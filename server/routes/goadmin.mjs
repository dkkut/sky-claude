import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as reg from './../goreg.mjs';
import * as adm from './../goadmin.mjs';

/** /api/admin/go/*: администрирование Sky GO (права go и go_finance проверяют модули). */
export const goAdminRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/go')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (!rateLimit(`go:adm:${me}`, 200)) return json(res, 429, { error: 'rate_limited' });
  const code = (r) => (r.error === 'not_allowed' ? 403 : r.error === 'not_found' ? 404 : r.error === 'bad_transition' || r.error === 'bad_state' ? 409 : 400);
  const reply = (r) => (r.error ? json(res, code(r), r) : json(res, 200, r));
  let m;

  if (req.method === 'GET' && path === '/api/admin/go/overview') return reply(await adm.overview(me));
  if (req.method === 'GET' && path === '/api/admin/go/applications') return reply(await reg.adminQueue(me, { status: u.searchParams.get('status'), role: u.searchParams.get('role') }));
  if ((m = path.match(/^\/api\/admin\/go\/applications\/([\w-]+)$/)) && req.method === 'GET') return reply(await reg.adminDetail(me, m[1]));
  if ((m = path.match(/^\/api\/admin\/go\/applications\/([\w-]+)\/decide$/)) && req.method === 'POST') { const b = await parseBody(req); return reply(await reg.adminDecide(me, m[1], String(b?.action ?? ''), b?.note)); }
  if ((m = path.match(/^\/api\/admin\/go\/docs\/([\w-]+)$/)) && req.method === 'GET') {
    const r = await reg.adminDocBytes(me, m[1]);
    if (r.error) return json(res, code(r), r);
    res.writeHead(200, { 'Content-Type': r.mime, 'Content-Length': r.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.end(r.bytes);
    return true;
  }
  if (req.method === 'GET' && path === '/api/admin/go/settings') return reply(await adm.getSettings(me));
  if ((m = path.match(/^\/api\/admin\/go\/settings\/([a-z_]+)$/)) && req.method === 'PUT') return reply(await adm.putSetting(me, m[1], (await parseBody(req))?.value));
  if ((m = path.match(/^\/api\/admin\/go\/tariffs\/([a-z_]+)$/)) && req.method === 'PUT') return reply(await adm.putTariff(me, m[1], await parseBody(req)));
  if (req.method === 'PUT' && path === '/api/admin/go/role-tariff') { const b = await parseBody(req); return reply(await adm.putRoleTariff(me, String(b?.role ?? ''), String(b?.code ?? ''))); }
  if (req.method === 'GET' && path === '/api/admin/go/executor-tariffs') return reply(await adm.listExecutorTariffs(me));
  if (req.method === 'PUT' && path === '/api/admin/go/executor-tariffs') return reply(await adm.putExecutorTariff(me, await parseBody(req)));
  if (req.method === 'GET' && path === '/api/admin/go/subscriptions') return reply(await adm.listSubscriptions(me, { q: u.searchParams.get('q') }));
  if (req.method === 'GET' && path === '/api/admin/go/orders') return reply(await adm.listOrders(me, { kind: u.searchParams.get('kind'), status: u.searchParams.get('status'), q: u.searchParams.get('q') }));
  if ((m = path.match(/^\/api\/admin\/go\/orders\/([\w-]+)$/)) && req.method === 'GET') return reply(await adm.orderDetail(me, m[1]));
  if ((m = path.match(/^\/api\/admin\/go\/orders\/([\w-]+)\/resolve$/)) && req.method === 'POST') { const b = await parseBody(req); return reply(await adm.adminResolve(me, m[1], String(b?.outcome ?? ''), b?.note)); }
  if (req.method === 'GET' && path === '/api/admin/go/integrations') return reply(await adm.integrations(me));
  return json(res, 404, { error: 'not_found' });
};
