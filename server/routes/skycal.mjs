import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { range, createEvent, updateEvent, deleteEvent, guests, invite, respond, pendingInvites } from './../skycal.mjs';

const STATUS = { not_found: 404, limit_reached: 409, too_many: 409, not_friend: 403 };

/** /api/cal/* — Sky Календарь. Владелец данных — профиль из сессии. */
export const skyCalRoutes = async (req, res, url) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  if (!path.startsWith('/api/cal/')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const m = req.method;
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  if (!rateLimit(`cal:${me}`, 180)) return json(res, 429, { error: 'rate_limited' });
  const rest = path.slice('/api/cal/'.length);
  if (m === 'GET' && rest === 'range') return reply(await range(me, u.searchParams.get('from'), u.searchParams.get('to')));
  if (m === 'GET' && rest === 'invites') return json(res, 200, await pendingInvites(me));
  if (m === 'POST' && rest === 'events') { if (!rateLimit(`cal:new:${me}`, 30)) return json(res, 429, { error: 'rate_limited' }); return reply(await createEvent(me, await body())); }
  let x;
  if ((x = /^events\/(cal-[A-Za-z0-9_-]{6,64})$/.exec(rest))) {
    if (m === 'PUT') return reply(await updateEvent(me, x[1], await body()));
    if (m === 'DELETE') return reply(await deleteEvent(me, x[1]));
  }
  if ((x = /^events\/(cal-[A-Za-z0-9_-]{6,64})\/guests$/.exec(rest)) && m === 'GET') return reply(await guests(me, x[1]));
  if ((x = /^events\/(cal-[A-Za-z0-9_-]{6,64})\/invite$/.exec(rest)) && m === 'POST') { if (!rateLimit(`cal:inv:${me}`, 20)) return json(res, 429, { error: 'rate_limited' }); return reply(await invite(me, x[1], (await body()).ids)); }
  if ((x = /^events\/(cal-[A-Za-z0-9_-]{6,64})\/respond$/.exec(rest)) && m === 'POST') return reply(await respond(me, x[1], Boolean((await body()).accept)));
  return json(res, 404, { error: 'not_found' });
};
