/**
 * Отслеживание посылок (server/tracking.mjs).
 *
 *   GET    /api/tracking/providers            службы и какие из них подключены
 *   GET    /api/tracking/lookup?provider&number   разовая проверка номера
 *   GET    /api/tracking/orders/:id           трек заказа и состояние посылки
 *   PUT    /api/tracking/orders/:id           продавец указывает номер
 *   DELETE /api/tracking/orders/:id           продавец снимает номер
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  providerList, lookupParcel, getOrderTracking, setOrderTracking, clearOrderTracking,
} from './../tracking.mjs';

const READ_PER_MIN = 60;
const LOOKUP_PER_MIN = 15;
const WRITE_PER_MIN = 20;

const FAIL = { bad_input: 400, bad_provider: 400, bad_number: 400, bad_status: 409, not_found: 404 };

export const trackingRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/tracking')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const path = url.split('?')[0];

  if (req.method === 'GET' && path === '/api/tracking/providers') {
    if (!rateLimit(`tracking:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { providers: providerList() });
  }

  if (req.method === 'GET' && path === '/api/tracking/lookup') {
    if (!rateLimit(`tracking:lookup:${me}`, LOOKUP_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const params = new URL(req.url, 'http://x').searchParams;
    const r = await lookupParcel(params.get('provider'), params.get('number'));
    if (r.error === 'bad_input') return json(res, 400, { error: 'bad_input' });
    return json(res, 200, {
      parcel: r.ok ? r.data : null, error: r.ok ? null : r.error, url: r.url ?? null,
      live: r.live === true, stale: r.stale === true,
    });
  }

  const one = /^\/api\/tracking\/orders\/([A-Za-z0-9-]{1,64})$/.exec(path);
  if (one) {
    const orderId = one[1];
    if (req.method === 'GET') {
      if (!rateLimit(`tracking:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const found = await getOrderTracking(orderId, me);
      return found ? json(res, 200, found) : json(res, 404, { error: 'not_found' });
    }
    if (req.method === 'PUT') {
      if (!rateLimit(`tracking:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setOrderTracking(orderId, me, { provider: body?.provider, number: body?.number });
      return r.error ? json(res, FAIL[r.error] ?? 400, { error: r.error }) : json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (!rateLimit(`tracking:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await clearOrderTracking(orderId, me);
      return r.error ? json(res, FAIL[r.error] ?? 400, { error: r.error }) : json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'not_found' });
};
