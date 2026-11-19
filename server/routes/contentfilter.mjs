import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { getAdminView, saveSettings, testText, listHolds, decideHold } from './../contentfilterstore.mjs';

const STATUS = { not_allowed: 403, not_found: 404, reason_required: 400, self_review: 403 };

/** /api/admin/content-filter* — настройки, проверка текста, очередь удержаний (право content). */
export const contentFilterRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const path = u.pathname;
  if (!path.startsWith('/api/admin/content-filter')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const m = req.method;
  if (!rateLimit(`cf:${me}`, 120)) return json(res, 429, { error: 'rate_limited' });
  const reply = (r) => json(res, r?.error ? (STATUS[r.error] ?? 400) : 200, r ?? { error: 'not_allowed' });
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  const rest = path.slice('/api/admin/content-filter'.length);

  if (m === 'GET' && rest === '') { const r = await getAdminView(me); return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' }); }
  if (m === 'PUT' && rest === '') return reply(await saveSettings(me, await body(), requestMeta(req)));
  if (m === 'POST' && rest === '/test') return reply(await testText(me, (await body()).text));
  if (m === 'GET' && rest === '/holds') { const r = await listHolds(me, u.searchParams.get('status') ?? 'pending'); return r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' }); }
  let x;
  if (m === 'POST' && (x = /^\/holds\/(cfh-[A-Za-z0-9_-]{6,64})\/(approve|reject)$/.exec(rest))) {
    const b = await body();
    return reply(await decideHold(me, x[1], x[2] === 'approve', b.reason, requestMeta(req)));
  }
  return json(res, 404, { error: 'not_found' });
};
