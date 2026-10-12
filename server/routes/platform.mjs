/**
 * «Аварийные работы» и «Технические работы» — статус и переключатели.
 * Сам гейт (кто вообще проходит дальше) стоит в server.mjs, до
 * диспетчеризации по маршрутам — см. комментарий там же.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { publicStatus as registrationStatus } from './../registration.mjs';
import { shutdownState, maintenanceState, setShutdown, setMaintenance } from './../platform.mjs';

export const platformRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/platform')) return false;

  /* Читает кто угодно, даже без сессии — это и есть ручка, по которой
     браузер без сессии понимает, какой экран показать. */
  if (req.method === 'GET' && url === '/api/platform/status') {
    const [shutdown, maintenance, registration] = await Promise.all([shutdownState(), maintenanceState(), registrationStatus()]);
    return json(res, 200, { shutdown, maintenance, registration });
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
