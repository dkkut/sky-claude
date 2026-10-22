import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getMyInvite } from './../invites.mjs';

/** Моя ссылка-приглашение и число приглашённых. */
export const inviteRoutes = async (req, res, url) => {
  if (url !== '/api/invite/me') return false;
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const session = await requireProfile(req, res);
  if (!session) return true;
  if (!rateLimit(`invite:${session.profileId}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const r = await getMyInvite(session.profileId);
  return r.error ? json(res, 500, r) : json(res, 200, r);
};
