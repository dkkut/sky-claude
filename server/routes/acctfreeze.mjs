import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import * as F from './../acctfreeze.mjs';

const STATUS = { not_found: 404, not_allowed: 403, person_not_found: 404, chat_not_found: 404, already_frozen: 409, cannot_freeze_self: 403, owner_protected: 403, admin_target_owner_only: 403, bad_state: 409, self_review: 403,
  only_owner_can_appeal: 403, appeal_open: 409, too_many_appeals: 429, appeal_too_short: 400, reason_required: 400 };
const ID = 'afz-[0-9a-f-]{36}';

/** Человек: /api/skyid/freeze* (остаётся открытым при заморозке). Сотрудник с правом `account_freeze`: /api/admin/account-freeze*. */
export const acctFreezeRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  const user = path.startsWith('/api/skyid/freeze'); const admin = path.startsWith('/api/admin/account-freeze');
  if (!user && !admin) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; let m;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const body = async () => (await parseBody(req)) ?? {};

  if (admin) {
    if (!(await can(me, 'account_freeze'))) return json(res, 403, { error: 'not_allowed' });
    if (!rateLimit(`afz:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && path === '/api/admin/account-freeze') return json(res, 200, await F.adminList({ status: u.searchParams.get('status') ?? 'active' }));
    if (req.method === 'GET' && (m = new RegExp(`^/api/admin/account-freeze/(${ID})/log$`).exec(path))) return json(res, 200, { log: await F.adminLog(m[1]) });
    if (req.method === 'POST' && (path === '/api/admin/account-freeze' || path === '/api/admin/account-freeze/channel')) {
      if (!rateLimitPerHour(`afzmk:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });       // скомпрометированная учётная запись не заморозит всех разом
      const b = await body(); return reply(path.endsWith('/channel') ? await F.freezeChannel(me, b) : await F.freezeAccount(me, b));
    }
    if (req.method === 'POST' && (m = new RegExp(`^/api/admin/account-freeze/(${ID})/lift$`).exec(path))) return reply(await F.liftFreeze(me, m[1], (await body()).note));
    if (req.method === 'POST' && (m = /^\/api\/admin\/account-freeze\/appeals\/(afa-[0-9a-f-]{36})\/decide$/.exec(path))) { const b = await body(); return reply(await F.decideAppeal(me, m[1], b.outcome, b.note, { owner: await isOwner(me) })); }
    return json(res, 404, { error: 'not_found' });
  }

  if (!rateLimit(`afzu:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  if (req.method === 'GET' && path === '/api/skyid/freeze') return json(res, 200, await F.myStatus(me));
  if (req.method === 'POST' && path === '/api/skyid/freeze/appeal') {
    if (!rateLimitPerHour(`afza:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    const st = await F.myStatus(me); if (!st.frozen) return json(res, 404, { error: 'not_found' });
    return reply(await F.appeal(me, { freezeId: st.freeze.id, text: (await body()).text }));
  }
  if (req.method === 'GET' && (m = /^\/api\/skyid\/freeze\/channel\/([A-Za-z0-9~_-]{1,200})$/.exec(path))) return reply(await F.channelStatus(me, m[1]));
  if (req.method === 'POST' && (m = /^\/api\/skyid\/freeze\/channel\/([A-Za-z0-9~_-]{1,200})\/appeal$/.exec(path))) {
    if (!rateLimitPerHour(`afza:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    const st = await F.channelStatus(me, m[1]); if (st.error || !st.frozen) return json(res, 404, { error: 'not_found' });
    return reply(await F.appeal(me, { freezeId: st.freeze.id, text: (await body()).text }));
  }
  return json(res, 404, { error: 'not_found' });
};
