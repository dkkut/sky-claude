import { json, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestSsh, pollSsh, inspectSshLink, confirmSshLink, panicSshLink } from './../sshgate.mjs';

/**
 * Подтверждение входа по SSH. Все ручки открыты без входа в аккаунт: скрипт на сервере приходит
 * с подписью, владелец — со ссылкой из письма. Пределы — на адрес.
 */
export const sshGateRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/ssh-gate')) return false;
  const u = new URL(req.url, 'http://x');
  const ip = clientIp(req);
  if (!rateLimit(`sshgate:pub:${ip}`, 40)) return json(res, 429, { error: 'too_many_requests' });

  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/request') {
    const r = await requestSsh(await parseBody(req), { ip });
    return json(res, r.error ? (r.error === 'bad_signature' ? 403 : r.error === 'too_many_requests' ? 429 : r.error === 'disabled' ? 404 : r.error === 'paused' ? 423 : 400) : 200, r);
  }
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/poll') {
    const body = await parseBody(req);
    return json(res, 200, await pollSsh(body?.id, body?.poll));
  }
  if (req.method === 'GET' && u.pathname === '/api/ssh-gate/link') {
    const r = await inspectSshLink(u.searchParams.get('t'));
    return json(res, r.error ? 404 : 200, r);
  }
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/confirm') {
    const body = await parseBody(req);
    const r = await confirmSshLink(body?.t, body?.code);
    return json(res, r.error ? (r.error === 'invalid_link' ? 404 : 400) : 200, r);
  }
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/panic') {
    const body = await parseBody(req);
    const r = await panicSshLink(body?.t, body?.action, { ip });
    return json(res, r.error ? (r.error === 'invalid_link' ? 404 : r.error === 'owner_only' ? 403 : 400) : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
