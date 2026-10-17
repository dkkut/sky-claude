import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getLabels, ownerUpdate, moderatorUpdate, batch, getSettings, saveSettings } from './../contentlabels.mjs';

const CODE = { not_allowed: 403, not_found: 404 };
const send = (res, r) => (r.error ? json(res, CODE[r.error] ?? 400, r) : json(res, 200, r));

/** Метки контента: чтение — всем (в пределах видимости материала), правка — владельцу (о своём) и модератору (с причиной). */
export const contentLabelsRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/labels')) return false;
  const s = await requireProfile(req, res);
  if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`labels:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const params = new URL(req.url, 'http://x').searchParams;
  if (req.method === 'GET' && path === '/api/labels/batch') return json(res, 200, { labels: await batch(params.get('kind') ?? '', (params.get('ids') ?? '').split(',').filter(Boolean), me) });
  if (path === '/api/labels/settings') {
    if (req.method === 'GET') return json(res, 200, await getSettings());
    if (req.method === 'PUT') return send(res, await saveSettings(me, (await parseBody(req)) ?? {}));
  }
  const m = path.match(/^\/api\/labels\/(track|movie|book)\/([^/]+)(\/moderate)?$/);
  if (!m) return json(res, 404, { error: 'not_found' });
  if (req.method === 'GET' && !m[3]) { const l = await getLabels(m[1], m[2], me); return l ? json(res, 200, l) : json(res, 404, { error: 'not_found' }); }
  if (req.method === 'PUT') {
    const b = (await parseBody(req)) ?? {};
    return send(res, m[3] ? await moderatorUpdate(m[1], m[2], me, b) : await ownerUpdate(m[1], m[2], me, b));
  }
  return json(res, 405, { error: 'method_not_allowed' });
};
