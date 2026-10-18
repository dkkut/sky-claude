import { json, requireProfile, parseBody } from './../http.mjs';
import { requestMeta } from './../adminsec.mjs';
import * as mc from './../modclosure.mjs';

const ERR = { bad_value: 400, not_allowed: 403, unknown_module: 404, reason_required: 400 };

export const modClosureRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/modules') && !url.startsWith('/api/admin/media-banner')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/admin/media-banner') {
    if (req.method === 'GET') return (await mc.adminList(me)) ? json(res, 200, { on: await mc.mediaBannerOn() }) : json(res, 403, { error: 'not_allowed' });
    if (req.method === 'PUT') { const r = await mc.adminSetBanner(me, ((await parseBody(req)) ?? {}).on, requestMeta(req)); return json(res, r.error ? (ERR[r.error] ?? 400) : 200, r); }
    return json(res, 405, { error: 'method' });
  }
  if (req.method === 'GET' && path === '/api/admin/modules') {
    const list = await mc.adminList(me);
    return list ? json(res, 200, { modules: list }) : json(res, 403, { error: 'not_allowed' });
  }
  if (req.method === 'PUT' && path === '/api/admin/modules') {
    const r = await mc.adminSetAll(me, (await parseBody(req)) ?? {}, requestMeta(req));
    return json(res, r.error ? (ERR[r.error] ?? 400) : 200, r);
  }
  const m = /^\/api\/admin\/modules\/([a-z0-9_-]+)$/.exec(path);
  if (req.method === 'PUT' && m) {
    const r = await mc.adminSet(me, m[1], (await parseBody(req)) ?? {}, requestMeta(req));
    return json(res, r.error ? (ERR[r.error] ?? 400) : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
