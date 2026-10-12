/**
 * Sky GO по HTTP: /api/go/*. Ни одна ручка не решает права и цену сама — это делают модули go*.mjs;
 * здесь только вход в аккаунт, пределы запросов, разбор тела и перевод ошибок в коды ответа.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { ROLES, cities, getSetting } from './../gocore.mjs';
import { mapsSettings } from './../maps.mjs';
import * as reg from './../goreg.mjs';
import * as subs from './../gosubs.mjs';
import * as pay from './../gopay.mjs';
import * as taxi from './../gotaxi.mjs';
import * as delivery from './../godelivery.mjs';
import * as food from './../gofood.mjs';
import * as flights from './../goflights.mjs';
import * as fuel from './../gofuel.mjs';
import * as stay from './../gostay.mjs';
import { query } from './../db.mjs';

const MAX_DOC = 8 * 1024 * 1024;
const readBytes = (req, limit) => new Promise((resolve) => {
  const chunks = []; let size = 0; let dead = false;
  req.on('data', (c) => { if (dead) return; size += c.length; if (size > limit) { dead = true; resolve(null); return; } chunks.push(c); });
  req.on('end', () => { if (!dead) resolve(Buffer.concat(chunks)); });
  req.on('error', () => { if (!dead) resolve(null); });
});

const STATUS_OF = {
  dates_taken: 409, has_bookings: 409, not_found: 404, not_allowed: 403, rate_limited: 429, too_many_requests: 429,
  already_taken: 409, bad_state: 409, active_order_exists: 409, driver_busy: 409, courier_busy: 409, not_editable: 409,
  subscription_required: 402, insufficient_funds: 402, not_approved: 403, not_registered: 403,
  provider_not_configured: 503, provider_unreachable: 502, provider_error: 502, provider_denied: 502,
};
const reply = (res, r, okCode = 200) => {
  if (!r || !r.error) return json(res, okCode, r ?? { ok: true });
  return json(res, STATUS_OF[r.error] ?? 400, r);
};

export const goRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/go')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  const method = req.method;
  const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(write ? `go:w:${me}` : `go:r:${me}`, write ? 90 : 300)) return json(res, 429, { error: 'rate_limited' });
  let m;

  if (method === 'GET' && path === '/api/go/config') {
    const t = await subs.tariffs();
    return json(res, 200, { cities: await cities(), tariffs: t, taxiTariffs: await getSetting('taxi_tariffs', {}), maps: mapsSettings(),
      flights: flights.flightsStatus(), fuel: fuel.fuelStatus(), paymentTerms: await getSetting('payment_terms', {}), roles: ROLES });
  }

  /* ── Регистрация исполнителей ─────────────────────────────────── */
  if (method === 'GET' && path === '/api/go/executors') return json(res, 200, { executors: await reg.listMine(me) });
  if (method === 'POST' && path === '/api/go/executors') return reply(res, await reg.saveDraft(me, await parseBody(req)));
  if ((m = path.match(/^\/api\/go\/executors\/([\w-]+)\/docs$/)) && method === 'POST') {
    const bytes = await readBytes(req, MAX_DOC);
    if (!bytes) return json(res, 413, { error: 'file_too_large' });
    return reply(res, await reg.attachDoc(me, m[1], u.searchParams.get('kind'), bytes));
  }
  if ((m = path.match(/^\/api\/go\/executors\/([\w-]+)\/docs\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await reg.removeDoc(me, m[1], m[2]));
  if ((m = path.match(/^\/api\/go\/executors\/([\w-]+)\/submit$/)) && method === 'POST') return reply(res, await reg.submit(me, m[1]));
  if (path === '/api/go/pay-details') {
    if (method === 'GET') return json(res, 200, { details: await reg.myPayDetails(me) });
    if (method === 'PUT') return reply(res, await reg.setPayDetails(me, await parseBody(req)));
  }

  /* ── Подписки и линия ─────────────────────────────────────────── */
  if ((m = path.match(/^\/api\/go\/subscription\/(taxi_driver|courier|food_seller|company|host|tour_operator|hotel)$/)) && method === 'GET') {
    return json(res, 200, { subscription: await subs.subscriptionState(me, m[1]), history: await subs.subscriptionHistory(me, m[1]), canAccept: await subs.canAccept(me, m[1]) });
  }
  if ((m = path.match(/^\/api\/go\/subscription\/(taxi_driver|courier|food_seller|company|host|tour_operator|hotel)\/buy$/)) && method === 'POST') {
    const body = await parseBody(req);
    return reply(res, await subs.buy(me, m[1], body?.idemKey));
  }
  if (path === '/api/go/presence' && method === 'POST') {
    const b = await parseBody(req);
    return reply(res, await subs.setPresence(me, String(b?.role ?? ''), b?.online === true, b));
  }
  if ((m = path.match(/^\/api\/go\/presence\/(taxi_driver|courier)$/)) && method === 'GET') return json(res, 200, await subs.presenceOf(me, m[1]));

  /* ── Такси ────────────────────────────────────────────────────── */
  if (path === '/api/go/taxi/quote' && method === 'POST') { if (!rateLimit(`go:q:${me}`, 30)) return json(res, 429, { error: 'rate_limited' }); return reply(res, await taxi.quote(await parseBody(req))); }
  if (path === '/api/go/taxi/orders' && method === 'POST') return reply(res, await taxi.create(me, await parseBody(req)), 201);
  if (path === '/api/go/taxi/available' && method === 'GET') return reply(res, await taxi.availableFor(me));
  if ((m = path.match(/^\/api\/go\/taxi\/orders\/([\w-]+)\/accept$/)) && method === 'POST') return reply(res, await taxi.accept(me, m[1]));
  if ((m = path.match(/^\/api\/go\/taxi\/orders\/([\w-]+)\/act$/)) && method === 'POST') return reply(res, await taxi.driverAct(me, m[1], String((await parseBody(req))?.action ?? '')));
  if ((m = path.match(/^\/api\/go\/taxi\/orders\/([\w-]+)\/cancel$/)) && method === 'POST') return reply(res, await taxi.customerCancel(me, m[1], (await parseBody(req))?.reason));

  /* ── Доставка ─────────────────────────────────────────────────── */
  if (path === '/api/go/delivery/quote' && method === 'POST') { if (!rateLimit(`go:q:${me}`, 30)) return json(res, 429, { error: 'rate_limited' }); return reply(res, await delivery.quote(await parseBody(req))); }
  if (path === '/api/go/delivery/orders' && method === 'POST') return reply(res, await delivery.create(me, await parseBody(req)), 201);
  if (path === '/api/go/delivery/available' && method === 'GET') return reply(res, await delivery.availableFor(me));
  if ((m = path.match(/^\/api\/go\/delivery\/orders\/([\w-]+)\/accept$/)) && method === 'POST') return reply(res, await delivery.accept(me, m[1]));
  if ((m = path.match(/^\/api\/go\/delivery\/orders\/([\w-]+)\/act$/)) && method === 'POST') {
    const b = await parseBody(req);
    const r = await delivery.courierAct(me, m[1], String(b?.action ?? ''), b?.code);
    if (r.ok && r.foodSync) await food.syncFromDelivery(r.foodSync.parent, r.foodSync.to, me).catch((e) => console.error('[go] синхронизация еды', e.message));
    return reply(res, r);
  }
  if ((m = path.match(/^\/api\/go\/delivery\/orders\/([\w-]+)\/cancel$/)) && method === 'POST') return reply(res, await delivery.customerCancel(me, m[1], (await parseBody(req))?.reason));

  /* ── Еда ──────────────────────────────────────────────────────── */
  if (path === '/api/go/food/places' && method === 'GET') return json(res, 200, await food.catalog({ city: u.searchParams.get('city'), q: u.searchParams.get('q'), category: u.searchParams.get('category') }));
  if ((m = path.match(/^\/api\/go\/food\/places\/([\w-]+)$/)) && method === 'GET') return reply(res, await food.getPlace(m[1]));
  if (path === '/api/go/food/orders' && method === 'POST') return reply(res, await food.create(me, await parseBody(req)), 201);
  if (path === '/api/go/food/my/place') {
    if (method === 'GET') return json(res, 200, await food.myPlace(me));
    if (method === 'PUT') return reply(res, await food.savePlace(me, await parseBody(req)));
  }
  if (path === '/api/go/food/my/publish' && method === 'POST') return reply(res, await food.setPublished(me, (await parseBody(req))?.on === true));
  if (path === '/api/go/food/my/accepting' && method === 'POST') return reply(res, await food.setAccepting(me, (await parseBody(req))?.on === true));
  if (path === '/api/go/food/my/items' && method === 'POST') return reply(res, await food.saveItem(me, await parseBody(req)));
  if ((m = path.match(/^\/api\/go\/food\/my\/items\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await food.removeItem(me, m[1]));
  if (path === '/api/go/food/my/orders' && method === 'GET') {
    const rows = await food.sellerOrders(me);
    return json(res, 200, { orders: await Promise.all(rows.map((r) => pay.orderView(r, me))) });
  }
  if ((m = path.match(/^\/api\/go\/food\/orders\/([\w-]+)\/seller-act$/)) && method === 'POST') { const b = await parseBody(req); return reply(res, await food.sellerAct(me, m[1], String(b?.action ?? ''), b?.reason)); }
  if ((m = path.match(/^\/api\/go\/food\/orders\/([\w-]+)\/cancel$/)) && method === 'POST') return reply(res, await food.customerCancel(me, m[1], (await parseBody(req))?.reason));

  /* ── Заказы и оплата ──────────────────────────────────────────── */
  if (path === '/api/go/orders' && method === 'GET') return json(res, 200, await pay.listMine(me, { side: u.searchParams.get('side'), status: u.searchParams.get('status'), limit: u.searchParams.get('limit'), offset: u.searchParams.get('offset') }));
  if ((m = path.match(/^\/api\/go\/orders\/([\w-]+)$/)) && method === 'GET') return reply(res, await pay.getOrder(me, m[1]));
  if ((m = path.match(/^\/api\/go\/orders\/([\w-]+)\/paid$/)) && method === 'POST') return reply(res, await pay.reportPaid(me, m[1]));
  if ((m = path.match(/^\/api\/go\/orders\/([\w-]+)\/confirm-paid$/)) && method === 'POST') return reply(res, await pay.confirmPaid(me, m[1]));
  if ((m = path.match(/^\/api\/go\/orders\/([\w-]+)\/dispute$/)) && method === 'POST') return reply(res, await pay.openDispute(me, m[1], (await parseBody(req))?.reason));

  /* ── Статистика исполнителя (только настоящие закрытые заказы) ── */
  if ((m = path.match(/^\/api\/go\/stats\/(taxi_driver|courier|food_seller)$/)) && method === 'GET') {
    const kind = { taxi_driver: 'taxi', courier: 'delivery', food_seller: 'food' }[m[1]];
    const { rows } = await query(
      `SELECT count(*) FILTER (WHERE status = 'paid')::int AS done, coalesce(sum(price_rub) FILTER (WHERE status = 'paid'), 0)::int AS earned,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled, count(*) FILTER (WHERE status NOT IN ('paid','cancelled'))::int AS active
         FROM go_orders WHERE executor_id = $1 AND kind = $2`, [me, kind]);
    return json(res, 200, { done: rows[0].done, earnedRub: rows[0].earned, cancelled: rows[0].cancelled, active: rows[0].active });
  }

  /* ── Жильё и отдых ────────────────────────────────────────────── */
  if (path === '/api/go/stay/listings' && method === 'GET') {
    return reply(res, await stay.catalog(Object.fromEntries(['kind', 'city', 'q', 'guests', 'checkIn', 'checkOut', 'sort'].map((k) => [k, u.searchParams.get(k)]))));
  }
  if ((m = path.match(/^\/api\/go\/stay\/listings\/([\w-]+)$/)) && method === 'GET') return reply(res, await stay.getListing(m[1]));
  if (path === '/api/go/stay/quote' && method === 'POST') { if (!rateLimit(`go:sq:${me}`, 40)) return json(res, 429, { error: 'rate_limited' }); return reply(res, await stay.quote(await parseBody(req))); }
  if (path === '/api/go/stay/bookings' && method === 'POST') { if (!rateLimit(`go:sb:${me}`, 12)) return json(res, 429, { error: 'rate_limited' }); return reply(res, await stay.book(me, await parseBody(req)), 201); }
  if ((m = path.match(/^\/api\/go\/stay\/bookings\/([\w-]+)\/act$/)) && method === 'POST') { const b = await parseBody(req); return reply(res, await stay.hostAct(me, m[1], String(b?.action ?? ''), b?.reason)); }
  if ((m = path.match(/^\/api\/go\/stay\/bookings\/([\w-]+)\/cancel$/)) && method === 'POST') return reply(res, await stay.guestCancel(me, m[1], (await parseBody(req))?.reason));
  if ((m = path.match(/^\/api\/go\/stay\/photos\/([\w-]+)$/)) && method === 'GET') {
    const r = await stay.getPhoto(me, m[1], false);
    if (r.error) return json(res, 404, r);
    res.writeHead(200, { 'Content-Type': r.mime, 'Content-Length': r.data.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.end(r.data);
    return true;
  }
  if (path === '/api/go/stay/my/listings' && method === 'GET') return json(res, 200, await stay.myListings(me));
  if (path === '/api/go/stay/my/listings' && method === 'PUT') return reply(res, await stay.saveListing(me, await parseBody(req)));
  if ((m = path.match(/^\/api\/go\/stay\/my\/listings\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await stay.removeListing(me, m[1]));
  if ((m = path.match(/^\/api\/go\/stay\/my\/listings\/([\w-]+)\/publish$/)) && method === 'POST') return reply(res, await stay.setPublished(me, m[1], (await parseBody(req))?.on === true));
  if ((m = path.match(/^\/api\/go\/stay\/my\/listings\/([\w-]+)\/photos$/)) && method === 'POST') {
    const bytes = await readBytes(req, 5 * 1024 * 1024);
    if (!bytes) return json(res, 413, { error: 'file_too_large' });
    return reply(res, await stay.addPhoto(me, m[1], bytes), 201);
  }
  if ((m = path.match(/^\/api\/go\/stay\/my\/listings\/([\w-]+)\/photos\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await stay.removePhoto(me, m[1], m[2]));

  /* ── Авиабилеты ───────────────────────────────────────────────── */
  if (path === '/api/go/flights/status' && method === 'GET') return json(res, 200, flights.flightsStatus());
  if (path === '/api/go/flights/suggest' && method === 'GET') return reply(res, await flights.suggest(u.searchParams.get('term')));
  if (path === '/api/go/flights/search' && method === 'POST') { if (!rateLimit(`go:fl:${me}`, 10)) return json(res, 429, { error: 'rate_limited' }); return reply(res, await flights.search(await parseBody(req))); }
  if (path === '/api/go/flights/orders' && method === 'POST') return reply(res, await flights.createOrder(me, await parseBody(req)), 201);
  if (path === '/api/go/flights/orders' && method === 'GET') return json(res, 200, await flights.listOrders(me));
  if ((m = path.match(/^\/api\/go\/flights\/orders\/([\w-]+)\/cancel$/)) && method === 'POST') return reply(res, await flights.cancelOrder(me, m[1]));

  /* ── Заправки ─────────────────────────────────────────────────── */
  if (path === '/api/go/fuel/status' && method === 'GET') return json(res, 200, fuel.fuelStatus());
  if (path === '/api/go/fuel/nearby' && method === 'POST') { if (!rateLimit(`go:fu:${me}`, 20)) return json(res, 429, { error: 'rate_limited' }); return reply(res, await fuel.nearby(await parseBody(req))); }
  if (path === '/api/go/fuel/report' && method === 'POST') { const b = await parseBody(req); return reply(res, await fuel.report(me, b?.key, b?.level)); }

  return json(res, 404, { error: 'not_found' });
};
