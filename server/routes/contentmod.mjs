import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { contentQueue, contentSearch, contentDecide, contentTakedown, contentTrashList, contentRestore } from './../contentmod.mjs';

/** Админка: очередь модерации, поиск и снятие материалов (музыка, кино, книги). */
export const contentModRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/content')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');
  const code = (e) => (e === 'not_allowed' ? 403 : e === 'not_found' ? 404 : 400);

  if (req.method === 'GET' && u.pathname === '/api/admin/content/queue') {
    if (!rateLimit(`adm:content:r:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    const r = await contentQueue(me);
    return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' });
  }
  if (req.method === 'GET' && u.pathname === '/api/admin/content/search') {
    if (!rateLimit(`adm:content:r:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    const r = await contentSearch(me, {
      kind: u.searchParams.get('kind'), q: u.searchParams.get('q'),
      status: u.searchParams.get('status'), limit: u.searchParams.get('limit'),
    });
    return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' });
  }

  if (req.method === 'GET' && u.pathname === '/api/admin/content/trash') {
    const r = await contentTrashList(me);
    return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' });
  }
  const rs = /^\/api\/admin\/content\/trash\/(\d{1,12})\/restore$/.exec(u.pathname);
  if (rs && req.method === 'POST') {
    if (!rateLimit(`adm:content:w:${me}`, 40)) return json(res, 429, { error: 'too_many_requests' });
    const r = await contentRestore(me, rs[1], requestMeta(req));
    return r.error ? json(res, code(r.error), r) : json(res, 200, r);
  }

  const m = /^\/api\/admin\/content\/(music|movie|book)\/([A-Za-z0-9_-]{1,80})(\/decide)?$/.exec(u.pathname);
  if (m && req.method === 'POST' && m[3]) {
    if (!rateLimit(`adm:content:w:${me}`, 40)) return json(res, 429, { error: 'too_many_requests' });
    const body = await parseBody(req);
    const r = await contentDecide(me, m[1], m[2], { approve: body?.approve === true, reason: body?.reason }, requestMeta(req));
    return r.error ? json(res, code(r.error), r) : json(res, 200, r);
  }
  if (m && req.method === 'DELETE' && !m[3]) {
    if (!rateLimit(`adm:content:w:${me}`, 40)) return json(res, 429, { error: 'too_many_requests' });
    const body = await parseBody(req).catch(() => null);
    const reason = body?.reason ?? u.searchParams.get('reason');
    const r = await contentTakedown(me, m[1], m[2], reason, requestMeta(req));
    return r.error ? json(res, code(r.error), r) : json(res, 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
