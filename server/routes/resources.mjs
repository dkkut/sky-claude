import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import { overview, saveSettings, scanDisk } from './../resourceopt.mjs';

/** «Оптимизация ресурсов»: просмотр — право `analytics`; изменение настроек — только владелец с подтверждением личности. */
export const resourceRoutes = async (req, res, url) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (!path.startsWith('/api/admin/resources')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!(await can(me, 'analytics'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`resources:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const meta = requestMeta(req);
  if (req.method === 'GET' && path === '/api/admin/resources') return json(res, 200, { ...(await overview()), canEdit: await isOwner(me) });
  if (req.method === 'POST' && path === '/api/admin/resources/disk-scan') {
    if (!rateLimit(`resources:scan:${me}`, 4)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, await scanDisk());
  }
  if (!(await isOwner(me))) return json(res, 403, { error: 'owner_only' });
  if (req.method === 'POST' && path === '/api/admin/resources/step-up') {
    const r = await beginStepUp(me, 'resource_settings', { meta });
    return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'PUT' && path === '/api/admin/resources/settings') {
    const b = (await parseBody(req)) ?? {};
    const st = await consumeStepUp(me, 'resource_settings', b.stepUpCode, { meta });
    if (st.error) return json(res, st.error === 'step_up_exhausted' ? 429 : 401, st);
    const r = await saveSettings(me, b.settings, meta);
    return json(res, r.error ? 400 : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
