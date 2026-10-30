/**
 * Файрвол в админке: GET /api/admin/firewall — состояние, нагрузка, блокировки, журнал (право `security`);
 * изменения — только владелец с кодом подтверждения личности (назначение `firewall`).
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta, logAdmin } from './../adminsec.mjs';
import * as fw from './../firewall.mjs';

export const firewallRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/firewall')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId;
  if (!(await can(me, 'security'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`fwadm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const meta = requestMeta(req);
  const owner = await isOwner(me);

  if (req.method === 'GET' && p === '/api/admin/firewall') {
    const [settings, events, bans] = await Promise.all([fw.getSettings(), fw.listEvents(60), fw.listBans()]);
    return json(res, 200, { state: fw.getState(), levels: fw.LEVELS, stats: fw.stats(), settings, events, bans, canEdit: owner, cloudflare: { configured: fw.cloudflareConfigured() } });
  }
  if (!owner) return json(res, 403, { error: 'owner_only' });
  if (req.method === 'POST' && p === '/api/admin/firewall/step-up') { const r = await beginStepUp(me, 'firewall', { meta }); return json(res, r.error ? 400 : 200, r); }
  const b = req.method === 'DELETE' ? {} : ((await parseBody(req)) ?? {});
  const needCode = async () => { const s = await consumeStepUp(me, 'firewall', b.stepUpCode, { meta }); if (s.error) { json(res, s.error === 'step_up_exhausted' ? 429 : 401, s); return true; } return false; };

  if (req.method === 'POST' && p === '/api/admin/firewall/level') {
    const lv = Number(b.level); if (!Number.isInteger(lv) || lv < 0 || lv > 4) return json(res, 400, { error: 'bad_level' });
    { const e = await needCode(); if (e) return true; }
    const r = await fw.setLevel(lv, { hours: Number(b.hours) || 0, reason: String(b.reason || 'вручную').slice(0, 150), by: me });
    await logAdmin({ actorId: me, type: 'firewall_level', targetType: 'system', detail: `уровень ${lv} «${r.name}»`, meta });
    return json(res, 200, { state: r });
  }
  if (req.method === 'PUT' && p === '/api/admin/firewall/settings') {
    { const e = await needCode(); if (e) return true; }
    const r = await fw.saveSettings(me, b.settings ?? {});
    if (!r.error) await logAdmin({ actorId: me, type: 'firewall_settings', targetType: 'system', detail: 'изменены настройки файрвола', meta });
    return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'POST' && p === '/api/admin/firewall/bans') {
    const ip = String(b.ip ?? '').trim(); if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return json(res, 400, { error: 'bad_ip' });
    { const e = await needCode(); if (e) return true; }
    const r = await fw.ban(ip, Number(b.hours) || 6, String(b.reason || 'вручную').slice(0, 100), true);
    if (!r.error) await logAdmin({ actorId: me, type: 'firewall_ban', targetType: 'system', detail: 'блокировка адреса вручную', meta });
    return json(res, r.error ? 400 : 200, r);
  }
  const m = p.match(/^\/api\/admin\/firewall\/bans\/([0-9a-f]{16,64})$/);
  if (req.method === 'DELETE' && m) {
    const code = u.searchParams.get('code');
    { const s = await consumeStepUp(me, 'firewall', code, { meta }); if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s); }
    const r = await fw.unban(m[1]); await logAdmin({ actorId: me, type: 'firewall_unban', targetType: 'system', detail: 'снята блокировка адреса', meta });
    return json(res, 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
