/**
 * Активность на главной вкладке Sky Media — только чтение, только
 * своё: чужую активность эта ручка не отдаёт никому.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { myMediaActivity } from './../mediaActivity.mjs';
import { ping, stop, summary, setShare, presenceOf, knownGames } from './../gameactivity.mjs';
import { parseBody } from './../http.mjs';

const READ_PER_MIN = 30;

export const mediaActivityRoutes = async (req, res, url) => {
  if (url.startsWith('/api/games/activity')) {
    const s2 = await requireProfile(req, res);
    if (!s2) return true;
    const me = s2.profileId;
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/games/activity/ping' && req.method === 'POST') {
      if (!rateLimit(`games:ping:${me}`, 12)) return json(res, 429, { error: 'too_many_requests' });
      const r = await ping(me, (await parseBody(req)) ?? {});
      return json(res, r.error ? (r.error === 'not_found' ? 404 : 400) : 200, r);
    }
    if (u.pathname === '/api/games/activity/stop' && req.method === 'POST') return json(res, 200, await stop(me));
    if (u.pathname === '/api/games/activity/summary' && req.method === 'GET') return json(res, 200, { ...(await summary(me)), known: knownGames() });
    if (u.pathname === '/api/games/activity/share' && req.method === 'PUT') return json(res, 200, await setShare(me, (await parseBody(req))?.share === true));
    if (u.pathname === '/api/games/activity/of' && req.method === 'GET') {
      if (!rateLimit(`games:of:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { playing: await presenceOf(String(u.searchParams.get('ids') ?? '').split(',')) });
    }
    return json(res, 404, { error: 'not_found' });
  }
  if (url !== '/api/media/activity') return false;
  if (req.method !== 'GET') return json(res, 404, { error: 'not_found' });

  const session = await requireProfile(req, res);
  if (!session) return true;

  if (!rateLimit(`media:activity:${session.profileId}`, READ_PER_MIN)) {
    return json(res, 429, { error: 'too_many_requests' });
  }

  return json(res, 200, { data: await myMediaActivity(session.profileId) });
};
