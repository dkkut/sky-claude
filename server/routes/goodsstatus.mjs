/**
 * Статус товара (server/goodsstatus.mjs):
 *   GET    /api/market/goods-status/queue
 *   GET    /api/market/goods-status/staff        POST {username}   DELETE /staff/:id
 *   GET    /api/market/goods-status/:orderId     PUT {place,note,eta,etaTo}   DELETE
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as G from './../goodsstatus.mjs';

const CODE = { not_found: 404, bad_status: 409, bad_date: 400, empty: 400, bad_username: 400, user_not_found: 404, self: 400, too_many: 409, not_seller: 403 };

export const goodsStatusRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/market/goods-status')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`gs:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  if (req.method !== 'GET' && !rateLimit(`gsw:${me}`, 40)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (CODE[r.error] ?? 400) : 200, r);
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  let m;
  try {
    if (path === '/api/market/goods-status/queue' && req.method === 'GET') return reply(await G.workQueue(me));
    if (path === '/api/market/goods-status/staff') {
      if (req.method === 'GET') return reply(await G.listStaff(me));
      if (req.method === 'POST') return reply(await G.addStaff(me, (await body()).username));
    }
    if ((m = /^\/api\/market\/goods-status\/staff\/([A-Za-z0-9_-]{1,64})$/.exec(path)) && req.method === 'DELETE') {
      return reply(await G.removeStaff(me, m[1]));
    }
    if ((m = /^\/api\/market\/goods-status\/(mo-[0-9a-f-]{36})$/.exec(path))) {
      if (req.method === 'GET') { const r = await G.getGoodsStatus(m[1], me); return r ? json(res, 200, r) : json(res, 404, { error: 'not_found' }); }
      if (req.method === 'PUT') return reply(await G.setGoodsStatus(m[1], me, await body()));
      if (req.method === 'DELETE') return reply(await G.clearGoodsStatus(m[1], me));
    }
  } catch (e) { console.error('[goods-status]', e.message); return json(res, 500, { error: 'server_error' }); }
  return json(res, 404, { error: 'not_found' });
};
