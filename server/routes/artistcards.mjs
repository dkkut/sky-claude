import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { hasPrime } from './../skyid.mjs';
import { can } from './../admin.mjs';
import { suggest, createCard, readCard, readCardByName, listCards, updateCard, claim, withdrawClaim, adminClaims, decideClaim, revokeOwner, duplicates, merge, unmerge, adminList, transferOwner, setForeignAgent, setCardImage, clearCardImage, cardImage } from './../artistcards.mjs';

const CODE = { image_too_large: 413, no_transparency: 422, user_not_found: 404, not_allowed: 403, no_own_track: 403, self_review: 403, not_found: 404, exists: 409, already_owned: 409, already_owner: 409, already_pending: 409, not_pending: 409, already_merged: 409, name_taken: 409 };
const send = (res, r) => (r.error ? json(res, CODE[r.error] ?? 400, r) : json(res, 200, r));

/** Карточки музыкантов: люди (с Prime, как вся Sky Music) и сотрудники (право `content`). */
export const artistCardsRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  const admin = path.startsWith('/api/admin/artist-cards');
  if (!admin && !path.startsWith('/api/music/artist-cards')) return false;
  const s = await requireProfile(req, res);
  if (!s) return true;
  const me = s.profileId;
  if (!admin && !(await hasPrime(me)) && !(await can(me, 'content'))) return json(res, 403, { error: 'prime_required' });
  if (!rateLimit(`acard:${me}`, 180)) return json(res, 429, { error: 'too_many_requests' });
  const params = new URL(req.url, 'http://x').searchParams;

  if (!admin) {
    if (req.method === 'GET' && path === '/api/music/artist-cards/suggest') return json(res, 200, await suggest(params.get('name') ?? ''));
    if (req.method === 'GET' && path === '/api/music/artist-cards/by-name') { const c = await readCardByName(params.get('name') ?? '', me); return c ? json(res, 200, { card: c }) : json(res, 404, { error: 'not_found' }); }
    if (req.method === 'GET' && path === '/api/music/artist-cards') return json(res, 200, { cards: await listCards({ q: params.get('q') ?? undefined, limit: params.get('limit') }) });
    if (req.method === 'POST' && path === '/api/music/artist-cards') { if (!rateLimit(`acard:new:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' }); return send(res, await createCard(me, (await parseBody(req)) ?? {})); }
    const im = path.match(/^\/api\/music\/artist-cards\/(acd-[0-9a-f-]{36})\/image\/(photo|banner|cutout)$/);
    if (im) {
      if (req.method === 'GET') {
        const img = await cardImage(im[1], im[2]);
        if (!img) return json(res, 404, { error: 'not_found' });
        res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.data.length, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
        return res.end(img.data);
      }
      if (!rateLimit(`acard:img:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
      if (req.method === 'PUT') return send(res, await setCardImage(me, im[1], im[2], (await parseBody(req))?.dataUrl));
      if (req.method === 'DELETE') return send(res, await clearCardImage(me, im[1], im[2]));
    }
    const m = path.match(/^\/api\/music\/artist-cards\/(acd-[0-9a-f-]{36})(?:\/(claim))?$/);
    if (m) {
      if (req.method === 'GET' && !m[2]) { const c = await readCard(m[1], me); return c ? json(res, 200, { card: c }) : json(res, 404, { error: 'not_found' }); }
      if (req.method === 'PATCH' && !m[2]) return send(res, await updateCard(me, m[1], (await parseBody(req)) ?? {}));
      if (req.method === 'POST' && m[2] === 'claim') return send(res, await claim(me, m[1], (await parseBody(req)) ?? {}));
    }
    const w = path.match(/^\/api\/music\/artist-cards\/claims\/(clm-[0-9a-f-]{36})\/withdraw$/);
    if (req.method === 'POST' && w) return send(res, await withdrawClaim(me, w[1]));
    return json(res, 404, { error: 'not_found' });
  }

  if (req.method === 'GET' && path === '/api/admin/artist-cards/claims') return send(res, await adminClaims(me, { status: params.get('status') ?? 'pending' }));
  if (req.method === 'GET' && path === '/api/admin/artist-cards/duplicates') return send(res, await duplicates(me));
  const d = path.match(/^\/api\/admin\/artist-cards\/claims\/(clm-[0-9a-f-]{36})\/decide$/);
  if (req.method === 'POST' && d) { const b = (await parseBody(req)) ?? {}; return send(res, await decideClaim(me, d[1], { approve: b.approve === true, reason: b.reason })); }
  if (req.method === 'POST' && path === '/api/admin/artist-cards/merge') { const b = (await parseBody(req)) ?? {}; return send(res, await merge(me, b.from, b.into, b.reason)); }
  if (req.method === 'GET' && path === '/api/admin/artist-cards') return send(res, await adminList(me, Object.fromEntries(params)));
  const tr = path.match(/^\/api\/admin\/artist-cards\/([\w-]+)\/transfer$/);
  if (req.method === 'POST' && tr) { const b = (await parseBody(req)) ?? {}; return send(res, await transferOwner(me, tr[1], b.username, b.reason)); }
  const fa = path.match(/^\/api\/admin\/artist-cards\/(acd-[0-9a-f-]{36})\/foreign-agent$/);
  if (req.method === 'POST' && fa) { const b = (await parseBody(req)) ?? {}; return send(res, await setForeignAgent(me, fa[1], b.on === true, b.reason)); }
  const u = path.match(/^\/api\/admin\/artist-cards\/(acd-[0-9a-f-]{36})\/(unmerge|revoke-owner)$/);
  if (req.method === 'POST' && u) { const b = (await parseBody(req)) ?? {}; return send(res, u[2] === 'unmerge' ? await unmerge(me, u[1], b.reason) : await revokeOwner(me, u[1], b.reason)); }
  return json(res, 404, { error: 'not_found' });
};
