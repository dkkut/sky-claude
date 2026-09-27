/**
 * Quick Menu по HTTP — всегда собственный профиль сессии, ни один
 * путь не принимает чужой profileId, так что обычной IDOR-проверки
 * («а если подставить чужой id») здесь физически негде случиться.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { ITEM_REGISTRY, getConfig, setConfig, resetConfig, setItemEnabled } from './../quickmenu.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 30;

export const quickMenuRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/quickmenu')) return false;
  const path = url.split('?')[0];

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && path === '/api/quickmenu') {
    if (!rateLimit(`quickmenu:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { items: await getConfig(me), registry: ITEM_REGISTRY });
  }

  if (req.method === 'POST' && path === '/api/quickmenu') {
    if (!rateLimit(`quickmenu:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await setConfig(me, body?.items);
    if (r.error) return json(res, 400, r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/quickmenu/reset') {
    if (!rateLimit(`quickmenu:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await resetConfig(me));
  }

  if (req.method === 'POST' && path === '/api/quickmenu/item') {
    if (!rateLimit(`quickmenu:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await setItemEnabled(me, String(body?.key ?? ''), !!body?.enabled);
    if (r.error) return json(res, r.error === 'unknown_item' ? 404 : 400, r);
    return json(res, 200, r);
  }

  return json(res, 404, { error: 'not_found' });
};
