import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getOnboarding, actOnboarding } from './../onboarding.mjs';

/** Состояние знакомства с Sky: GET — прочитать, POST {action} — сменить. */
export const onboardingRoutes = async (req, res, url) => {
  if (url !== '/api/onboarding') return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  if (!rateLimit(`onb:${session.profileId}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  if (req.method === 'GET') return json(res, 200, await getOnboarding(session.profileId));
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const b = (await parseBody(req)) ?? {};
  const r = await actOnboarding(session.profileId, String(b.action ?? ''), b);
  return json(res, r.error ? 400 : 200, r);
};
