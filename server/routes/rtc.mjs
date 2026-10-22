import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { iceConfig } from './../rtc.mjs';

/** Настройки STUN/TURN для WebRTC (только вошедшему, учётные данные TURN временные). */
export const rtcRoutes = async (req, res, url) => {
  if (url !== '/api/rtc/config') return false;
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  const session = await requireProfile(req, res);
  if (!session) return true;
  if (!rateLimit(`rtc:${session.profileId}`, 30)) return json(res, 429, { error: 'too_many_requests' });
  res.setHeader('Cache-Control', 'no-store');
  return json(res, 200, iceConfig(session.profileId));
};
