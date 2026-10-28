/**
 * Sky Ops.
 *  • Сотрудникам: /api/admin/ops/* — право `server_ops` (в «полные права» не входит). Изменяющие задания — ещё и код подтверждения.
 *  • Агенту на хосте: /api/ops/agent/* — подпись HMAC OPS_SECRET (время ±120 с + одноразовое значение + метод + путь + хеш тела), повтор подписи отклоняется.
 */
import crypto from 'node:crypto';
import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { requestMeta, logAdmin, beginStepUp, consumeStepUp } from './../adminsec.mjs';
import { logEvent } from './../skylog.mjs';
import { getCommand } from './../opscmds.mjs';
import * as ops from './../serverops.mjs';

const secret = () => String(process.env.OPS_SECRET ?? '');
const seenSigs = new Map();
const badSig = new Map();
const readRaw = (req, max = 256 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});
export const agentAuth = (req, path, raw, key = secret()) => {
  if (String(key).length < 24) return 'ops_disabled';
  const ts = Number(req.headers['x-ops-ts']); const sig = String(req.headers['x-ops-sig'] ?? ''); const nonce = String(req.headers['x-ops-nonce'] ?? '');
  if (!/^[0-9a-f]{16,64}$/.test(nonce)) return 'bad_nonce';
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 120) return 'bad_time';
  const want = crypto.createHmac('sha256', key).update(`${ts}\n${nonce}\n${req.method}\n${path}\n${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  const a = Buffer.from(want); const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'bad_signature';
  const now = Date.now();
  for (const [k, t] of seenSigs) if (now - t > 300_000) seenSigs.delete(k);
  if (seenSigs.has(sig)) return 'replay';
  seenSigs.set(sig, now);
  return null;
};

export const opsRoutes = async (req, res, url) => {
  const path = url.split('?')[0];

  /* ── Агент ── */
  if (path.startsWith('/api/ops/agent/')) {
    const ip = clientIp(req);
    if (!rateLimit(`opsa:${ip}`, 600)) return json(res, 429, { error: 'too_many_requests' });
    let raw; try { raw = await readRaw(req); } catch { return json(res, 413, { error: 'too_large' }); }
    const bad = agentAuth(req, path, raw);
    if (bad) {
      if (bad !== 'ops_disabled') { badSig.set(ip, [...(badSig.get(ip) ?? []).filter((t) => Date.now() - t < 600_000), Date.now()]); if ((badSig.get(ip) ?? []).length === 10) logEvent({ category: 'security', type: 'ops_bad_signature', level: 'WARN', result: 'denied', ip, reason: bad }); }
      return json(res, bad === 'ops_disabled' ? 404 : 403, { error: bad });
    }
    let body = {}; if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'bad_json' }); } }
    if (req.method === 'POST' && path === '/api/ops/agent/claim') {
      await ops.touchAgent(body.runner, body.version);
      return json(res, 200, { job: await ops.claimJob(body.runner, body.busyMutating) });
    }
    const m = path.match(/^\/api\/ops\/agent\/job\/(ops-[0-9a-f]{16})\/(progress|result|ping)$/);
    if (req.method === 'POST' && m) {
      if (m[2] === 'progress') { const r = await ops.appendOutput(m[1], body.seq, body.text); return json(res, r.error && r.error !== 'gap' ? 409 : 200, r); }
      if (m[2] === 'ping') { const r = await ops.heartbeat(m[1]); return json(res, r.error ? 409 : 200, r); }
      const r = await ops.finishJob(m[1], body);
      if (r.ok) logEvent({ category: 'admin', type: 'ops_job_done', level: r.status === 'done' ? 'INFO' : 'WARN', result: r.status, detail: { id: m[1], kind: r.kind } });
      return json(res, r.error ? 409 : 200, r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!path.startsWith('/api/admin/ops')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!(await can(me, 'server_ops'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`ops:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const meta = requestMeta(req);

  if (req.method === 'GET' && path === '/api/admin/ops') return json(res, 200, await ops.overview());
  if (req.method === 'POST' && path === '/api/admin/ops/step-up') { const r = await beginStepUp(me, 'server_ops', { meta }); return json(res, r.error ? 400 : 200, r); }

  let m = path.match(/^\/api\/admin\/ops\/jobs\/(ops-[0-9a-f]{16})$/);
  if (req.method === 'GET' && m) {
    const from = Number(new URL(req.url, 'http://x').searchParams.get('from')) || 0;
    const j = await ops.getJob(m[1], from);
    return j ? json(res, 200, j) : json(res, 404, { error: 'not_found' });
  }
  m = path.match(/^\/api\/admin\/ops\/jobs\/(ops-[0-9a-f]{16})\/cancel$/);
  if (req.method === 'POST' && m) {
    const r = await ops.cancelJob(m[1]);
    if (r.ok) await logAdmin({ actorId: me, targetId: m[1], targetType: 'ops', type: 'ops_cancel', meta });
    return json(res, r.error ? 409 : 200, r);
  }

  if (req.method === 'POST' && path === '/api/admin/ops/jobs') {
    const b = (await parseBody(req)) ?? {};
    const cmd = getCommand(b.kind);
    if (!cmd) return json(res, 400, { error: 'unknown_command' });
    if (cmd.mutating) {
      const s = await consumeStepUp(me, 'server_ops', b.stepUpCode, { meta });
      if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
    }
    const r = await ops.createJob(me, b.kind, b.params);
    if (r.error) return json(res, r.error === 'busy' ? 409 : r.error === 'ops_disabled' ? 503 : 400, r);
    await logAdmin({ actorId: me, targetId: r.id, targetType: 'ops', type: cmd.mutating ? `ops_${r.kind}` : 'ops_read', detail: `${r.kind} ${JSON.stringify(r.params).slice(0, 120)}`, meta });
    return json(res, 201, r);
  }
  return json(res, 404, { error: 'not_found' });
};
