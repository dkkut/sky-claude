import { json, requireProfile, parseBody } from './../http.mjs';
import { rightsOf } from './../admin.mjs';
import { getPrefs, setPrefs, categoriesFor } from './../staffnotify.mjs';

/** GET/PUT /api/staff/notify-prefs — свои переключатели уведомлений о новых заявках (только сотрудникам и владельцу). */
export const staffNotifyRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/staff/notify-prefs')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const rights = await rightsOf(me);
  if (!rights.admin) return json(res, 403, { error: 'not_allowed' });
  if (req.method === 'GET') {
    return json(res, 200, { ...(await getPrefs(me)), categories: await categoriesFor(me, Boolean(rights.owner), rights.permissions ?? []) });
  }
  if (req.method === 'PUT') {
    const r = await setPrefs(me, (await parseBody(req)) ?? {});
    return json(res, r.error ? 400 : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
