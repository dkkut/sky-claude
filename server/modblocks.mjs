/**
 * Блокировка отдельных вкладок (модулей) для отдельных людей + заявка на вывод остатка баланса у заблокированного.
 * Ключи модулей — те же, что у общего закрытия (modclosure.MODULES). Право выдачи — `modules`; вывод выполняет сотрудник с `finance`.
 *
 * Решает сервер: запросы к API заблокированного модуля получают 403 `module_blocked` (карта путей PATHS), клиент дополнительно
 * показывает вместо вкладки экран с причиной и кнопкой «Заявка на вывод остатка». Модули без карты путей закрываются только на уровне интерфейса.
 */
import { query, pool } from './db.mjs';
import { config } from './config.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { encryptSecret, openSecret } from './crypto.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { notifyGift } from './giftnotify.mjs';
import { MODULES } from './modclosure.mjs';

const KEYS = new Set(MODULES.map((m) => m.key));
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Модуль → префиксы API, которые он закрывает на сервере. */
const PATHS = {
  market: ['/api/market', '/api/onsite'], pvz: ['/api/market/pvz'], garant: ['/api/garant'], go: ['/api/go', '/api/parking'],
  kbiz: ['/api/kbiz'], tickets: ['/api/tickets'], blox: ['/api/blox'], ads: ['/api/ads'], family: ['/api/family'],
  nftgifts: ['/api/gifts'], music: ['/api/music'], movies: ['/api/film'], podcasts: ['/api/podcasts'], books: ['/api/books'],
  ai: ['/api/ai'], bots: ['/api/bots'], partners: ['/api/partners'], friendsmap: ['/api/maps/friends', '/api/safety'], launcher: ['/api/launcher'], campaigns: ['/api/campaigns'],
  prime: ['/api/prime'], video: ['/api/skyvideo'], gaming: ['/api/games', '/api/gaming'], bloom: ['/api/bloom'],
};
const MATCHERS = Object.entries(PATHS).map(([k, list]) => [k, list]);

let _cache = new Map();   // profileId → { at, set }
const forget = (id) => { if (id) _cache.delete(id); else _cache = new Map(); };
export const blockedKeys = async (profileId) => {
  const hit = _cache.get(profileId);
  if (hit && Date.now() - hit.at < 4000) return hit.set;
  let set = new Set();
  try { set = new Set((await query('SELECT module FROM user_module_blocks WHERE profile_id = $1', [profileId])).rows.map((r) => r.module)); } catch { return new Set(); }  // сбой базы не закрывает человека
  _cache.set(profileId, { at: Date.now(), set });
  if (_cache.size > 5000) _cache.clear();
  return set;
};
/** Какой заблокированный модуль закрывает этот путь (или null). Служебные пути блокировок и вывода не закрываются никогда. */
export const moduleBlockedFor = async (profileId, path) => {
  if (!profileId || path.startsWith('/api/me/') || path.startsWith('/api/withdraw')) return null;
  const set = await blockedKeys(profileId);
  if (!set.size) return null;
  for (const [key, prefixes] of MATCHERS) {
    if (set.has(key) && prefixes.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) return key;
  }
  return null;
};

const ownerProfileIds = async () => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return [];
  return (await query('SELECT id FROM profiles WHERE lower(username) = $1', [name])).rows.map((r) => r.id);
};
const log = (me, type, detail, meta) => logAdmin({ actorId: me, targetType: 'profile', type, detail: String(detail).slice(0, 200), meta });

/* ─── Администрация ─── */
export const adminList = async (me, q = '') => {
  if (!(await can(me, 'modules'))) return { error: 'not_allowed' };
  const term = clean(q, 60).replace(/^@/, '').toLowerCase();
  const { rows } = await query(
    `SELECT b.profile_id, b.module, b.reason, b.show_reason, b.created_at, p.username, p.name
       FROM user_module_blocks b JOIN profiles p ON p.id = b.profile_id
      WHERE ($1 = '' OR lower(p.username) LIKE $1 || '%' OR b.profile_id = $1)
      ORDER BY b.created_at DESC LIMIT 300`, [term]);
  const label = new Map(MODULES.map((m) => [m.key, m.label]));
  return { blocks: rows.map((r) => ({ profileId: r.profile_id, username: r.username, name: r.name, module: r.module, moduleLabel: label.get(r.module) ?? r.module, reason: r.reason, showReason: r.show_reason, at: r.created_at.toISOString() })) };
};

export const adminBlock = async (me, b, meta) => {
  if (!(await can(me, 'modules'))) return { error: 'not_allowed' };
  const uname = clean(b?.username, 40).replace(/^@/, '').toLowerCase();
  const mods = [...new Set((Array.isArray(b?.modules) ? b.modules : []).map(String))].filter((k) => KEYS.has(k));
  if (!uname || !mods.length) return { error: 'bad_value' };
  const reason = clean(b?.reason, 300);
  if (reason.length < 3) return { error: 'reason_required' };
  const p = (await query('SELECT id, username FROM profiles WHERE lower(username) = $1', [uname])).rows[0];
  if (!p) return { error: 'user_not_found' };
  if (p.id === me) return { error: 'self_block' };
  if ((await ownerProfileIds()).includes(p.id)) return { error: 'owner_protected' };
  for (const k of mods) {
    await query(`INSERT INTO user_module_blocks (profile_id, module, reason, show_reason, blocked_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (profile_id, module) DO UPDATE SET reason=$3, show_reason=$4, blocked_by=$5, created_at=now()`, [p.id, k, reason, b?.showReason === true, me]);
  }
  forget(p.id);
  await log(me, 'user_module_block', `@${p.username}: ${mods.join(', ')} — ${reason}`, meta);
  void notifyGift(p.id, 'module_block', 'Доступ к разделам ограничен', 'Часть разделов для вас закрыта. Если на балансе остались деньги, в закрытом разделе можно подать заявку на вывод остатка.', `mblock:${p.id}:${Date.now() >> 16}`).catch(() => {});
  return { ok: true, blocked: mods.length };
};

export const adminUnblock = async (me, profileId, module, meta) => {
  if (!(await can(me, 'modules'))) return { error: 'not_allowed' };
  const r = await query('DELETE FROM user_module_blocks WHERE profile_id = $1 AND ($2 = \'\' OR module = $2) RETURNING module', [String(profileId ?? ''), String(module ?? '')]);
  if (!r.rowCount) return { error: 'not_found' };
  forget(String(profileId));
  await log(me, 'user_module_unblock', `${profileId}: ${r.rows.map((x) => x.module).join(', ')}`, meta);
  return { ok: true, removed: r.rowCount };
};

/* ─── Человек: свои блокировки и баланс ─── */
export const myBlocks = async (profileId) => {
  const { rows } = await query('SELECT module, reason, show_reason FROM user_module_blocks WHERE profile_id = $1', [profileId]);
  if (!rows.length) return { blocks: {}, balance: 0, request: null };
  const acc = (await query('SELECT balance FROM wallet_accounts WHERE user_id = $1', [profileId])).rows[0];
  const req = (await query("SELECT id, amount_rub, status, reason, created_at FROM withdraw_requests WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 1", [profileId])).rows[0];
  return {
    blocks: Object.fromEntries(rows.map((r) => [r.module, r.show_reason ? { reason: r.reason } : {}])),
    balance: Number(acc?.balance ?? 0),
    request: req ? { id: req.id, amountRub: req.amount_rub, status: req.status, reason: req.reason, at: req.created_at.toISOString() } : null,
  };
};

/* ─── Заявка на вывод остатка ─── */
const BAD_WORDS = /(\bpin\b|пин|cvv|cvc|парол|смс|sms|код из)/i;
export const createWithdraw = async (profileId, b) => {
  if (!(await blockedKeys(profileId)).size) return { error: 'not_blocked' };
  const details = clean(b?.details, 300);
  if (details.length < 8) return { error: 'details_required' };
  if (BAD_WORDS.test(details)) return { error: 'bad_details' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acc = (await client.query('SELECT balance FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [profileId])).rows[0];
    const balance = Math.floor(Number(acc?.balance ?? 0));
    if (balance < 1) { await client.query('ROLLBACK'); return { error: 'no_balance' }; }
    const want = b?.amountRub == null || b.amountRub === '' ? balance : Math.floor(Number(b.amountRub));
    if (!Number.isFinite(want) || want < 1 || want > balance) { await client.query('ROLLBACK'); return { error: 'bad_amount', balance }; }
    const id = `wdr-${generateId()}`;
    try {
      await client.query('INSERT INTO withdraw_requests (id, profile_id, amount_rub, details_enc) VALUES ($1,$2,$3,$4)', [id, profileId, want, encryptSecret(details)]);
    } catch (e) { await client.query('ROLLBACK'); if (e.code === '23505') return { error: 'already_open' }; throw e; }
    await client.query('COMMIT');
    void import('./staffnotify.mjs').then((m) => m.notifyStaff('withdraw', { title: 'Заявка на вывод остатка', body: `${want} ₽`, dedupe: `wdr:${id}`, except: profileId })).catch(() => {});
    return { ok: true, id, amountRub: want };
  } catch (e) { try { await client.query('ROLLBACK'); } catch { /* уже закрыто */ } throw e; }
  finally { client.release(); }
};

export const cancelWithdraw = async (profileId) => {
  const r = await query("UPDATE withdraw_requests SET status='cancelled', decided_at=now() WHERE profile_id=$1 AND status='pending' RETURNING id", [profileId]);
  return r.rowCount ? { ok: true } : { error: 'not_found' };
};

/* ─── Сотрудник (право finance) ─── */
export const adminWithdrawals = async (me, status = 'pending') => {
  if (!(await can(me, 'finance'))) return { error: 'not_allowed' };
  const st = ['pending', 'paid', 'rejected', 'cancelled'].includes(status) ? status : 'pending';
  const { rows } = await query(
    `SELECT w.*, p.username, p.name, COALESCE(a.balance,0) AS balance FROM withdraw_requests w JOIN profiles p ON p.id = w.profile_id
       LEFT JOIN wallet_accounts a ON a.user_id = w.profile_id WHERE w.status = $1 ORDER BY w.created_at DESC LIMIT 200`, [st]);
  return { requests: rows.map((r) => ({ id: r.id, profileId: r.profile_id, username: r.username, name: r.name, amountRub: r.amount_rub, balance: Number(r.balance), details: openSecret(r.details_enc) ?? '', status: r.status, reason: r.reason, at: r.created_at.toISOString() })) };
};

/** Выполнено: сотрудник перевёл деньги сам; в той же транзакции остаток списывается с кошелька. Отказ — только с причиной. */
export const decideWithdraw = async (me, id, action, reasonRaw, meta) => {
  if (!(await can(me, 'finance'))) return { error: 'not_allowed' };
  const reason = clean(reasonRaw, 300);
  if (action === 'reject' && reason.length < 3) return { error: 'reason_required' };
  if (action !== 'paid' && action !== 'reject') return { error: 'bad_action' };
  const client = await pool.connect();
  let out;
  try {
    await client.query('BEGIN');
    const w = (await client.query('SELECT * FROM withdraw_requests WHERE id = $1 FOR UPDATE', [String(id ?? '')])).rows[0];
    if (!w) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (w.status !== 'pending') { await client.query('ROLLBACK'); return { error: 'bad_state', status: w.status }; }
    if (w.profile_id === me) { await client.query('ROLLBACK'); return { error: 'self_review' }; }
    if (action === 'paid') {
      const spent = await wallet.spendIn(client, w.profile_id, w.amount_rub, 'withdrawal', 'Вывод остатка баланса', `withdraw:${w.id}`);
      if (spent.error) { await client.query('ROLLBACK'); return { error: spent.error, balance: spent.balance }; }
    }
    await client.query('UPDATE withdraw_requests SET status=$2, reason=$3, decided_by=$4, decided_at=now() WHERE id=$1', [w.id, action === 'paid' ? 'paid' : 'rejected', reason, me]);
    await client.query('COMMIT');
    out = { ok: true, status: action === 'paid' ? 'paid' : 'rejected', profileId: w.profile_id, amountRub: w.amount_rub };
  } catch (e) { try { await client.query('ROLLBACK'); } catch { /* уже закрыто */ } throw e; }
  finally { client.release(); }
  await log(me, action === 'paid' ? 'withdraw_paid' : 'withdraw_rejected', `${id}: ${out.amountRub} ₽`, meta);
  void notifyGift(out.profileId, 'withdraw', action === 'paid' ? 'Остаток выведен' : 'Заявка на вывод отклонена',
    action === 'paid' ? `Перевод ${out.amountRub} ₽ выполнен по указанным данным.` : `Причина: ${reason}`, `wdr:${id}:${out.status}`).catch(() => {});
  return out;
};
