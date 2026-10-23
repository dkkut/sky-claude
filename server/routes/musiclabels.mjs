import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { hasPrime } from './../skyid.mjs';
import { can, isOwner } from './../admin.mjs';
import * as L from './../musiclabels.mjs';

const CODE = { not_found: 404, not_allowed: 403, self_review: 403, exists: 409, already_pending: 409, already_verified: 409, not_pending: 409, card_not_found: 404, label_not_found: 404, card_not_yours: 403, label_not_yours: 403 };
const send = (res, r) => (r.error ? json(res, CODE[r.error] ?? 400, r) : json(res, 200, r));

/** /api/music/labels|albums|rights* (люди с Prime, как вся Sky Music) и /api/admin/music-labels* (сотрудники `content`, владелец). */
export const musicLabelsRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  const admin = path.startsWith('/api/admin/music-labels') || path.startsWith('/api/admin/music-rights');
  if (!admin && !/^\/api\/music\/(labels|albums|rights)(\/|$)/.test(path)) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`mlbl:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const q = new URL(req.url, 'http://x').searchParams;
  const body = async () => (await parseBody(req)) ?? {};
  const m = req.method;

  if (admin) {
    if (!(await can(me, 'content')) && !(await isOwner(me))) return json(res, 403, { error: 'not_allowed' });
    if (m === 'GET' && path === '/api/admin/music-labels') return send(res, await L.adminOverview(me, { q: q.get('q') ?? undefined }));
    if (m === 'GET' && path === '/api/admin/music-rights') return send(res, await L.adminRightsList(me, { status: q.get('status') ?? 'pending' }));
    const d = path.match(/^\/api\/admin\/music-rights\/(rcl-[0-9a-f-]{36})\/decide$/);
    if (m === 'POST' && d) { const b = await body(); return send(res, await L.decideRights(me, d[1], { approve: b.approve === true, reason: b.reason })); }
    if (m === 'POST' && path === '/api/admin/music-rights/revoke') { const b = await body(); return send(res, await L.revokeRights(me, b.kind, b.subjectId, b.reason)); }
    return json(res, 404, { error: 'not_found' });
  }

  if (!(await hasPrime(me)) && !(await can(me, 'content')) && !(await isOwner(me))) return json(res, 403, { error: 'prime_required' });
  if (m !== 'GET' && !rateLimit(`mlbl:w:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });

  if (path === '/api/music/labels') {
    if (m === 'GET') return json(res, 200, await L.listLabels(me, { q: q.get('q') ?? undefined, mine: q.get('mine') === '1' }));
    if (m === 'POST') return send(res, await L.createLabel(me, await body()));
  }
  const l = path.match(/^\/api\/music\/labels\/(lbl-[0-9a-f-]{36})$/);
  if (l) { if (m === 'PATCH') return send(res, await L.updateLabel(me, l[1], await body())); if (m === 'DELETE') return send(res, await L.deleteLabel(me, l[1])); }

  if (path === '/api/music/albums') {
    if (m === 'GET') return json(res, 200, await L.listAlbums(me, { cardId: q.get('cardId') ?? undefined, labelId: q.get('labelId') ?? undefined, mine: q.get('mine') === '1' }));
    if (m === 'POST') return send(res, await L.createAlbum(me, await body()));
  }
  const a = path.match(/^\/api\/music\/albums\/(alb-[0-9a-f-]{36})(?:\/(tracks))?$/);
  if (a) {
    if (m === 'GET' && !a[2]) return send(res, await L.readAlbum(me, a[1]));
    if (m === 'PATCH' && !a[2]) return send(res, await L.updateAlbum(me, a[1], await body()));
    if (m === 'DELETE' && !a[2]) return send(res, await L.deleteAlbum(me, a[1]));
    if (m === 'POST' && a[2]) { const b = await body(); return send(res, await L.setTracks(me, a[1], b.trackIds, { remove: b.remove === true })); }
  }

  if (m === 'POST' && path === '/api/music/rights') return send(res, await L.submitRights(me, await body()));
  if (m === 'GET' && path === '/api/music/rights') return json(res, 200, await L.myRights(me, { kind: q.get('kind'), subjectId: q.get('subjectId') }));
  const w = path.match(/^\/api\/music\/rights\/(rcl-[0-9a-f-]{36})\/withdraw$/);
  if (m === 'POST' && w) return send(res, await L.withdrawRights(me, w[1]));
  return json(res, 404, { error: 'not_found' });
};
