/** Bloom: мероприятия — /api/bloom/events*; снятие администрацией — /api/admin/bloom-events/:id/remove. Стоит ПЕРЕД bloomRoutes. */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as E from './../bloomevents.mjs';

const STATUS = { content_blocked: 422, not_found: 404, forbidden: 403, not_allowed: 403, banned: 403, bad_state: 409, event_full: 409, cancelled: 409, event_over: 409, capacity_below_going: 409, daily_limit: 429, too_many_events: 429 };
export const bloomEventsRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (!p.startsWith('/api/bloom/events') && !p.startsWith('/api/admin/bloom-events/')) return false;
  const s = await requireProfile(req, res); if (!s) return true; const me = s.profileId; let m;
  if (!rateLimit(`bev:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  if (req.method !== 'GET' && !rateLimit(`bevw:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  const get = req.method === 'GET'; const post = req.method === 'POST'; const put = req.method === 'PUT';
  try {
    if ((m = /^\/api\/admin\/bloom-events\/(bev-[0-9a-f-]{36})\/remove$/.exec(p)) && post) { const b = await body(); return reply(await E.adminRemove(me, m[1], b.reason)); }
    if (p === '/api/bloom/events') {
      if (get) return reply(await E.list(me, Object.fromEntries(u.searchParams)));
      if (post) return reply(await E.create(me, await body()));
    }
    if ((m = /^\/api\/bloom\/events\/(bev-[0-9a-f-]{36})(?:\/([a-z]+))?$/.exec(p))) {
      const [, id, act] = m;
      if (!act && get) return reply(await E.get(me, id));
      if (!act && put) return reply(await E.update(me, id, await body()));
      if (act === 'cancel' && post) { const b = await body(); return reply(await E.cancel(me, id, b.reason)); }
      if (act === 'rsvp' && post) { const b = await body(); return reply(await E.rsvp(me, id, b.status)); }
      if (act === 'attendees' && get) return reply(await E.attendees(me, id));
    }
  } catch (e) { console.error('[bloom-events]', e.message); return json(res, 500, { error: 'server_error' }); }
  return json(res, 404, { error: 'not_found' });
};
