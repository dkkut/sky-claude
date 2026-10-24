import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import * as L from './../lawrequests.mjs';

const status = (e) => (e === 'not_allowed' ? 403 : e === 'not_found' ? 404 : 400);
const reply = (res, r) => (r?.error ? json(res, status(r.error), r) : json(res, 200, r));

/** Запросы уполномоченных органов — только владелец сервиса. */
export const lawRequestRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/law-requests')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`adm:law:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
  const u = new URL(req.url, 'http://x'); const path = u.pathname; const meta = requestMeta(req);
  let m;
  if (path === '/api/admin/law-requests' && req.method === 'GET') { const r = await L.listRequests(me, { status: u.searchParams.get('status') || '' }); return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' }); }
  if (path === '/api/admin/law-requests' && req.method === 'POST') return reply(res, await L.createRequest(me, (await parseBody(req)) ?? {}, meta));
  if (path === '/api/admin/law-requests/step-up' && req.method === 'POST') return reply(res, await L.stepUp(me, meta));
  if ((m = path.match(/^\/api\/admin\/law-requests\/([a-z0-9-]{6,40})\/export$/)) && req.method === 'POST') return reply(res, await L.exportRequest(me, m[1], (await parseBody(req)) ?? {}, meta));
  if ((m = path.match(/^\/api\/admin\/law-requests\/([a-z0-9-]{6,40})\/close$/)) && req.method === 'POST') return reply(res, await L.closeRequest(me, m[1], (await parseBody(req)) ?? {}, meta));
  return json(res, 404, { error: 'not_found' });
};
