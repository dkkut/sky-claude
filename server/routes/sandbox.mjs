/**
 * Sky Sandbox.
 *  • Сотрудникам: /api/admin/sandbox/* — право `sandbox` (просмотр, запуск проверок), `sandbox_publish` (одобрение публикации и откат, с кодом подтверждения).
 *  • Раннеру на хосте: /api/sandbox/runner/* — подпись HMAC SANDBOX_SECRET (время ±120 с + метод + путь + хеш тела), повтор подписи отклоняется.
 *    Раннер получает только задания; в ответах нет ни секретов, ни данных людей.
 */
import crypto from 'node:crypto';
import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { requestMeta, logAdmin, beginStepUp, consumeStepUp } from './../adminsec.mjs';
import { logEvent } from './../skylog.mjs';
import { notifyStaff } from './../staffnotify.mjs';
import * as sb from './../sandbox.mjs';

const secret = () => String(process.env.SANDBOX_SECRET ?? '');
const seenSigs = new Map();
const badSig = new Map();
const readRaw = (req, max = 512 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});
const runnerAuth = (req, path, raw) => {
  const key = secret(); if (key.length < 24) return 'sandbox_disabled';
  const ts = Number(req.headers['x-sbx-ts']); const sig = String(req.headers['x-sbx-sig'] ?? ''); const nonce = String(req.headers['x-sbx-nonce'] ?? '');
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

export const sandboxRoutes = async (req, res, url) => {
  const path = url.split('?')[0];

  /* ── Раннер ── */
  if (path.startsWith('/api/sandbox/runner/')) {
    const ip = clientIp(req);
    if (!rateLimit(`sbxr:${ip}`, 240)) return json(res, 429, { error: 'too_many_requests' });
    let raw; try { raw = await readRaw(req); } catch { return json(res, 413, { error: 'too_large' }); }
    const bad = runnerAuth(req, path, raw);
    if (bad) {
      if (bad !== 'sandbox_disabled') { badSig.set(ip, [...(badSig.get(ip) ?? []).filter((t) => Date.now() - t < 600_000), Date.now()]); if ((badSig.get(ip) ?? []).length === 10) logEvent({ category: 'security', type: 'sandbox_bad_signature', level: 'WARN', result: 'denied', ip, reason: bad }); }
      return json(res, bad === 'sandbox_disabled' ? 404 : 403, { error: bad });
    }
    let body = {}; if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'bad_json' }); } }
    if (req.method === 'POST' && path === '/api/sandbox/runner/claim') {
      const caps = (Array.isArray(body.caps) ? body.caps : ['check']).filter((c) => ['check', 'deploy'].includes(c));
      sb.touchRunner(body.runner, caps);
      return json(res, 200, { job: await sb.claimJob(body.runner, caps) });
    }
    let m = path.match(/^\/api\/sandbox\/runner\/build\/([\w-]{6,40})\/result$/);
    if (req.method === 'POST' && m) {
      const r = await sb.finishBuild(m[1], body);
      if (r.ok) {
        logEvent({ category: 'admin', type: 'sandbox_build_done', level: r.status === 'passed' ? 'INFO' : 'WARN', result: r.status, detail: { id: m[1] } });
        if (r.status !== 'passed') void notifyStaff('sandbox', { title: `Sky Sandbox: ${sb.statusLabel(r.status)}`, body: `Сборка ${m[1]}`, dedupe: `b:${m[1]}` }).catch(() => {});
      }
      return json(res, r.error ? 409 : 200, r);
    }
    m = path.match(/^\/api\/sandbox\/runner\/build\/([\w-]{6,40})\/progress$/);
    if (req.method === 'POST' && m) { const r = await sb.progressBuild(m[1], body); return json(res, r.error ? 409 : 200, r); }
    m = path.match(/^\/api\/sandbox\/runner\/pub\/([\w-]{6,40})\/(progress|result)$/);
    if (req.method === 'POST' && m) {
      const r = m[2] === 'progress' ? await sb.progressPublication(m[1], body) : await sb.finishPublication(m[1], body);
      if (r.ok && m[2] === 'result') {
        await logAdmin({ actorId: null, targetId: m[1], targetType: 'sandbox', type: `sandbox_publication_${r.status}`, detail: String(body.note ?? '').slice(0, 160) });
        logEvent({ category: 'admin', type: 'sandbox_publication_done', level: r.status === 'deployed' ? 'INFO' : 'ERROR', result: r.status, detail: { id: m[1] } });
        void notifyStaff('sandbox', { title: `Sky Sandbox: публикация — ${r.status === 'deployed' ? 'выполнена' : r.status === 'rolled_back' ? 'откат кода' : 'сбой'}`, body: m[1], dedupe: `p:${m[1]}` }).catch(() => {});
      }
      return json(res, r.error ? 409 : 200, r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!path.startsWith('/api/admin/sandbox')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  if (!(await can(me, 'sandbox'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`sbx:${me}`, 90)) return json(res, 429, { error: 'too_many_requests' });
  const meta = requestMeta(req);
  const done = (r, okCode = 200) => json(res, r.error ? (r.error === 'not_found' || r.error === 'build_not_found' ? 404 : r.error === 'step_up_exhausted' ? 429 : 400) : okCode, r);

  if (req.method === 'GET' && path === '/api/admin/sandbox') return json(res, 200, { ...(await sb.overview()), canPublish: await can(me, 'sandbox_publish'), owner: await isOwner(me) });
  let m = path.match(/^\/api\/admin\/sandbox\/builds\/([\w-]{6,40})$/);
  if (req.method === 'GET' && m) { const b = await sb.getBuild(m[1]); return b ? json(res, 200, b) : json(res, 404, { error: 'not_found' }); }

  if (req.method === 'POST' && path === '/api/admin/sandbox/builds') {
    const b = (await parseBody(req)) ?? {};
    const r = await sb.createBuild(me, b);
    if (!r.error) await logAdmin({ actorId: me, targetId: r.id, targetType: 'sandbox', type: 'sandbox_build', detail: `${r.sha.slice(0, 12)} ${String(b.profile ?? 'full')}`, meta });
    return done(r, 201);
  }
  m = path.match(/^\/api\/admin\/sandbox\/builds\/([\w-]{6,40})\/(rerun|cancel)$/);
  if (req.method === 'POST' && m) {
    const old = await sb.getBuild(m[1]);
    if (!old) return json(res, 404, { error: 'not_found' });
    const r = m[2] === 'rerun' ? await sb.createBuild(me, { sha: old.sha, ref: old.ref, note: old.note, profile: old.profile, rerunOf: old.id }) : await sb.cancelBuild(old.id);
    if (!r.error) await logAdmin({ actorId: me, targetId: old.id, targetType: 'sandbox', type: m[2] === 'rerun' ? 'sandbox_rerun' : 'sandbox_cancel', detail: old.sha.slice(0, 12), meta });
    return done(r);
  }

  /* Публикация и откат: право sandbox_publish + код подтверждения. */
  if (path === '/api/admin/sandbox/step-up' || path.startsWith('/api/admin/sandbox/publish') || path.startsWith('/api/admin/sandbox/publications/')) {
    if (!(await can(me, 'sandbox_publish'))) return json(res, 403, { error: 'not_allowed' });
    const owner = await isOwner(me);
    if (req.method === 'POST' && path === '/api/admin/sandbox/step-up') { const r = await beginStepUp(me, 'sandbox_publish', { meta }); return json(res, r.error ? 400 : 200, r); }
    m = path.match(/^\/api\/admin\/sandbox\/publications\/([\w-]{6,40})\/(rollback|cancel)$/);
    if (req.method === 'POST' && (path === '/api/admin/sandbox/publish' || m)) {
      const b = (await parseBody(req)) ?? {};
      if (m?.[2] === 'cancel') {
        const r = await sb.cancelPublication(m[1]);
        if (!r.error) await logAdmin({ actorId: me, targetId: m[1], targetType: 'sandbox', type: 'sandbox_publication_cancel', meta });
        return done(r);
      }
      const s = await consumeStepUp(me, 'sandbox_publish', b.stepUpCode, { meta });
      if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
      const r = m ? await sb.requestRollback(me, owner, m[1], b) : await sb.approvePublication(me, owner, b);
      await logAdmin({ actorId: me, targetId: r.id ?? String(b.buildId ?? m?.[1] ?? ''), targetType: 'sandbox', type: m ? 'sandbox_rollback' : 'sandbox_publish_approve', result: r.error ? 'denied' : 'ok', detail: r.error ? `${r.error}` : `${r.sha.slice(0, 12)}${r.critical ? ' critical' : ''}`, meta });
      return done(r, 201);
    }
  }
  return json(res, 404, { error: 'not_found' });
};
