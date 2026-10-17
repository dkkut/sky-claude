import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { requestMeta } from './../adminsec.mjs';
import { adminList, adminCard, suspend, resume } from './../kbadmin.mjs';

const STATUS = { not_found: 404, reason_required: 400, bad_state: 409 };
/** /api/admin/kbiz/* — право `kassa_biz`. */
export const kbizAdminRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  if (!path.startsWith('/api/admin/kbiz')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  if (!(await can(s.profileId, 'kassa_biz'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`kbadm:${s.profileId}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  if (req.method === 'GET' && path === '/api/admin/kbiz') return json(res, 200, await adminList({ q: u.searchParams.get('q') ?? '', status: u.searchParams.get('status') ?? '' }));
  const m = /^\/api\/admin\/kbiz\/(kbz-[0-9a-f-]{36})(?:\/(suspend|resume))?$/.exec(path);
  if (m && req.method === 'GET' && !m[2]) return reply(await adminCard(m[1]));
  if (m && req.method === 'POST' && m[2]) { const b = (await parseBody(req)) ?? {}; return reply(await (m[2] === 'suspend' ? suspend : resume)(s.profileId, m[1], b.reason, requestMeta(req))); }
  return json(res, 404, { error: 'not_found' });
};
