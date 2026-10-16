import { json, parseBody, readSession, clientIp } from './../http.mjs';
import { rateLimit, rateLimitPerHour, verifyToken } from './../security.mjs';
import { config } from './../config.mjs';
import { verifySkyTwoFactor } from './../skyid.mjs';
import {
  generateBackupCodes, backupCodesLeft, startReset, resetInfo, cancelReset, finishReset, resetStatus, sendContactGuardCode,
} from './../accountrecovery.mjs';

const STATUS = { not_configured: 409, admin_manual: 403, email_required: 409, too_many_requests: 429, too_many_attempts: 429, invalid_link: 404,
  too_early: 409, cannot_prove_ownership: 409, invalid_code: 401, challenge_expired: 401, two_factor_required: 400 };

/** Резервные коды, сброс потерянного аутентификатора (ссылки из писем, challenge входа), код на текущую почту при смене контакта. */
export const accountRecoveryRoutes = async (req, res, url) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  const mine = path.startsWith('/api/auth/two-factor/reset') || path === '/api/skyid/two-factor/backup-codes' || path === '/api/skyid/contact/guard-code' || path === '/api/skyid/two-factor/reset-status';
  if (!mine) return false;
  const ip = clientIp(req); const ua = String(req.headers['user-agent'] ?? '');
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  if (!rateLimit(`recovery:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });

  /* Ссылки из писем и шаг входа — без сессии. Токен ссылки — секрет; challenge — результат первого фактора. */
  if (path === '/api/auth/two-factor/reset/info' && req.method === 'GET') {
    const kind = u.searchParams.get('kind') === 'cancel' ? 'cancel' : 'finish';
    return reply(await resetInfo(u.searchParams.get('token'), kind));
  }
  if (path === '/api/auth/two-factor/reset/cancel' && req.method === 'POST') {
    if (!rateLimitPerHour(`recovery:cancel:${ip}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await cancelReset((await parseBody(req))?.token));
  }
  if ((path === '/api/auth/two-factor/reset/start' || path === '/api/auth/two-factor/reset/finish') && req.method === 'POST') {
    const b = (await parseBody(req)) ?? {};
    const payload = verifyToken(String(b.challenge ?? ''), config.jwtSecret);
    if (!payload || payload.typ !== '2fa-challenge') return json(res, 401, { error: 'challenge_expired' });
    if (path.endsWith('/start')) return reply(await startReset(payload.sub, { ip, ua }));
    return reply(await finishReset(payload.sub, b.token));
  }

  /* С сессией */
  const s = await readSession(req);
  if (!s) return json(res, 401, { error: 'unauthorized' });
  if (path === '/api/skyid/two-factor/reset-status' && req.method === 'GET') return json(res, 200, await resetStatus(s.skyId));
  if (path === '/api/skyid/two-factor/backup-codes') {
    if (req.method === 'GET') return json(res, 200, { left: await backupCodesLeft(s.skyId) });
    if (req.method === 'POST') {
      if (!rateLimitPerHour(`recovery:codes:${s.skyId}`, 10)) return json(res, 429, { error: 'too_many_requests' });
      const b = (await parseBody(req)) ?? {};
      const c = await verifySkyTwoFactor(s.skyId, String(b.code ?? ''));
      if (c.skipped) return json(res, 409, { error: 'not_configured' });     // кодов без включённого второго фактора нет
      if (c.error) return reply({ error: c.error === 'too_many_attempts' ? 'too_many_attempts' : 'invalid_code' });
      return json(res, 200, await generateBackupCodes(s.skyId));
    }
  }
  if (path === '/api/skyid/contact/guard-code' && req.method === 'POST') {
    if (!rateLimitPerHour(`recovery:guard:${s.skyId}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await sendContactGuardCode(s.skyId));
  }
  return json(res, 405, { error: 'method_not_allowed' });
};
