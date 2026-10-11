import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { adminListChannels, adminDeleteChannel } from './../adminchannels.mjs';

export const adminChannelRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/channels')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');

  if (req.method === 'GET' && u.pathname === '/api/admin/channels') {
    if (!rateLimit(`adm:chan:r:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    const r = await adminListChannels(me, {
      q: u.searchParams.get('q'), type: u.searchParams.get('type'),
      limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset'),
    });
    return r === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, r);
  }

  const m = /^\/api\/admin\/channels\/([A-Za-z0-9_-]{1,80})$/.exec(u.pathname);
  if (req.method === 'DELETE' && m) {
    if (!rateLimit(`adm:chan:w:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    const r = await adminDeleteChannel(me, m[1], requestMeta(req));
    if (r.error) return json(res, r.error === 'not_found' ? 404 : 403, r);
    return json(res, 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
