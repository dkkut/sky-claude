/**
 * Sky GO «Организации»:
 *   люди     — /api/go/places*  (каталог, карточка, маршрут, избранное, заказы, свои заказы)
 *   владелец — /api/kbiz/place* (настройка публичной карточки из «Sky для бизнеса»)
 *   админка  — /api/admin/go/places*, /api/admin/go/place-categories* (право gop_places)
 * Фото отдаются без токена (<img>), но только у опубликованных карточек.
 */
import { json, parseBody, requireProfile, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as gp from './../goplaces.mjs';
import * as bk from './../goplacebook.mjs';
import * as st from './../kbstaff.mjs';
import { audit } from './../kbiz.mjs';

const MULT = Math.max(1, Number(process.env.GOPLACES_RATE_MULT) || 1);   // только для тестов
const CODE = { not_found: 404, not_allowed: 403, no_business: 404, suspended: 423, blocked: 423, bad_state: 409, incomplete: 422, not_connected: 409, already_published: 409, own_place: 403, shop_unavailable: 410,
  out_of_stock: 409, slot_taken: 409, slot_unavailable: 409, already_booked: 409, too_many_bookings: 429, booking_disabled: 409, hours_required: 422, review_not_allowed: 403, already_reviewed: 409, too_early: 409, item_unavailable: 409, item_unavailable: 409, empty_cart: 400, too_many_photos: 409, too_many_requests: 429, self_review: 403, reason_required: 400, category_in_use: 409, exists: 409, payment_in_progress: 409, from_not_found: 404, logo_too_large: 413 };
const reply = (res, r, ok = 200) => (!r || !r.error ? json(res, ok, r ?? { ok: true }) : json(res, CODE[r.error] ?? 400, r));
const sendImg = (res, m) => { if (!m) return json(res, 404, { error: 'not_found' }); res.writeHead(200, { 'Content-Type': m.type, 'Content-Length': m.data.length, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); return res.end(m.data); };

export const goPlacesRoutes = async (req, res, url) => {
  const isAdmin = url.startsWith('/api/admin/go/places') || url.startsWith('/api/admin/go/place-categories');
  const isOwner = url.startsWith('/api/kbiz/place');
  if (!url.startsWith('/api/go/places') && !isAdmin && !isOwner) return false;
  const u = new URL(req.url, 'http://x'); const path = u.pathname; const method = req.method;
  let m;
  // Фото опубликованных карточек — публично (как логотип и фото товаров).
  if (method === 'GET' && (m = path.match(/^\/api\/go\/places\/media\/(kbm-[0-9a-f-]{36})$/))) {
    if (!rateLimit(`gopl:img:${clientIp(req)}`, 600 * MULT)) return json(res, 429, { error: 'rate_limited' });
    return sendImg(res, await gp.mediaPublic(m[1]));
  }
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(write ? `gopl:w:${me}` : `gopl:r:${me}`, (write ? 60 : 300) * MULT)) return json(res, 429, { error: 'rate_limited' });
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  try {
    if (isAdmin) {
      if (method === 'GET' && path === '/api/admin/go/place-categories') return reply(res, await gp.adminCategories(me));
      if (method === 'POST' && path === '/api/admin/go/place-categories') return reply(res, await gp.adminSaveCategory(me, null, await body()));
      if ((m = path.match(/^\/api\/admin\/go\/place-categories\/([\w-]+)$/))) {
        if (method === 'PUT') return reply(res, await gp.adminSaveCategory(me, m[1], await body()));
        if (method === 'DELETE') return reply(res, await gp.adminDeleteCategory(me, m[1]));
      }
      if (method === 'GET' && path === '/api/admin/go/places/reports') return reply(res, await bk.adminReports(me, Object.fromEntries(u.searchParams)));
      if (method === 'POST' && (m = path.match(/^\/api\/admin\/go\/places\/reports\/(gpx-[0-9a-f-]{36})\/(resolve|dismiss)$/))) return reply(res, await bk.adminResolveReport(me, m[1], m[2], (await body()).note));
      if (method === 'GET' && (m = path.match(/^\/api\/admin\/go\/places\/(kbz-[0-9a-f-]{36})\/reviews$/))) return reply(res, await bk.adminReviews(me, m[1]));
      if (method === 'POST' && (m = path.match(/^\/api\/admin\/go\/places\/reviews\/(gpr-[0-9a-f-]{36})\/(hide|show)$/))) return reply(res, await bk.adminHideReview(me, m[1], m[2] === 'hide', (await body()).reason));
      if (method === 'GET' && path === '/api/admin/go/places') return reply(res, await gp.adminList(me, Object.fromEntries(u.searchParams)));
      if (method === 'GET' && path === '/api/admin/go/places/errors') return reply(res, await gp.adminErrors(me));
      if (method === 'GET' && (m = path.match(/^\/api\/admin\/go\/places\/media\/(kbm-[0-9a-f-]{36})$/))) return sendImg(res, await gp.adminMedia(me, m[1]));
      if (method === 'GET' && (m = path.match(/^\/api\/admin\/go\/places\/(kbz-[0-9a-f-]{36})$/))) return reply(res, await gp.adminDetail(me, m[1]));
      if (method === 'POST' && (m = path.match(/^\/api\/admin\/go\/places\/(kbz-[0-9a-f-]{36})\/(approve|reject|hide|unhide|block|unblock)$/))) { const b = await body(); return reply(res, await gp.adminDecide(me, m[1], m[2], b.reason)); }
      return json(res, 404, { error: 'not_found' });
    }
    if (isOwner) {
      // Владелец и сотрудники бизнеса (kbstaff.PERMS): сотрудник работает «от имени владельца», каждое его изменение пишется в журнал бизнеса.
      const acc = await st.accessOf(me);
      if (!acc) return json(res, 404, { error: 'no_business' });
      const own = acc.role === 'owner' ? me : `biz:${acc.businessId}`;
      const group = method === 'GET' ? 'placeview'
        : /\/place\/connect$/.test(path) ? 'owner'
        : /\/place\/(bookings|reviews)\/[^/]+\/(confirm|reject|cancel|done|no-show|reply)$/.test(path) ? 'placeops' : 'placecard';
      if (!st.can(acc, group)) return json(res, 403, { error: 'forbidden' });
      if (acc.role !== 'owner' && method !== 'GET') await audit(acc.businessId, me, 'staff_action', `${acc.role}: ${method} ${path.replace(/(kb[a-z0-9]*|gp[a-z])-[0-9a-f-]{36}/g, '$1:id')}`).catch(() => {});
      if (method === 'GET' && path === '/api/kbiz/place/booking') return reply(res, await bk.ownerBookGet(own));
      if (method === 'PUT' && path === '/api/kbiz/place/booking') return reply(res, await bk.ownerBookSave(own, await body()));
      if (method === 'POST' && path === '/api/kbiz/place/booking/day-off') { const b = await body(); return reply(res, await bk.ownerDayOff(own, b.day, b.reason, b.on !== false)); }
      if (method === 'GET' && path === '/api/kbiz/place/bookings') return reply(res, await bk.ownerBookings(own, Object.fromEntries(u.searchParams)));
      if (method === 'POST' && (m = path.match(/^\/api\/kbiz\/place\/bookings\/(gpb-[0-9a-f-]{36})\/(confirm|reject|cancel|done|no-show)$/))) return reply(res, await bk.ownerAct(own, m[1], m[2], (await body()).reason));
      if (method === 'GET' && path === '/api/kbiz/place/reviews') return reply(res, await bk.ownerReviews(own));
      if (method === 'POST' && (m = path.match(/^\/api\/kbiz\/place\/reviews\/(gpr-[0-9a-f-]{36})\/reply$/))) return reply(res, await bk.ownerReply(own, m[1], (await body()).text));
      if (method === 'GET' && path === '/api/kbiz/place/stats') return reply(res, await bk.ownerStats(own, u.searchParams.get('days')));
      if (method === 'GET' && path === '/api/kbiz/place') return reply(res, await gp.ownerGet(own));
      if (method === 'PUT' && path === '/api/kbiz/place') return reply(res, await gp.ownerSave(own, await body()));
      if (method === 'POST' && path === '/api/kbiz/place/connect') return reply(res, await gp.ownerConnect(own, (await body()).on !== false));
      if (method === 'POST' && path === '/api/kbiz/place/submit') return reply(res, await gp.ownerSubmit(own));
      if (method === 'POST' && path === '/api/kbiz/place/photo') return reply(res, await gp.ownerAddPhoto(own, (await body()).dataUrl));
      if (method === 'DELETE' && (m = path.match(/^\/api\/kbiz\/place\/photo\/(kbm-[0-9a-f-]{36})$/))) return reply(res, await gp.ownerRemovePhoto(own, m[1]));
      if (method === 'GET' && (m = path.match(/^\/api\/kbiz\/place\/media\/(kbm-[0-9a-f-]{36})$/))) return sendImg(res, await gp.mediaOwn(own, m[1]));
      return json(res, 404, { error: 'not_found' });
    }
    if (method === 'GET' && path === '/api/go/places/categories') return reply(res, await gp.categories());
    if (method === 'GET' && path === '/api/go/places') return reply(res, await gp.list(me, Object.fromEntries(u.searchParams)));
    if (method === 'GET' && path === '/api/go/places/orders') return reply(res, await gp.myOrders(me));
    if (method === 'POST' && (m = path.match(/^\/api\/go\/places\/orders\/(kbo-[0-9a-f-]{36})\/cancel$/))) return reply(res, await gp.cancelMyOrder(me, m[1]));
    if (method === 'GET' && path === '/api/go/places/bookings') return reply(res, await bk.myBookings(me));
    if (method === 'POST' && (m = path.match(/^\/api\/go\/places\/bookings\/(gpb-[0-9a-f-]{36})\/cancel$/))) return reply(res, await bk.cancelMine(me, m[1]));
    if (method === 'GET' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/book$/))) return reply(res, await bk.bookInfo(m[1]));
    if (method === 'GET' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/slots$/))) return reply(res, await bk.slots(m[1], u.searchParams.get('itemId'), u.searchParams.get('date')));
    if (method === 'POST' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/book$/))) return reply(res, await bk.book(me, m[1], await body()), 201);
    if (method === 'GET' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/reviews$/))) return reply(res, await bk.reviewsOf(me, m[1]));
    if (method === 'POST' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/reviews$/))) return reply(res, await bk.addReview(me, m[1], await body()), 201);
    if (method === 'POST' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/report$/))) return reply(res, await bk.report(me, m[1], await body()), 201);
    if (method === 'GET' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})$/))) return reply(res, await gp.get(me, m[1], Object.fromEntries(u.searchParams)));
    if (method === 'POST' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/route$/))) return reply(res, await gp.route(me, m[1], await body()));
    if ((m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/fav$/))) { if (method === 'PUT') return reply(res, await gp.toggleFav(me, m[1], true)); if (method === 'DELETE') return reply(res, await gp.toggleFav(me, m[1], false)); }
    if (method === 'POST' && (m = path.match(/^\/api\/go\/places\/(kbz-[0-9a-f-]{36})\/orders$/))) return reply(res, await gp.createOrder(me, m[1], await body(), clientIp(req)), 201);
    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[goplaces]', e.message);
    await import('./../db.mjs').then(({ query }) => query('INSERT INTO gop_errors (where_, detail) VALUES ($1,$2)', [path.replace(/(kb[a-z]-)[0-9a-f-]{36}/g, '$1:id'), String(e.message).slice(0, 300)])).catch(() => {});
    return json(res, 500, { error: 'server_error' });
  }
};
