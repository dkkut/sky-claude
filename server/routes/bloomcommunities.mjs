/** Bloom: сообщества — /api/bloom/communities*, /api/bloom/community-posts/*; администрация (право `bloom_communities`) — /api/admin/bloom-communities*. Стоит ПЕРЕД bloomRoutes (тот отвечает 404 на любой /api/bloom/…). */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { communityPosts } from './../bloom.mjs';
import * as C from './../bloomcommunities.mjs';

const STATUS = { not_found: 404, forbidden: 403, not_allowed: 403, banned: 403, slug_taken: 409, bad_state: 409, already_reported: 409, daily_limit: 429, too_many_communities: 429, too_many_pinned: 409 };
const KEY = '([a-z0-9_]{3,30}|bcm-[0-9a-f-]{36})';
export const bloomCommunitiesRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (!p.startsWith('/api/bloom/communities') && !p.startsWith('/api/bloom/community-posts/') && !p.startsWith('/api/admin/bloom-communities')) return false;
  const s = await requireProfile(req, res); if (!s) return true; const me = s.profileId; let m;
  if (!rateLimit(`bloomc:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  if (req.method !== 'GET' && !rateLimit(`bloomcw:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  const get = req.method === 'GET'; const post = req.method === 'POST'; const put = req.method === 'PUT'; const del = req.method === 'DELETE';
  try {
    if (p.startsWith('/api/admin/bloom-communities')) {
      if (get && p === '/api/admin/bloom-communities') return reply(await C.adminList(me, Object.fromEntries(u.searchParams)));
      if (post && (m = /^\/api\/admin\/bloom-communities\/(bcm-[0-9a-f-]{36})\/block$/.exec(p))) { const b = await body(); return reply(await C.adminBlock(me, m[1], b.block === true, b.reason)); }
      if (post && (m = /^\/api\/admin\/bloom-communities\/reports\/(bcr-[0-9a-f-]{36})$/.exec(p))) { const b = await body(); return reply(await C.adminReport(me, m[1], String(b.action ?? ''), b.note)); }
      return json(res, 404, { error: 'not_found' });
    }
    if ((m = /^\/api\/bloom\/community-posts\/(blp-[0-9a-f-]{36})\/(pin|remove)$/.exec(p)) && post) { const b = await body(); return reply(m[2] === 'pin' ? await C.pinPost(me, m[1], b.on === true) : await C.removePost(me, m[1], b.reason)); }
    if (p === '/api/bloom/communities') { if (get) return json(res, 200, await C.list(me, Object.fromEntries(u.searchParams))); if (post) return reply(await C.create(me, await body())); }
    if (get && p === '/api/bloom/communities/reasons') return json(res, 200, { reasons: C.REPORT_REASONS });
    if ((m = new RegExp(`^/api/bloom/communities/${KEY}$`).exec(p))) { if (get) return reply(await C.get(me, m[1])); if (put) return reply(await C.update(me, m[1], await body())); if (del) return reply(await C.remove(me, m[1])); }
    if ((m = new RegExp(`^/api/bloom/communities/${KEY}/([a-z]+)(?:/([^/]+))?$`).exec(p))) {
      const [, key, act, sub] = m;
      if (get && act === 'posts') { const c = await C.get(me, key); if (c.error) return reply(c); return json(res, 200, { posts: c.community.contentVisible ? await communityPosts(me, c.community.id) : [], contentVisible: c.community.contentVisible }); }
      if (get && act === 'members') return reply(await C.members(me, key));
      if (get && act === 'log') return reply(await C.modLog(me, key));
      if (post && act === 'join') return reply(await C.join(me, key));
      if (post && act === 'leave') return reply(await C.leave(me, key));
      if (post && act === 'report') { const b = await body(); return reply(await C.report(me, key, b.reason, b.text)); }
      if (post && act === 'members' && sub) { const b = await body(); return reply(await C.moderate(me, key, decodeURIComponent(sub), String(b.action ?? ''), b.reason)); }
    }
  } catch (e) { console.error('[bloom-communities]', e.message); return json(res, 500, { error: 'server_error' }); }
  return json(res, 404, { error: 'not_found' });
};
