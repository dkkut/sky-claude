import { json, requireProfile, parseBody } from './../http.mjs';
import { isOwner } from './../admin.mjs';
import { getPrefs, setPrefs } from './../ownernotify.mjs';

export const ownerNotifyRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/owner/notify-prefs')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!(await isOwner(me))) return json(res, 403, { error: 'owner_only' });
  if (req.method === 'GET') return json(res, 200, await getPrefs(me));
  if (req.method === 'PUT') {
    const r = await setPrefs(me, (await parseBody(req)) ?? {});
    return json(res, r.error ? 400 : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
