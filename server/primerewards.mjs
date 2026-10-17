/**
 * Sky Prime: каталог наград за баллы. Раньше каталог был зашит в браузер, а «обмен» только списывал баллы и ничего не выдавал.
 * Теперь:
 *  • награды заводит администрация (право `prime`), без выдуманных по умолчанию: пока нет ни одной активной — каталог пуст;
 *  • обмен — ОДНА транзакция под блокировкой награды: проверка остатка и лимита на человека → списание (wallet.spendPointsIn) → запись;
 *    `prime_days` выдаётся сразу (grantPrimeIn в той же транзакции, дни добавляются к действующему Prime), `manual` ждёт сотрудника;
 *  • повтор запроса с тем же `idemKey` ничего не списывает второй раз;
 *  • отказ по ручной награде возвращает баллы (creditPointsIn) в той же транзакции, что и смена статуса.
 */
import crypto from 'node:crypto';
import { notifyStaff } from './staffnotify.mjs';
import { query, pool } from './db.mjs';
import { wallet } from './wallet.mjs';
import { grantPrimeIn } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { logAdmin } from './adminsec.mjs';

const KINDS = ['prime_days', 'manual'];
const TIERS = { silver: 0, gold: 2000, platinum: 8000, diamond: 20000 };
const err = (code, extra = {}) => ({ error: code, ...extra });
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31).join('').trim().slice(0, n);
const intOrNull = (v, lo, hi) => { if (v === null || v === undefined || v === '') return null; const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN; };

const toReward = (r) => ({ id: r.id, title: r.title, description: r.description, cost: r.cost_points, kind: r.kind, valueDays: r.value_days, stock: r.stock, perUserLimit: r.per_user_limit, minTier: r.min_tier, active: r.active, sort: r.sort });

/** Накопленные баллы человека: тот же расчёт уровня, что и в приложении (начисления не уменьшаются при тратах). */
export const lifetimePoints = async (profileId) =>
  Number((await query(`SELECT COALESCE(SUM(amount),0) AS n FROM wallet_transactions WHERE user_id = $1 AND type IN ('points_earn','cashback','code_points') AND amount > 0`, [profileId])).rows[0]?.n ?? 0);

export const listForUser = async (profileId) => {
  const [rw, my, life] = await Promise.all([
    query(`SELECT * FROM prime_rewards WHERE active ORDER BY sort, cost_points`),
    query(`SELECT id, reward_id, title, cost_points, status, note, created_at FROM prime_redemptions WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 30`, [profileId]),
    lifetimePoints(profileId),
  ]);
  const taken = {};
  for (const r of my.rows) if (['done', 'pending_manual'].includes(r.status)) taken[r.reward_id] = (taken[r.reward_id] ?? 0) + 1;
  return {
    lifetime: life,
    rewards: rw.rows.map((r) => ({ ...toReward(r), taken: taken[r.id] ?? 0, tierLocked: Boolean(r.min_tier) && life < (TIERS[r.min_tier] ?? 0), soldOut: r.stock !== null && r.stock <= 0 })),
    redemptions: my.rows.map((r) => ({ id: r.id, rewardId: r.reward_id, title: r.title, cost: r.cost_points, status: r.status, note: r.note, createdAt: r.created_at })),
  };
};

export const redeem = async (profileId, rewardId, idemKey) => {
  const key = clean(idemKey, 80);
  if (key.length < 8) return err('idem_key_required');
  const c = await pool.connect();
  let done = null;
  try {
    await c.query('BEGIN');
    const { rows: dup } = await c.query('SELECT id, status, title, cost_points FROM prime_redemptions WHERE profile_id = $1 AND idem_key = $2', [profileId, key]);
    if (dup[0]) { await c.query('ROLLBACK'); return { ok: true, duplicate: true, redemption: { id: dup[0].id, status: dup[0].status, title: dup[0].title, cost: dup[0].cost_points } }; }
    const { rows } = await c.query('SELECT * FROM prime_rewards WHERE id = $1 FOR UPDATE', [String(rewardId ?? '')]);
    const r = rows[0];
    if (!r || !r.active) { await c.query('ROLLBACK'); return err('not_found'); }
    if (r.stock !== null && r.stock <= 0) { await c.query('ROLLBACK'); return err('sold_out'); }
    if (r.min_tier) {
      const life = Number((await c.query(`SELECT COALESCE(SUM(amount),0) AS n FROM wallet_transactions WHERE user_id = $1 AND type IN ('points_earn','cashback','code_points') AND amount > 0`, [profileId])).rows[0].n);
      if (life < (TIERS[r.min_tier] ?? 0)) { await c.query('ROLLBACK'); return err('tier_too_low', { minTier: r.min_tier }); }
    }
    if (r.per_user_limit !== null) {
      const { rows: n } = await c.query(`SELECT count(*)::int AS n FROM prime_redemptions WHERE profile_id = $1 AND reward_id = $2 AND status IN ('done','pending_manual')`, [profileId, r.id]);
      if (n[0].n >= r.per_user_limit) { await c.query('ROLLBACK'); return err('limit_reached'); }
    }
    const sp = await wallet.spendPointsIn(c, profileId, r.cost_points, 'prime_reward', `Награда Prime: ${r.title}`, `reward:${r.id}:${key}`);
    if (sp?.error) { await c.query('ROLLBACK'); return err(sp.error === 'insufficient_points' ? 'insufficient_points' : sp.error); }
    const id = `rdm-${crypto.randomUUID()}`;
    let status = 'pending_manual'; let note = '';
    if (r.kind === 'prime_days') { await grantPrimeIn(c, profileId, 'standard', r.value_days, { additive: true }); status = 'done'; note = `+${r.value_days} дн. Prime`; }
    await c.query(`INSERT INTO prime_redemptions (id, reward_id, profile_id, cost_points, title, kind, status, idem_key, note, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${status === 'done' ? 'now()' : 'NULL'})`,
      [id, r.id, profileId, r.cost_points, r.title, r.kind, status, key, note]);
    if (r.stock !== null) await c.query('UPDATE prime_rewards SET stock = stock - 1, updated_at = now() WHERE id = $1', [r.id]);
    await c.query('COMMIT');
    done = { id, status, title: r.title, cost: r.cost_points, note };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return { ok: true, duplicate: true };        // параллельный повтор того же ключа
    throw e;
  } finally { c.release(); }
  if (done.status === 'pending_manual') void notifyStaff('prime_reward', { title: 'Награда Prime ждёт выдачи', body: `${done.title}: нужна ручная выдача.`, dedupe: done.id });
  await notifyGift(profileId, 'prime_reward', done.status === 'done' ? 'Награда получена' : 'Награда оформлена', done.status === 'done' ? `${done.title}: ${done.note}` : `${done.title} — ждёт выдачи сотрудником`, done.id).catch(() => {});
  return { ok: true, redemption: done };
};

/* ─── Администрация ────────────────────────────────────────────────── */

export const adminList = async () => {
  const [rw, q] = await Promise.all([
    query(`SELECT * FROM prime_rewards ORDER BY sort, created_at`),
    query(`SELECT d.*, p.username FROM prime_redemptions d LEFT JOIN profiles p ON p.id = d.profile_id WHERE d.status = 'pending_manual' ORDER BY d.created_at LIMIT 200`),
  ]);
  return { rewards: rw.rows.map(toReward), queue: q.rows.map((r) => ({ id: r.id, rewardId: r.reward_id, title: r.title, cost: r.cost_points, user: r.username, createdAt: r.created_at })) };
};

export const adminSave = async (actorId, body, id = null) => {
  const title = clean(body?.title, 120);
  const cost = intOrNull(body?.cost, 1, 10_000_000);
  const kind = String(body?.kind ?? '');
  const days = intOrNull(body?.valueDays, 1, 3650);
  const stock = intOrNull(body?.stock, 0, 1_000_000);
  const limit = intOrNull(body?.perUserLimit, 1, 1000);
  const minTier = body?.minTier ? String(body.minTier) : null;
  if (title.length < 2) return err('bad_field', { field: 'title' });
  if (cost === null || Number.isNaN(cost)) return err('bad_field', { field: 'cost' });
  if (!KINDS.includes(kind)) return err('bad_field', { field: 'kind' });
  if (kind === 'prime_days' && (days === null || Number.isNaN(days))) return err('bad_field', { field: 'valueDays' });
  if (Number.isNaN(stock)) return err('bad_field', { field: 'stock' });
  if (Number.isNaN(limit)) return err('bad_field', { field: 'perUserLimit' });
  if (minTier && !(minTier in TIERS)) return err('bad_field', { field: 'minTier' });
  const f = [title, clean(body?.description, 600), cost, kind, kind === 'prime_days' ? days : null, stock, limit, minTier, body?.active === true, intOrNull(body?.sort, 0, 100000) ?? 100];
  if (id) {
    const { rowCount } = await query(`UPDATE prime_rewards SET title=$2, description=$3, cost_points=$4, kind=$5, value_days=$6, stock=$7, per_user_limit=$8, min_tier=$9, active=$10, sort=$11, updated_at=now() WHERE id=$1`, [id, ...f]);
    if (!rowCount) return err('not_found');
    await logAdmin({ actorId, targetType: 'prime', type: 'prime_reward_update', detail: `${id}: ${title}, ${cost} б., ${body?.active === true ? 'включена' : 'выключена'}` });
    return { ok: true, id };
  }
  const nid = `rwd-${crypto.randomUUID()}`;
  await query(`INSERT INTO prime_rewards (id, title, description, cost_points, kind, value_days, stock, per_user_limit, min_tier, active, sort, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [nid, ...f, actorId]);
  await logAdmin({ actorId, targetType: 'prime', type: 'prime_reward_create', detail: `${nid}: ${title}, ${cost} б.` });
  return { ok: true, id: nid };
};

/** Решение по ручной награде. Отказ возвращает баллы в той же транзакции. */
export const decideManual = async (actorId, redemptionId, approve, note) => {
  const c = await pool.connect();
  let r;
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT * FROM prime_redemptions WHERE id = $1 AND status = 'pending_manual' FOR UPDATE`, [String(redemptionId ?? '')]);
    r = rows[0];
    if (!r) { await c.query('ROLLBACK'); return err('not_pending'); }
    const why = clean(note, 200);
    if (!approve) {
      if (why.length < 3) { await c.query('ROLLBACK'); return err('reason_required'); }
      await wallet.creditPointsIn(c, r.profile_id, r.cost_points, 'prime_reward_refund', `Возврат баллов: ${r.title}`, `reward:refund:${r.id}`);
      await c.query('UPDATE prime_rewards SET stock = stock + 1 WHERE id = $1 AND stock IS NOT NULL', [r.reward_id]);
    }
    await c.query(`UPDATE prime_redemptions SET status = $2, note = $3, decided_at = now(), decided_by = $4 WHERE id = $1`, [r.id, approve ? 'done' : 'rejected_refunded', why, actorId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logAdmin({ actorId, targetType: 'prime', type: approve ? 'prime_reward_fulfilled' : 'prime_reward_rejected', detail: `${r.id}: ${r.title}` });
  await notifyGift(r.profile_id, 'prime_reward', approve ? 'Награда выдана' : 'Награда отклонена', approve ? r.title : `${r.title}: ${clean(note, 200)}. Баллы возвращены.`, r.id).catch(() => {});
  return { ok: true };
};
