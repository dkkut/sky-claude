/**
 * Админка карт: GET /api/admin/maps (право `maps` или `analytics`), изменения — владелец и право `maps` с кодом подтверждения (`maps_settings`).
 * Секретных ключей в ответах нет — только «подключён / нет», последние 4 знака не показываем вовсе.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta, logAdmin } from './../adminsec.mjs';
import { usageReport, getMapsSettings, saveMapsSettings } from './../mapsusage.mjs';
import { capabilities } from './../skymaps.mjs';
import { probeGeocode } from './../maps.mjs';

export const mapsAdminRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/maps')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId;
  const view = (await can(me, 'maps')) || (await can(me, 'analytics'));
  if (!view) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`mapsadm:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const p = new URL(req.url, 'http://x').pathname; const meta = requestMeta(req);
  const edit = await can(me, 'maps');

  if (req.method === 'GET' && p === '/api/admin/maps') {
    const days = Number(new URL(req.url, 'http://x').searchParams.get('days')) || 7;
    return json(res, 200, { capabilities: capabilities(), settings: await getMapsSettings(), report: await usageReport(days), canEdit: edit });
  }
  if (!edit) return json(res, 403, { error: 'not_allowed' });
  if (req.method === 'POST' && p === '/api/admin/maps/step-up') { const r = await beginStepUp(me, 'maps_settings', { meta }); return json(res, r.error ? 400 : 200, r); }

  if (req.method === 'POST' && p === '/api/admin/maps/check') {
    if (!rateLimit(`mapschk:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    const b = (await parseBody(req)) ?? {};
    const who = b.provider === 'yandex' ? 'yandex' : 'google';
    const r = await probeGeocode(who);
    await logAdmin({ actorId: me, type: 'maps_check', targetType: 'system', detail: `проверка ${who}: ${r.ok ? 'ok' : r.code}`, meta });
    return json(res, 200, { provider: who, ...r });
  }
  if (req.method === 'PUT' && p === '/api/admin/maps/settings') {
    const b = (await parseBody(req)) ?? {};
    const s = await consumeStepUp(me, 'maps_settings', b.stepUpCode, { meta });
    if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
    const r = await saveMapsSettings(me, b.settings ?? {});
    if (!r.error) await logAdmin({ actorId: me, type: 'maps_settings', targetType: 'system', detail: 'изменены настройки карт', meta });
    return json(res, r.error ? 400 : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
