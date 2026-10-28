import { json, requireSkyId, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { deviceHash } from './../applock.mjs';
import { pinState, enablePin, verifyPin, changePin, disablePin, startReset, finishReset } from './../ippin.mjs';

const STATUS = { not_found: 404, not_enabled: 409, already_enabled: 409, too_many_requests: 429, locked: 429, session_ended: 401 };

/** PIN-код при смене IP (настройка Sky ID). Эти ручки открыты и для сессии, закрытой PIN-ом (server.mjs). */
export const ipPinRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/skyid/pin')) return false;
  const session = await requireSkyId(req, res);
  if (!session) return true;
  const { skyId, sessionId } = session;
  if (!rateLimit(`ippin:${skyId}`, 40)) return json(res, 429, { error: 'too_many_requests' });
  const ip = clientIp(req);
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);

  if (req.method === 'GET' && url === '/api/skyid/pin') return reply(await pinState(skyId));
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const b = (await parseBody(req)) ?? {};
  switch (url) {
    case '/api/skyid/pin/enable':       return reply(await enablePin(skyId, sessionId, ip, { pin: b.pin, totp: b.totp }));
    case '/api/skyid/pin/verify':       return reply(await verifyPin(skyId, sessionId, ip, b.pin, deviceHash(req)));
    case '/api/skyid/pin/change':       return reply(await changePin(skyId, sessionId, { pin: b.pin, newPin: b.newPin }));
    case '/api/skyid/pin/disable':      return reply(await disablePin(skyId, sessionId, { pin: b.pin }));
    case '/api/skyid/pin/reset/start':  return reply(await startReset(skyId));
    case '/api/skyid/pin/reset/finish': return reply(await finishReset(skyId, sessionId, ip, { emailCode: b.emailCode, totp: b.totp, newPin: b.newPin }));
    default: return json(res, 404, { error: 'not_found' });
  }
};
