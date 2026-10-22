import { json, requireSkyId, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { listKeys, beginRegister, finishRegister, updateKey, setFrozen, deleteKey } from './../passkeys.mjs';

const STATUS = { not_found: 404, too_many_attempts: 429, challenge_expired: 410, two_factor_required_setup: 409, too_many_keys: 409, invalid_code: 401 };

/** /api/skyid/passkeys — список и управление ключами доступа (нужна сессия Sky ID). */
export const passkeyRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/skyid/passkeys')) return false;
  const s = await requireSkyId(req, res); if (!s) return true;
  if (!rateLimit(`passkeys:${s.skyId}`, 40)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  if (req.method === 'GET' && path === '/api/skyid/passkeys') return json(res, 200, await listKeys(s.skyId));
  const b = (await parseBody(req).catch(() => ({}))) ?? {};
  if (req.method === 'POST' && path === '/api/skyid/passkeys/register/begin') return reply(await beginRegister(s.skyId, b));
  if (req.method === 'POST' && path === '/api/skyid/passkeys/register/finish') return reply(await finishRegister(s.skyId, b));
  const m = /^\/api\/skyid\/passkeys\/([\w-]+)(?:\/(freeze|unfreeze))?$/.exec(path);
  if (m) {
    if (req.method === 'PATCH' && !m[2]) return reply(await updateKey(s.skyId, m[1], b));
    if (req.method === 'POST' && m[2]) return reply(await setFrozen(s.skyId, m[1], m[2] === 'freeze', b.twoFactorCode));
    if (req.method === 'DELETE' && !m[2]) return reply(await deleteKey(s.skyId, m[1], b.twoFactorCode));
  }
  return json(res, 404, { error: 'not_found' });
};
