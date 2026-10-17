/** Sky Market «На месте»: /api/onsite/* (люди) и /api/admin/onsite/* (модерация, право market_moderation). */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as os from './../onsite.mjs';
import { can } from './../admin.mjs';

const RATE_MULT = Math.max(1, Number(process.env.ONSITE_RATE_MULT) || 1);   // только для тестов
const readBytes = (req, limit) => new Promise((resolve) => {
  const chunks = []; let size = 0; let dead = false;
  req.on('data', (c) => { if (dead) return; size += c.length; if (size > limit) { dead = true; resolve(null); return; } chunks.push(c); });
  req.on('end', () => { if (!dead) resolve(Buffer.concat(chunks)); });
  req.on('error', () => { if (!dead) resolve(null); });
});
const STATUS_OF = { not_found: 404, not_allowed: 403, rate_limited: 429, bad_state: 409, deal_exists: 409, listing_unavailable: 409, has_active_deal: 409, too_many_listings: 409, too_many_open: 409,
  code_locked: 423, bad_code: 400, already_reviewed: 409, already_reported: 409, not_editable: 409, removed_by_moderation: 403, self_review: 403 };
const reply = (res, r, okCode = 200) => (!r || !r.error ? json(res, okCode, r ?? { ok: true }) : json(res, STATUS_OF[r.error] ?? 400, r));

export const onsiteRoutes = async (req, res, url) => {
  const adminSide = url.startsWith('/api/admin/onsite');
  if (!url.startsWith('/api/onsite') && !adminSide) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');
  const path = u.pathname; const method = req.method;
  const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(write ? `os:w:${me}` : `os:r:${me}`, (write ? 60 : 300) * RATE_MULT)) return json(res, 429, { error: 'rate_limited' });
  let m;

  if (adminSide) {
    if (method === 'GET' && path === '/api/admin/onsite/reports') return reply(res, await os.adminReports(me, u.searchParams.get('status')));
    if ((m = path.match(/^\/api\/admin\/onsite\/reports\/([\w-]+)\/decide$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await os.adminDecide(me, m[1], String(b.action ?? ''), b.note)); }
    if ((m = path.match(/^\/api\/admin\/onsite\/photos\/([\w-]+)$/)) && method === 'GET') {
      if (!(await can(me, 'market_moderation'))) return json(res, 403, { error: 'not_allowed' });
      const r = await os.getPhoto(me, m[1], true); if (r.error) return json(res, 404, r);
      res.writeHead(200, { 'Content-Type': r.mime, 'Content-Length': r.data.length, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' }); res.end(r.data); return true;
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (path === '/api/onsite/meta' && method === 'GET') return json(res, 200, os.meta());
  if (path === '/api/onsite/listings' && method === 'GET') return json(res, 200, await os.catalog(me, Object.fromEntries(u.searchParams)));
  if ((m = path.match(/^\/api\/onsite\/listings\/([\w-]+)$/)) && method === 'GET') return reply(res, await os.getListing(me, m[1]));
  if ((m = path.match(/^\/api\/onsite\/photos\/([\w-]+)$/)) && method === 'GET') {
    const r = await os.getPhoto(me, m[1], false); if (r.error) return json(res, 404, r);
    res.writeHead(200, { 'Content-Type': r.mime, 'Content-Length': r.data.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); res.end(r.data); return true;
  }
  if ((m = path.match(/^\/api\/onsite\/listings\/([\w-]+)\/deals$/)) && method === 'POST') return reply(res, await os.requestViewing(me, m[1], await parseBody(req)), 201);
  if ((m = path.match(/^\/api\/onsite\/listings\/([\w-]+)\/report$/)) && method === 'POST') return reply(res, await os.report(me, m[1], await parseBody(req)), 201);

  if (path === '/api/onsite/my/listings' && method === 'GET') return json(res, 200, await os.myListings(me));
  if (path === '/api/onsite/my/listings' && method === 'PUT') return reply(res, await os.saveListing(me, await parseBody(req)));
  if ((m = path.match(/^\/api\/onsite\/my\/listings\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await os.removeListing(me, m[1]));
  if ((m = path.match(/^\/api\/onsite\/my\/listings\/([\w-]+)\/(publish|close)$/)) && method === 'POST') return reply(res, await os.setStatus(me, m[1], m[2]));
  if ((m = path.match(/^\/api\/onsite\/my\/listings\/([\w-]+)\/photos$/)) && method === 'POST') {
    const bytes = await readBytes(req, 5 * 1024 * 1024);
    if (!bytes) return json(res, 413, { error: 'file_too_large' });
    return reply(res, await os.addPhoto(me, m[1], bytes), 201);
  }
  if ((m = path.match(/^\/api\/onsite\/my\/listings\/([\w-]+)\/photos\/([\w-]+)$/)) && method === 'DELETE') return reply(res, await os.removePhoto(me, m[1], m[2]));

  if (path === '/api/onsite/deals' && method === 'GET') return json(res, 200, await os.myDeals(me));
  if ((m = path.match(/^\/api\/onsite\/deals\/([\w-]+)$/)) && method === 'GET') return reply(res, await os.getDeal(me, m[1]));
  if ((m = path.match(/^\/api\/onsite\/deals\/([\w-]+)\/(message|accept|decline|cancel|confirm|done|fail|review)$/)) && method === 'POST') {
    const b = (await parseBody(req)) ?? {};
    switch (m[2]) {
      case 'message': return reply(res, await os.sendMessage(me, m[1], b.text));
      case 'accept': return reply(res, await os.accept(me, m[1], b));
      case 'decline': return reply(res, await os.decline(me, m[1], b.note));
      case 'cancel': return reply(res, await os.cancel(me, m[1], b.note));
      case 'confirm': { if (!rateLimit(`os:code:${me}`, 20 * RATE_MULT)) return json(res, 429, { error: 'rate_limited' }); return reply(res, await os.confirmMeeting(me, m[1], b.code)); }
      case 'done': return reply(res, await os.finish(me, m[1], 'done'));
      case 'fail': return reply(res, await os.finish(me, m[1], 'fail', b.note));
      default: return reply(res, await os.review(me, m[1], b));
    }
  }
  return json(res, 404, { error: 'not_found' });
};
