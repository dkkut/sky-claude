import { needDeviceCode } from './../devicecode.mjs';
import { json, parseBody, readSession, clientIp } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { freezeState, protectAccount, confirmFreezeLink, resendFreezeLink, unfreeze } from './../accountfreeze.mjs';

const STATUS = { bad_period: 400, bad_freeze: 400, nothing_to_do: 400, email_required: 409, not_frozen: 409, link_required: 409,
  totp_required: 400, bad_code: 400, invalid_link: 404, not_found: 404 };

/** Очистка сессий и заморозка новых входов (accountfreeze.mjs). */
export const accountFreezeRoutes = async (req, res, url) => {
  const mine = url === '/api/auth/devices/protect' || url.startsWith('/api/auth/freeze');
  if (!mine) return false;
  const ip = clientIp(req); const ua = String(req.headers['user-agent'] ?? '');
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);

  // Ссылка из письма открыта в любом браузере — входа в аккаунт для этого не нужно.
  if (req.method === 'POST' && url === '/api/auth/freeze/link') {
    if (!rateLimit(`freeze:link:${ip}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    const b = (await parseBody(req)) ?? {};
    return reply(await confirmFreezeLink(b.t, { ip, ua }));
  }

  const s = await readSession(req);
  if (!s) return json(res, 401, { error: 'unauthorized' });
  if (req.method === 'GET' && url === '/api/auth/freeze') return reply(await freezeState(s.skyId));
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const b = (await parseBody(req)) ?? {};
  if (url === '/api/auth/devices/protect') {
    if (!rateLimitPerHour(`freeze:protect:${s.skyId}`, 40)) return json(res, 429, { error: 'too_many_requests' });
    if (['last', 'period'].includes(b.remove)) {   // завершение чужих входов — с кодом аутентификатора (заморозка новых входов никого не выбивает)
      const need = await needDeviceCode(s.skyId, b.twoFactorCode);
      if (need) return json(res, need.status, need.body);
    }
    return reply(await protectAccount(s.skyId, s.sessionId, { ip, ua }, b));
  }
  if (url === '/api/auth/freeze/resend') {
    if (!rateLimitPerHour(`freeze:resend:${s.skyId}`, 3)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await resendFreezeLink(s.skyId));
  }
  if (url === '/api/auth/freeze/unfreeze') {
    if (!rateLimitPerHour(`freeze:unfreeze:${s.skyId}`, 30)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await unfreeze(s.skyId, { ip, ua }, b));
  }
  return json(res, 404, { error: 'not_found' });
};
