/**
 * Sky Storage — маршруты.
 *   /api/admin/storage/*       — управление (права storage_*, подтверждение нового подключения, критические — step-up)
 *   /api/storage/verify/*      — страница подтверждения подключения по ссылке из письма (токен + код владельца)
 *   /api/storage/download/:t   — одноразовое скачивание резервной копии
 * Все проверки — на сервере; ответы мутаций содержат фактическое состояние из базы.
 */
import crypto from 'node:crypto';
import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { requestMeta, consumeStepUp, logAdmin } from './../adminsec.mjs';
import { query } from './../db.mjs';
import * as A from './../skystorageadmin.mjs';
import * as B from './../skystoragebackup.mjs';
import * as X from './../skystorageaccess.mjs';
import * as I from './../skystorageindex.mjs';
import { effective, snapshot, loadState, logEvent, counters } from './../skystoragestate.mjs';
import { getTarget, describeTarget } from './../skystoragetarget.mjs';
import { keyStatus } from './../skystoragecrypto.mjs';

const P = A.PERMS;
const CODE = {
  not_allowed: 403, owner_only: 403, confirm_required: 400, step_up_required: 401, step_up_invalid: 401, step_up_exhausted: 429, no_second_factor: 409,
  conflict: 409, checks_failed: 409, busy: 409, not_found: 404, bad_state: 409, storage_unavailable: 503, storage_maintenance: 503, connection_pending: 403,
  reason_required: 400, bad_field: 400, bad_kind: 400, bad_category: 400, nothing_selected: 400, plan_expired: 410, plan_already_applied: 409, kek_not_configured: 409,
  target_not_configured: 409, target_unavailable: 502, kek_missing: 409, recovery_procedure_required: 409, rotate_keys_first: 409, ack_required: 400,
};
const reply = (res, r) => json(res, r?.error ? (CODE[r.error] ?? 400) : 200, r);

/** Для тестов лимиты запросов можно умножить: STORAGE_RATE_MULT (по умолчанию 1). */
const MULT = Math.max(Number(process.env.STORAGE_RATE_MULT) || 1, 1);
const rl = (key, n) => rateLimit(key, n * MULT);
const hashIp = (ip) => crypto.createHash('sha256').update(`storage-ip:${ip}`).digest('hex').slice(0, 24);

export const storageRoutes = async (req, res, url) => {
  // /api/storage/* принадлежит ещё и общему доступу к файлам (storageshare.mjs): берём только свои адреса
  if (!url.startsWith('/api/admin/storage') && !url.startsWith('/api/storage/verify/') && !url.startsWith('/api/storage/download/')) return false;
  const path = new URL(req.url, 'http://x').pathname;
  const params = new URL(req.url, 'http://x').searchParams;
  const ip = clientIp(req);

  /* ─── Публично: страница подтверждения по ссылке из письма ─── */
  if (path === '/api/storage/verify/lookup' || path === '/api/storage/verify/decide') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!rl(`storage:verify:${ip}`, 12)) return json(res, 429, { error: 'too_many_attempts' });
    const body = (await parseBody(req)) ?? {};
    const meta = requestMeta(req);
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
    if (path.endsWith('lookup')) return json(res, 200, await X.lookupForPage(body.token, meta));
    const r = await X.decideByToken(body.token, body.approve === true, body.code, meta);
    return json(res, r.error ? 400 : 200, r);   // не 401: клиент принял бы его за истёкшую сессию
  }

  /* ─── Публично: скачивание копии по одноразовой ссылке ─── */
  let m = /^\/api\/storage\/download\/([A-Za-z0-9_-]{30,80})$/.exec(path);
  if (m) {
    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    if (!rl(`storage:dl:${ip}`, 10)) return json(res, 429, { error: 'too_many_attempts' });
    if (!effective(snapshot()).read) return json(res, 503, { error: 'storage_unavailable' });
    let d;
    try { d = await B.openDownload(m[1], hashIp(ip)); } catch (e) { console.error('[storage] скачивание:', e.message); return json(res, 502, { error: 'download_failed' }); }
    if (!d) return json(res, 404, { error: 'not_found' });          // нет такой / использована / истекла — одинаковый ответ
    res.writeHead(200, { 'Content-Type': 'application/x-tar', 'Content-Disposition': `attachment; filename="${d.name}"`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    d.stream.on('error', (e) => { console.error('[storage] поток скачивания:', e.message); res.destroy(); });
    d.stream.pipe(res);
    return true;
  }

  if (!url.startsWith('/api/admin/storage')) return json(res, 404, { error: 'not_found' });

  /* ─── Управление ─── */
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const meta = requestMeta(req);
  const rest = path.slice('/api/admin/storage'.length) || '/';
  if (!rl(`storage:admin:${me}`, 240)) return json(res, 429, { error: 'too_many_attempts' });
  const isWrite = req.method !== 'GET';
  const body = isWrite ? ((await parseBody(req)) ?? {}) : {};

  const needPerm = async (perm) => (await can(me, perm)) ? null : json(res, 403, { error: 'not_allowed' });
  const anyStorage = async () => { for (const p of Object.values(P)) if (await can(me, p)) return true; return false; };
  if (!(await anyStorage())) return json(res, 403, { error: 'not_allowed' });

  /* Новое подключение: пока не подтверждено — к данным управления доступа нет */
  const conn = await X.evaluateConnection(me, req, session.sessionId);
  if (rest === '/connection-status' && req.method === 'GET') return json(res, 200, { allowed: conn.allowed, status: conn.status ?? 'approved', pending: conn.pending ?? null, bootstrap: conn.bootstrap === true });
  if (!conn.allowed) return json(res, 403, { error: 'connection_pending', status: conn.status, pending: conn.pending ?? null });

  const critical = ['/emergency-off', '/enable', '/sky-auth', '/unlock', '/restrict', '/compromise', '/recover', '/restore/apply'];
  if (isWrite && critical.includes(rest) && !rl(`storage:crit:${me}`, 10)) return json(res, 429, { error: 'too_many_attempts' });

  // Чтение
  if (req.method === 'GET') {
    if (rest === '/overview') return (await needPerm(P.view)) ?? json(res, 200, await A.overview());
    if (rest === '/events') {
      const deny = await needPerm(P.audit); if (deny) return deny;
      const level = ['info', 'warn', 'critical'].includes(params.get('level')) ? params.get('level') : null;
      const kind = (params.get('kind') ?? '').replace(/[^a-z_]/g, '').slice(0, 40);
      const args = []; const where = [];
      if (level) { args.push(level); where.push(`level = $${args.length}`); }
      if (kind) { args.push(`${kind}%`); where.push(`kind LIKE $${args.length}`); }
      const { rows } = await query(`SELECT e.id, e.at, e.level, e.kind, e.detail, p.username FROM storage_events e LEFT JOIN profiles p ON p.id = e.actor_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.at DESC LIMIT 200`, args);
      return json(res, 200, { items: rows.map((r) => ({ id: r.id, at: r.at, level: r.level, kind: r.kind, detail: r.detail, by: r.username })) });
    }
    if (rest === '/restrictions') return (await needPerm(P.view)) ?? json(res, 200, { items: await A.removable(), state: await A.publicState() });
    if (rest === '/enable-checks') return (await needPerm(P.enable)) ?? json(res, 200, await A.enableChecks());
    if (rest === '/connections') return (await needPerm(P.access)) ?? json(res, 200, { items: await X.listConnections() });
    if (rest === '/backups') {
      const deny = await needPerm(P.view); if (deny) return deny;
      const { rows } = await query(`SELECT id, kind, scope, status, target, base_id, files, bytes, progress, verify, error, trigger, started_at, finished_at, verified_at, pinned, key_id FROM storage_backups WHERE status <> 'deleted' ORDER BY started_at DESC LIMIT 100`);
      return json(res, 200, { items: rows, summary: await B.backupSummary() });
    }
    if (rest === '/retention/plan') return (await needPerm(P.backup)) ?? json(res, 200, await B.retentionPlan());
    if (rest === '/schedules') { const deny = await needPerm(P.view); if (deny) return deny; const { rows } = await query('SELECT * FROM storage_schedules ORDER BY created_at'); return json(res, 200, { items: rows }); }
    if (rest === '/quarantine') { const deny = await needPerm(P.view); if (deny) return deny; const { rows } = await query(`SELECT id, service, object_id, size, reason, moved_at, purge_after, state FROM storage_quarantine ORDER BY moved_at DESC LIMIT 200`); return json(res, 200, { items: rows }); }
    if (rest === '/orphans') return (await needPerm(P.backup)) ?? json(res, 200, await I.quarantineOrphans(me, { dryRun: true }));
    if (rest === '/keys') return (await needPerm(P.keys)) ?? json(res, 200, { keys: keyStatus() });
    return json(res, 404, { error: 'not_found' });
  }

  // Запись
  if (rest === '/step-up') { if (!rl(`storage:stepup:${me}`, 6)) return json(res, 429, { error: 'too_many_attempts' }); return reply(res, await A.beginCritical(me, meta)); }
  if (rest === '/emergency-off') return reply(res, await A.emergencyOff(me, body, meta));
  if (rest === '/sky-auth') return reply(res, await A.requireSkyAuth(me, body, meta));
  if (rest === '/enable') return reply(res, await A.enable(me, body, meta));
  if (rest === '/unlock') return reply(res, await A.removeRestrictions(me, body, meta));
  if (rest === '/restrict') return reply(res, await A.addRestriction(me, body, meta));
  if (rest === '/compromise') return reply(res, await A.flagCompromise(me, body, meta));
  if (rest === '/recover') return reply(res, await A.recoverFromCompromise(me, body, meta));
  if (rest === '/maintenance') return reply(res, await A.setMaintenance(me, body, meta));
  /* Пороги, сроки хранения копий и квоты решают, что будет заблокировано и что удалится, — только с подтверждением личности. */
  const withCode = async (perm, fn) => {
    const deny = await needPerm(perm); if (deny) return deny;
    const step = await consumeStepUp(me, A.CRITICAL_PURPOSE, body.stepUpCode, { meta }); if (step.error) return reply(res, step);
    return fn();
  };
  if (rest === '/settings' && req.method === 'PUT') return withCode(P.quota, async () => reply(res, await A.updateSettings(me, body, meta)));
  if (rest === '/quotas' && req.method === 'PUT') return withCode(P.quota, async () => reply(res, await A.setQuota(me, body, meta)));

  if (rest === '/target/check') {
    const deny = await needPerm(P.view); if (deny) return deny;
    const d = describeTarget(); if (!d.configured) return json(res, 200, { ok: false, target: d });
    const h = await getTarget().health().catch((e) => ({ ok: false, code: e.code }));
    return json(res, 200, { ok: h.ok, health: h, target: d });
  }

  if (rest === '/backups' && req.method === 'POST') {
    const deny = await needPerm(P.backup); if (deny) return deny;
    if (!rl(`storage:bk:${me}`, 4)) return json(res, 429, { error: 'too_many_attempts' });
    const r = await B.startBackup({ kind: body.kind, scope: body.scope ?? {}, trigger: 'manual', actorId: me, verify: body.verify === 'sample' ? 'sample' : 'full', incremental: body.incremental !== false });
    if (!r.error) await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_backup_run', detail: `${body.kind}: ${r.id}`, meta });
    return reply(res, r);
  }
  m = /^\/backups\/(bk-[0-9a-f]{16})\/(verify|cancel|pin|restore-plan|download-link)$/.exec(rest);
  if (m && req.method === 'POST') {
    const [, id, act] = m;
    if (act === 'verify') { const deny = await needPerm(P.backup); if (deny) return deny; return reply(res, await B.verifyBackupExclusive(id, { mode: body.mode === 'sample' ? 'sample' : 'full' })); }
    if (act === 'cancel') { const deny = await needPerm(P.backup); if (deny) return deny; B.cancelBackup(id); return json(res, 200, { ok: true }); }
    if (act === 'pin') { const deny = await needPerm(P.backup); if (deny) return deny; await B.pinBackup(id, body.pinned === true); await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_backup_pin', detail: `${id} ${body.pinned ? 'закреплена' : 'откреплена'}`, meta }); return json(res, 200, { ok: true }); }
    if (act === 'restore-plan') { const deny = await needPerm(P.restore); if (deny) return deny; if (!(await isOwner(me))) return json(res, 403, { error: 'owner_only' }); return reply(res, await B.restorePlan(id, body.scope ?? {}, me)); }
    if (act === 'download-link') {
      if (!(await isOwner(me))) return json(res, 403, { error: 'owner_only' });
      if (body.confirm !== true) return json(res, 400, { error: 'confirm_required' });
      const step = await consumeStepUp(me, A.CRITICAL_PURPOSE, body.stepUpCode, { meta }); if (step.error) return reply(res, step);
      const mins = snapshot()?.settings.downloadLinkMinutes ?? 15;
      const r = await B.createDownloadLink(me, id, mins, hashIp(ip));
      if (r.error) return reply(res, r);
      await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_download', detail: `Ссылка на копию ${id}, ${mins} мин.`, meta });
      return json(res, 200, { ok: true, url: `/api/storage/download/${r.token}`, expiresInMin: r.expiresInMin, note: 'Ссылка одноразовая. Ключи в архив не входят.' });
    }
  }
  if (rest === '/restore/apply') {
    if (!(await isOwner(me))) { await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_restore', detail: 'не владелец', result: 'denied', meta }); return json(res, 403, { error: 'owner_only' }); }
    const deny = await needPerm(P.restore); if (deny) return deny;
    if (body.confirm !== true) return json(res, 400, { error: 'confirm_required' });
    const step = await consumeStepUp(me, A.CRITICAL_PURPOSE, body.stepUpCode, { meta }); if (step.error) return reply(res, step);
    const r = await B.restoreApply(me, String(body.planId ?? ''), { overwrite: body.overwrite === true });
    if (!r.error) await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_restore', detail: `${r.status}: файлов ${r.restored}, конфликтов ${r.conflicts}`, result: r.status === 'ok' ? 'ok' : 'partial', meta });
    return reply(res, r);
  }
  if (rest === '/retention/apply') {
    const deny = await needPerm(P.backup); if (deny) return deny;
    if (body.confirm !== true) return json(res, 400, { error: 'confirm_required' });
    const r = await B.applyRetention(me, Array.isArray(body.ids) ? body.ids : null);
    if (!r.error) await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_retention', detail: `удалено копий: ${r.deleted}`, meta });
    return reply(res, r);
  }
  if (rest === '/schedules' && req.method === 'POST') {
    const deny = await needPerm(P.schedule); if (deny) return deny;
    { const step = await consumeStepUp(me, A.CRITICAL_PURPOSE, body.stepUpCode, { meta }); if (step.error) return reply(res, step); }
    const kind = String(body.kind ?? 'full');
    if (!['full', 'media', 'messenger', 'service', 'category', 'metadata', 'config'].includes(kind)) return json(res, 400, { error: 'bad_kind' });
    const frequency = ['daily', 'multi', 'weekly'].includes(body.frequency) ? body.frequency : null;
    const times = Array.isArray(body.times) ? body.times.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t))).slice(0, 12) : [];
    if (!frequency || !times.length) return json(res, 400, { error: 'bad_field' });
    const weekday = frequency === 'weekly' ? Number(body.weekday) : null;
    if (frequency === 'weekly' && !(weekday >= 0 && weekday <= 6)) return json(res, 400, { error: 'bad_field' });
    const id = `sch-${crypto.randomBytes(6).toString('hex')}`;
    await query(`INSERT INTO storage_schedules (id, frequency, times, weekday, kind, scope, created_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7)`, [id, frequency, JSON.stringify(times), weekday, kind, JSON.stringify(body.scope ?? {}), me]);
    await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_schedule', detail: `${frequency} ${times.join(',')} ${kind}`, meta });
    return json(res, 200, { ok: true, id });
  }
  m = /^\/schedules\/(sch-[0-9a-f]{12})$/.exec(rest);
  if (m) {
    const deny = await needPerm(P.schedule); if (deny) return deny;
    { const step = await consumeStepUp(me, A.CRITICAL_PURPOSE, body.stepUpCode, { meta }); if (step.error) return reply(res, step); }
    if (req.method === 'PUT') { await query('UPDATE storage_schedules SET enabled = $2 WHERE id = $1', [m[1], body.enabled === true]); await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_schedule', detail: `${m[1]} ${body.enabled ? 'включено' : 'выключено'}`, meta }); return json(res, 200, { ok: true }); }
    if (req.method === 'DELETE') { await query('DELETE FROM storage_schedules WHERE id = $1', [m[1]]); await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_schedule', detail: `${m[1]} удалено`, meta }); return json(res, 200, { ok: true }); }
  }
  m = /^\/connections\/(cn-[0-9a-f]{16})\/(decide|revoke)$/.exec(rest);
  if (m && req.method === 'POST') {
    const deny = await needPerm(P.access); if (deny) return deny;
    if (!(await isOwner(me))) return json(res, 403, { error: 'owner_only' });
    const step = await consumeStepUp(me, A.CRITICAL_PURPOSE, body.stepUpCode, { meta }); if (step.error) return reply(res, step);
    return reply(res, m[2] === 'decide' ? await X.decideInPanel(me, m[1], body.approve === true, meta) : await X.revokeConnection(me, m[1], meta));
  }
  if (rest === '/objects/scan') {
    const deny = await needPerm(P.backup); if (deny) return deny;
    if (!rl(`storage:scan:${me}`, 2)) return json(res, 429, { error: 'too_many_attempts' });
    return json(res, 200, { ok: true, ...(await I.scanAll()) });
  }
  if (rest === '/quarantine' && req.method === 'POST') {
    const deny = await needPerm(P.backup); if (deny) return deny;
    if (body.dryRun !== false) return json(res, 200, await I.quarantineOrphans(me, { dryRun: true }));
    if (body.confirm !== true) return json(res, 400, { error: 'confirm_required' });
    const step = await consumeStepUp(me, A.CRITICAL_PURPOSE, body.stepUpCode, { meta }); if (step.error) return reply(res, step);
    const r = await I.quarantineOrphans(me, { dryRun: false });
    await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_quarantine', detail: `в карантин: ${r.moved}`, meta });
    return json(res, 200, r);
  }
  m = /^\/quarantine\/(\d+)\/restore$/.exec(rest);
  if (m && req.method === 'POST') { const deny = await needPerm(P.backup); if (deny) return deny; return reply(res, await I.restoreFromQuarantine(me, Number(m[1]))); }

  return json(res, 404, { error: 'not_found' });
};
