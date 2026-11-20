/**
 * Sky GO «Билеты на проезд»:
 *   люди     — /api/go/transit/*   (каталог перевозчиков, покупка, мои билеты, QR-токен, возврат)
 *   перевозчик — /api/kbiz/transit/* (продукты, проданные билеты, проверка на борту, возвраты; сотрудники по kbstaff: проверка — роли door)
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as gt from './../gotransit.mjs';
import * as st from './../kbstaff.mjs';
import { audit } from './../kbiz.mjs';

const CODE = { not_found: 404, no_business: 404, not_transit: 409, own_operator: 403, sales_unavailable: 409, too_many_pending: 429, not_active: 409, used: 409, expired: 409, bad_token: 422, refund_not_allowed: 409, reason_required: 400, too_many_products: 409 };
const reply = (res, r, ok = 200) => (!r || !r.error ? json(res, ok, r ?? { ok: true }) : json(res, CODE[r.error] ?? 400, r));
const MULT = Math.max(1, Number(process.env.GOPLACES_RATE_MULT) || 1);

export const goTransitRoutes = async (req, res, url) => {
  const isOwner = url.startsWith('/api/kbiz/transit');
  if (!url.startsWith('/api/go/transit') && !isOwner) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const u = new URL(req.url, 'http://x'); const path = u.pathname; const method = req.method; const me = s.profileId; const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(`gtr:${write ? 'w' : 'r'}:${me}`, (write ? 60 : 300) * MULT)) return json(res, 429, { error: 'rate_limited' });
  if (path.endsWith('/validate') && !rateLimit(`gtr:v:${me}`, 120 * MULT)) return json(res, 429, { error: 'rate_limited' });
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  let m;
  try {
    if (isOwner) {
      const acc = await st.accessOf(me); if (!acc) return json(res, 404, { error: 'no_business' });
      const own = acc.role === 'owner' ? me : `biz:${acc.businessId}`;
      const group = path.endsWith('/validate') ? 'door' : method === 'GET' ? 'placeview' : /\/refund$/.test(path) ? 'placeops' : 'placecard';
      if (!st.can(acc, group)) return json(res, 403, { error: 'forbidden' });
      if (acc.role !== 'owner' && write) await audit(acc.businessId, me, 'staff_action', `${acc.role}: ${method} ${path.replace(/(gt[a-z])-[0-9a-f-]{36}/g, '$1:id')}`).catch(() => {});
      if (method === 'GET' && path === '/api/kbiz/transit/products') return reply(res, await gt.ownerProducts(own));
      if (method === 'POST' && path === '/api/kbiz/transit/products') return reply(res, await gt.saveProduct(own, null, await body()), 201);
      if (method === 'PUT' && (m = path.match(/^\/api\/kbiz\/transit\/products\/(gtp-[0-9a-f-]{36})$/))) return reply(res, await gt.saveProduct(own, m[1], await body()));
      if (method === 'GET' && path === '/api/kbiz/transit/tickets') return reply(res, await gt.ownerTickets(own, Object.fromEntries(u.searchParams)));
      if (method === 'GET' && path === '/api/kbiz/transit/stats') return reply(res, await gt.ownerStats(own));
      if (method === 'POST' && path === '/api/kbiz/transit/validate') return reply(res, await gt.validate(own, me, (await body()).token));
      if (method === 'POST' && (m = path.match(/^\/api\/kbiz\/transit\/tickets\/(gtt-[0-9a-f-]{36})\/refund$/))) { const b = await body(); return reply(res, await gt.decideRefund(own, me, m[1], b.approve === true, b.comment)); }
      return json(res, 404, { error: 'not_found' });
    }
    if (method === 'GET' && path === '/api/go/transit/catalog') return reply(res, await gt.catalog(Object.fromEntries(u.searchParams)));
    if (method === 'GET' && path === '/api/go/transit/tickets') return reply(res, await gt.myTickets(me));
    if (method === 'POST' && path === '/api/go/transit/buy') { const b = await body(); return reply(res, await gt.buy(me, b.productId, b.idemKey), 201); }
    if (method === 'GET' && (m = path.match(/^\/api\/go\/transit\/tickets\/(gtt-[0-9a-f-]{36})\/token$/))) return reply(res, await gt.ticketToken(me, m[1]));
    if (method === 'POST' && (m = path.match(/^\/api\/go\/transit\/tickets\/(gtt-[0-9a-f-]{36})\/(cancel|refund)$/))) return reply(res, await (m[2] === 'cancel' ? gt.cancelPending(me, m[1]) : gt.requestRefund(me, m[1])));
    return json(res, 404, { error: 'not_found' });
  } catch (e) { console.error('[gotransit]', e.message); return json(res, 500, { error: 'server_error' }); }
};
