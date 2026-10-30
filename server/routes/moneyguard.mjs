/** Ручки замка SkyMoney: /api/skyid/money/{status,code,unlock,lock}. Логика — moneyguard.mjs. */
import { json, parseBody, readSession } from './../http.mjs';
import { moneyState, unlockMoney, lockMoney, sendDeviceCode } from './../moneyguard.mjs';
import { rateLimit } from './../security.mjs';

const CODES = { invalid_credentials: 401, password_required: 400, device_code_required: 400, invalid_code: 400, code_expired: 400, too_many_attempts: 429, too_many_requests: 429, too_soon: 429, use_authenticator: 400, no_contact: 400, not_found: 404 };

export const moneyGuardRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/skyid/money/')) return false;
  const s = await readSession(req);
  if (!s) return json(res, 401, { error: 'unauthorized' });
  if (!rateLimit(`moneyguard:${s.skyId}`, 60)) return json(res, 429, { error: 'rate_limited' });
  if (req.method === 'GET' && path === '/api/skyid/money/status') return json(res, 200, await moneyState(s.skyId, s.sessionId, req));
  if (req.method === 'POST' && path === '/api/skyid/money/code') { const r = await sendDeviceCode(s.skyId); return json(res, r.ok ? 200 : (CODES[r.error] ?? 400), r); }
  if (req.method === 'POST' && path === '/api/skyid/money/unlock') {
    const b = (await parseBody(req).catch(() => ({}))) ?? {};
    const r = await unlockMoney(s.skyId, s.sessionId, req, { password: b.password, code: b.code });
    return json(res, r.ok ? 200 : (CODES[r.error] ?? 400), r);
  }
  if (req.method === 'POST' && path === '/api/skyid/money/lock') return json(res, 200, await lockMoney(s.sessionId));
  return json(res, 404, { error: 'not_found' });
};
