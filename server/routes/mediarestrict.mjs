import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import * as M from './../mediarestrict.mjs';

const STATUS = { not_found: 404, bad_scope: 400, bad_direction: 400, basis_required: 400, reason_required: 400, self_review: 403, owner_protected: 403, already_active: 409, not_active: 409,
  too_short: 400, appeal_limit: 429, appeal_open: 409 };
const PURPOSE = 'media_restrict';

/** Ограничения Sky Media: автору и людям — /api/media-restrictions*; сотрудникам (право `media_restrict`, действия с кодом) — /api/admin/media-restrictions*. */
export const mediaRestrictRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  const user = path.startsWith('/api/media-restrictions'); const admin = path.startsWith('/api/admin/media-restrictions');
  if (!user && !admin) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const b = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});
  let m;
  if (user) {
    if (!rateLimit(`mr:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && path === '/api/media-restrictions/status') return reply(await M.statusOf(u.searchParams.get('direction'), u.searchParams.get('id'), u.searchParams.get('kind') ?? 'work'));
    if (req.method === 'GET' && path === '/api/media-restrictions/mine') return json(res, 200, { restrictions: await M.mine(me) });
    if (req.method === 'POST' && (m = /^\/api\/media-restrictions\/(\d+)\/appeal$/.exec(path))) return reply(await M.appeal(me, m[1], b.body));
    return json(res, 404, { error: 'not_found' });
  }
  if (!rateLimit(`mradm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const owner = await isOwner(me);
  if (!owner && !(await can(me, 'media_restrict'))) return json(res, 403, { error: 'not_allowed' });
  const meta = requestMeta(req);
  const step = async () => { const st = await consumeStepUp(me, PURPOSE, b.stepUpCode, { meta }); if (st.error) { json(res, st.error === 'step_up_exhausted' ? 429 : 401, st); return false; } return true; };
  if (req.method === 'GET' && path === '/api/admin/media-restrictions') return json(res, 200, { restrictions: await M.adminList({ status: u.searchParams.get('status') ?? 'active', direction: u.searchParams.get('direction') ?? '', q: u.searchParams.get('q') ?? '' }) });
  if (req.method === 'GET' && path === '/api/admin/media-restrictions/appeals') return json(res, 200, { appeals: await M.appealsQueue() });
  if (req.method === 'GET' && (m = /^\/api\/admin\/media-restrictions\/(\d+)\/history$/.exec(path))) return json(res, 200, { log: await M.history(m[1]) });
  if (req.method === 'POST' && path === '/api/admin/media-restrictions/step-up') { const r = await beginStepUp(me, PURPOSE, { meta }); return json(res, r.error ? 400 : 200, r); }
  if (req.method === 'POST' && path === '/api/admin/media-restrictions') { if (!(await step())) return true; return reply(await M.create(me, b)); }
  if (req.method === 'POST' && (m = /^\/api\/admin\/media-restrictions\/(\d+)\/lift$/.exec(path))) { if (!(await step())) return true; return reply(await M.lift(me, m[1], b.reason)); }
  if (req.method === 'POST' && (m = /^\/api\/admin\/media-restrictions\/appeals\/(\d+)\/decide$/.exec(path))) { if (!(await step())) return true; return reply(await M.decideAppeal(me, m[1], b.accept === true, b.note)); }
  return json(res, 404, { error: 'not_found' });
};
