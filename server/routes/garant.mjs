/**
 * Sky Garant по HTTP.
 *
 * Здесь только вход: кто спрашивает и не слишком ли часто. Кому что
 * можно и куда деваются деньги решает server/garant.mjs — от статуса
 * сделки и роли actorId в ней, а не от того, что прислал клиент.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  myGarantStatus, myDeals, createDeal, depositSeller, depositBuyer,
  confirmBuyer, confirmSeller, cancelDeal, openDispute, purchaseSubscription,
  listNotifications, readNotification,
  adminListDeals, adminDealDetail, adminResolveDispute, adminForceConfirm, adminForceCancel,
  DEAL_ID_RE,
} from './../garant.mjs';
import {
  createVerifiedDeal, submitData, confirmOwnData, viewData, approveData, payDeal, closeDeal, cancelVerified, openVerifyDispute,
  adminViewData, adminResolveVerifyDispute,
} from './../garantverify.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 20;
/* Создание сделок — то место, где спамят: свой, более тесный предел. */
const CREATE_PER_HOUR = 15;

const CODES = {
  not_found: 404,
  not_allowed: 403,
  self_deal: 400,
  bad_item_type: 400,
  bad_item_name: 400,
  bad_price: 400,
  bad_status: 409,
  already_confirmed: 409,
  bad_reason: 400,
  bad_winner: 400,
  bad_note: 400,
  bad_side: 400,
  monthly_limit: 409,
  refund_failed: 500,
  no_such_user: 404,
  invalid_amount: 400,
  insufficient_funds: 402,
  insufficient_points: 402,
  bad_flow: 400, bad_counter_item: 400, bad_data: 400, confirm_required: 400, data_locked: 409, view_first: 409, no_funds_held: 409,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

export const garantRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/garant')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const readOk = () => rateLimit(`grt:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`grt:w:${me}`, WRITE_PER_MIN);
  const body = async () => parseBody(req);

  if (req.method === 'GET' && path === '/api/garant/me/status') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { data: await myGarantStatus(me) });
  }

  if (req.method === 'GET' && path === '/api/garant/deals') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { deals: await myDeals(me) });
  }

  if (req.method === 'POST' && path === '/api/garant/deals') {
    if (!rateLimitPerHour(`grt:create:${me}`, CREATE_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await createDeal(me, b);
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  if (req.method === 'POST' && path === '/api/garant/verify') {
    if (!rateLimitPerHour(`grt:create:${me}`, CREATE_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
    const done = await createVerifiedDeal(me, await body());
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  if (req.method === 'POST' && path === '/api/garant/subscribe') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await purchaseSubscription(me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (req.method === 'GET' && path === '/api/garant/notifications') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await listNotifications(me, { limit: params.get('limit') }) });
  }
  if (req.method === 'POST' && path === '/api/garant/notifications/read') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { ok: await readNotification(me, (await body()).id) });
  }

  const dealPath = path.match(/^\/api\/garant\/deals\/(grt-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (dealPath) {
    const dealId = dealPath[1];
    const tail = dealPath[2] ?? '';
    if (!DEAL_ID_RE.test(dealId)) return json(res, 404, { error: 'not_found' });

    // Сделка с проверкой и обмен (server/garantverify.mjs)
    if (tail === '/data' && req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const r = await viewData(me, dealId); return r.error ? fail(res, r) : json(res, 200, r);
    }
    const VERIFY = { '/data': (b) => submitData(me, dealId, b), '/confirm-data': () => confirmOwnData(me, dealId), '/approve': () => approveData(me, dealId), '/pay': () => payDeal(me, dealId),
      '/close': () => closeDeal(me, dealId), '/v-cancel': () => cancelVerified(me, dealId), '/v-dispute': (b) => openVerifyDispute(me, dealId, b?.reason) };
    if (req.method === 'POST' && VERIFY[tail]) {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await VERIFY[tail](await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/deposit-seller') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await depositSeller(me, dealId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/deposit-buyer') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await depositBuyer(me, dealId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/confirm-buyer') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await confirmBuyer(me, dealId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/confirm-seller') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await confirmSeller(me, dealId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/cancel') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await cancelDeal(me, dealId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/dispute') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await openDispute(me, dealId, (await body()).reason);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Админка ═══════════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/garant/admin/deals') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const items = await adminListDeals(me, { status: params.get('status'), q: params.get('q'), limit: params.get('limit') });
    if (items === null) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { items });
  }

  const adminDealPath = path.match(/^\/api\/garant\/admin\/deals\/(grt-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (adminDealPath) {
    const dealId = adminDealPath[1];
    const tail = adminDealPath[2] ?? '';
    if (!DEAL_ID_RE.test(dealId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && !tail) {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const data = await adminDealDetail(me, dealId);
      if (data === null) return json(res, 403, { error: 'not_allowed' });
      if (!data.deal) return json(res, 404, { error: 'not_found' });
      return json(res, 200, data);
    }
    if (req.method === 'POST' && tail === '/resolve') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await adminResolveDispute(me, dealId, b.winner, b.note);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'GET' && tail === '/data') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const r = await adminViewData(me, dealId); return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/resolve-verify') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await adminResolveVerifyDispute(me, dealId, b.outcome, b.note);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/force-confirm') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await adminForceConfirm(me, dealId, (await body()).side);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/force-cancel') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await adminForceCancel(me, dealId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  return json(res, 404, { error: 'not_found' });
};
