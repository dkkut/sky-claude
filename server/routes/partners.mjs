import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import { publicList, logoOf, adminList, adminLog, save, setLogo, transition, CATEGORIES } from './../partners.mjs';

const STATUS = { not_found: 404, bad_state: 409, self_approval: 403, not_allowed: 403, incomplete: 400, reason_required: 400, bad_field: 400, bad_logo: 400, logo_too_large: 413, archived: 409, bad_action: 400 };
const PURPOSE = 'partners_approve';
const APPROVER_ACTIONS = new Set(['approve', 'return', 'suspend', 'resume', 'archive']);
const STEP_UP_ACTIONS = new Set(['approve', 'suspend', 'resume', 'archive']);

/** Партнёры: люди видят подтверждённых (GET /api/partners, логотип); администрация — /api/admin/partners (права `partners`, `partners_approve`). */
export const partnersRoutes = async (req, res, url) => {
  const path = new URL(req.url, 'http://x').pathname;
  const user = path === '/api/partners' || /^\/api\/partners\/ptn-[0-9a-f-]{36}\/logo$/.test(path);
  const admin = path.startsWith('/api/admin/partners');
  if (!user && !admin) return false;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;

  if (user) {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
    if (!rateLimit(`partners:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    if (path === '/api/partners') return json(res, 200, { categories: CATEGORIES, partners: await publicList() });
    const id = path.split('/')[3];
    const logo = await logoOf(id, { staff: await can(me, 'partners') });
    if (!logo) return json(res, 404, { error: 'not_found' });
    res.writeHead(200, { 'Content-Type': logo.type, 'Content-Length': logo.data.length, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    return res.end(logo.data);
  }

  if (!(await can(me, 'partners'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`partnersadm:${me}`, 90)) return json(res, 429, { error: 'too_many_requests' });
  const meta = requestMeta(req);
  const canApprove = await can(me, 'partners_approve');
  if (req.method === 'GET' && path === '/api/admin/partners') return json(res, 200, { categories: CATEGORIES, canApprove, partners: await adminList() });
  let m = /^\/api\/admin\/partners\/(ptn-[0-9a-f-]{36})\/log$/.exec(path);
  if (req.method === 'GET' && m) return json(res, 200, { log: await adminLog(m[1]) });
  if (req.method === 'POST' && path === '/api/admin/partners/step-up') {
    if (!canApprove) return json(res, 403, { error: 'not_allowed' });
    const r = await beginStepUp(me, PURPOSE, { meta });
    return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'POST' && path === '/api/admin/partners') return reply(await save(me, (await parseBody(req)) ?? {}));
  if (req.method === 'PUT' && (m = /^\/api\/admin\/partners\/(ptn-[0-9a-f-]{36})$/.exec(path))) return reply(await save(me, (await parseBody(req)) ?? {}, m[1]));
  if (req.method === 'PUT' && (m = /^\/api\/admin\/partners\/(ptn-[0-9a-f-]{36})\/logo$/.exec(path))) return reply(await setLogo(me, m[1], (await parseBody(req))?.dataUrl));
  if (req.method === 'POST' && (m = /^\/api\/admin\/partners\/(ptn-[0-9a-f-]{36})\/(submit|approve|return|suspend|resume|archive)$/.exec(path))) {
    const action = m[2]; const b = (await parseBody(req)) ?? {};
    if (APPROVER_ACTIONS.has(action) && !canApprove) return json(res, 403, { error: 'not_allowed' });
    if (STEP_UP_ACTIONS.has(action)) {
      const st = await consumeStepUp(me, PURPOSE, b.stepUpCode, { meta });
      if (st.error) return json(res, st.error === 'step_up_exhausted' ? 429 : 401, st);
    }
    return reply(await transition(me, m[1], action, { reason: b.reason, canApprove, owner: await isOwner(me) }));
  }
  return json(res, 404, { error: 'not_found' });
};
