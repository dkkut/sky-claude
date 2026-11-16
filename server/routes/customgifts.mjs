import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import * as G from './../customgifts.mjs';

const STATUS = { not_found: 404, not_allowed: 403, self_review: 403, not_editable: 409, bad_state: 409, unsupported_media: 415, too_large: 413, file_blocked: 422, scan_unavailable: 503, storage_failed: 500,
  too_many_gifts: 429, too_many_submissions: 429, daily_limit: 429, pair_limit: 429, recipient_not_accepting: 403, second_reviewer_required: 403, media_required: 400, recipient_not_found: 404 };
const ID = 'cgf-[0-9a-f-]{36}';

/** Читает тело целиком до предела (файл подарка ≤ 12 МБ): тип и вирусы проверяются по готовому буферу, а не по частям. */
const readBody = (req, max) => new Promise((resolve) => {
  const declared = Number(req.headers['content-length'] ?? 0); if (declared > max) { req.resume(); return resolve({ error: 'too_large' }); }
  const chunks = []; let n = 0; let over = false;
  req.on('data', (c) => { n += c.length; if (n > max) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); });
  req.on('end', () => resolve(over ? { error: 'too_large' } : { buf: Buffer.concat(chunks) })); req.on('error', () => resolve({ error: 'read_failed' }));
});

/** Люди: /api/custom-gifts*, администрация (право `gifts`): /api/admin/custom-gifts*. */
export const customGiftsRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  const user = path.startsWith('/api/custom-gifts'); const admin = path.startsWith('/api/admin/custom-gifts');
  if (!user && !admin) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; let m;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const body = async () => (await parseBody(req)) ?? {};
  const stream = async (acc, asStaff = false) => {
    if (!acc) return json(res, 404, { error: 'not_found' });
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    const size = acc.size; let start = 0; let end = size - 1; let code = 200;
    if (range && size > 0) { start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]); end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1; if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); } code = 206; }
    res.writeHead(code, { 'Content-Type': acc.mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(code === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}), 'Cache-Control': asStaff ? 'no-store' : 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    const st = acc.open(code === 206 ? { start, end } : null); st.on('error', () => res.destroy()); res.on('close', () => st.destroy()); st.pipe(res); return true;
  };

  if (admin) {
    if (!(await can(me, 'gifts'))) return json(res, 403, { error: 'not_allowed' });
    if (!rateLimit(`cgfadm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && path === '/api/admin/custom-gifts') return json(res, 200, await G.queue({ status: u.searchParams.get('status') ?? '' }));
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/custom-gifts/(${ID})/media$`).exec(path))) return stream(await G.mediaAccess(me, m[1], { staff: true }), true);
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/custom-gifts/(${ID})/log$`).exec(path))) return json(res, 200, { log: await G.adminLog(m[1]) });
    if (req.method === 'POST' && (m = new RegExp(`^/api/admin/custom-gifts/(${ID})/(approve|reject|escalate|remove)$`).exec(path))) { const b = await body(); return reply(await G.decide(me, m[1], m[2], b.reason ?? b.note, { owner: await isOwner(me) })); }
    return json(res, 404, { error: 'not_found' });
  }

  if (!rateLimit(`cgf:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const write = () => rateLimit(`cgfw:${me}`, 60);
  if (req.method === 'GET' && path === '/api/custom-gifts/catalog') return json(res, 200, await G.catalog({ q: u.searchParams.get('q') ?? '', offset: u.searchParams.get('offset') ?? 0 }));
  if (req.method === 'GET' && path === '/api/custom-gifts/mine') return json(res, 200, await G.mine(me));
  if (req.method === 'GET' && path === '/api/custom-gifts/received') return json(res, 200, await G.received(me));
  if (req.method === 'GET' && path === '/api/custom-gifts/sent') return json(res, 200, await G.sent(me));
  if (req.method === 'POST' && path === '/api/custom-gifts') { if (!write()) return json(res, 429, { error: 'too_many_requests' }); return reply(await G.createGift(me, await body())); }
  if ((m = new RegExp(`^/api/custom-gifts/(${ID})(?:/([a-z]+))?$`).exec(path))) {
    const id = m[1]; const sub = m[2] ?? '';
    if (req.method === 'GET' && sub === 'media') return stream(await G.mediaAccess(me, id));
    if (!write()) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'PUT' && sub === '') return reply(await G.updateGift(me, id, await body()));
    if (req.method === 'PUT' && sub === 'media') {
      if (!rateLimitPerHour(`cgfup:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      const r = await readBody(req, G.MAX_VIDEO + 1024); if (r.error) return json(res, r.error === 'too_large' ? 413 : 400, { error: r.error });
      return reply(await G.putMedia(me, id, r.buf, { fileName: String(req.headers['x-file-name'] ?? '').slice(0, 120) }));
    }
    if (req.method === 'POST' && sub === 'submit') return reply(await G.submitGift(me, id));
    if (req.method === 'POST' && sub === 'withdraw') return reply(await G.withdrawGift(me, id));
    if (req.method === 'POST' && sub === 'send') return reply(await G.sendGift(me, id, await body()));
  }
  return json(res, 404, { error: 'not_found' });
};
