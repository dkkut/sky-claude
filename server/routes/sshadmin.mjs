/**
 * Админка доступа по SSH: журнал запросов (право security) и рубильник новых входов (только владелец + подтверждение личности).
 * Сам вход по SSH подтверждается ссылкой из письма — server/sshgate.mjs. Рубильник закрывает НОВЫЕ входы и не обрывает уже открытые сессии.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import { sshState, setSshPaused, listSshRequests, sshGateEnabled } from './../sshgate.mjs';

export const sshAdminRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/ssh')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!(await can(me, 'security'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`sshadm:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const path = new URL(req.url, 'http://x').pathname;
  const meta = requestMeta(req);

  if (req.method === 'GET' && path === '/api/admin/ssh') {
    return json(res, 200, { enabled: sshGateEnabled(), state: await sshState(), requests: await listSshRequests(100) });
  }
  const owner = await isOwner(me);
  if (req.method === 'POST' && path === '/api/admin/ssh/step-up') {
    if (!owner) return json(res, 403, { error: 'owner_only' });
    const r = await beginStepUp(me, 'ssh_gate', { meta });
    return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'POST' && (path === '/api/admin/ssh/pause' || path === '/api/admin/ssh/resume')) {
    if (!owner) return json(res, 403, { error: 'owner_only' });
    const b = (await parseBody(req)) ?? {};
    const s = await consumeStepUp(me, 'ssh_gate', b.stepUpCode, { meta });
    if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
    const r = await setSshPaused(me, path.endsWith('/pause'), b.reason);
    return json(res, r.error ? 400 : 200, r);
  }
  return json(res, 404, { error: 'not_found' });
};
