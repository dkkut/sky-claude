import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { listArchive, restoreArchived, purgeNow, PURGE_DAYS } from './../contentarchive.mjs';

/** /api/archive — архив своих материалов (20 дней на возврат). */
export const contentArchiveRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/archive')) return false;
  const s = await requireProfile(req, res);
  if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`archive:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
  if (req.method === 'GET' && path === '/api/archive') return json(res, 200, { days: PURGE_DAYS, items: await listArchive(me) });
  const m = /^\/api\/archive\/([\w-]+)\/(restore|purge)$/.exec(path);
  if (req.method === 'POST' && m) {
    await parseBody(req).catch(() => ({}));
    const r = m[2] === 'restore' ? await restoreArchived(m[1], me) : await purgeNow(m[1], me);
    return json(res, r.error ? 404 : 200, r);
  }
  return false;
};
