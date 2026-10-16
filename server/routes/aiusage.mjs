import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import { overview, saveSettings } from './../aiusage.mjs';

/** «AI — ресурсы и токены»: просмотр — право `analytics`; изменение лимитов и блокировки — только владелец с подтверждением личности. */
export const aiUsageRoutes = async (req, res, url) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (!path.startsWith('/api/admin/ai-usage')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!(await can(me, 'analytics'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`aiusage:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const meta = requestMeta(req);
  if (req.method === 'GET' && path === '/api/admin/ai-usage') {
    return json(res, 200, { ...(await overview(new URL(req.url, 'http://x').searchParams.get('days') ?? 30)), canEdit: await isOwner(me) });
  }
  if (!(await isOwner(me))) return json(res, 403, { error: 'owner_only' });
  if (req.method === 'POST' && path === '/api/admin/ai-usage/step-up') {
    const r = await beginStepUp(me, 'ai_budget', { meta });
    return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'PUT' && path === '/api/admin/ai-usage/settings') {
    const b = (await parseBody(req)) ?? {};
    const st = await consumeStepUp(me, 'ai_budget', b.stepUpCode, { meta });
    if (st.error) return json(res, st.error === 'step_up_exhausted' ? 429 : 401, st);
    const r = await saveSettings(me, b.settings);
    return json(res, r.error ? 400 : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
