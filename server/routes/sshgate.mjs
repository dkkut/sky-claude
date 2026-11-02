import { json, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { inspectSshConfirm, confirmSshLogin, denySshConfirm, inspectShutdown, decideShutdown } from './../breach.mjs';
import { requestSsh, pollSsh, inspectSshLink, confirmSshLink, panicSshLink, loginSsh, watchSsh } from './../sshgate.mjs';

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
  // Вход по токену администратора (режим token): @ник + токен; владельцу сразу уходит уведомление, 25 минут можно отменить.
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/login') {
    const r = await loginSsh(await parseBody(req), { ip });
    return json(res, r.error ? (r.error === 'bad_signature' ? 403 : r.error === 'too_many_requests' ? 429 : r.error === 'disabled' ? 404 : r.error === 'paused' ? 423 : r.error === 'denied' ? 401 : 400) : 200, r);
  }
  // Сторож сессии на сервере спрашивает, не отменил ли владелец вход (пока открыто окно в 25 минут).
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/watch') {
    const body = await parseBody(req);
    return json(res, 200, await watchSsh(body?.id, body?.poll));
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
    const r = await confirmSshLink(body?.t, body?.code, body?.adminToken);
    return json(res, r.error ? (r.error === 'invalid_link' ? 404 : 400) : 200, r);
  }
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/panic') {
    const body = await parseBody(req);
    const r = await panicSshLink(body?.t, body?.action, { ip });
    return json(res, r.error ? (r.error === 'invalid_link' ? 404 : r.error === 'owner_only' ? 403 : 400) : 200, r);
  }
  // Прежний хук ssh-login-hook.sh: письмо «подтвердите вход за 10 минут» ведёт сюда (страница /ssh-confirm с двумя кнопками).
  if (req.method === 'GET' && u.pathname === '/api/ssh-gate/legacy') {
    const r = await inspectSshConfirm(u.searchParams.get('token'));
    return json(res, r.error ? 404 : 200, r);
  }
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/legacy/confirm') {
    const ok = await confirmSshLogin((await parseBody(req))?.token);
    return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'invalid_link' });
  }
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/legacy/deny') {
    const r = await denySshConfirm((await parseBody(req))?.token);
    return json(res, r.error ? 404 : 200, r);
  }
  if (req.method === 'GET' && u.pathname === '/api/ssh-gate/shutdown') {
    const r = await inspectShutdown(u.searchParams.get('token'));
    return json(res, r.error ? 404 : 200, r);
  }
  if (req.method === 'POST' && u.pathname === '/api/ssh-gate/shutdown/decide') {
    const b = await parseBody(req);
    const r = await decideShutdown(b?.token, b?.action);
    return json(res, r.error ? (r.error === 'bad_action' ? 400 : 404) : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
