/**
 * Детский аккаунт внутри Sky ID.
 *
 * Ребёнок — обычный профиль того же Sky ID (лимит профилей остаётся 2), помеченный строкой child_accounts.
 * Сервер, а не клиент, решает: что закрыто (403 child_restricted в server.mjs), кто может менять настройки
 * (только не-детский профиль того же Sky ID) и как выйти из детского профиля (PIN опекуна, с паузой при переборе).
 * Не делает: слежки за перепиской, ограничения по времени суток, фильтра сообщений — этого нет.
 */
import { query } from './db.mjs';
import { hashPassword, verifyPassword } from './security.mjs';
import { createProfile, getProfileOfSkyId } from './skyid.mjs';

/** Ключи модулей, которые опекун может закрыть ребёнку (совпадают с modclosure.MODULES). */
export const CHILD_MODULES = ['market', 'pvz', 'garant', 'go', 'kbiz', 'tickets', 'blox', 'ads', 'nftgifts', 'bots', 'partners',
  'friendsmap', 'launcher', 'campaigns', 'prime', 'ai', 'gaming', 'bloom'];
export const CHILD_DEFAULT_CLOSED = ['market', 'pvz', 'garant', 'go', 'kbiz', 'tickets', 'blox', 'ads', 'nftgifts', 'bots', 'partners', 'friendsmap', 'launcher', 'campaigns', 'prime'];

const PATHS = {
  market: ['/api/market', '/api/onsite'], pvz: ['/api/market/pvz'], garant: ['/api/garant'], go: ['/api/go', '/api/parking'], kbiz: ['/api/kbiz'],
  tickets: ['/api/tickets'], blox: ['/api/blox'], ads: ['/api/ads'], nftgifts: ['/api/gifts'], bots: ['/api/bots'], partners: ['/api/partners'],
  friendsmap: ['/api/maps/friends', '/api/safety'], launcher: ['/api/launcher'], campaigns: ['/api/campaigns'], prime: ['/api/prime'],
  ai: ['/api/ai'], gaming: ['/api/games', '/api/gaming'], bloom: ['/api/bloom'],
};
const MONEY = ['/api/wallet', '/api/skykassa', '/api/codes', '/api/withdraw'];
/** Что ребёнок не может менять в самом Sky ID (безопасность аккаунта — дело опекуна). */
const SKYID_OPEN = [/^\/api\/skyid\/profiles\/[\w.-]+\/select$/, /^\/api\/skyid\/applock/, /^\/api\/skyid\/pin/, /^\/api\/skyid\/limited/, /^\/api\/skyid\/child/];
const AUTH_LOCKED = /^\/api\/auth\/(devices|deletion|password|freeze|two-factor|link)/;

let cache = new Map();
const forget = (id) => { if (id) cache.delete(id); else cache = new Map(); };
export const childOf = async (profileId) => {
  if (!profileId) return null;
  const hit = cache.get(profileId);
  if (hit && Date.now() - hit.at < 4000) return hit.row;
  let row = null;
  try { row = (await query('SELECT profile_id, sky_id, settings FROM child_accounts WHERE profile_id = $1', [profileId])).rows[0] ?? null; } catch { return null; }
  cache.set(profileId, { at: Date.now(), row });
  if (cache.size > 5000) cache.clear();
  return row;
};
const closedOf = (row) => new Set(Array.isArray(row?.settings?.modules) ? row.settings.modules : CHILD_DEFAULT_CLOSED);

/** Что закрывает этот запрос для детского профиля: ключ модуля, 'money', 'skyid' или null. */
export const childBlockedFor = async (profileId, path, method = 'GET') => {
  const row = await childOf(profileId);
  if (!row) return null;
  const closed = closedOf(row);
  for (const [key, list] of Object.entries(PATHS)) {
    if (closed.has(key) && list.some((p) => path === p || path.startsWith(`${p}/`))) return key;
  }
  if (!row.settings?.money && MONEY.some((p) => path === p || path.startsWith(`${p}/`)) && path !== '/api/wallet/balance') return 'money';
  if (method !== 'GET' && method !== 'HEAD') {
    if (path.startsWith('/api/skyid/') && !SKYID_OPEN.some((re) => re.test(path))) return 'skyid';
    if (AUTH_LOCKED.test(path)) return 'skyid';
  }
  return null;
};

const cleanPin = (v) => String(v ?? '').replace(/\D/g, '');
const cleanSettings = (b, prev = {}) => ({
  modules: Array.isArray(b?.modules) ? [...new Set(b.modules.map(String))].filter((k) => CHILD_MODULES.includes(k)) : (prev.modules ?? CHILD_DEFAULT_CLOSED),
  money: typeof b?.money === 'boolean' ? b.money : !!prev.money,
  hideAdult: typeof b?.hideAdult === 'boolean' ? b.hideAdult : prev.hideAdult !== false,
});

/** Профиль сессии не детский — только такой управляет детскими. */
export const isGuardianSession = async (profileId) => !(await childOf(profileId));

const view = (r, p) => ({ profileId: r.profile_id, name: p?.name ?? '', username: p?.username ?? '', birthYear: r.birth_year, settings: cleanSettings(r.settings), createdAt: r.created_at.toISOString() });

export const listChildren = async (skyId) => {
  const { rows } = await query('SELECT c.*, p.name, p.username FROM child_accounts c JOIN profiles p ON p.id = c.profile_id WHERE c.sky_id = $1 ORDER BY c.created_at', [skyId]);
  return { modules: CHILD_MODULES, defaults: CHILD_DEFAULT_CLOSED, children: rows.map((r) => view(r, r)) };
};

/** Превратить ПРОФИЛЬ ЭТОГО ЖЕ Sky ID в детский (existingId) или создать новый (name+username). */
export const createChild = async (skyId, guardianId, b) => {
  const pin = cleanPin(b?.pin);
  if (pin.length < 4 || pin.length > 8) return { error: 'bad_pin' };
  const year = Number(b?.birthYear);
  const nowY = new Date().getFullYear();
  const birthYear = Number.isInteger(year) && year > nowY - 18 && year <= nowY ? year : null;
  if (b?.birthYear != null && birthYear == null) return { error: 'bad_birth_year' };
  let childId;
  if (b?.existingId) {
    const p = await getProfileOfSkyId(skyId, String(b.existingId));
    if (!p) return { error: 'not_found' };
    if (p.id === guardianId) return { error: 'self_child' };
    childId = p.id;
  } else {
    const r = await createProfile(skyId, { name: String(b?.name ?? ''), username: String(b?.username ?? '') });
    if (r.error) return { error: r.error };
    childId = r.profile.id;
  }
  if ((await query('SELECT 1 FROM child_accounts WHERE profile_id = $1', [childId])).rows[0]) return { error: 'already_child' };
  await query(
    `INSERT INTO child_accounts (profile_id, sky_id, guardian_id, pin_hash, birth_year, settings) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [childId, skyId, guardianId, await hashPassword(pin), birthYear, JSON.stringify(cleanSettings(b))]);
  forget(childId);
  return { ok: true, profileId: childId };
};

const owns = async (skyId, childId) => (await query('SELECT 1 FROM child_accounts WHERE profile_id = $1 AND sky_id = $2', [childId, skyId])).rows[0];

export const updateChild = async (skyId, childId, b) => {
  const r = (await query('SELECT settings FROM child_accounts WHERE profile_id = $1 AND sky_id = $2', [childId, skyId])).rows[0];
  if (!r) return { error: 'not_found' };
  const sets = [JSON.stringify(cleanSettings(b, r.settings))]; let sql = 'settings = $3::jsonb';
  const params = [childId, skyId, sets[0]];
  if (b?.pin != null) {
    const pin = cleanPin(b.pin);
    if (pin.length < 4 || pin.length > 8) return { error: 'bad_pin' };
    params.push(await hashPassword(pin)); sql += `, pin_hash = $${params.length}, pin_fails = 0, pin_locked_until = NULL`;
  }
  await query(`UPDATE child_accounts SET ${sql}, updated_at = now() WHERE profile_id = $1 AND sky_id = $2`, params);
  forget(childId);
  return { ok: true };
};

export const removeChild = async (skyId, childId) => {
  if (!(await owns(skyId, childId))) return { error: 'not_found' };
  await query('DELETE FROM child_accounts WHERE profile_id = $1 AND sky_id = $2', [childId, skyId]);
  forget(childId);
  return { ok: true };
};

/** Проверка PIN опекуна: из детского профиля нельзя перейти в другой без него. 5 неверных — пауза 15 минут, дальше вдвое. */
export const checkGuardianPin = async (skyId, childId, pin) => {
  const r = (await query('SELECT pin_hash, pin_fails, pin_locked_until FROM child_accounts WHERE profile_id = $1 AND sky_id = $2', [childId, skyId])).rows[0];
  if (!r) return { ok: true };
  if (r.pin_locked_until && r.pin_locked_until > new Date()) return { error: 'pin_locked', retryAfter: Math.ceil((r.pin_locked_until - Date.now()) / 1000) };
  if (await verifyPassword(cleanPin(pin), r.pin_hash)) {
    await query('UPDATE child_accounts SET pin_fails = 0, pin_locked_until = NULL WHERE profile_id = $1', [childId]);
    return { ok: true };
  }
  const fails = r.pin_fails + 1;
  const lock = fails >= 5 ? new Date(Date.now() + 15 * 60_000 * 2 ** Math.min(6, Math.floor(fails / 5) - 1)) : null;
  await query('UPDATE child_accounts SET pin_fails = $2, pin_locked_until = $3 WHERE profile_id = $1', [childId, fails, lock]);
  return { error: lock ? 'pin_locked' : 'bad_pin_code', retryAfter: lock ? Math.ceil((lock - Date.now()) / 1000) : undefined };
};

export const myChildState = async (profileId) => {
  const row = await childOf(profileId);
  if (!row) return { child: false };
  const closed = [...closedOf(row)];
  return { child: true, closedModules: closed, money: !!row.settings?.money, hideAdult: row.settings?.hideAdult !== false };
};
