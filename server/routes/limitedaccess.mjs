import { json, requireSkyId, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { sessionStore } from './../sessions.mjs';
import { settings, setEnabled, decide, statusFor, lostStart, lostFinish } from './../limitedaccess.mjs';

const STATUS = { not_found: 404, not_limited: 409, already_decided: 409, backup_email_required: 409, no_backup_email: 409, too_many_requests: 429, too_soon: 429, invalid_code: 400, session_ended: 401, limited_session: 403 };

/**
 * Ограниченный доступ на неподтверждённом устройстве. Ручки для ограниченной сессии (status, lost/*) открыты ей самой;
 * настройка и решение — только НЕограниченной (сервер проверяет флаг в сессии, а не слова клиента).
 */
export const limitedAccessRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/skyid/limited')) return false;
  const session = await requireSkyId(req, res);
  if (!session) return true;
  const { skyId, sessionId } = session;
  if (!rateLimit(`limited:${skyId}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const limited = Boolean((await sessionStore.get(sessionId))?.limited);
  const b = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});

  // Только для самой ограниченной сессии.
  if (req.method === 'GET' && url === '/api/skyid/limited/status') return reply(await statusFor(skyId, sessionId));
  if (req.method === 'POST' && url === '/api/skyid/limited/lost/start') return reply(await lostStart(skyId, sessionId, clientIp(req)));
  if (req.method === 'POST' && url === '/api/skyid/limited/lost/finish') return reply(await lostFinish(skyId, sessionId, b.code, clientIp(req)));

  // Остальное — только полноценная сессия (ограниченная не может ни включить настройку, ни подтвердить сама себя).
  if (limited) return json(res, 403, { error: 'limited_session' });
  if (req.method === 'GET' && url === '/api/skyid/limited') return reply(await settings(skyId));
  if (req.method === 'PUT' && url === '/api/skyid/limited') return reply(await setEnabled(skyId, Boolean(b.enabled), req));
  if (req.method === 'POST' && url === '/api/skyid/limited/decide') return reply(await decide(skyId, b.id, b.approve === true));
  return json(res, 404, { error: 'not_found' });
};
