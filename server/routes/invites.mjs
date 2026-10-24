import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getMyInvite, claimInviteReward } from './../invites.mjs';

/** Моя ссылка-приглашение, число приглашённых и награды по порогам. */
export const inviteRoutes = async (req, res, url) => {
  if (url !== '/api/invite/me' && url !== '/api/invite/claim') return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  if (url === '/api/invite/claim') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (!rateLimit(`invite-claim:${session.profileId}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    const body = await parseBody(req).catch(() => ({}));
    const r = await claimInviteReward(session.profileId, body?.count);
    return r.error ? json(res, r.status ?? 400, { error: r.error }) : json(res, 200, r);
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (!rateLimit(`invite:${session.profileId}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const r = await getMyInvite(session.profileId);
  return r.error ? json(res, 500, r) : json(res, 200, r);
};
