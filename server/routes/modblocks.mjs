import { json, requireProfile, parseBody } from './../http.mjs';
import { requestMeta } from './../adminsec.mjs';
import { rateLimit } from './../security.mjs';
import * as mb from './../modblocks.mjs';

const ERR = { bad_value: 400, not_allowed: 403, reason_required: 400, user_not_found: 404, self_block: 400, owner_protected: 403, not_found: 404,
  not_blocked: 403, details_required: 400, bad_details: 400, no_balance: 409, bad_amount: 400, already_open: 409, bad_state: 409, bad_action: 400, self_review: 403, insufficient_funds: 409 };

export const modBlockRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/module-blocks') && !url.startsWith('/api/admin/withdrawals') && !url.startsWith('/api/me/module-blocks') && !url.startsWith('/api/withdraw')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  const out = (r, ok = 200) => json(res, r.error ? (ERR[r.error] ?? 400) : ok, r);

  if (req.method === 'GET' && path === '/api/me/module-blocks') {
    if (!rateLimit(`mblk:me:${me}`, 120)) return json(res, 429, { error: 'rate_limited' }), true;
    return json(res, 200, await mb.myBlocks(me)), true;
  }
  if (path === '/api/withdraw') {
    if (!rateLimit(`mblk:wd:${me}`, 10)) return json(res, 429, { error: 'rate_limited' }), true;
    if (req.method === 'POST') return out(await mb.createWithdraw(me, (await parseBody(req)) ?? {}), 201), true;
    if (req.method === 'DELETE') return out(await mb.cancelWithdraw(me)), true;
    return json(res, 405, { error: 'method' }), true;
  }
  if (path === '/api/admin/module-blocks') {
    if (req.method === 'GET') return out(await mb.adminList(me, u.searchParams.get('q') ?? '')), true;
    if (req.method === 'POST') return out(await mb.adminBlock(me, (await parseBody(req)) ?? {}, requestMeta(req))), true;
    if (req.method === 'DELETE') return out(await mb.adminUnblock(me, u.searchParams.get('profileId'), u.searchParams.get('module') ?? '', requestMeta(req))), true;
    return json(res, 405, { error: 'method' }), true;
  }
  if (req.method === 'GET' && path === '/api/admin/withdrawals') return out(await mb.adminWithdrawals(me, u.searchParams.get('status') ?? 'pending')), true;
  const m = /^\/api\/admin\/withdrawals\/(wdr-[0-9a-f-]+)\/(paid|reject)$/.exec(path);
  if (req.method === 'POST' && m) { const b = (await parseBody(req)) ?? {}; return out(await mb.decideWithdraw(me, m[1], m[2], b.reason, requestMeta(req))), true; }
  return json(res, 404, { error: 'not_found' }), true;
};
