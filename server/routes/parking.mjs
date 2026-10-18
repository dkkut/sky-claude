/** Sky Parking: /api/parking/* (люди и организации) и /api/admin/parking/* (право parking / parking_moderation). */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as pk from './../parking.mjs';
import * as pp from './../parkingpay.mjs';

const RATE_MULT = Math.max(1, Number(process.env.PARKING_RATE_MULT) || 1);   // только для тестов
const STATUS_OF = { not_found: 404, not_allowed: 403, self_review: 403, rate_limited: 429, bad_state: 409, in_review: 409, not_editable: 409,
  org_suspended: 423, insufficient_funds: 402, lot_full: 409, vehicle_in_use: 409, vehicle_exists: 409, too_many_vehicles: 409, session_ended: 409, not_extendable: 409, refund_exists: 409, already_reported: 409, own_lot: 403, refund_window_closed: 409, lot_unavailable: 409, too_many_orgs: 409, too_many_lots: 409, too_many_tariffs: 409, too_many_staff: 409, already_owner: 409, incomplete: 422, no_tariff: 422 };
const reply = (res, r, okCode = 200) => (!r || !r.error ? json(res, okCode, r ?? { ok: true }) : json(res, STATUS_OF[r.error] ?? 400, r));

export const parkingRoutes = async (req, res, url) => {
  const adminSide = url.startsWith('/api/admin/parking');
  if (!url.startsWith('/api/parking') && !adminSide) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');
  const path = u.pathname; const method = req.method;
  const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(write ? `pk:w:${me}` : `pk:r:${me}`, (write ? 60 : 300) * RATE_MULT)) return json(res, 429, { error: 'rate_limited' });
  let m;

  if (adminSide) {
    if (method === 'GET' && path === '/api/admin/parking/lots') return reply(res, await pk.adminQueue(me, u.searchParams.get('status') ?? 'review'));
    if ((m = path.match(/^\/api\/admin\/parking\/lots\/([\w-]+)\/(approve|reject|suspend|restore)$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await pk.adminDecide(me, m[1], m[2], b.reason)); }
    if ((m = path.match(/^\/api\/admin\/parking\/lots\/([\w-]+)\/events$/)) && method === 'GET') return reply(res, await pk.lotEvents(me, m[1]));
    if (method === 'GET' && path === '/api/admin/parking/orgs') return reply(res, await pk.adminOrgs(me, u.searchParams.get('q') ?? ''));
    if ((m = path.match(/^\/api\/admin\/parking\/orgs\/([\w-]+)\/(suspend|restore)$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await pk.adminSuspendOrg(me, m[1], m[2] === 'suspend', b.reason)); }
    if ((m = path.match(/^\/api\/admin\/parking\/orgs\/([\w-]+)\/refunds$/)) && method === 'GET') return reply(res, await pp.orgRefunds(me, m[1], u.searchParams.get('status') ?? 'requested'));
    if ((m = path.match(/^\/api\/admin\/parking\/refunds\/([\w-]+)\/(approve|reject)$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await pp.decideRefund(me, m[1], m[2], b.note)); }
    if (method === 'GET' && path === '/api/admin/parking/reports') return reply(res, await pp.adminReports(me, u.searchParams.get('status') ?? 'open'));
    if ((m = path.match(/^\/api\/admin\/parking\/reports\/([\w-]+)\/resolve$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await pp.adminResolveReport(me, m[1], b.resolution)); }
    return json(res, 404, { error: 'not_found' });
  }

  if (path === '/api/parking/vehicles' && method === 'GET') return json(res, 200, await pp.myVehicles(me));
  if (path === '/api/parking/vehicles' && method === 'POST') return reply(res, await pp.addVehicle(me, await parseBody(req)), 201);
  if ((m = path.match(/^\/api\/parking\/vehicles\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await pp.removeVehicle(me, m[1]));
  if (path === '/api/parking/sessions' && method === 'GET') return json(res, 200, await pp.mySessions(me));
  if (path === '/api/parking/sessions' && method === 'POST') return reply(res, await pp.startSession(me, await parseBody(req)), 201);
  if ((m = path.match(/^\/api\/parking\/sessions\/([\w-]+)\/extend$/)) && method === 'POST') return reply(res, await pp.extendSession(me, m[1], await parseBody(req)));
  if ((m = path.match(/^\/api\/parking\/sessions\/([\w-]+)\/extend-quote$/)) && method === 'GET') return reply(res, await pp.extendQuote(me, m[1], u.searchParams.get('minutes')));
  if ((m = path.match(/^\/api\/parking\/payments\/([\w-]+)\/refund$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await pp.requestRefund(me, m[1], b.reason), 201); }
  if ((m = path.match(/^\/api\/parking\/lots\/([\w-]+)\/report$/)) && method === 'POST') return reply(res, await pp.reportLot(me, m[1], await parseBody(req)), 201);
  if ((m = path.match(/^\/api\/parking\/orgs\/([\w-]+)\/sessions$/)) && method === 'GET') return reply(res, await pp.orgSessions(me, m[1]));
  if ((m = path.match(/^\/api\/parking\/orgs\/([\w-]+)\/refunds$/)) && method === 'GET') return reply(res, await pp.orgRefunds(me, m[1], u.searchParams.get('status') ?? 'requested'));
  if ((m = path.match(/^\/api\/parking\/refunds\/([\w-]+)\/(approve|reject)$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await pp.decideRefund(me, m[1], m[2], b.note)); }

  if (path === '/api/parking/lots' && method === 'GET') return json(res, 200, await pk.catalog(Object.fromEntries(u.searchParams)));
  if ((m = path.match(/^\/api\/parking\/lots\/([\w-]+)$/)) && method === 'GET') return reply(res, await pk.getPublicLot(m[1]));
  if ((m = path.match(/^\/api\/parking\/lots\/([\w-]+)\/quote$/)) && method === 'GET') return reply(res, await pk.quote(m[1], u.searchParams.get('tariffId') ?? '', u.searchParams.get('minutes')));

  if (path === '/api/parking/orgs' && method === 'GET') return json(res, 200, await pk.myOrgs(me));
  if (path === '/api/parking/orgs' && method === 'POST') return reply(res, await pk.createOrg(me, await parseBody(req)), 201);
  if ((m = path.match(/^\/api\/parking\/orgs\/([\w-]+)\/lots$/))) {
    if (method === 'GET') return reply(res, await pk.orgLots(me, m[1]));
    if (method === 'POST') return reply(res, await pk.createLot(me, m[1], await parseBody(req)), 201);
  }
  if ((m = path.match(/^\/api\/parking\/orgs\/([\w-]+)\/staff$/))) {
    if (method === 'GET') return reply(res, await pk.listStaff(me, m[1]));
    if (method === 'POST') return reply(res, await pk.addStaff(me, m[1], await parseBody(req)));
  }
  if ((m = path.match(/^\/api\/parking\/orgs\/([\w-]+)\/staff\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await pk.removeStaff(me, m[1], m[2]));
  if ((m = path.match(/^\/api\/parking\/my\/lots\/([\w-]+)$/)) && method === 'PUT') return reply(res, await pk.updateLot(me, m[1], await parseBody(req)));
  if ((m = path.match(/^\/api\/parking\/my\/lots\/([\w-]+)\/(submit|archive)$/)) && method === 'POST') return reply(res, m[2] === 'submit' ? await pk.submitLot(me, m[1]) : await pk.archiveLot(me, m[1]));
  if ((m = path.match(/^\/api\/parking\/my\/lots\/([\w-]+)\/tariffs$/)) && method === 'POST') return reply(res, await pk.addTariff(me, m[1], await parseBody(req)), 201);
  if ((m = path.match(/^\/api\/parking\/my\/lots\/([\w-]+)\/tariffs\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await pk.removeTariff(me, m[1], m[2]));
  if ((m = path.match(/^\/api\/parking\/my\/lots\/([\w-]+)\/events$/)) && method === 'GET') return reply(res, await pk.lotEvents(me, m[1]));
  return json(res, 404, { error: 'not_found' });
};
