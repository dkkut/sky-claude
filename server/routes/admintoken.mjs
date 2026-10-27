import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { tokenState, issueToken, revokeToken, unlockSettings, lockSettings, settingsOpen, isAdminProfile, UNLOCK_MIN } from './../admintoken.mjs';

const STATUS = { not_allowed: 403, two_factor_required: 409, bad_code: 400, too_many_requests: 429, admin_token_required: 400, admin_token_missing: 409, admin_token_invalid: 403, admin_token_blocked: 429 };

/** Личный токен администратора/владельца: состояние, выдача, отзыв, открытие настроек. Только администратору; вход в аккаунт обязателен. */
export const adminTokenRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/skyid/admin-token')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`admtok:api:${me}`, 60) || !rateLimit(`admtok:ip:${clientIp(req)}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const path = url.split('?')[0];
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  if (!(await isAdminProfile(me))) return json(res, 200, { admin: false });
  if (req.method === 'GET' && path === '/api/skyid/admin-token') {
    return json(res, 200, { admin: true, ...(await tokenState(me)), unlocked: await settingsOpen(s.sessionId, me), unlockMinutes: UNLOCK_MIN });
  }
  const b = req.method === 'POST' ? ((await parseBody(req).catch(() => ({}))) ?? {}) : {};
  if (req.method === 'POST' && path === '/api/skyid/admin-token/issue') return reply(await issueToken(me, b.code));
  if (req.method === 'POST' && path === '/api/skyid/admin-token/revoke') return reply(await revokeToken(me, b.code));
  if (req.method === 'POST' && path === '/api/skyid/admin-token/unlock') return reply(await unlockSettings(s.sessionId, me, b.token));
  if (req.method === 'POST' && path === '/api/skyid/admin-token/lock') return reply(await lockSettings(s.sessionId));
  return json(res, 404, { error: 'not_found' });
};
