import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as H from './../handoff.mjs';

const MULT = Math.max(1, Number(process.env.HANDOFF_RATE_MULT) || 1);
const STATUS = {
  not_found: 404, unknown_device: 403, device_not_approved: 403, device_revoked: 403, recipient_not_trusted: 409, same_device: 400, other_profile: 409,
  device_offline: 409, handoff_disabled: 403, expired: 410, bad_state: 409, bad_kind: 400, bad_item: 400, bad_idem: 400, no_device: 400,
};

/**
 * /api/handoff/* — «Продолжить на другом устройстве». Только вошедший профиль; устройство — заголовок X-Sky-Device, подтверждённое в реестре Sky Transfer.
 * Место остановки и доступ к материалу решает сервер (те же проверки, что у самих плееров).
 */
export const handoffRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/handoff')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const { skyId, profileId } = s;
  const m = req.method;
  const reply = (r, ok = 200) => json(res, r.error ? (STATUS[r.error] ?? 400) : ok, r);
  if (!rateLimit(`ho:api:${profileId}`, 240)) return json(res, 429, { error: 'rate_limited' });
  const rest = path.slice('/api/handoff'.length);
  const b = (m === 'GET' || m === 'DELETE') ? {} : ((await parseBody(req).catch(() => ({}))) ?? {});

  if (m === 'POST' && rest === '/device/register') return reply(await H.registerThisDevice(skyId, profileId, req, b, !!s.via));
  if (m === 'POST' && rest === '/device/heartbeat') return reply(await H.beat(skyId, profileId, req));
  if (m === 'GET' && rest === '/devices') return reply(await H.devices(skyId, profileId, req));
  if (m === 'POST' && rest === '/send') {
    if (!rateLimit(`ho:send:${profileId}`, 20 * MULT)) return json(res, 429, { error: 'rate_limited' });
    return reply(await H.send(skyId, profileId, req, b), 201);
  }
  if (m === 'GET' && rest === '/pending') return reply(await H.pendingFor(skyId, profileId, req));
  if (m === 'GET' && rest === '/history') return reply(await H.history(skyId, profileId));
  if (m === 'DELETE' && rest === '/history') return reply(await H.clearHistory(skyId, profileId));
  if (m === 'GET' && rest === '/continue') return reply(await H.continueList(profileId));
  if (rest === '/prefs') {
    if (m === 'GET') return json(res, 200, await H.getPrefs(skyId));
    if (m === 'PUT') return reply(await H.setPrefs(skyId, b));
  }
  /* Место в Sky Video: у видео прогресса раньше не было. */
  let x = /^\/video-progress\/([\w.:-]{1,80})$/.exec(rest);
  if (x) {
    if (m === 'GET') return json(res, 200, { progress: await H.getVideoProgress(profileId, x[1]) });
    if (m === 'PUT') { if (!rateLimit(`ho:vp:${profileId}`, 120)) return json(res, 429, { error: 'rate_limited' }); return reply(await H.setVideoProgress(profileId, x[1], b)); }
  }
  x = /^\/(ho-[0-9a-f-]{36})(?:\/(accept|decline|cancel))?$/.exec(rest);
  if (x) {
    if (m === 'GET' && !x[2]) return reply(await H.status(skyId, profileId, req, x[1]));
    if (m === 'POST' && x[2] === 'accept') return reply(await H.accept(skyId, profileId, req, x[1]));
    if (m === 'POST' && x[2] === 'decline') return reply(await H.decline(skyId, profileId, req, x[1]));
    if (m === 'POST' && x[2] === 'cancel') return reply(await H.cancel(skyId, profileId, req, x[1]));
  }
  return json(res, 404, { error: 'not_found' });
};
