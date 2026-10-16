/**
 * Sky Prime: кэшбэк Prime Points за завершённые заказы Sky Market.
 *
 *  • Начисляет только платформа и только баллами (wallet.creditPointsIn); рублей и курса «баллы → рубли» здесь нет.
 *  • Заказ в Market оплачивается напрямую продавцу — Sky денег не видит, поэтому кэшбэк зависит от подтверждённого завершения
 *    сделки и «созревает»: баллы лежат в статусе pending `holdDays` дней (по умолчанию 7) и только потом зачисляются —
 *    времени хватает на спор/возврат, а сговор покупателя с продавцом становится дорогим.
 *  • Один заказ — один кэшбэк (UNIQUE по order_id), зачисление идемпотентно (ref `cashback:<orderId>`).
 *  • Пределы: минимальная сумма заказа, максимум баллов с заказа, максимум баллов в месяц на человека и на пару «покупатель — продавец»;
 *    покупатель и продавец не могут быть одним Sky ID. Всё правится в админке (право `prime`, с подтверждением личности).
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { wallet } from './wallet.mjs';
import { hasPrime } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { logAdmin } from './adminsec.mjs';

export const DEFAULTS = {
  enabled: true,
  primePercent: 3,          // % от суммы заказа для подписчиков Prime
  basePercent: 0,           // для остальных (0 — кэшбэк только с Prime)
  minOrderRub: 300,
  maxPointsPerOrder: 500,
  maxPointsPerMonth: 5000,
  maxPointsPerSellerMonth: 1000,
  holdDays: 7,
};
const LIMITS = {
  primePercent: [0, 30], basePercent: [0, 30], minOrderRub: [0, 1_000_000], maxPointsPerOrder: [1, 1_000_000],
  maxPointsPerMonth: [1, 10_000_000], maxPointsPerSellerMonth: [1, 10_000_000], holdDays: [0, 60],
};

export const loadSettings = async () => {
  const { rows } = await query('SELECT cashback FROM prime_settings WHERE id');
  return { ...DEFAULTS, ...(rows[0]?.cashback ?? {}) };
};

export const saveSettings = async (actorId, patch) => {
  const cur = await loadSettings();
  const next = { ...cur };
  if (patch?.enabled !== undefined) next.enabled = patch.enabled === true;
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (patch?.[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: 'bad_field', field: k };
    next[k] = k.endsWith('Percent') ? Math.round(n * 100) / 100 : Math.trunc(n);
  }
  await query('UPDATE prime_settings SET cashback = $1::jsonb, updated_by = $2, updated_at = now() WHERE id', [JSON.stringify(next), actorId]);
  await logAdmin({ actorId, targetType: 'prime', type: 'prime_cashback_settings', detail: JSON.stringify(next).slice(0, 280) });
  return { ok: true, settings: next };
};

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

/**
 * Вызывается ВНУТРИ транзакции перехода заказа в `completed` (marketorders.applyTransition): записывает ожидающий кэшбэк.
 * Любая причина отказа — просто «кэшбэка нет», заказ при этом не страдает.
 */
export const scheduleCashbackIn = async (client, order) => {
  await client.query('SAVEPOINT prime_cashback');   // ошибка здесь не должна ломать переход заказа (транзакция чужая)
  try {
    const s = await loadSettings();
    if (!s.enabled) return { skipped: 'disabled' };
    const totalKop = Number(order.total_kop);
    if (!(totalKop > 0) || totalKop < s.minOrderRub * 100) return { skipped: 'below_min' };
    if (!order.buyer_id || !order.seller_id || order.buyer_id === order.seller_id) return { skipped: 'self' };
    const { rows: sk } = await client.query('SELECT id, sky_id FROM profiles WHERE id = ANY($1::text[])', [[order.buyer_id, order.seller_id]]);
    const buyerSky = sk.find((r) => r.id === order.buyer_id)?.sky_id; const sellerSky = sk.find((r) => r.id === order.seller_id)?.sky_id;
    if (!buyerSky || buyerSky === sellerSky) return { skipped: 'same_account' };
    const prime = await hasPrime(order.buyer_id);
    const percent = prime ? s.primePercent : s.basePercent;
    if (!(percent > 0)) return { skipped: 'no_rate' };
    let points = Math.floor((totalKop / 100) * (percent / 100));
    points = Math.min(points, s.maxPointsPerOrder);
    const from = monthStart();
    const { rows: used } = await client.query(
      `SELECT COALESCE(SUM(points) FILTER (WHERE status <> 'cancelled'), 0)::int AS month,
              COALESCE(SUM(points) FILTER (WHERE status <> 'cancelled' AND seller_id = $3), 0)::int AS seller
         FROM prime_cashback WHERE profile_id = $1 AND created_at >= $2`, [order.buyer_id, from, order.seller_id]);
    points = Math.min(points, s.maxPointsPerMonth - used[0].month, s.maxPointsPerSellerMonth - used[0].seller);
    if (!(points > 0)) return { skipped: 'limit' };
    const id = `cbk-${crypto.randomUUID()}`;
    const { rowCount } = await client.query(
      `INSERT INTO prime_cashback (id, order_id, profile_id, seller_id, total_kop, percent, points, release_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval) ON CONFLICT (order_id) DO NOTHING`,
      [id, order.id, order.buyer_id, order.seller_id, String(totalKop), percent, points, String(s.holdDays)]);
    await client.query('RELEASE SAVEPOINT prime_cashback');
    return rowCount ? { scheduled: id, points } : { skipped: 'duplicate' };
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT prime_cashback').catch(() => {});
    console.error('[prime] кэшбэк не записан:', e.message);
    return { skipped: 'error' };
  }
};

/** Зачислить созревшие записи. Каждая — своя транзакция под блокировкой строки; параллельные запуски не задвоят. */
export const releaseDueCashback = async (limit = 200) => {
  const { rows } = await query(`SELECT id FROM prime_cashback WHERE status = 'pending' AND release_at <= now() ORDER BY release_at LIMIT $1`, [limit]);
  let paid = 0;
  for (const { id } of rows) {
    const c = await pool.connect();
    let note = null;
    try {
      await c.query('BEGIN');
      const { rows: r } = await c.query(`SELECT * FROM prime_cashback WHERE id = $1 AND status = 'pending' FOR UPDATE SKIP LOCKED`, [id]);
      if (!r[0]) { await c.query('ROLLBACK'); continue; }
      await wallet.creditPointsIn(c, r[0].profile_id, r[0].points, 'cashback', `Кэшбэк за заказ Sky Market (${r[0].percent}%)`, `cashback:${r[0].order_id}`);
      await c.query(`UPDATE prime_cashback SET status = 'paid', decided_at = now() WHERE id = $1`, [id]);
      await c.query('COMMIT'); paid += 1; note = r[0];
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('[prime] кэшбэк не зачислен:', e.message); } finally { c.release(); }
    if (note) await notifyGift(note.profile_id, 'cashback', 'Кэшбэк зачислен', `+${note.points} баллов за заказ в Sky Market`, note.order_id).catch(() => {});
  }
  return paid;
};

/** Сотрудник отменяет начисление (сговор, возврат): только пока оно ждёт; зачисленное откатывается отдельной операцией кошелька. */
export const cancelCashback = async (actorId, id, reason) => {
  const why = String(reason ?? '').trim().slice(0, 200);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query(
    `UPDATE prime_cashback SET status = 'cancelled', reason = $2, decided_at = now(), decided_by = $3 WHERE id = $1 AND status = 'pending' RETURNING order_id`, [id, why, actorId]);
  if (!rows[0]) return { error: 'not_pending' };
  await logAdmin({ actorId, targetType: 'prime', type: 'prime_cashback_cancel', detail: `${rows[0].order_id}: ${why}` });
  return { ok: true };
};

export const myCashback = async (profileId) => {
  const s = await loadSettings();
  const { rows } = await query(
    `SELECT id, order_id, points, percent, status, release_at, created_at FROM prime_cashback WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 30`, [profileId]);
  const sum = (st) => rows.filter((r) => r.status === st).reduce((a, r) => a + r.points, 0);
  return {
    rules: { enabled: s.enabled, primePercent: s.primePercent, basePercent: s.basePercent, minOrderRub: s.minOrderRub, maxPointsPerOrder: s.maxPointsPerOrder, holdDays: s.holdDays, maxPointsPerMonth: s.maxPointsPerMonth },
    pendingPoints: sum('pending'), paidPoints: sum('paid'),
    items: rows.map((r) => ({ id: r.id, orderId: r.order_id, points: r.points, percent: Number(r.percent), status: r.status, releaseAt: r.release_at, createdAt: r.created_at })),
  };
};

export const adminCashback = async ({ status = '', limit = 100 } = {}) => {
  const args = [Math.min(200, Math.max(1, limit))]; let where = '';
  if (['pending', 'paid', 'cancelled'].includes(status)) { args.push(status); where = 'WHERE c.status = $2'; }
  const { rows } = await query(
    `SELECT c.*, p.username AS buyer, s.username AS seller FROM prime_cashback c
       LEFT JOIN profiles p ON p.id = c.profile_id LEFT JOIN profiles s ON s.id = c.seller_id ${where} ORDER BY c.created_at DESC LIMIT $1`, args);
  const { rows: tot } = await query(`SELECT status, COALESCE(SUM(points),0)::int AS points, count(*)::int AS n FROM prime_cashback GROUP BY status`);
  return {
    totals: Object.fromEntries(tot.map((t) => [t.status, { points: t.points, count: t.n }])),
    items: rows.map((r) => ({ id: r.id, orderId: r.order_id, buyer: r.buyer, seller: r.seller, totalRub: Number(r.total_kop) / 100, percent: Number(r.percent), points: r.points, status: r.status, reason: r.reason, releaseAt: r.release_at, createdAt: r.created_at })),
  };
};
