import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { hasPrime } from './../skyid.mjs';
import { duoFriends, getDuo, inviteDuo, actDuo, duoQueue } from './../musicduo.mjs';

/** «Поток на двоих» в Sky Music (входит в Prime, как вся музыка). */
export const musicDuoRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/music/duo')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`mduo:${me}`, 90)) return json(res, 429, { error: 'too_many_requests' });
  if (!(await hasPrime(me))) return json(res, 403, { error: 'prime_required' });
  const u = new URL(req.url, 'http://x'); let m;
  if (url === '/api/music/duo' && req.method === 'GET') return json(res, 200, await getDuo(me));
  if (url === '/api/music/duo/friends' && req.method === 'GET') return json(res, 200, { friends: await duoFriends(me) });
  if (url === '/api/music/duo' && req.method === 'POST') {
    const b = (await parseBody(req)) ?? {}; const r = await inviteDuo(me, b.friendId);
    return json(res, r.error ? (r.error === 'not_friends' ? 403 : r.error === 'already_exists' ? 409 : 400) : 200, r);
  }
  if ((m = url.match(/^\/api\/music\/duo\/(duo-[A-Za-z0-9-]{1,60})\/(accept|decline|end)$/)) && req.method === 'POST') {
    const r = await actDuo(me, m[1], m[2]); return json(res, r.error ? (r.error === 'not_found' ? 404 : r.error === 'forbidden' ? 403 : 400) : 200, r);
  }
  if ((m = url.match(/^\/api\/music\/duo\/(duo-[A-Za-z0-9-]{1,60})\/queue$/)) && req.method === 'GET') {
    const r = await duoQueue(me, m[1], { hideExplicit: u.searchParams.get('hideExplicit') === '1' });
    return json(res, r.error ? (r.error === 'not_found' ? 404 : 409) : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
