/**
 * Пометки и блокировки контента — читает любой вошедший (виджет
 * предупреждения показывается всем зрителям), пишет только модерация
 * (право content, проверяется внутри contentflags.mjs).
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { listFlags, setWarning, setBlocked } from './../contentflags.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 30;

export const contentFlagsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/moderation/flags')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && url === '/api/moderation/flags') {
    if (!rateLimit(`modflags:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { flags: await listFlags() });
  }

  if (req.method === 'POST' && url === '/api/moderation/flags/warning') {
    if (!rateLimit(`modflags:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await setWarning(me, body?.domain, body?.targetId, body?.warning);
    return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
  }

  if (req.method === 'POST' && url === '/api/moderation/flags/block') {
    if (!rateLimit(`modflags:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await setBlocked(me, body?.domain, body?.targetId, Boolean(body?.blocked), body?.reason);
    return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
  }

  return json(res, 404, { error: 'not_found' });
};
