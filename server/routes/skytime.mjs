import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { listCapsules, createCapsule, cancelCapsule, getBalance, saveBalance, addUsage, clearUsage, usageReport, thisDay } from './../skytime.mjs';

const STATUS = { not_found: 404, limit_reached: 409, daily_limit: 429, locked: 409, not_sealed: 409, not_friend: 403 };

/**
 * /api/time/* — Sky Time (капсулы времени, Sky Balance, «В этот день»). Все ручки только для вошедшего профиля;
 * владелец данных — профиль из сессии, тело запроса его подменить не может.
 */
export const skyTimeRoutes = async (req, res, url) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  if (!path.startsWith('/api/time/')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const m = req.method;
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  if (!rateLimit(`time:${me}`, 120)) return json(res, 429, { error: 'rate_limited' });
  const rest = path.slice('/api/time/'.length);
  if (m === 'GET' && rest === 'capsules') return json(res, 200, await listCapsules(me));
  if (m === 'POST' && rest === 'capsules') { if (!rateLimit(`time:cap:${me}`, 10)) return json(res, 429, { error: 'rate_limited' }); return reply(await createCapsule(me, await body())); }
  let x;
  if (m === 'POST' && (x = /^capsules\/(cap-[0-9a-f-]{36})\/cancel$/.exec(rest))) return reply(await cancelCapsule(me, x[1]));
  if (m === 'GET' && rest === 'balance') return json(res, 200, await getBalance(me));
  if (m === 'PUT' && rest === 'balance') return reply(await saveBalance(me, await body()));
  if (m === 'POST' && rest === 'usage') { if (!rateLimit(`time:use:${me}`, 12)) return json(res, 429, { error: 'rate_limited' }); return reply(await addUsage(me, (await body()).entries)); }
  if (m === 'DELETE' && rest === 'usage') return reply(await clearUsage(me));
  if (m === 'GET' && rest === 'report') return json(res, 200, await usageReport(me, u.searchParams.get('days')));
  if (m === 'GET' && rest === 'today') return json(res, 200, await thisDay(me, u.searchParams.get('date')));
  return json(res, 404, { error: 'not_found' });
};
