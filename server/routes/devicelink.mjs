import { json, parseBody, requireSkyId, clientIp, appBody, isAppClient } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { startLink, lookupLink, decideLink, pollLink, cancelLink, linkHistory, needsTotp } from './../devicelink.mjs';
import { findSkyIdById } from './../skyid.mjs';
import { startSession } from './auth.mjs';
import { config } from './../config.mjs';
import { buildRefreshCookie } from './../cookies.mjs';

const STATUS = { not_found: 404, wrong_verify: 400, bad_verify: 400, totp_required: 400, bad_code: 400, exhausted: 410 };

/**
 * Вход на ТВ, консоли и в машине по QR/коду с телефона (devicelink.mjs).
 * Открытые ручки устройства — /api/auth/link/*; ручки телефона — /api/skyid/link/* (нужен вход в Sky ID).
 */
export const deviceLinkRoutes = async (req, res, url) => {
  const ip = clientIp(req);

  /* ── Устройство ─────────────────────────────────────────────── */
  if (url.startsWith('/api/auth/link/')) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const b = (await parseBody(req)) ?? {};
    if (url === '/api/auth/link/start') {
      if (!rateLimitPerHour(`dlink:start:${ip}`, 30) || !rateLimit(`dlink:start:m:${ip}`, 6)) return json(res, 429, { error: 'too_many_requests' });
      const r = await startLink({ kind: b.kind, label: b.label, lang: b.lang, app: isAppClient(req) },
        { ip, ua: req.headers['user-agent'] });
      const origin = config.publicOrigin;
      return json(res, 201, { id: r.id, code: r.code, pollKey: r.pollKey, verify: r.verify, expiresIn: r.expiresIn,
        // Ссылка внутри QR: камера телефона откроет сайт, а сканер в приложении возьмёт из неё код.
        url: `${origin}/link?code=${r.codeRaw}` });
    }
    if (url === '/api/auth/link/poll') {
      if (!rateLimit(`dlink:poll:${b.id ?? ip}`, 60)) return json(res, 429, { error: 'too_many_requests' });
      const r = await pollLink({ id: b.id, pollKey: b.pollKey });
      if (r.error) return json(res, 404, r);
      if (r.status !== 'approved') return json(res, 200, { status: r.status, scanned: r.scanned });
      const skyId = await findSkyIdById(r.skyId);
      if (!skyId) return json(res, 410, { status: 'denied' });
      const session = await startSession(skyId, req, { via: { kind: r.row.kind, label: r.row.label } });
      return json(res, 200, appBody(req, { status: 'approved', session: session.body }, { refreshToken: session.refreshToken }),
        { 'Set-Cookie': session.cookie });
    }
    if (url === '/api/auth/link/cancel') return json(res, 200, await cancelLink({ id: b.id, pollKey: b.pollKey }));
    return json(res, 404, { error: 'not_found' });
  }

  /* ── Телефон ───────────────────────────────────────────────── */
  if (url.startsWith('/api/skyid/link')) {
    const s = await requireSkyId(req, res);
    if (!s) return true;
    if (req.method === 'GET' && url === '/api/skyid/link/history') return json(res, 200, { items: await linkHistory(s.skyId) });
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const b = (await parseBody(req)) ?? {};
    if (url === '/api/skyid/link/lookup') {
      // Код — секрет на 10 минут; подбирать его через телефон нельзя ни с одной учётки, ни с одного адреса.
      if (!rateLimit(`dlink:look:${s.skyId}`, 10) || !rateLimit(`dlink:look:ip:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      const r = await lookupLink(s.skyId, b.code);
      return json(res, r.error ? STATUS[r.error] ?? 400 : 200, r.error ? r : { ...r, needsTotp: await needsTotp(s.skyId) });
    }
    if (url === '/api/skyid/link/decide') {
      if (!rateLimit(`dlink:dec:${s.skyId}`, 20) || !rateLimitPerHour(`dlink:dec:h:${s.skyId}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      const r = await decideLink(s.skyId, s.sessionId, ip, { id: b.id, approve: b.approve === true, verify: b.verify, totp: b.totp });
      return json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
    }
    return json(res, 404, { error: 'not_found' });
  }
  return false;
};
