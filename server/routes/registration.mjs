import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { adminOverview, adminSave } from './../registration.mjs';

/** Админка: ограничение регистрации новых аккаунтов (право `registration`). */
export const registrationRoutes = async (req, res, url) => {
  if (url !== '/api/admin/registration') return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`adm:reg:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
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
