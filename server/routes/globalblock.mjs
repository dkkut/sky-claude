import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import * as G from './../globalblock.mjs';

const status = (e) => (e === 'not_allowed' || e === 'owner_protected' || e === 'self_review' ? 403 : e === 'not_found' ? 404 : e === 'failed' ? 500 : 400);
const reply = (res, r) => (r?.error ? json(res, status(r.error), r) : json(res, 200, r));

/** Человек без входа: статус блокировки и обжалование по подписанному токену (выдаётся в ответе об отказе). */
const publicRoutes = async (req, res, url) => {
  if (url !== '/api/blocked/status' && url !== '/api/blocked/appeal') return false;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const ip = clientIp(req);
  if (!rateLimit(`gblock:pub:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });
  const b = (await parseBody(req)) ?? {};
  if (url === '/api/blocked/status') return reply(res, await G.appealInfo(b.token));
  if (!rateLimit(`gblock:appeal:${ip}`, 6)) return json(res, 429, { error: 'too_many_requests' });
  return reply(res, await G.submitAppeal(b.token, b));
};

/** Админка (право `global_block`; действия — с кодом подтверждения личности). */
export const globalBlockRoutes = async (req, res, url) => {
  if (url.startsWith('/api/blocked/')) return publicRoutes(req, res, url);
  if (!url.startsWith('/api/admin/global-blocks')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`adm:gblock:${me}`, 90)) return json(res, 429, { error: 'too_many_requests' });
  const u = new URL(req.url, 'http://x'); const path = u.pathname; const meta = requestMeta(req);
  let m;
  const denyNull = (r) => (r ? json(res, 200, r) : json(res, 403, { error: 'not_allowed' }));

  if (path === '/api/admin/global-blocks' && req.method === 'GET') return denyNull(await G.listBlocks(me, { status: u.searchParams.get('status') || 'active', q: u.searchParams.get('q') || '' }));
  if (path === '/api/admin/global-blocks' && req.method === 'POST') return reply(res, await G.createBlock(me, (await parseBody(req)) ?? {}, meta));
  if (path === '/api/admin/global-blocks/step-up' && req.method === 'POST') return reply(res, await G.stepUp(me, meta));
  if (path === '/api/admin/global-blocks/appeals' && req.method === 'GET') return denyNull(await G.listAppeals(me, u.searchParams.get('status') || 'pending'));
  if ((m = path.match(/^\/api\/admin\/global-blocks\/appeals\/([a-z0-9-]{6,40})\/decide$/)) && req.method === 'POST') return reply(res, await G.decideAppeal(me, m[1], (await parseBody(req)) ?? {}, meta));
  if ((m = path.match(/^\/api\/admin\/global-blocks\/([a-z0-9-]{6,40})\/revoke$/)) && req.method === 'POST') return reply(res, await G.revokeBlock(me, m[1], (await parseBody(req)) ?? {}, meta));
  if ((m = path.match(/^\/api\/admin\/global-blocks\/([a-z0-9-]{6,40})$/)) && req.method === 'GET') { const r = await G.blockDetail(me, m[1]); return r ? reply(res, r) : json(res, 403, { error: 'not_allowed' }); }
  return json(res, 404, { error: 'not_found' });
};
