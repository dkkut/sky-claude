/** Мониторинг и аналитика (право 'analytics'). Только чтение. */
import { json, requireProfile } from './../http.mjs';
import { can } from './../admin.mjs';
import { rateLimit } from './../security.mjs';
import { overview, live } from './../analytics.mjs';
import { systemHealth } from './../systemhealth.mjs';

export const analyticsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/analytics')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!(await can(me, 'analytics'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`an:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  if (req.method === 'GET' && path === '/api/admin/analytics/overview') return json(res, 200, await overview(params.get('days')));
  if (req.method === 'GET' && path === '/api/admin/analytics/live') return json(res, 200, await live());
  if (req.method === 'GET' && path === '/api/admin/analytics/systems') {
    if (!rateLimit(`an:sys:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, await systemHealth(me));
  }
  return json(res, 404, { error: 'not_found' });
};
