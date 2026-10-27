import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { gateStatus, requestGate, inspectLink, confirmLink, panicLink } from './../admingate.mjs';

/** Двухэтапный вход в панель администратора. Страница ссылки открывается без входа — по самой ссылке. */
export const adminGateRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/gate')) return false;
  const u = new URL(req.url, 'http://x');
  const ip = clientIp(req);

  // Ссылка: без входа в аккаунт, поэтому предел — на адрес.
  if (u.pathname === '/api/admin/gate/link' || u.pathname === '/api/admin/gate/confirm' || u.pathname === '/api/admin/gate/panic') {
    if (!rateLimit(`admgate:pub:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && u.pathname === '/api/admin/gate/link') {
      const r = await inspectLink(u.searchParams.get('t'));
      return json(res, r.error ? 404 : 200, r);
    }
    if (req.method === 'POST' && u.pathname === '/api/admin/gate/confirm') {
      const body = await parseBody(req);
      const r = await confirmLink(body?.t, body?.code, body?.adminToken);
      return json(res, r.error ? (r.error === 'invalid_link' ? 404 : 400) : 200, r);
    }
    if (req.method === 'POST' && u.pathname === '/api/admin/gate/panic') {
      const body = await parseBody(req);
      const r = await panicLink(body?.t, body?.action, { ip });
      return json(res, r.error ? (r.error === 'invalid_link' ? 404 : r.error === 'owner_only' ? 403 : 400) : 200, r);
    }
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (req.method === 'GET' && u.pathname === '/api/admin/gate') {
    if (!rateLimit(`admgate:r:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, await gateStatus(session.sessionId, me));
  }
  if (req.method === 'POST' && u.pathname === '/api/admin/gate/request') {
    const r = await requestGate(session.sessionId, me, { req, device: String(req.headers['user-agent'] ?? ''), ip });
    return json(res, r.error ? (r.error === 'not_allowed' ? 403 : r.error === 'too_many_requests' ? 429 : 400) : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
