import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import * as S from './../specialists.mjs';

const STATUS = { not_found: 404, not_allowed: 403, self_review: 403, own_profile: 400, bad_state: 409, active_offer_exists: 409, already_reported: 409, suspended: 403, closed: 409, profile_unavailable: 409,
  too_many_open_offers: 429, too_many_reports: 429, too_many_messages: 429, too_many_works: 400, image_too_large: 413, not_disputed: 409, no_profile: 404 };
const ID = '[a-z]{3}-[0-9a-f-]{36}';

/** Биржа специалистов: людям — /api/specialists*, администрации (право `specialists`) — /api/admin/specialists*. */
export const specialistsRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  const user = path.startsWith('/api/specialists'); const admin = path.startsWith('/api/admin/specialists');
  if (!user && !admin) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const body = async () => (await parseBody(req)) ?? {};
  const image = (r) => { res.writeHead(200, { 'Content-Type': r.type, 'Content-Length': r.data.length, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); return res.end(r.data); };
  let m;

  if (admin) {
    if (!(await can(me, 'specialists'))) return json(res, 403, { error: 'not_allowed' });
    if (!rateLimit(`specadm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && path === '/api/admin/specialists') return json(res, 200, await S.adminList({ status: u.searchParams.get('status') ?? '' }));
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/specialists/(${ID})/log$`).exec(path))) return json(res, 200, { log: await S.adminLog(m[1]) });
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/specialists/(${ID})/photo$`).exec(path))) { const r = await S.photoOf(m[1], { staff: true }); return r ? image(r) : json(res, 404, { error: 'not_found' }); }
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/specialists/work/(${ID})/image$`).exec(path))) { const r = await S.workImage(m[1], { staff: true }); return r ? image(r) : json(res, 404, { error: 'not_found' }); }
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/specialists/(${ID})$`).exec(path))) return reply(await S.getPublic(m[1], '__staff__'));
    if (req.method === 'POST' && (m = new RegExp(`^/api/admin/specialists/(${ID})/(approve|reject|suspend|restore)$`).exec(path))) { const b = await body(); return reply(await S.adminReview(me, m[1], m[2], b.reason, { owner: await isOwner(me) })); }
    if (req.method === 'POST' && (m = new RegExp(`^/api/admin/specialists/reports/(${ID})$`).exec(path))) { const b = await body(); return reply(await S.adminResolveReport(me, m[1], b.outcome, b.note)); }
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/specialists/offers/(${ID})$`).exec(path))) return reply(await S.adminOffer(me, m[1]));
    if (req.method === 'POST' && (m = new RegExp(`^/api/admin/specialists/offers/(${ID})/resolve$`).exec(path))) { const b = await body(); return reply(await S.adminResolveDispute(me, m[1], b.outcome, b.note)); }
    return json(res, 404, { error: 'not_found' });
  }

  if (!rateLimit(`spec:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const write = () => rateLimit(`specw:${me}`, 40);
  if (req.method === 'GET' && path === '/api/specialists') return json(res, 200, await S.search({ category: u.searchParams.get('category') ?? '', spec: u.searchParams.get('spec') ?? '', service: u.searchParams.get('service') ?? '', workType: u.searchParams.get('workType') ?? '', availability: u.searchParams.get('availability') ?? '', q: u.searchParams.get('q') ?? '', offset: u.searchParams.get('offset') ?? 0 }));
  if (req.method === 'GET' && path === '/api/specialists/me') return json(res, 200, await S.myProfile(me));
  if (req.method === 'PUT' && path === '/api/specialists/me') { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await S.saveProfile(me, await body())); }
  if (req.method === 'PUT' && path === '/api/specialists/me/photo') { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await S.setPhoto(me, (await body()).dataUrl)); }
  if (req.method === 'POST' && path === '/api/specialists/me/works') { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await S.addWork(me, await body())); }
  if (req.method === 'DELETE' && (m = new RegExp(`^/api/specialists/me/works/(${ID})$`).exec(path))) return reply(await S.removeWork(me, m[1]));
  if (req.method === 'POST' && path === '/api/specialists/me/submit') return reply(await S.submitProfile(me));
  if (req.method === 'GET' && path === '/api/specialists/offers') return json(res, 200, await S.listOffers(me, u.searchParams.get('role') ?? 'all'));
  if (req.method === 'POST' && path === '/api/specialists/offers') { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await S.sendOffer(me, await body())); }
  if (req.method === 'POST' && path === '/api/specialists/reports') { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await S.report(me, await body())); }
  if (req.method === 'GET' && (m = new RegExp(`^/api/specialists/offers/(${ID})$`).exec(path))) return reply(await S.getOffer(me, m[1]));
  if (req.method === 'POST' && (m = new RegExp(`^/api/specialists/offers/(${ID})/messages$`).exec(path))) { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await S.sendMessage(me, m[1], (await body()).text)); }
  if (req.method === 'POST' && (m = new RegExp(`^/api/specialists/offers/(${ID})/([a-z]+)$`).exec(path))) { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await S.offerAction(me, m[1], m[2], (await body()).reason)); }
  if (req.method === 'GET' && (m = new RegExp(`^/api/specialists/(${ID})/photo$`).exec(path))) {
    let r = await S.photoOf(m[1], { staff: false });
    if (!r && (await S.myProfile(me)).profile?.id === m[1]) r = await S.photoOf(m[1], { staff: true });
    return r ? image(r) : json(res, 404, { error: 'not_found' });
  }
  if (req.method === 'GET' && (m = new RegExp(`^/api/specialists/work/(${ID})/image$`).exec(path))) { const r = await S.workImage(m[1], { me }); return r ? image(r) : json(res, 404, { error: 'not_found' }); }
  if (req.method === 'GET' && (m = new RegExp(`^/api/specialists/(${ID})$`).exec(path))) return reply(await S.getPublic(m[1], me));
  return json(res, 404, { error: 'not_found' });
};
