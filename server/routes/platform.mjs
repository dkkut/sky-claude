/**
 * «Аварийные работы» и «Технические работы» — статус и переключатели.
 * Сам гейт (кто вообще проходит дальше) стоит в server.mjs, до
 * диспетчеризации по маршрутам — см. комментарий там же.
 */
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { viewerBypasses } from './../platformaccess.mjs';
import { publicStatus as registrationStatus } from './../registration.mjs';
import { closedPublic, mediaBannerOn } from './../modclosure.mjs';
import { isOutdatedApp, outdatedReason } from './../appversion.mjs';
import { shutdownState, maintenanceState, setShutdown, setMaintenance } from './../platform.mjs';

export const platformRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/platform')) return false;

  /* Читает кто угодно, даже без сессии — это и есть ручка, по которой
     браузер без сессии понимает, какой экран показать. */
  if (req.method === 'GET' && url === '/api/platform/status') {
    const [shutdown, maintenance, registration, closedModules, mediaBanner] = await Promise.all([shutdownState(), maintenanceState(), registrationStatus(), closedPublic(), mediaBannerOn()]);
    // bypass: этого посетителя режим не касается (владелец/администратор) — клиент не должен показывать ему заглушку
    const kind = shutdown.active ? 'shutdown' : maintenance.active ? 'maintenance' : null;
    const bypass = kind ? await viewerBypasses(await readSession(req).catch(() => null), kind) : false;
    if (isOutdatedApp(req)) return json(res, 200, { shutdown: { active: false, reason: '' }, maintenance: { active: true, reason: outdatedReason(req) }, registration, closedModules, mediaBanner, bypass: false });
    return json(res, 200, { shutdown, maintenance, registration, closedModules, mediaBanner, bypass });
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'POST' && url === '/api/platform/shutdown') {
    const b = await parseBody(req);
    const done = await setShutdown(me, Boolean(b.active), b.reason, b.stepUpCode);
    return done.error ? json(res, done.error === 'owner_only' ? 403 : 400, done) : json(res, 200, done);
  }
  if (req.method === 'POST' && url === '/api/platform/maintenance') {
    const b = await parseBody(req);
    const done = await setMaintenance(me, Boolean(b.active), b.reason, b.stepUpCode);
    return done.error ? json(res, done.error === 'owner_only' ? 403 : 400, done) : json(res, 200, done);
  }

  return json(res, 404, { error: 'not_found' });
};
