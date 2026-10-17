import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { entitlementsOf, surfaceOf, purchaseAllowedOn } from './../entitlements.mjs';

/** Права по подписке для текущего профиля — одинаково для всех устройств. */
export const entitlementsRoutes = async (req, res, url) => {
  if (url.split('?')[0] !== '/api/entitlements') return false;
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const s = await requireProfile(req, res);
  if (!s) return true;
  if (!rateLimit(`ent:${s.profileId}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  return json(res, 200, { ...(await entitlementsOf(s.profileId)), surface: surfaceOf(req), purchaseAllowedHere: purchaseAllowedOn(req) });
};
