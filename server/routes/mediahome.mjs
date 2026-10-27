import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { logAdmin } from './../adminsec.mjs';
import { getHome, createLayout, saveLayout, activateLayout, deleteLayout } from './../mediahome.mjs';
import { popularEvents, activeBookings, storageUsage, securitySummary } from './../homedata.mjs';
import { buildWave, sendFeedback, clearFeedback, explain, getPrefs, savePrefs, diagnostics, getAdminConfig, saveAdminConfig } from './../mediawave.mjs';

/** Sky Media Home и SkyWave. Все данные — только своего профиля (profileId из сессии); чужие раскладки и история недоступны. */
export const mediaHomeRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/media/home') && !url.startsWith('/api/media/wave') && !url.startsWith('/api/admin/wave')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`mhome:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const body = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});
  const u = new URL(req.url, 'http://x');
  let m;

  if (url === '/api/media/home' && req.method === 'GET') return json(res, 200, await getHome(me));
  if (url === '/api/media/home/layouts' && req.method === 'POST') {
    const r = await createLayout(me, body); return json(res, r.error ? 400 : 200, r);
  }
  if ((m = url.match(/^\/api\/media\/home\/layouts\/([A-Za-z0-9-]{1,64})(?:\/(activate))?$/))) {
    if (m[2] === 'activate' && req.method === 'POST') { const r = await activateLayout(me, m[1]); return json(res, r.error ? 404 : 200, r); }
    if (!m[2] && req.method === 'PUT') { const r = await saveLayout(me, m[1], body); return json(res, r.error ? 404 : 200, r); }
    if (!m[2] && req.method === 'DELETE') { const r = await deleteLayout(me, m[1]); return json(res, r.error === 'not_found' ? 404 : r.error ? 409 : 200, r); }
  }

  if (url.startsWith('/api/media/home/data/') && req.method === 'GET') {
    if (!rateLimit(`mhdata:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    const k = url.slice('/api/media/home/data/'.length);
    const src = { events: () => popularEvents(), bookings: () => activeBookings(me), storage: () => storageUsage(me), security: () => securitySummary(me) }[k];
    if (!src) return json(res, 404, { error: 'not_found' });
    try { return json(res, 200, await src()); } catch (e) { console.error('[homedata]', k, e.message); return json(res, 500, { error: 'server_error' }); }
  }

  if (url === '/api/media/wave' && req.method === 'GET') {
    if (!rateLimit(`wave:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, await buildWave(me, { only: u.searchParams.get('shelf') || undefined }));
  }
  if (url === '/api/media/wave/feedback') {
    if (req.method === 'POST') { const r = await sendFeedback(me, body); return json(res, r.error ? 400 : 200, r); }
    if (req.method === 'DELETE') return json(res, 200, await clearFeedback(me));
  }
  if (url === '/api/media/wave/prefs') {
    if (req.method === 'GET') return json(res, 200, await getPrefs(me));
    if (req.method === 'PUT') return json(res, 200, await savePrefs(me, body));
  }
  if (url === '/api/media/wave/why' && req.method === 'GET') {
    const r = await explain(me, String(u.searchParams.get('shelf') ?? ''), String(u.searchParams.get('kind') ?? ''), String(u.searchParams.get('id') ?? ''));
    return json(res, r.error ? 404 : 200, r);
  }

  if (url === '/api/admin/wave') {
    if (!(await can(me, 'content'))) return json(res, 403, { error: 'forbidden' });
    if (req.method === 'GET') return json(res, 200, { config: await getAdminConfig(), diagnostics: await diagnostics(Number(u.searchParams.get('days')) || 7) });
    if (req.method === 'PUT') {
      const cfg = await saveAdminConfig(me, body);
      await logAdmin({ actorId: me, type: 'wave_config', detail: 'Настройки SkyWave', meta: { disabled: cfg.disabled.length, editorial: cfg.editorial.length } });
      return json(res, 200, { config: cfg });
    }
  }
  return json(res, 404, { error: 'not_found' });
};
