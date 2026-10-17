import { json, parseBody, requireProfile, clientIp } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import { myCashback, loadSettings, saveSettings, cancelCashback, adminCashback } from './../primecashback.mjs';
import * as cbr from './../cashbackrules.mjs';
import { listForUser, redeem, adminList, adminSave, decideManual } from './../primerewards.mjs';

const STATUS = { not_found: 404, sold_out: 409, limit_reached: 409, tier_too_low: 403, insufficient_points: 402, idem_key_required: 400, bad_field: 400, not_pending: 409, reason_required: 400, rule_ended: 409, bad_tab: 400 };
const PURPOSE = 'prime_admin';

/** Кэшбэк и награды Sky Prime: человек (/api/prime/cashback, /api/prime/rewards*) и администрация (/api/admin/prime*, право `prime`, изменения — с подтверждением личности). */
export const primeRewardsRoutes = async (req, res, url) => {
  const path = new URL(req.url, 'http://x').pathname;
  const user = path === '/api/prime/cashback' || path === '/api/prime/cashback/visit' || path.startsWith('/api/prime/rewards');
  const admin = path.startsWith('/api/admin/prime');
  if (!user && !admin) return false;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? (r.error === 'not_allowed' ? 403 : 400) : 200, r);
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;

  if (user) {
    if (!rateLimit(`prime:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && path === '/api/prime/cashback') return json(res, 200, { ...(await myCashback(me)), adminRules: await cbr.publicRules(), grants: await cbr.myGrants(me) });
    if (req.method === 'POST' && path === '/api/prime/cashback/visit') {
      if (!rateLimitPerHour(`prime:visit:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
      const b = (await parseBody(req)) ?? {};
      return reply(await cbr.tabVisit(me, b.tab));
    }
    if (req.method === 'GET' && path === '/api/prime/rewards') return json(res, 200, await listForUser(me));
    if (req.method === 'POST' && path === '/api/prime/rewards/redeem') {
      if (!rateLimitPerHour(`prime:redeem:${me}`, 60) || !rateLimitPerHour(`prime:redeem:ip:${clientIp(req)}`, 200)) return json(res, 429, { error: 'too_many_requests' });
      const b = (await parseBody(req)) ?? {};
      return reply(await redeem(me, b.rewardId, b.idemKey));
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!(await can(me, 'prime'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`primeadm:${me}`, 90)) return json(res, 429, { error: 'too_many_requests' });
  const meta = requestMeta(req);
  if (req.method === 'GET' && path === '/api/admin/prime/cashback/rules') return json(res, 200, await cbr.adminList());
  if (req.method === 'GET' && path === '/api/admin/prime/cashback/grants') return json(res, 200, await cbr.adminGrants(new URL(req.url, 'http://x').searchParams.get('rule') ?? ''));
  if (req.method === 'GET' && path === '/api/admin/prime') {
    const u = new URL(req.url, 'http://x');
    return json(res, 200, { settings: await loadSettings(), ...(await adminList()), cashback: await adminCashback({ status: u.searchParams.get('status') ?? '' }) });
  }
  if (req.method === 'POST' && path === '/api/admin/prime/step-up') {
    const r = await beginStepUp(me, PURPOSE, { meta });
    return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'GET') return json(res, 404, { error: 'not_found' });
  // Все изменения — с подтверждением личности (одноразовый код)
  const b = (await parseBody(req)) ?? {};
  const step = await consumeStepUp(me, PURPOSE, b.stepUpCode, { meta });
  if (step.error) return json(res, step.error === 'step_up_exhausted' ? 429 : 401, step);
  let m;
  if (req.method === 'PUT' && path === '/api/admin/prime/cashback/settings') return reply(await saveSettings(me, b.settings));
  if (req.method === 'POST' && path === '/api/admin/prime/rewards') return reply(await adminSave(me, b));
  if (req.method === 'PUT' && (m = /^\/api\/admin\/prime\/rewards\/(rwd-[0-9a-f-]{36})$/.exec(path))) return reply(await adminSave(me, b, m[1]));
  if (req.method === 'POST' && (m = /^\/api\/admin\/prime\/redemptions\/(rdm-[0-9a-f-]{36})\/(approve|reject)$/.exec(path))) return reply(await decideManual(me, m[1], m[2] === 'approve', b.note));
  if (req.method === 'POST' && (m = /^\/api\/admin\/prime\/cashback\/(cbk-[0-9a-f-]{36})\/cancel$/.exec(path))) return reply(await cancelCashback(me, m[1], b.reason));
  if (req.method === 'POST' && path === '/api/admin/prime/cashback/rules') return reply(await cbr.adminSave(me, b));
  if (req.method === 'PUT' && (m = /^\/api\/admin\/prime\/cashback\/rules\/(cbr-[0-9a-f-]{36})$/.exec(path))) return reply(await cbr.adminSave(me, b, m[1]));
  if (req.method === 'POST' && (m = /^\/api\/admin\/prime\/cashback\/rules\/(cbr-[0-9a-f-]{36})\/status$/.exec(path))) return reply(await cbr.adminSetStatus(me, m[1], b.status));
  return json(res, 404, { error: 'not_found' });
};
