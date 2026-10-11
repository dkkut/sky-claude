/**
 * Пуш-уведомления: ключ для подписки, подписка устройства, отписка.
 * Сами пуши шлёт server/webpush.mjs тем, кого нет в сети.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { publicKey, webPushEnabled, fcmEnabled, saveSubscription, removeSubscription } from './../webpush.mjs';

export const pushRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/push/')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`push:${me}`, 30)) return json(res, 429, { error: 'rate_limited' });

  if (req.method === 'GET' && path === '/api/push/key') {
    return json(res, 200, { web: webPushEnabled(), fcm: fcmEnabled(), key: publicKey() });
  }
  if (req.method === 'POST' && path === '/api/push/subscribe') {
    let b; try { b = (await parseBody(req)) ?? {}; } catch { b = {}; }
    const r = await saveSubscription(me, b, req.headers['user-agent']);
    return r.error ? json(res, 400, r) : json(res, 200, r);
  }
  if (req.method === 'POST' && path === '/api/push/unsubscribe') {
    let b; try { b = (await parseBody(req)) ?? {}; } catch { b = {}; }
    return json(res, 200, await removeSubscription(me, b.endpoint ?? b.token));
  }
  return json(res, 404, { error: 'not_found' });
};
