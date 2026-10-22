/**
 * Sky Garant: сделка с проверкой данных (flow 'sale') и обмен (flow 'exchange').
 *
 * Сделка с проверкой:  awaiting_data → verifying → paid → completed
 *   продавец передаёт данные гаранту и подтверждает, что они верны → открывается режим проверки: покупатель видит данные
 *   и кнопку «Оплатить» → оплата списывается в эскроу (кошелёк, как в прежнем Garant) → продавец подтверждает закрытие → деньги продавцу.
 * Обмен:  awaiting_data → confirming → verifying → completed
 *   обе стороны передают данные гаранту → каждая подтверждает, что её данные верны (после этого не правятся) → режим проверки:
 *   каждая видит данные другой и подтверждает «всё верно»; обе подтвердили — обмен завершён. Денег нет.
 * Спор — из режима проверки (и после оплаты): «что-то не так». Решает сотрудник с правом `garant`.
 *
 * Данные лежат зашифрованными (garant_deal_data), другой стороне отдаются только в режиме проверки, каждое открытие пишется в журнал
 * (`data_viewed`) — по нему видно, кто и когда смотрел. Подтвердить «верно» или оплатить, не открыв данные, нельзя.
 * Деньги — только через wallet.mjs в транзакции сделки под FOR UPDATE; отмена возможна лишь до режима проверки.
 */
import { pool, query } from './db.mjs';
import { can } from './admin.mjs';
import { wallet } from './wallet.mjs';
import { generateId } from './security.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { notifyStaff } from './staffnotify.mjs';
import {
  DEAL_ID_RE, text, logGarant, notifyGarant, lockDeal, completeDeal, refundDeal, toDeal, dealRow, monthlyDealCount, hasProSubscription,
} from './garant.mjs';

const FLOWS = ['sale', 'exchange'];
const ITEM_TYPES = ['skin', 'gift', 'nft', 'currency', 'item', 'other'];
const MAX_PRICE = 5_000_000;
const FREE_MONTHLY_LIMIT = 3;
const MAX_FIELDS = 10, MAX_LABEL = 60, MAX_VALUE = 500, MAX_NOTE = 1000, MAX_TOTAL = 6000;
const REVEAL = ['verifying', 'paid', 'completed', 'disputed'];

const roleOf = (deal, actor) => (deal.seller_id === actor ? 'seller' : deal.buyer_id === actor ? 'buyer' : null);
const other = (role) => (role === 'seller' ? 'buyer' : 'seller');
const done = async (id) => ({ deal: toDeal(await dealRow(id)) });
const load = async (actor, dealId) => {
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  const role = deal ? roleOf(deal, actor) : null;
  if (!deal || !role || !FLOWS.includes(deal.flow)) return { error: 'not_found' };
  return { deal, role };
};

const cleanData = (input) => {
  const raw = Array.isArray(input?.fields) ? input.fields : [];
  const fields = raw.slice(0, MAX_FIELDS).map((f) => ({ label: text(f?.label, MAX_LABEL), value: text(f?.value, MAX_VALUE) })).filter((f) => f.label && f.value);
  if (!fields.length) return null;
  const note = text(input?.note, MAX_NOTE);
  if (JSON.stringify({ fields, note }).length > MAX_TOTAL) return null;
  return { fields, note };
};
const readData = (row) => { try { const t = decryptSecret(row.data_enc); return t ? JSON.parse(t) : null; } catch { return null; } };

/* ─── Создание ─── */
export const createVerifiedDeal = async (actor, params) => {
  const flow = String(params?.flow ?? '');
  if (!FLOWS.includes(flow)) return { error: 'bad_flow' };
  const counter = String(params?.counterpartyId ?? '');
  if (!counter) return { error: 'no_such_user' };
  if (counter === actor) return { error: 'self_deal' };
  const itemType = String(params?.itemType ?? '');
  if (!ITEM_TYPES.includes(itemType)) return { error: 'bad_item_type' };
  const itemName = text(params?.itemName, 60); if (!itemName) return { error: 'bad_item_name' };
  const counterItem = flow === 'exchange' ? text(params?.counterItemName, 60) : '';
  if (flow === 'exchange' && !counterItem) return { error: 'bad_counter_item' };
  const title = text(params?.title, 80) || itemName;
  const description = text(params?.description, 500);
  const payType = params?.payType === 'points' ? 'points' : 'rubles';
  let price = 0;
  if (flow === 'sale') { price = Number(params?.price); if (!Number.isInteger(price) || price <= 0 || price > MAX_PRICE) return { error: 'bad_price' }; }
  if (!(await query('SELECT 1 FROM profiles WHERE id = $1', [counter])).rowCount) return { error: 'no_such_user' };
  if (!(await hasProSubscription(actor)) && (await monthlyDealCount(actor)) >= FREE_MONTHLY_LIMIT) return { error: 'monthly_limit' };

  // продавец (в обмене — инициатор) = actor; покупатель (в обмене — вторая сторона) = counter
  const id = `grt-${generateId()}`;
  await query(
    `INSERT INTO garant_deals (id, seller_id, buyer_id, title, description, item_type, item_name, price, pay_type, flow, counter_item_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'awaiting_data')`, [id, actor, counter, title, description, itemType, itemName, price, payType, flow, counterItem]);
  await logGarant(id, actor, 'deal_created', { flow, counter, itemType, price, payType });
  await notifyGarant(counter, id, 'created', flow === 'exchange' ? `Вам предложен обмен через Sky Garant: «${title}»` : `Вам предложена сделка Sky Garant с проверкой: «${title}»`);
  return done(id);
};

/* ─── Данные сторон ─── */
export const submitData = async (actor, dealId, input) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  const data = cleanData(input); if (!data) return { error: 'bad_data' };
  if (deal.flow === 'sale' && role !== 'seller') return { error: 'not_allowed' };
  if (!['awaiting_data', 'confirming'].includes(deal.status)) return { error: 'bad_status' };
  if (deal.flow === 'sale' && input?.confirmed !== true) return { error: 'confirm_required' };   // продавец подтверждает, что данные верны

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const d = await lockDeal(c, dealId);
    if (!d || !['awaiting_data', 'confirming'].includes(d.status)) { await c.query('ROLLBACK'); return { error: 'bad_status' }; }
    const cur = (await c.query('SELECT confirmed_at FROM garant_deal_data WHERE deal_id = $1 AND side = $2', [dealId, role])).rows[0];
    if (cur?.confirmed_at) { await c.query('ROLLBACK'); return { error: 'data_locked' }; }
    const sale = d.flow === 'sale';
    await c.query(
      `INSERT INTO garant_deal_data (deal_id, side, data_enc, submitted_at, confirmed_at) VALUES ($1,$2,$3, now(), ${sale ? 'now()' : 'NULL'})
       ON CONFLICT (deal_id, side) DO UPDATE SET data_enc = EXCLUDED.data_enc, submitted_at = now(), confirmed_at = ${sale ? 'now()' : 'NULL'}`, [dealId, role, encryptSecret(JSON.stringify(data))]);
    if (sale) await c.query(`UPDATE garant_deals SET status = 'verifying', seller_deposited = TRUE WHERE id = $1`, [dealId]);
    else {
      const both = (await c.query('SELECT count(*)::int n FROM garant_deal_data WHERE deal_id = $1', [dealId])).rows[0].n === 2;
      if (both) await c.query(`UPDATE garant_deals SET status = 'confirming' WHERE id = $1 AND status = 'awaiting_data'`, [dealId]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }

  await logGarant(dealId, actor, 'data_submitted', { side: role });
  const dest = other(role) === 'seller' ? deal.seller_id : deal.buyer_id;
  if (deal.flow === 'sale') await notifyGarant(dest, dealId, 'verifying', `Продавец передал данные по сделке «${deal.title}» — проверьте их и оплатите`);
  else await notifyGarant(dest, dealId, 'data_submitted', `Вторая сторона передала данные по обмену «${deal.title}»`);
  return done(dealId);
};

/** Обмен: сторона подтверждает, что её данные верны (после этого не правятся). Обе подтвердили — открывается режим проверки. */
export const confirmOwnData = async (actor, dealId) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  if (deal.flow !== 'exchange') return { error: 'bad_flow' };
  if (deal.status !== 'confirming') return { error: 'bad_status' };
  const c = await pool.connect(); let both = false;
  try {
    await c.query('BEGIN');
    const d = await lockDeal(c, dealId);
    if (!d || d.status !== 'confirming') { await c.query('ROLLBACK'); return { error: 'bad_status' }; }
    const up = await c.query('UPDATE garant_deal_data SET confirmed_at = now() WHERE deal_id = $1 AND side = $2 AND confirmed_at IS NULL', [dealId, role]);
    if (!up.rowCount) { await c.query('ROLLBACK'); return { error: 'already_confirmed' }; }
    both = (await c.query('SELECT count(*)::int n FROM garant_deal_data WHERE deal_id = $1 AND confirmed_at IS NOT NULL', [dealId])).rows[0].n === 2;
    if (both) await c.query(`UPDATE garant_deals SET status = 'verifying' WHERE id = $1`, [dealId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logGarant(dealId, actor, 'data_confirmed', { side: role });
  if (both) {
    await notifyGarant(deal.seller_id, dealId, 'verifying', `Обмен «${deal.title}»: открыт режим проверки`);
    await notifyGarant(deal.buyer_id, dealId, 'verifying', `Обмен «${deal.title}»: открыт режим проверки`);
  } else await notifyGarant(other(role) === 'seller' ? deal.seller_id : deal.buyer_id, dealId, 'data_confirmed', `Вторая сторона подтвердила свои данные по обмену «${deal.title}»`);
  return done(dealId);
};

/** Что видит человек: свои данные всегда, чужие — только в режиме проверки (и после). Каждое открытие чужих данных пишется в журнал. */
export const viewData = async (actor, dealId) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  const rows = (await query('SELECT side, data_enc, submitted_at, confirmed_at FROM garant_deal_data WHERE deal_id = $1', [dealId])).rows;
  const pack = (r) => (r ? { ...readData(r), submittedAt: r.submitted_at.toISOString(), confirmed: Boolean(r.confirmed_at) } : null);
  const mine = pack(rows.find((r) => r.side === role));
  // в сделке данные передаёт только продавец; в обмене — обе стороны
  const canSee = REVEAL.includes(deal.status) && (deal.flow === 'exchange' || role === 'buyer');
  const theirsRow = canSee ? rows.find((r) => r.side === other(role)) : null;
  if (theirsRow) await logGarant(dealId, actor, 'data_viewed', { side: other(role) });
  return { role, status: deal.status, mine, theirs: pack(theirsRow ?? null), canSeeTheirs: canSee };
};
const hasViewed = async (actor, dealId) => (await query(`SELECT 1 FROM garant_audit_log WHERE deal_id = $1 AND actor_id = $2 AND action = 'data_viewed' LIMIT 1`, [dealId, actor])).rowCount > 0;

/** Обмен: «всё верно» по данным другой стороны. Обе стороны подтвердили — обмен завершён. */
export const approveData = async (actor, dealId) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  if (deal.flow !== 'exchange') return { error: 'bad_flow' };
  if (deal.status !== 'verifying') return { error: 'bad_status' };
  if (!(await hasViewed(actor, dealId))) return { error: 'view_first' };      // подтвердить вслепую нельзя
  const col = role === 'seller' ? 'seller_approved' : 'buyer_approved';
  const c = await pool.connect(); let finished = false;
  try {
    await c.query('BEGIN');
    const d = await lockDeal(c, dealId);
    if (!d || d.status !== 'verifying') { await c.query('ROLLBACK'); return { error: 'bad_status' }; }
    if (d[col]) { await c.query('ROLLBACK'); return { error: 'already_confirmed' }; }
    const up = await c.query(`UPDATE garant_deals SET ${col} = TRUE WHERE id = $1 RETURNING seller_approved, buyer_approved`, [dealId]);
    if (up.rows[0].seller_approved && up.rows[0].buyer_approved) { await c.query(`UPDATE garant_deals SET status = 'completed', completed_at = now(), seller_confirmed = TRUE, buyer_confirmed = TRUE WHERE id = $1`, [dealId]); finished = true; }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logGarant(dealId, actor, 'data_approved', { side: role });
  if (finished) { await logGarant(dealId, actor, 'deal_completed', {}); for (const id of [deal.seller_id, deal.buyer_id]) await notifyGarant(id, dealId, 'completed', `Обмен «${deal.title}» завершён`); }
  else await notifyGarant(other(role) === 'seller' ? deal.seller_id : deal.buyer_id, dealId, 'data_approved', `Вторая сторона подтвердила данные по обмену «${deal.title}»`);
  return done(dealId);
};

/* ─── Сделка: оплата и закрытие ─── */
export const payDeal = async (actor, dealId) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  if (deal.flow !== 'sale' || role !== 'buyer') return { error: 'not_allowed' };
  if (deal.status !== 'verifying') return { error: 'bad_status' };
  if (!(await hasViewed(actor, dealId))) return { error: 'view_first' };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const d = await lockDeal(c, dealId);
    if (!d || d.status !== 'verifying' || d.buyer_id !== actor) { await c.query('ROLLBACK'); return { error: 'bad_status' }; }
    const paid = d.pay_type === 'points'
      ? await wallet.spendPointsIn(c, actor, d.price, 'points_spend', `Sky Garant: ${d.title}`, dealId)
      : await wallet.spendIn(c, actor, d.price, 'garant_escrow', `Sky Garant: ${d.title}`, dealId);
    if (paid.error) { await c.query('ROLLBACK'); return paid; }
    await c.query(`UPDATE garant_deals SET buyer_deposited = TRUE, status = 'paid' WHERE id = $1`, [dealId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logGarant(dealId, actor, 'buyer_deposited', { price: deal.price, payType: deal.pay_type });
  await notifyGarant(deal.seller_id, dealId, 'buyer_deposited', `Покупатель оплатил сделку «${deal.title}» — подтвердите закрытие`);
  return done(dealId);
};

/** Продавец подтверждает закрытие: деньги из эскроу — продавцу (одна транзакция). */
export const closeDeal = async (actor, dealId) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  if (deal.flow !== 'sale' || role !== 'seller') return { error: 'not_allowed' };
  if (deal.status !== 'paid') return { error: 'bad_status' };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const d = await lockDeal(c, dealId);
    if (!d || d.status !== 'paid' || !d.buyer_deposited) { await c.query('ROLLBACK'); return { error: 'bad_status' }; }
    await completeDeal(c, d);
    await c.query('UPDATE garant_deals SET seller_confirmed = TRUE, buyer_confirmed = TRUE WHERE id = $1', [dealId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); if (e.code === 'GARANT_CREDIT_FAILED') return { error: 'refund_failed' }; throw e; } finally { c.release(); }
  await logGarant(dealId, actor, 'deal_completed', {});
  await notifyGarant(deal.seller_id, dealId, 'completed', `Сделка «${deal.title}» закрыта — деньги зачислены`);
  await notifyGarant(deal.buyer_id, dealId, 'completed', `Сделка «${deal.title}» закрыта`);
  return done(dealId);
};

/* ─── Отмена (только до режима проверки) и спор ─── */
export const cancelVerified = async (actor, dealId) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  if (!['awaiting_data', 'confirming'].includes(deal.status)) return { error: 'bad_status' };   // в режиме проверки — только спор или решение
  const { rows } = await query(`UPDATE garant_deals SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2 WHERE id = $1 AND status IN ('awaiting_data','confirming') RETURNING id`, [dealId, actor]);
  if (!rows[0]) return { error: 'bad_status' };
  await logGarant(dealId, actor, 'deal_cancelled', {});
  await notifyGarant(other(role) === 'seller' ? deal.seller_id : deal.buyer_id, dealId, 'cancelled', `Сделка «${deal.title}» отменена`);
  return done(dealId);
};

export const openVerifyDispute = async (actor, dealId, reason) => {
  const l = await load(actor, dealId); if (l.error) return l;
  const { deal, role } = l;
  if (!['verifying', 'paid'].includes(deal.status)) return { error: 'bad_status' };
  if (deal.status === 'verifying' && !(await hasViewed(actor, dealId)) && !(deal.flow === 'sale' && role === 'seller')) return { error: 'view_first' };   // «что-то не так» — после просмотра
  const clean = text(reason, 1000); if (!clean) return { error: 'bad_reason' };
  const { rows } = await query(
    `UPDATE garant_deals SET status = 'disputed', dispute_from = status, dispute_reason = $2, dispute_opened_by = $3, dispute_at = now()
      WHERE id = $1 AND status IN ('verifying','paid') RETURNING id`, [dealId, clean, actor]);
  if (!rows[0]) return { error: 'bad_status' };
  await logGarant(dealId, actor, 'dispute_opened', { reason: clean, from: deal.status });
  await notifyGarant(other(role) === 'seller' ? deal.seller_id : deal.buyer_id, dealId, 'disputed', `По сделке «${deal.title}» открыт спор`);
  void notifyStaff('garant', { title: 'Спор по сделке Гаранта', body: 'Открыт спор в режиме проверки — нужен арбитр.', dedupe: `${dealId}:dispute`, except: actor });
  return done(dealId);
};

/* ─── Администрация ─── */
/** Данные сторон открывает сотрудник только в споре; каждый просмотр — в журнале. */
export const adminViewData = async (adminId, dealId) => {
  if (!(await can(adminId, 'garant'))) return { error: 'not_allowed' };
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  const deal = await dealRow(dealId);
  if (!deal || !FLOWS.includes(deal.flow)) return { error: 'not_found' };
  if (deal.status !== 'disputed') return { error: 'bad_status' };
  const rows = (await query('SELECT side, data_enc, submitted_at, confirmed_at FROM garant_deal_data WHERE deal_id = $1', [dealId])).rows;
  await logGarant(dealId, adminId, 'admin_data_viewed', {});
  const pack = (r) => (r ? { ...readData(r), submittedAt: r.submitted_at.toISOString(), confirmed: Boolean(r.confirmed_at) } : null);
  const views = (await query(`SELECT actor_id, created_at FROM garant_audit_log WHERE deal_id = $1 AND action = 'data_viewed' ORDER BY created_at`, [dealId])).rows.map((v) => ({ actorId: v.actor_id, at: v.created_at?.toISOString?.() ?? null }));
  return { seller: pack(rows.find((r) => r.side === 'seller')), buyer: pack(rows.find((r) => r.side === 'buyer')), views };
};

/** Спор без удержанных денег (обмен, сделка до оплаты): 'resume' — данные в порядке, проверка продолжается; 'cancel' — сделка отменена. */
export const adminResolveVerifyDispute = async (adminId, dealId, outcome, note) => {
  if (!(await can(adminId, 'garant'))) return { error: 'not_allowed' };
  if (!DEAL_ID_RE.test(String(dealId ?? ''))) return { error: 'not_found' };
  if (!['resume', 'cancel'].includes(String(outcome))) return { error: 'bad_winner' };
  const clean = text(note, 1000); if (!clean) return { error: 'bad_note' };
  const c = await pool.connect(); let deal;
  try {
    await c.query('BEGIN');
    deal = await lockDeal(c, dealId);
    if (!deal || !FLOWS.includes(deal.flow) || deal.status !== 'disputed' || deal.buyer_deposited) { await c.query('ROLLBACK'); return { error: 'bad_status' }; }
    if (outcome === 'resume') await c.query(`UPDATE garant_deals SET status = COALESCE(dispute_from, 'verifying'), dispute_result = NULL, dispute_note = $2, dispute_resolved_by = $3, dispute_resolved_at = now() WHERE id = $1`, [dealId, clean, adminId]);
    else await c.query(`UPDATE garant_deals SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, dispute_result = 'cancelled', dispute_note = $2, dispute_resolved_by = $3, dispute_resolved_at = now() WHERE id = $1`, [dealId, clean, adminId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logGarant(dealId, adminId, 'dispute_resolved', { outcome, note: clean });
  for (const id of [deal.seller_id, deal.buyer_id]) await notifyGarant(id, dealId, 'dispute_resolved', `Спор по сделке «${deal.title}» решён: ${outcome === 'resume' ? 'проверка продолжается' : 'сделка отменена'}`);
  return done(dealId);
};
void refundDeal;
