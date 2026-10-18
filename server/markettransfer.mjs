/**
 * Передача магазина (Sky Market) или ПВЗ другому аккаунту.
 *
 * Путь: владелец предлагает @нику (с кодом аутентификатора, если он включён) → получатель принимает →
 * администрация Market одобряет (или отклоняет с причиной) → сервер переносит объект ОДНОЙ транзакцией.
 *
 * Магазин: товары, витрина, отзывы, чаты, акции, подписка и завершённые заказы переходят к новому владельцу
 * (они принадлежат магазину). Личное прежнего владельца остаётся у него: заявки, документы и налоговый статус
 * (новый владелец проходит проверку заново — verification_status = 'none'), реквизиты выплат (стираются).
 * ПВЗ: меняются владелец и роль владельца в штате; реквизиты владельца стираются. Ячейки, история и сотрудники остаются.
 * Передать нельзя: при незавершённых заказах, блокировке/приостановке, пока у получателя уже есть магазин
 * (или он не подходит для ПВЗ). Все шаги — в журнал администрации.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { marketText as text } from './market.mjs';
import { recheckSellerProducts } from './marketmod.mjs';
import { PVZ_KINDS } from './sellerrules.mjs';
import { verifySkyTwoFactor } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { PVZ_ID_RE } from './pvzops.mjs';

const TTL_DAYS = 7;
const iso = (d) => d?.toISOString?.() ?? null;
const ID_RE = /^mtr-[0-9a-f-]{36}$/;
const mayAdmin = async (actor, kind) => (kind === 'pvz' ? (await can(actor, 'pvz_manage')) || (await can(actor, 'market')) : can(actor, 'market'));
const mayAnyAdmin = async (actor) => (await can(actor, 'market')) || (await can(actor, 'pvz_manage'));

const view = (r, viewer) => ({
  id: r.id, kind: r.kind, subjectId: r.subject_id, title: r.subject_title, status: r.status, message: r.message,
  from: { id: r.from_id, name: r.from_name ?? null, username: r.from_username ?? null },
  to: { id: r.to_id, name: r.to_name ?? null, username: r.to_username ?? null },
  adminComment: r.admin_comment || '', createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), acceptedAt: iso(r.accepted_at), decidedAt: iso(r.decided_at),
  mine: viewer ? (r.from_id === viewer ? 'from' : r.to_id === viewer ? 'to' : null) : null,
});
const SELECT = `SELECT t.*, pf.name AS from_name, pf.username AS from_username, pt.name AS to_name, pt.username AS to_username
                  FROM market_transfers t JOIN profiles pf ON pf.id = t.from_id JOIN profiles pt ON pt.id = t.to_id`;

/** Просроченные предложения закрываются лениво при любом чтении. */
const expireOld = () => query(`UPDATE market_transfers SET status = 'expired', decided_at = now() WHERE status IN ('offered','accepted') AND expires_at < now()`).catch(() => {});

/** Можно ли сейчас передавать объект. Возвращает код отказа или null. */
const subjectProblem = async (q, kind, subjectId, fromId) => {
  if (kind === 'shop') {
    const { rows } = await q('SELECT status, verification_status FROM market_sellers WHERE profile_id = $1', [fromId]);
    if (!rows[0] || subjectId !== fromId) return 'not_found';
    if (rows[0].status === 'suspended' || rows[0].verification_status === 'suspended') return 'subject_blocked';
    const { rows: o } = await q(`SELECT 1 FROM market_orders WHERE seller_id = $1 AND status NOT IN ('completed','cancelled') LIMIT 1`, [fromId]);
    if (o[0]) return 'has_active_orders';
    const { rows: a } = await q(`SELECT 1 FROM market_appeals WHERE seller_id = $1 AND status = 'open' LIMIT 1`, [fromId]);
    if (a[0]) return 'has_open_appeals';
    return null;
  }
  const { rows } = await q('SELECT owner_id, admin_blocked FROM market_pickup_points WHERE id = $1', [subjectId]);
  if (!rows[0] || rows[0].owner_id !== fromId) return 'not_found';
  if (rows[0].admin_blocked) return 'subject_blocked';
  const { rows: o } = await q(`SELECT 1 FROM market_orders WHERE pickup_point_id = $1 AND status IN ('seller_shipped','in_transit','ready_for_pickup') LIMIT 1`, [subjectId]);
  if (o[0]) return 'has_active_orders';
  return null;
};

/** Годится ли получатель. */
const targetProblem = async (q, kind, toId) => {
  const { rows: p } = await q('SELECT id FROM profiles WHERE id = $1 AND deleted_at IS NULL', [toId]);
  if (!p[0]) return 'target_not_found';
  const { rows: s } = await q('SELECT status, verification_status, tax_kind FROM market_sellers WHERE profile_id = $1', [toId]);
  if (kind === 'shop') return s[0] ? 'target_has_shop' : null;
  if (!s[0] || s[0].verification_status !== 'approved' || s[0].status === 'suspended' || !PVZ_KINDS.includes(s[0].tax_kind)) return 'target_not_pvz_eligible';
  return null;
};

export const createTransfer = async (me, skyId, input = {}) => {
  const kind = input.kind === 'pvz' ? 'pvz' : input.kind === 'shop' ? 'shop' : null;
  if (!kind) return { error: 'bad_kind' };
  const subjectId = kind === 'shop' ? me : String(input.subjectId ?? '');
  if (kind === 'pvz' && !PVZ_ID_RE.test(subjectId)) return { error: 'not_found' };
  const uname = String(input.toUsername ?? '').trim().replace(/^@/, '').toLowerCase().slice(0, 40);
  if (!uname) return { error: 'username_required' };
  const { rows: tp } = await query('SELECT id FROM profiles WHERE lower(username) = $1 AND deleted_at IS NULL', [uname]);
  if (!tp[0]) return { error: 'target_not_found' };
  const toId = tp[0].id;
  if (toId === me) return { error: 'self_transfer' };
  await expireOld();
  const sp = await subjectProblem(query, kind, subjectId, me); if (sp) return { error: sp };
  const tg = await targetProblem(query, kind, toId); if (tg) return { error: tg };
  const tf = await verifySkyTwoFactor(skyId, input.twoFactorCode);
  if (tf?.error) return { error: tf.error === 'invalid_code' ? 'two_factor_required' : tf.error };
  const title = kind === 'shop'
    ? (await query('SELECT shop_name FROM market_sellers WHERE profile_id = $1', [me])).rows[0]?.shop_name ?? ''
    : (await query('SELECT title FROM market_pickup_points WHERE id = $1', [subjectId])).rows[0]?.title ?? '';
  const id = `mtr-${generateId()}`;
  try {
    await query(
      `INSERT INTO market_transfers (id, kind, subject_id, subject_title, from_id, to_id, message, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval)`,
      [id, kind, subjectId, text(title, 120), me, toId, text(input.message, 300), String(TTL_DAYS)]);
  } catch (e) { if (e.code === '23505') return { error: 'transfer_open' }; throw e; }
  await logAdmin({ actorId: me, targetId: id, targetType: 'market_transfer', type: 'market_transfer_offer', detail: `${kind} ${subjectId} → ${toId}` }).catch(() => {});
  notifyGift(toId, 'system', 'Вам предлагают принять ' + (kind === 'shop' ? 'магазин' : 'ПВЗ'), `«${text(title, 80)}» — откройте Market → Передача, чтобы принять или отклонить.`, id).catch(() => {});
  return { ok: true, id };
};

export const myTransfers = async (me) => {
  await expireOld();
  const { rows } = await query(`${SELECT} WHERE t.from_id = $1 OR t.to_id = $1 ORDER BY t.created_at DESC LIMIT 50`, [me]);
  return { items: rows.map((r) => view(r, me)) };
};

const load = async (client, id) => (await client.query(`${SELECT} WHERE t.id = $1 FOR UPDATE OF t`, [id])).rows[0];

/** accept | decline (получатель), cancel (отправитель). */
export const respondTransfer = async (me, id, action) => {
  if (!ID_RE.test(String(id ?? ''))) return { error: 'not_found' };
  await expireOld();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await load(client, id);
    if (!t) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    const isTo = t.to_id === me; const isFrom = t.from_id === me;
    if (!isTo && !isFrom) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    let to;
    if (action === 'accept' || action === 'decline') {
      if (!isTo) { await client.query('ROLLBACK'); return { error: 'not_allowed' }; }
      if (t.status !== 'offered') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      if (action === 'accept') {
        const tg = await targetProblem((s, a) => client.query(s, a), t.kind, t.to_id);
        if (tg) { await client.query('ROLLBACK'); return { error: tg }; }
      }
      to = action === 'accept' ? 'accepted' : 'declined';
    } else if (action === 'cancel') {
      if (!isFrom) { await client.query('ROLLBACK'); return { error: 'not_allowed' }; }
      if (!['offered', 'accepted'].includes(t.status)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      to = 'cancelled';
    } else { await client.query('ROLLBACK'); return { error: 'bad_action' }; }
    await client.query(`UPDATE market_transfers SET status = $2, accepted_at = CASE WHEN $2 = 'accepted' THEN now() ELSE accepted_at END,
                         decided_at = CASE WHEN $2 = 'accepted' THEN NULL ELSE now() END WHERE id = $1`, [id, to]);
    await client.query('COMMIT');
    await logAdmin({ actorId: me, targetId: id, targetType: 'market_transfer', type: `market_transfer_${action}`, detail: `${t.kind} ${t.subject_id}` }).catch(() => {});
    if (to === 'accepted') void notifyStaff(t.kind === 'pvz' ? 'pvz_app' : 'seller_app', { title: 'Передача ' + (t.kind === 'shop' ? 'магазина' : 'ПВЗ') + ' ждёт решения', body: 'Получатель принял передачу.', dedupe: `transfer:${id}`, except: me }).catch(() => {});
    else notifyGift(isTo ? t.from_id : t.to_id, 'system', 'Передача: ' + ({ declined: 'отклонена получателем', cancelled: 'отменена отправителем' }[to] ?? to), `«${text(t.subject_title, 80)}»`, id).catch(() => {});
    return { ok: true, status: to };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

export const listTransfersAdmin = async (actor, { status = 'accepted' } = {}) => {
  if (!(await mayAnyAdmin(actor))) return { error: 'not_allowed' };
  await expireOld();
  const canShop = await can(actor, 'market');
  const args = []; const where = [];
  if (status !== 'all') { args.push(status); where.push(`t.status = $${args.length}`); }
  if (!canShop) where.push(`t.kind = 'pvz'`);
  const { rows } = await query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.created_at DESC LIMIT 100`, args);
  return { items: rows.map((r) => view(r, null)) };
};

const SHOP_TABLES = [['market_products', 'seller_id'], ['market_reviews', 'seller_id'], ['market_chats', 'seller_id'], ['market_promotions', 'seller_id'],
  ['market_orders', 'seller_id'], ['market_appeals', 'seller_id'], ['market_reports', 'seller_id'], ['market_seller_payments', 'profile_id']];

/** approve | reject (администрация). approve переносит объект атомарно. */
export const decideTransfer = async (actor, id, action, comment, { meta = {} } = {}) => {
  if (!ID_RE.test(String(id ?? ''))) return { error: 'not_found' };
  const why = text(comment, 400);
  if (action === 'reject' && why.length < 3) return { error: 'reason_required' };
  if (action !== 'approve' && action !== 'reject') return { error: 'bad_action' };
  await expireOld();
  const client = await pool.connect();
  let t;
  try {
    await client.query('BEGIN');
    t = await load(client, id);
    if (!t) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (!(await mayAdmin(actor, t.kind))) { await client.query('ROLLBACK'); return { error: 'not_allowed' }; }
    if (actor === t.from_id || actor === t.to_id) { await client.query('ROLLBACK'); return { error: 'own_target' }; }
    if (t.status !== 'accepted') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
    if (action === 'reject') {
      await client.query(`UPDATE market_transfers SET status = 'rejected', admin_id = $2, admin_comment = $3, decided_at = now() WHERE id = $1`, [id, actor, why]);
    } else {
      const q = (s, a) => client.query(s, a);
      const sp = await subjectProblem(q, t.kind, t.subject_id, t.from_id);
      const tg = sp ? null : await targetProblem(q, t.kind, t.to_id);
      if (sp || tg) { await client.query('ROLLBACK'); return { error: sp || tg }; }
      await client.query('SAVEPOINT mv');
      try {
        if (t.kind === 'shop') {
          for (const [tbl, col] of SHOP_TABLES) await client.query(`UPDATE ${tbl} SET ${col} = $2 WHERE ${col} = $1`, [t.from_id, t.to_id]);
          await client.query(
            `UPDATE market_sellers SET profile_id = $2, verification_status = 'none', tax_kind = NULL, activities = '{}',
                    payment_details_enc = NULL, has_payment_details = FALSE, suspend_reason = '', suspended_at = NULL, updated_at = now()
              WHERE profile_id = $1`, [t.from_id, t.to_id]);
        } else {
          await client.query(`UPDATE market_pickup_points SET owner_id = $2, owner_payment_details_enc = NULL, has_owner_payment_details = FALSE WHERE id = $1 AND owner_id = $3`, [t.subject_id, t.to_id, t.from_id]);
          await client.query(`UPDATE market_pvz_staff SET status = 'revoked', revoked_at = now(), revoked_by = $3 WHERE pvz_id = $1 AND profile_id = $2 AND status = 'active'`, [t.subject_id, t.from_id, actor]);
          await client.query(
            `INSERT INTO market_pvz_staff (id, pvz_id, profile_id, role, permissions, added_by)
             VALUES ($1,$2,$3,'owner','{}',$4)
             ON CONFLICT (pvz_id, profile_id) DO UPDATE SET role = 'owner', status = 'active', revoked_at = NULL, revoked_by = NULL`,
            [`pzs-${generateId()}`, t.subject_id, t.to_id, actor]);
        }
        await client.query(`UPDATE market_transfers SET status = 'approved', admin_id = $2, admin_comment = $3, decided_at = now() WHERE id = $1`, [id, actor, why]);
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT mv');
        console.error('[transfer] перенос не удался:', e.message);
        await client.query(`UPDATE market_transfers SET status = 'failed', admin_id = $2, admin_comment = $3, decided_at = now() WHERE id = $1`, [id, actor, 'перенос не удался: ' + String(e.message).slice(0, 120)]);
        await client.query('COMMIT');
        return { error: 'transfer_failed' };
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  await logAdmin({ actorId: actor, targetId: id, targetType: 'market_transfer', type: `market_transfer_${action}`, detail: `${t.kind} ${t.subject_id} ${t.from_id} → ${t.to_id}${why ? ` · ${why}` : ''}`, meta });
  if (action === 'approve' && t.kind === 'shop') await recheckSellerProducts(t.to_id, 'Магазин передан новому владельцу').catch(() => {});
  const word = t.kind === 'shop' ? 'магазин' : 'ПВЗ';
  const msg = action === 'approve' ? `Передача одобрена: «${text(t.subject_title, 80)}»` : `Передача отклонена: ${why}`;
  notifyGift(t.from_id, 'system', 'Передача: ' + word, msg, id).catch(() => {});
  notifyGift(t.to_id, 'system', 'Передача: ' + word, msg + (action === 'approve' && t.kind === 'shop' ? '. Пройдите проверку продавца заново.' : ''), id).catch(() => {});
  return { ok: true, status: action === 'approve' ? 'approved' : 'rejected' };
};
