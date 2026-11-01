/**
 * Карта друзей:
 *   GET    /api/maps/friends           — друзья, показывающие мне себя, + кому показываю я;
 *   PUT    /api/maps/friends/share     — {viewerIds:[…]} кому показывать (только друзьям);
 *   POST   /api/maps/friends/position  — {lat,lng,speed?,accuracy?} моя точка (пока делюсь);
 *   DELETE /api/maps/friends/position  — перестать делиться и стереть точку.
 * Каждый видит только то, что ему разрешили; чужой список разрешений прочитать нельзя.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { visibleFriends, sharedWith, setSharing, putPosition, stopSharing, myFriends, routeToFriend } from './../friendloc.mjs';

export const friendLocRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/maps/friends')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && path === '/api/maps/friends') {
    if (!rateLimit(`fl:g:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { ...(await visibleFriends(me)), sharingWith: await sharedWith(me), myFriends: await myFriends(me) });
  }
  if (req.method === 'PUT' && path === '/api/maps/friends/share') {
    if (!rateLimit(`fl:s:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    const b = (await parseBody(req)) ?? {};
    const r = await setSharing(me, b.viewerIds);
    return json(res, r.error ? (r.error === 'feature_off' ? 503 : 400) : 200, r);
  }
  if (req.method === 'POST' && path === '/api/maps/friends/position') {
    if (!rateLimit(`fl:p:${me}`, 12)) return json(res, 429, { error: 'too_many_requests' });
    const r = await putPosition(me, (await parseBody(req)) ?? {});
    return json(res, r.error ? (r.error === 'feature_off' ? 503 : 400) : 200, r);
  }
  if (req.method === 'POST' && path === '/api/maps/friends/route') {
    if (!rateLimit(`fl:r:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    const b = (await parseBody(req)) ?? {};
    const r = await routeToFriend(me, b.friendId, b.origin, b.mode);
    return json(res, r.error ? (r.error === 'feature_off' || r.error === 'route_unavailable' ? 503 : 404) : 200, r);
  }
  if (req.method === 'DELETE' && path === '/api/maps/friends/position') {
    return json(res, 200, await stopSharing(me));
  }
  return json(res, 404, { error: 'not_found' });
};
