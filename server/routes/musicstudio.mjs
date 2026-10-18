/** Sky Music Studio: /api/music/studio/* — кабинет владельца карточки. Стоит ПЕРЕД musicRoutes. */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as ms from './../musicstudio.mjs';
import * as roy from './../musicroyalty.mjs';

const MULT = Math.max(1, Number(process.env.STUDIO_RATE_MULT) || 1);        // только для тестов
const STATUS_OF = { bad_value: 400, reason_required: 400, not_allowed: 403, failed: 500, not_found: 404, rate_limited: 429, file_too_large: 413, unsupported_type: 400, already_current: 409, storage_provider_unavailable: 503, replace_failed: 500, rollback_failed: 500 };
const reply = (res, r, ok = 200) => (!r || !r.error ? json(res, ok, r ?? { ok: true }) : json(res, STATUS_OF[r.error] ?? 400, r));
const readBytes = (req, limit) => new Promise((resolve) => {
  const chunks = []; let size = 0; let dead = false;
  req.on('data', (c) => { if (dead) return; size += c.length; if (size > limit) { dead = true; resolve(null); return; } chunks.push(c); });
  req.on('end', () => { if (!dead) resolve(Buffer.concat(chunks)); });
  req.on('error', () => { if (!dead) resolve(null); });
});

export const musicStudioRoutes = async (req, res, url) => {
  const adminRoy = url.startsWith('/api/admin/music/royalty');
  if (!url.startsWith('/api/music/studio') && !adminRoy) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const u = new URL(req.url, 'http://x'); const path = u.pathname; const method = req.method;
  const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(write ? `ms:w:${me}` : `ms:r:${me}`, (write ? 40 : 200) * MULT)) return json(res, 429, { error: 'rate_limited' });
  let m;
  if (adminRoy) {
    if (method === 'GET') return reply(res, await roy.adminGet(me));
    if (method === 'PUT') { const b = (await parseBody(req)) ?? {}; return reply(res, await roy.adminSet(me, b.mode, b.reason)); }
    return json(res, 404, { error: 'not_found' });
  }
  if ((m = path.match(/^\/api\/music\/studio\/cards\/([\w-]+)\/royalty$/))) {
    if (method === 'GET') return reply(res, await roy.cardRoyalty(me, m[1]));
    if (method === 'PUT') { const b = (await parseBody(req)) ?? {}; return reply(res, await roy.setCardRoyalty(me, m[1], b.enabled)); }
  }
  if (path === '/api/music/studio/cards' && method === 'GET') return json(res, 200, await ms.myCards(me));
  if ((m = path.match(/^\/api\/music\/studio\/cards\/([\w-]+)\/tracks$/)) && method === 'GET') return reply(res, await ms.cardTracks(me, m[1], Object.fromEntries(u.searchParams)));
  if ((m = path.match(/^\/api\/music\/studio\/tracks\/([\w-]+)\/versions$/)) && method === 'GET') return reply(res, await ms.versions(me, m[1]));
  if ((m = path.match(/^\/api\/music\/studio\/tracks\/([\w-]+)\/events$/)) && method === 'GET') return reply(res, await ms.trackEvents(me, m[1]));
  if ((m = path.match(/^\/api\/music\/studio\/tracks\/([\w-]+)\/audio$/)) && method === 'POST') {
    if (!rateLimit(`ms:audio:${me}`, 10 * MULT)) return json(res, 429, { error: 'rate_limited' });     // замен в час — немного
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > ms.MAX_MP3_BYTES) { req.destroy(); return json(res, 413, { error: 'file_too_large' }); }
    const buf = await readBytes(req, ms.MAX_MP3_BYTES);
    if (!buf) return json(res, 413, { error: 'file_too_large' });
    return reply(res, await ms.replaceAudio(me, m[1], buf, u.searchParams.get('note')));
  }
  if ((m = path.match(/^\/api\/music\/studio\/tracks\/([\w-]+)\/rollback$/)) && method === 'POST') { const b = (await parseBody(req)) ?? {}; return reply(res, await ms.rollback(me, m[1], b.version)); }
  return json(res, 404, { error: 'not_found' });
};
