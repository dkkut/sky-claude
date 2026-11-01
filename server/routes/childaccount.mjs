import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as ch from './../childaccount.mjs';

const ERR = { bad_pin: 400, bad_birth_year: 400, not_found: 404, self_child: 400, already_child: 409, child_session: 403, profile_limit_reached: 409,
  invalid_name: 400, invalid_username: 400, username_taken: 409 };

export const childAccountRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/skyid/child')) return false;
  const s = await requireProfile(req, res);
  if (!s) return true;
  const path = new URL(req.url, 'http://x').pathname;
  const out = (r, ok = 200) => json(res, r.error ? (ERR[r.error] ?? 400) : ok, r);

  // Свой статус: можно читать из любого профиля (клиент показывает, что закрыто).
  if (req.method === 'GET' && path === '/api/skyid/child/me') return json(res, 200, await ch.myChildState(s.profileId)), true;

  // Управление — только из не-детского профиля этого Sky ID.
  if (!rateLimit(`child:${s.profileId}`, 60)) return json(res, 429, { error: 'rate_limited' }), true;
  if (!(await ch.isGuardianSession(s.profileId))) return json(res, 403, { error: 'child_session' }), true;

  if (req.method === 'GET' && path === '/api/skyid/child') return json(res, 200, await ch.listChildren(s.skyId)), true;
  if (req.method === 'POST' && path === '/api/skyid/child') return out(await ch.createChild(s.skyId, s.profileId, (await parseBody(req)) ?? {}), 201), true;
  const m = /^\/api\/skyid\/child\/([\w.-]+)$/.exec(path);
  const bm = /^\/api\/skyid\/child\/([\w.-]+)\/blocked(?:\/([\w.-]+))?$/.exec(path);
  if (bm && req.method === 'GET' && !bm[2]) return out(await ch.blockedPeers(s.skyId, bm[1])), true;
  if (bm && req.method === 'DELETE' && bm[2]) return out(await ch.unblockPeer(s.skyId, bm[1], bm[2])), true;
  if (m && req.method === 'PUT') return out(await ch.updateChild(s.skyId, m[1], (await parseBody(req)) ?? {})), true;
  if (m && req.method === 'DELETE') return out(await ch.removeChild(s.skyId, m[1])), true;
  return json(res, 404, { error: 'not_found' }), true;
};
