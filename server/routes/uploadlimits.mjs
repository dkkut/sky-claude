import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { adminOverview, adminSave, effectiveFor } from './../uploadlimits.mjs';

/** Лимиты загрузки: людям — что действует (GET /api/upload-limits); администрации — править (право `upload_limits`). */
export const uploadLimitsRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (path !== '/api/upload-limits' && path !== '/api/admin/upload-limits') return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`uplim:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  if (path === '/api/upload-limits') {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
    return json(res, 200, await effectiveFor(me));
  }
  if (req.method === 'GET') {
    const r = await adminOverview(me);
    return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const r = await adminSave(me, (await parseBody(req)) ?? {}, requestMeta(req));
    return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
  }
  return json(res, 405, { error: 'method_not_allowed' });
};
