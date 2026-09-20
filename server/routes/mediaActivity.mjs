/**
 * Активность на главной вкладке Sky Media — только чтение, только
 * своё: чужую активность эта ручка не отдаёт никому.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { myMediaActivity } from './../mediaActivity.mjs';

const READ_PER_MIN = 30;

export const mediaActivityRoutes = async (req, res, url) => {
  if (url !== '/api/media/activity') return false;
  if (req.method !== 'GET') return json(res, 404, { error: 'not_found' });

  const session = await requireProfile(req, res);
  if (!session) return true;

  if (!rateLimit(`media:activity:${session.profileId}`, READ_PER_MIN)) {
    return json(res, 429, { error: 'too_many_requests' });
  }

  return json(res, 200, { data: await myMediaActivity(session.profileId) });
};
