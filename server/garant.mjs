/**
 * Sky Garant: сервис безопасных сделок между пользователями.
 *
 * Раньше вся Sky Garant жила в localStorage одного браузера
 * (src/garant/SkyGarant.tsx) — покупатель находился среди локальных
 * аккаунтов устройства, статусы менял сам клиент, а оплата покупателя
 * списывалась с кошелька и... нигде не появлялась: продавец не получал
 * денег даже при полностью «завершённой» сделке. Здесь — настоящий
 * эскроу: деньги покупателя списываются при внесении оплаты и
 * зачисляются продавцу только когда сделка действительно завершена
 * (оба подтвердили, либо администратор решил спор в его пользу), через
 * server/wallet.mjs — второго платёжного механизма нет.
 *
 * Что этот файл не делает никогда:
 *   · не читает status/price/участников, присланных клиентом, как
 *     истину — цена, стороны и статус всегда берутся из базы;
 *   · не завершает сделку и не переводит деньги иначе как через
 *     переходы состояний ниже — нет пути от «создана» сразу к
 *     «завершена» в обход депозитов и подтверждений;
 *   · не решает споры без права 'garant' и не спрашивает клиента,
 *     кто выиграл — только администратор с этим правом;
 *   · не двигает деньги мимо wallet.mjs.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { wallet } from './wallet.mjs';
import { pushGarant } from './signal.mjs';

export const DEAL_ID_RE = /^grt-[0-9a-f-]{36}$/;

const ITEM_TYPES = ['skin', 'gift', 'nft', 'currency', 'item', 'other'];
const MAX_TITLE = 80;
const MAX_ITEM_NAME = 60;
const MAX_DESC = 500;
const MAX_REASON = 1000;
const MAX_NOTE = 1000;
const MAX_PRICE = 5_000_000;

/** Бесплатно — 3 сделки в месяц в роли продавца, дальше нужен Sky Garant Pro. */
const FREE_MONTHLY_LIMIT = 3;
export const GARANT_PRO_PLAN = { price: 159, days: 30 };

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

const logGarant = async (dealId, actorId, action, detail = {}) => {
  try {
    await query(
      `INSERT INTO garant_audit_log (id, deal_id, actor_id, action, detail)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [`gal-${generateId()}`, dealId ?? null, actorId ?? null, text(action, 64), JSON.stringify(detail ?? {})]);
  } catch { /* журнал не должен ронять то, что он описывает */ }
};

const notifyGarant = async (userId, dealId, kind, textLine) => {
  if (!userId) return;
  const id = `gnn-${generateId()}`;
  await query(
    `INSERT INTO garant_notifications (id, user_id, deal_id, kind, text)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, userId, dealId ?? null, text(kind, 40), text(textLine, 200)]);
  pushGarant([userId], { type: 'garant-notification', payload: { id, kind, text: text(textLine, 200), dealId: dealId ?? null } });
};

/**
 * Вернуть покупателю удержанную сумму — рублями через wallet.refund,
 * баллами через wallet.creditPoints (у баллов нет отдельного refund,
 * зачисление с тем же эффектом). Общая точка на все четыре места, где
 * деньги возвращаются: раньше здесь была одна и та же ошибка —
 * `refundFn = payType==='points' ? null : wallet.refund` молча теряла
 * баллы покупателя при сбое или решении не в его пользу.
 */
/**
 * Возврат покупателю — ТОЛЬКО внутри транзакции сделки (client держит
 * вызывающий). Раньше возврат шёл отдельной транзакцией кошелька и
 * фиксировался сразу; если дальше что-то падало или два администратора
 * решали спор одновременно, деньги возвращались дважды.
 */
const refundDeal = (client, deal, descr) => {
  if (deal.pay_type === 'points') {
    return wallet.creditPointsIn(client, deal.buyer_id, deal.price, 'garant_refund', descr, deal.id);
  }
  return wallet.creditIn(client, deal.buyer_id, deal.price, 'refund', descr, deal.id);
};

/** Строка сделки под блокировкой до конца транзакции: решения по одной сделке идут по очереди. */
const lockDeal = async (client, dealId) => {
  const { rows } = await client.query('SELECT * FROM garant_deals WHERE id = $1 FOR UPDATE', [dealId]);
  return rows[0] ?? null;
};

/* ─── Выдача наружу ────────────────────────────────────────────────── */

const toDeal = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  sellerId: row.seller_id,
  sellerName: row.seller_name ?? undefined,
  sellerUsername: row.seller_username ?? undefined,
  buyerId: row.buyer_id,
  buyerName: row.buyer_name ?? undefined,
  buyerUsername: row.buyer_username ?? undefined,
  itemType: row.item_type,
  itemName: row.item_name,
  price: row.price,
  payType: row.pay_type,
  status: row.status,
  sellerDeposited: row.seller_deposited,
  buyerDeposited: row.buyer_deposited,
  sellerConfirmed: row.seller_confirmed,
  buyerConfirmed: row.buyer_confirmed,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  completedAt: row.completed_at?.toISOString?.() ?? null,
  cancelledAt: row.cancelled_at?.toISOString?.() ?? null,
  disputeReason: row.dispute_reason ?? undefined,
  disputeOpenedBy: row.dispute_opened_by ?? undefined,
  disputeAt: row.dispute_at?.toISOString?.() ?? undefined,
  disputeResult: row.dispute_result ?? undefined,
  disputeNote: row.dispute_note ?? undefined,
});

const DEAL_SELECT = `
  SELECT d.*,
         ps.name AS seller_name, ps.username AS seller_username,
         pb.name AS buyer_name,  pb.username AS buyer_username
    FROM garant_deals d
    JOIN profiles ps ON ps.id = d.seller_id
    JOIN profiles pb ON pb.id = d.buyer_id`;

const dealRow = async (dealId) => {
  const { rows } = await query(`${DEAL_SELECT} WHERE d.id = $1`, [dealId]);
  return rows[0] ?? null;
};

/** Мои сделки — как продавец, так и покупатель. */
export const myDeals = async (profileId) => {
  const { rows } = await query(
    `${DEAL_SELECT} WHERE d.seller_id = $1 OR d.buyer_id = $1 ORDER BY d.created_at DESC LIMIT 300`,
    [profileId]);
  return rows.map(toDeal);
};

const monthlyDealCount = async (profileId) => {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM garant_deals
      WHERE seller_id = $1 AND created_at >= date_trunc('month', now())`, [profileId]);
  return rows[0].n;
};

const subRow = async (profileId) => {
  const { rows } = await query('SELECT * FROM garant_subscriptions WHERE profile_id = $1', [profileId]);
  return rows[0] ?? null;
};

const hasProSubscription = async (profileId) => {
  const sub = await subRow(profileId);
  return !!sub && sub.status === 'active' && sub.until && new Date(sub.until).getTime() > Date.now();
};

/** Статус, счётчик месяца и подписка — то, что рисует главный экран. */
export const myGarantStatus = async (profileId) => {
  const [monthly, pro, sub] = await Promise.all([
    monthlyDealCount(profileId), hasProSubscription(profileId), subRow(profileId),
  ]);
  return {
    monthlyUsed: monthly,
    monthlyLimit: FREE_MONTHLY_LIMIT,
    hasSubscription: pro,
    subscriptionUntil: sub?.until?.toISOString?.() ?? null,
  };
};

/* ─── Создание сделки ──────────────────────────────────────────────── */

/**
 * Создаёт сделку. Покупатель — реальный Sky ID, найденный тем же
 * поиском, что и в Sky Family/Мессенджере (server/directory.mjs) на
 * клиенте; сюда приходит уже разрешённый id, не никнейм с фронта.
 */
export const createDeal = async (actorId, params) => {
  const buyerId = String(params?.buyerId ?? '');
  if (!buyerId) return { error: 'no_such_user' };
  if (buyerId === actorId) return { error: 'self_deal' };

  const itemType = String(params?.itemType ?? '');
  if (!ITEM_TYPES.includes(itemType)) return { error: 'bad_item_type' };

  const itemName = text(params?.itemName, MAX_ITEM_NAME);
  if (!itemName) return { error: 'bad_item_name' };

  const title = text(params?.title, MAX_TITLE) || itemName;
  const description = text(params?.description, MAX_DESC);

  const payType = params?.payType === 'points' ? 'points' : 'rubles';
  const price = Number(params?.price);
  if (!Number.isInteger(price) || price <= 0 || price > MAX_PRICE) return { error: 'bad_price' };

  const { rows: buyer } = await query('SELECT id FROM profiles WHERE id = $1', [buyerId]);
  if (!buyer[0]) return { error: 'no_such_user' };

  if (!(await hasProSubscription(actorId))) {
    const used = await monthlyDealCount(actorId);
    if (used >= FREE_MONTHLY_LIMIT) return { error: 'monthly_limit' };
  }

  const id = `grt-${generateId()}`;
  await query(
    `INSERT INTO garant_deals (id, seller_id, buyer_id, title, description, item_type, item_name, price, pay_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, actorId, buyerId, title, description, itemType, itemName, price, payType]);

  await logGarant(id, actorId, 'deal_created', { buyerId, itemType, itemName, price, payType });
  await notifyGarant(buyerId, id, 'created', `Вам предложена сделка Sky Garant: «${title}»`);
  return { deal: toDeal(await dealRow(id)) };
};

/* ─── Депозиты ─────────────────────────────────────────────────────── */

/** Продавец вносит товар гаранту. Первый шаг — до него покупатель внести оплату не может. */
export const depositSeller = async (actorId, dealId) => {
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  if (!deal || deal.seller_id !== actorId) return { error: 'not_found' };
  if (deal.status !== 'pending_seller') return { error: 'bad_status' };

  const { rows } = await query(
    `UPDATE garant_deals SET seller_deposited = TRUE, status = 'pending_buyer'
      WHERE id = $1 AND status = 'pending_seller' RETURNING *`, [dealId]);
  if (!rows[0]) return { error: 'bad_status' };
  await logGarant(dealId, actorId, 'seller_deposited', {});
  await notifyGarant(deal.buyer_id, dealId, 'seller_deposited', `Продавец внёс товар по сделке «${deal.title}» — можно оплачивать`);
  return { deal: toDeal(await dealRow(dealId)) };
};

/**
 * Покупатель вносит оплату — реальное списание с кошелька (эскроу).
 * Деньги «у гаранта» до завершения сделки: баланс продавца не меняется
 * здесь — зачисление происходит только в completeDeal.
 */
export const depositBuyer = async (actorId, dealId) => {
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  if (!deal || deal.buyer_id !== actorId) return { error: 'not_found' };
  if (deal.status !== 'pending_buyer') return { error: 'bad_status' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Списание и переход в эскроу — одной транзакцией: либо оба, либо ничего.
    const locked = await lockDeal(client, dealId);
    if (!locked || locked.status !== 'pending_buyer' || locked.buyer_id !== actorId) {
      await client.query('ROLLBACK');
      return { error: 'bad_status' };
    }
    const paid = deal.pay_type === 'points'
      ? await wallet.spendPointsIn(client, actorId, deal.price, 'points_spend', `Sky Garant: ${deal.title}`, dealId)
      : await wallet.spendIn(client, actorId, deal.price, 'garant_escrow', `Sky Garant: ${deal.title}`, dealId);
    if (paid.error) { await client.query('ROLLBACK'); return paid; }
    await client.query(
      `UPDATE garant_deals SET buyer_deposited = TRUE, status = 'in_escrow' WHERE id = $1`, [dealId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await logGarant(dealId, actorId, 'buyer_deposited', { price: deal.price, payType: deal.pay_type });
  await notifyGarant(deal.seller_id, dealId, 'buyer_deposited', `Покупатель внёс оплату по сделке «${deal.title}» — сделка у гаранта`);
  return { deal: toDeal(await dealRow(dealId)) };
};

/* ─── Завершение сделки ────────────────────────────────────────────── */

/**
 * Зачисляет продавцу и закрывает сделку. Общая точка для трёх путей:
 * оба подтвердили, администратор force-подтвердил обе стороны,
 * администратор решил спор в пользу продавца — everywhere деньги
 * переходят от «удержаны» к «у продавца» ровно один раз.
 */
const completeDeal = async (client, deal) => {
  // Зачисление — в той же транзакции, что и перевод сделки в completed:
  // раньше оно фиксировалось отдельно, и сбой между двумя шагами оставлял
  // деньги у продавца при незавершённой сделке (повторное подтверждение
  // платило бы второй раз).
  const creditFn = deal.pay_type === 'points' ? wallet.creditPointsIn : wallet.creditIn;
  const credited = await creditFn(
    client, deal.seller_id, deal.price, 'garant_payout', `Sky Garant: получено за «${deal.title}»`, deal.id);
  if (credited.error) throw Object.assign(new Error('credit_failed'), { code: 'GARANT_CREDIT_FAILED' });
  await client.query(
    `UPDATE garant_deals SET status = 'completed', completed_at = now() WHERE id = $1`, [deal.id]);
};

export const confirmBuyer = async (actorId, dealId) => {
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  if (!deal || deal.buyer_id !== actorId) return { error: 'not_found' };
  if (deal.status !== 'in_escrow') return { error: 'bad_status' };
  if (deal.buyer_confirmed) return { error: 'already_confirmed' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE garant_deals SET buyer_confirmed = TRUE
        WHERE id = $1 AND status = 'in_escrow' AND buyer_confirmed = FALSE RETURNING *`, [dealId]);
    const updated = rows[0];
    if (!updated) throw Object.assign(new Error('bad_status'), { code: 'GARANT_BAD_STATUS' });
    if (updated.seller_confirmed) await completeDeal(client, updated);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'GARANT_BAD_STATUS') return { error: 'bad_status' };
    throw err;
  } finally {
    client.release();
  }

  const done = await dealRow(dealId);
  await logGarant(dealId, actorId, 'buyer_confirmed', {});
  await notifyGarant(deal.seller_id, dealId, 'buyer_confirmed', `Покупатель подтвердил получение по сделке «${deal.title}»`);
  if (done.status === 'completed') {
    await logGarant(dealId, actorId, 'deal_completed', {});
    await notifyGarant(deal.seller_id, dealId, 'completed', `Сделка «${deal.title}» завершена — деньги зачислены`);
    await notifyGarant(deal.buyer_id, dealId, 'completed', `Сделка «${deal.title}» завершена`);
  }
  return { deal: toDeal(done) };
};

export const confirmSeller = async (actorId, dealId) => {
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  if (!deal || deal.seller_id !== actorId) return { error: 'not_found' };
  if (deal.status !== 'in_escrow') return { error: 'bad_status' };
  if (deal.seller_confirmed) return { error: 'already_confirmed' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE garant_deals SET seller_confirmed = TRUE
        WHERE id = $1 AND status = 'in_escrow' AND seller_confirmed = FALSE RETURNING *`, [dealId]);
    const updated = rows[0];
    if (!updated) throw Object.assign(new Error('bad_status'), { code: 'GARANT_BAD_STATUS' });
    if (updated.buyer_confirmed) await completeDeal(client, updated);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'GARANT_BAD_STATUS') return { error: 'bad_status' };
    throw err;
  } finally {
    client.release();
  }

  const done = await dealRow(dealId);
  await logGarant(dealId, actorId, 'seller_confirmed', {});
  await notifyGarant(deal.buyer_id, dealId, 'seller_confirmed', `Продавец подтвердил получение оплаты по сделке «${deal.title}»`);
  if (done.status === 'completed') {
    await logGarant(dealId, actorId, 'deal_completed', {});
    await notifyGarant(deal.seller_id, dealId, 'completed', `Сделка «${deal.title}» завершена — деньги зачислены`);
    await notifyGarant(deal.buyer_id, dealId, 'completed', `Сделка «${deal.title}» завершена`);
  }
  return { deal: toDeal(done) };
};

/* ─── Отмена (до эскроу) ───────────────────────────────────────────── */

/** Отменить на раннем этапе. Покупатель ещё не платил — возвращать нечего. */
export const cancelDeal = async (actorId, dealId) => {
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  if (!deal || (deal.seller_id !== actorId && deal.buyer_id !== actorId)) return { error: 'not_found' };
  if (!['pending_seller', 'pending_buyer'].includes(deal.status)) return { error: 'bad_status' };

  const { rows } = await query(
    `UPDATE garant_deals SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2
      WHERE id = $1 AND status IN ('pending_seller','pending_buyer') RETURNING *`, [dealId, actorId]);
  if (!rows[0]) return { error: 'bad_status' };
  await logGarant(dealId, actorId, 'deal_cancelled', {});
  const other = actorId === deal.seller_id ? deal.buyer_id : deal.seller_id;
  await notifyGarant(other, dealId, 'cancelled', `Сделка «${deal.title}» отменена`);
  return { deal: toDeal(await dealRow(dealId)) };
};

/* ─── Споры ─────────────────────────────────────────────────────────── */

export const openDispute = async (actorId, dealId, reason) => {
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  if (!deal || (deal.seller_id !== actorId && deal.buyer_id !== actorId)) return { error: 'not_found' };
  if (deal.status !== 'in_escrow') return { error: 'bad_status' };
  const clean = text(reason, MAX_REASON);
  if (!clean) return { error: 'bad_reason' };

  const { rows } = await query(
    `UPDATE garant_deals
        SET status = 'disputed', dispute_reason = $2, dispute_opened_by = $3, dispute_at = now()
      WHERE id = $1 AND status = 'in_escrow' RETURNING *`,
    [dealId, clean, actorId]);
  if (!rows[0]) return { error: 'bad_status' };
  await logGarant(dealId, actorId, 'dispute_opened', { reason: clean });
  const other = actorId === deal.seller_id ? deal.buyer_id : deal.seller_id;
  await notifyGarant(other, dealId, 'disputed', `По сделке «${deal.title}» открыт спор`);
  return { deal: toDeal(await dealRow(dealId)) };
};

/* ─── Подписка Sky Garant Pro ──────────────────────────────────────── */

export const purchaseSubscription = async (actorId) => {
  const paid = await wallet.spend(actorId, GARANT_PRO_PLAN.price, 'garant_subscription',
    `Sky Garant Pro · ${GARANT_PRO_PLAN.days} дн.`);
  if (paid.error) return paid;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO garant_subscriptions (profile_id, status, started_at, until, updated_at)
       VALUES ($1, 'active', now(), now() + ($2::int * interval '1 day'), now())
       ON CONFLICT (profile_id) DO UPDATE
         SET status = 'active',
             started_at = COALESCE(garant_subscriptions.started_at, now()),
             until = GREATEST(COALESCE(garant_subscriptions.until, now()), now()) + ($2::int * interval '1 day'),
             updated_at = now()
       RETURNING *`,
      [actorId, GARANT_PRO_PLAN.days]);
    await client.query('COMMIT');
    await logGarant(null, actorId, 'subscription_purchased', { days: GARANT_PRO_PLAN.days, price: GARANT_PRO_PLAN.price });
    return { until: rows[0].until.toISOString(), balance: paid.balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await wallet.refund(actorId, GARANT_PRO_PLAN.price, 'Sky Garant Pro: возврат за сбой продления').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Уведомления ──────────────────────────────────────────────────── */

export const listNotifications = async (profileId, { limit } = {}) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await query(
    `SELECT * FROM garant_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [profileId, lim]);
  return rows.map((r) => ({
    id: r.id, dealId: r.deal_id, kind: r.kind, text: r.text, read: r.read,
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};

export const readNotification = async (profileId, id) => {
  const { rowCount } = await query(
    `UPDATE garant_notifications SET read = TRUE WHERE id = $1 AND user_id = $2`, [String(id ?? ''), profileId]);
  return rowCount > 0;
};

/* ─── Админ-панель ─────────────────────────────────────────────────── */

export const adminListDeals = async (adminId, { status, q, limit } = {}) => {
  if (!(await can(adminId, 'garant'))) return null;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const args = [];
  const where = [];
  if (status && ['pending_seller', 'pending_buyer', 'in_escrow', 'completed', 'cancelled', 'disputed'].includes(String(status))) {
    args.push(status); where.push(`d.status = $${args.length}`);
  }
  const needle = text(q, 60).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`(lower(d.title) LIKE $${args.length} ESCAPE '\\' OR lower(ps.username) LIKE $${args.length} ESCAPE '\\' OR lower(pb.username) LIKE $${args.length} ESCAPE '\\')`);
  }
  args.push(lim);
  const { rows } = await query(
    `${DEAL_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY d.created_at DESC LIMIT $${args.length}`, args);
  return rows.map(toDeal);
};

export const adminDealDetail = async (adminId, dealId) => {
  if (!(await can(adminId, 'garant'))) return null;
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return null;
  const deal = await dealRow(dealId);
  if (!deal) return null;
  const { rows: log } = await query(
    `SELECT * FROM garant_audit_log WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 100`, [dealId]);
  return {
    deal: toDeal(deal),
    log: log.map((r) => ({
      id: r.id, actorId: r.actor_id, action: r.action,
      detail: r.detail, createdAt: r.created_at?.toISOString?.() ?? undefined,
    })),
  };
};

/**
 * Решить спор. Право 'garant' — как у Sky Market своих споров
 * (server/marketorders.mjs::resolveDispute), без двух ключей: деньги
 * уже удержаны в конкретной сделке, это не создание новых денег
 * администратором, а решение, кому отдать уже удержанное.
 *
 *  seller_wins → зачислить продавцу, sделка завершена;
 *  buyer_wins  → вернуть покупателю, сделка завершена;
 *  cancelled   → вернуть покупателю, сделка отменена (не «завершена» —
 *                в исходном моке оба случая ошибочно помечались
 *                completed; здесь это исправлено).
 */
export const adminResolveDispute = async (adminId, dealId, winner, note) => {
  if (!(await can(adminId, 'garant'))) return { error: 'not_allowed' };
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  if (!['seller_wins', 'buyer_wins', 'cancelled'].includes(String(winner))) return { error: 'bad_winner' };
  const clean = text(note, MAX_NOTE);
  if (!clean) return { error: 'bad_note' };

  const pre = await dealRow(dealId);
  if (!pre) return { error: 'bad_status' };
  let deal = pre;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Блокировка строки: два администратора (или двойной клик) решают спор
    // по очереди, и второй видит уже не 'disputed'. Раньше оба читали статус
    // до записи, оба платили и деньги уходили дважды — в том числе
    // «и продавцу, и покупателю».
    deal = await lockDeal(client, dealId);
    if (!deal || deal.status !== 'disputed') {
      await client.query('ROLLBACK');
      return { error: 'bad_status' };
    }
    if (winner === 'seller_wins') {
      await completeDeal(client, deal);
      await client.query(
        `UPDATE garant_deals SET buyer_confirmed = TRUE, seller_confirmed = TRUE,
                dispute_result = $2, dispute_note = $3, dispute_resolved_by = $4, dispute_resolved_at = now()
          WHERE id = $1`, [dealId, winner, clean, adminId]);
    } else if (winner === 'buyer_wins') {
      const refunded = await refundDeal(client, deal, `Sky Garant: спор решён в пользу покупателя — «${deal.title}»`);
      if (refunded.error) throw Object.assign(new Error('refund_failed'), { code: 'GARANT_REFUND_FAILED' });
      await client.query(
        `UPDATE garant_deals SET status = 'completed', completed_at = now(),
                buyer_confirmed = TRUE, seller_confirmed = TRUE,
                dispute_result = $2, dispute_note = $3, dispute_resolved_by = $4, dispute_resolved_at = now()
          WHERE id = $1`, [dealId, winner, clean, adminId]);
    } else {
      const refunded = await refundDeal(client, deal, `Sky Garant: сделка отменена администратором — «${deal.title}»`);
      if (refunded.error) throw Object.assign(new Error('refund_failed'), { code: 'GARANT_REFUND_FAILED' });
      await client.query(
        `UPDATE garant_deals SET status = 'cancelled', cancelled_at = now(), cancelled_by = $4,
                dispute_result = $2, dispute_note = $3, dispute_resolved_by = $4, dispute_resolved_at = now()
          WHERE id = $1`, [dealId, winner, clean, adminId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'GARANT_REFUND_FAILED' || err.code === 'GARANT_CREDIT_FAILED') return { error: 'refund_failed' };
    throw err;
  } finally {
    client.release();
  }

  await logGarant(dealId, adminId, 'dispute_resolved', { winner, note: clean });
  await notifyGarant(deal.seller_id, dealId, 'dispute_resolved', `Спор по сделке «${deal.title}» решён администратором`);
  await notifyGarant(deal.buyer_id, dealId, 'dispute_resolved', `Спор по сделке «${deal.title}» решён администратором`);
  return { deal: toDeal(await dealRow(dealId)) };
};

/** Force-подтвердить за сторону, которая явно уклоняется. Право 'garant'. */
export const adminForceConfirm = async (adminId, dealId, side) => {
  if (!(await can(adminId, 'garant'))) return { error: 'not_allowed' };
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  if (!['buyer', 'seller'].includes(String(side))) return { error: 'bad_side' };

  const deal = await dealRow(dealId);
  if (!deal || deal.status !== 'in_escrow') return { error: 'bad_status' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const col = side === 'buyer' ? 'buyer_confirmed' : 'seller_confirmed';
    const { rows } = await client.query(
      `UPDATE garant_deals SET ${col} = TRUE
        WHERE id = $1 AND status = 'in_escrow' AND ${col} = FALSE RETURNING *`, [dealId]);
    const updated = rows[0];
    if (!updated) throw Object.assign(new Error('bad_status'), { code: 'GARANT_BAD_STATUS' });
    if (updated.buyer_confirmed && updated.seller_confirmed) await completeDeal(client, updated);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'GARANT_BAD_STATUS') return { error: 'bad_status' };
    throw err;
  } finally {
    client.release();
  }

  await logGarant(dealId, adminId, 'admin_force_confirm', { side });
  return { deal: toDeal(await dealRow(dealId)) };
};

/** Принудительно отменить зависшую сделку у гаранта. Право 'garant'. Покупателю — возврат. */
export const adminForceCancel = async (adminId, dealId) => {
  if (!(await can(adminId, 'garant'))) return { error: 'not_allowed' };
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };

  if (!(await dealRow(dealId))) return { error: 'not_found' };

  let deal;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Та же очередность, что и при решении спора: возврат и отмена в одной
    // транзакции под блокировкой строки — повторный запрос уже ничего не вернёт.
    deal = await lockDeal(client, dealId);
    if (!deal || !['pending_seller', 'pending_buyer', 'in_escrow'].includes(deal.status)) {
      await client.query('ROLLBACK');
      return { error: 'bad_status' };
    }
    if (deal.buyer_deposited) {
      const refunded = await refundDeal(client, deal, `Sky Garant: сделка отменена администратором — «${deal.title}»`);
      if (refunded.error) throw Object.assign(new Error('refund_failed'), { code: 'GARANT_REFUND_FAILED' });
    }
    await client.query(
      `UPDATE garant_deals SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2 WHERE id = $1`,
      [dealId, adminId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'GARANT_REFUND_FAILED') return { error: 'refund_failed' };
    throw err;
  } finally {
    client.release();
  }
  await logGarant(dealId, adminId, 'admin_force_cancel', {});
  await notifyGarant(deal.seller_id, dealId, 'cancelled', `Сделка «${deal.title}» отменена администратором`);
  await notifyGarant(deal.buyer_id, dealId, 'cancelled', `Сделка «${deal.title}» отменена администратором`);
  return { deal: toDeal(await dealRow(dealId)) };
};
