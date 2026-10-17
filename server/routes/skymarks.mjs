import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestVerification, withdraw, mine, marksFor, adminQueue, adminDetail, decide, revoke, grantOfficial, saveSettings, getSettings, stats } from './../skymarks.mjs';

const CODE = { not_allowed: 403, not_owner: 403, owner_only: 403, self_review: 403, not_found: 404, already_pending: 409, already_verified: 409, not_pending: 409, not_approved: 409, retry_later: 429 };
const send = (res, r) => (r.error ? json(res, CODE[r.error] ?? 400, r) : json(res, 200, r));

/** Верификация: людям — свои заявки и публичные отметки; сотрудникам (право `verification`) — очередь, решения, настройки. */
export const verificationRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/verification') && !path.startsWith('/api/admin/verification')) return false;
  const s = await requireProfile(req, res);
  if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`ver:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const params = new URL(req.url, 'http://x').searchParams;

  if (req.method === 'GET' && path === '/api/verification/marks') {
    const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
    return json(res, 200, { marks: await marksFor(params.get('type') ?? '', ids) });
  }
  if (req.method === 'GET' && path === '/api/verification/mine') return json(res, 200, await mine(me));
  if (req.method === 'POST' && path === '/api/verification/request') {
    if (!rateLimit(`ver:req:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    return send(res, await requestVerification(me, (await parseBody(req)) ?? {}));
  }
  const wd = path.match(/^\/api\/verification\/([^/]+)\/withdraw$/);
  if (req.method === 'POST' && wd) return send(res, await withdraw(me, wd[1]));

  /* ── сотрудники ── */
  if (req.method === 'GET' && path === '/api/admin/verification') {
    const r = await adminQueue(me, { status: params.get('status') ?? 'pending', type: params.get('type') ?? undefined });
    if (r.error) return send(res, r);
    return json(res, 200, { ...r, stats: await stats(me), settings: await getSettings() });
  }
  const det = path.match(/^\/api\/admin\/verification\/(ver-[0-9a-f-]{36})$/);
  if (req.method === 'GET' && det) return send(res, await adminDetail(me, det[1]));
  const act = path.match(/^\/api\/admin\/verification\/(ver-[0-9a-f-]{36})\/(decide|revoke)$/);
  if (req.method === 'POST' && act) {
    const b = (await parseBody(req)) ?? {};
    return send(res, act[2] === 'decide' ? await decide(me, act[1], { approve: b.approve === true, reason: b.reason }) : await revoke(me, act[1], b.reason));
  }
  if (req.method === 'POST' && path === '/api/admin/verification/official') return send(res, await grantOfficial(me, (await parseBody(req)) ?? {}));
  if ((req.method === 'PUT' || req.method === 'POST') && path === '/api/admin/verification/settings') return send(res, await saveSettings(me, (await parseBody(req)) ?? {}));
  return json(res, 404, { error: 'not_found' });
};
