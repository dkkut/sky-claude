/**
 * Проверки заморозки (аккаунт/канал) — ЛЁГКИЙ модуль без обращений к уведомлениям и сокету: его зовут chats.mjs и шлюз server.mjs, а тяжёлые зависимости
 * (уведомления тянут сокет, сокет тянет чаты) здесь дали бы циклический импорт. Всё, что создаёт и снимает заморозки, — в acctfreeze.mjs.
 */
import { query } from './db.mjs';

export const _cache = new Map();            // 'a:<skyId>' | 'c:<chatId>' → { at, v }
const TTL = 3000;
export const forgetFreezes = () => _cache.clear();
const lookup = async (type, id) => {
  const key = `${type === 'account' ? 'a' : 'c'}:${id}`; const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const { rows } = await query("SELECT * FROM acct_freezes WHERE target_type = $1 AND target_id = $2 AND status = 'active' AND (expires_at IS NULL OR expires_at > now()) LIMIT 1", [type, id]);
  _cache.set(key, { at: Date.now(), v: rows[0] ?? null }); return rows[0] ?? null;
};
export const frozenSky = (skyId) => lookup('account', String(skyId ?? ''));
export const frozenChat = (chatId) => lookup('channel', String(chatId ?? ''));
const skyOfProfile = new Map();
export const frozenProfile = async (profileId) => {
  let sky = skyOfProfile.get(profileId);
  if (!sky || Date.now() - sky.at > 60_000) { const { rows } = await query('SELECT sky_id FROM profiles WHERE id = $1', [profileId]); sky = { at: Date.now(), id: rows[0]?.sky_id ?? '' }; skyOfProfile.set(profileId, sky); }
  return sky.id ? frozenSky(sky.id) : null;
};
/** Чат доступен человеку при заморозке? (нет заморозки — да; есть — только из списка разрешённых) */
export const chatAllowedFor = async (profileId, chatId) => { const f = await frozenProfile(profileId); return !f || (f.allowed_chat_ids ?? []).includes(chatId); };

/** Что остаётся открытым замороженному аккаунту. Всё остальное — 403 account_frozen. */
export const frozenMay = (method, path) => {
  if (path.startsWith('/api/auth/')) return true;                                   // вход/выход/обновление токена/сессия
  if (path.startsWith('/api/skyid/freeze')) return true;                            // свой экран заморозки и апелляция
  if (path.startsWith('/api/support/')) return true;                               // обращение в поддержку
  if (path.startsWith('/api/skyid/export')) return true;                           // выгрузка собственных данных
  if (path.startsWith('/api/skyid/money/')) return true;                           // замок SkyMoney (код, пароль) — чтобы увидеть баланс
  if (path.startsWith('/api/platform/') || path === '/api/me/module-blocks' || path === '/api/rtc/config') return true;
  if (method === 'GET' && (path === '/api/wallet' || path.startsWith('/api/wallet/'))) return true;   // просмотр баланса и истории; движение денег — только не-GET и закрыто
  if (method === 'GET' && (path.startsWith('/api/skyid') || path === '/api/directory/people' || path.startsWith('/api/entitlements') || path === '/api/onboarding')) return true;
  return false;
};

