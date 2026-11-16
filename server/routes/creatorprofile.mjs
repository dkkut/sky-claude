import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getCreatorProfile } from './../creatorprofile.mjs';

/** GET /api/creators/:profileId — авторская часть профиля (вошедшему). Подписка — прежняя /api/follows/:id/toggle. */
export const creatorProfileRoutes = async (req, res, url) => {
  const m = url.split('?')[0].match(/^\/api\/creators\/([A-Za-z0-9_-]{1,64})$/);
  if (!m) return false;
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const s = await requireProfile(req, res); if (!s) return true;
  if (!rateLimit(`crp:${s.profileId}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const r = await getCreatorProfile(s.profileId, m[1]);
  return json(res, r.error ? 404 : 200, r);
};
