/**
 * Владелец о входах по SSH по токену: список входов, которые ещё можно отменить (25 минут), и ответ «Это я» / «Это не я».
 * Лежит под /api/skyid/ — вне админских ручек: на экстренную отмену не должны влиять шлюз входа в панель и замок настроек,
 * поэтому владельца определяем «сырым» признаком (isOwnerRaw), а не правами панели. Работает только с входом в аккаунт владельца.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { isOwnerRaw } from './../admin.mjs';
import { pendingSshLogins, answerSshLogin } from './../sshgate.mjs';

export const sshOwnerRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/skyid/ssh-login')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!(await isOwnerRaw(me))) return json(res, 200, { owner: false, pending: [] });   // обычному человеку — пусто, ничего не раскрываем
  if (!rateLimit(`sshown:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const path = new URL(req.url, 'http://x').pathname;
  if (req.method === 'GET' && path === '/api/skyid/ssh-login') return json(res, 200, { owner: true, pending: await pendingSshLogins() });
  if (req.method === 'POST' && path === '/api/skyid/ssh-login/answer') {
    const b = (await parseBody(req).catch(() => ({}))) ?? {};
    const r = await answerSshLogin(me, b.id, b.notMe === true);
    return json(res, r.error ? (r.error === 'not_found' ? 404 : 409) : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
