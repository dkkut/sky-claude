import { json, requireSkyId, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { status, enable, disable, unlock, unlockBegin, ping, lock, bioBegin, bioFinish, bioRemove } from './../applock.mjs';
import { kickLocked } from './../signal.mjs';

const STATUS = { invalid_pin: 400, too_many_attempts: 429, session_ended: 401, not_enabled: 404, challenge_expired: 410, method_not_allowed: 403, no_device: 400 };

/** /api/skyid/applock/* — замок приложения. Эти ручки открыты и ЗАКРЫТОЙ сессии (иначе её нечем открыть), см. server.mjs. */
export const appLockRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/skyid/applock')) return false;
  const s = await requireSkyId(req, res); if (!s) return true;
  const { skyId, sessionId } = s;
  if (!rateLimit(`applock:${skyId}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const b = req.method === 'GET' ? {} : ((await parseBody(req).catch(() => ({}))) ?? {});
  const p = path.slice('/api/skyid/applock'.length);
  if (req.method === 'GET' && p === '') return reply(await status(skyId, sessionId, req));
  if (req.method !== 'POST') return json(res, 404, { error: 'not_found' });
  if (p === '/ping') return reply(await ping(sessionId));
  if (p === '/lock') { const r = await lock(sessionId); kickLocked(sessionId); return reply(r); }
  if (p === '/unlock/begin') return reply(await unlockBegin(skyId, req));
  if (p === '/unlock') return reply(await unlock(skyId, sessionId, req, b));
  // Остальное меняет настройку — только с ОТКРЫТОЙ сессии (закрытая сюда не доходит: не может ни выключить, ни сменить код сама).
  const st = await status(skyId, sessionId, req);
  if (st.enabled && st.locked && p !== '/enable') return json(res, 423, { error: 'app_locked' });
  if (st.enabled && st.locked && p === '/enable' && !st.fresh) return json(res, 423, { error: 'app_locked' });
  if (p === '/enable') return reply(await enable(skyId, sessionId, req, b));
  if (p === '/disable') return reply(await disable(skyId, sessionId, req, b));
  if (p === '/bio/begin') return reply(await bioBegin(skyId, sessionId, req, b));
  if (p === '/bio/finish') return reply(await bioFinish(skyId, req, b));
  if (p === '/bio/remove') return reply(await bioRemove(skyId, sessionId, req, b));
  return json(res, 404, { error: 'not_found' });
};
