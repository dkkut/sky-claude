/**
 * Sky Games: игровая инфраструктура (Minecraft, GTA) — аудит ресурсов, хосты, серверы, очередь команд для агента, мониторинг, доступ, журналы, копии.
 * API сам игровые процессы НЕ запускает и к docker доступа не имеет: он ставит команду в очередь, а исполняет её агент на игровом хосте (gamehost/agent.mjs).
 * Основной сервер Sky (хост вида `main`) используется только после подтверждения владельцем и только если ресурсы позволяют (запас для Messenger/Music/Media).
 */
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { logAdmin } from './adminsec.mjs';
import { scrubText } from './opscmds.mjs';
import { KINDS, cleanConfig, cleanLimits, buildLaunchSpec, assertSafeArgs, PORT_RANGE } from './gamespec.mjs';

const err = (error, extra = {}) => ({ error, ...extra });
const id = (p) => `${p}-${crypto.randomUUID()}`;
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31).join('').trim().slice(0, n);
export const AGENT_ONLINE_SEC = 90;
const RESERVE = { cpuFrac: 0.25, ramFrac: 0.25, ramMinMb: 2048, diskFrac: 0.2 };
const log = (actor, server, action, detail = '') => query('INSERT INTO gi_log (actor_id, server_id, action, detail) VALUES ($1,$2,$3,$4)', [actor, server, action, String(detail).slice(0, 300)]).catch(() => {});

/* ─── Аудит ресурсов (только чтение, то, что видит процесс API) ─── */
const readNum = (p) => { try { const v = fs.readFileSync(p, 'utf8').trim(); return v === 'max' ? null : Number(v); } catch { return null; } };
const netSpeed = (name) => { const n = readNum(`/sys/class/net/${name}/speed`); return n != null && n > 0 ? n : null; };
const diskOf = (p) => { try { const s = fs.statfsSync(p); const total = s.blocks * s.bsize; const free = s.bavail * s.bsize; return { path: p, totalGb: +(total / 1e9).toFixed(1), freeGb: +(free / 1e9).toFixed(1), freePct: total ? +((free / total) * 100).toFixed(1) : 0 }; } catch { return null; } };
export const auditResources = () => {
  const cpus = os.cpus(); const [l1, l5, l15] = os.loadavg();
  const cgroupMem = readNum('/sys/fs/cgroup/memory.max') ?? readNum('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const totalMb = Math.round(os.totalmem() / 1048576); const limitMb = cgroupMem && cgroupMem < os.totalmem() ? Math.round(cgroupMem / 1048576) : null;
  const cgroupCpu = (() => { try { const [q, p] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(' '); return q === 'max' ? null : +(Number(q) / Number(p)).toFixed(2); } catch { return null; } })();
  let procs = null; try { procs = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).length; } catch { /* не Linux */ }
  const ifaces = Object.entries(os.networkInterfaces()).filter(([n]) => n !== 'lo').map(([name, a]) => ({ name, addresses: (a ?? []).filter((x) => !x.internal).length, speedMbps: netSpeed(name) }));
  return {
    at: new Date().toISOString(), hostname: os.hostname(), platform: `${os.platform()} ${os.release()}`, uptimeSec: Math.round(os.uptime()),
    cpu: { cores: cpus.length, model: cpus[0]?.model ?? '', load1: +l1.toFixed(2), load5: +l5.toFixed(2), load15: +l15.toFixed(2), cgroupCpus: cgroupCpu },
    memory: { totalMb, availableMb: Math.round(os.freemem() / 1048576), containerLimitMb: limitMb },
    disks: ['/', '/data'].map(diskOf).filter(Boolean), processes: procs,
    network: { interfaces: ifaces, note: 'Пропускную способность и сетевую нагрузку процесс API измерить не может — скорость линка известна, только если её отдаёт драйвер.' },
  };
};

/** Хватит ли запаса, чтобы запустить серверы с такими лимитами, не задев основные сервисы. */
export const fitCheck = (audit, limits, { existing = [] } = {}) => {
  const cores = audit.cpu.cgroupCpus ?? audit.cpu.cores;
  const usedCpu = Math.max(audit.cpu.load15, 0) + existing.reduce((a, x) => a + (x.cpu ?? 0), 0);
  const cpuFree = cores * (1 - RESERVE.cpuFrac) - usedCpu;
  const ramBase = audit.memory.containerLimitMb ?? audit.memory.totalMb;
  const ramFree = audit.memory.availableMb - Math.max(RESERVE.ramMinMb, ramBase * RESERVE.ramFrac) - existing.reduce((a, x) => a + (x.ramMb ?? 0), 0);
  const disk = audit.disks.find((d) => d.path === '/data') ?? audit.disks[0];
  const diskFreeMb = disk ? disk.freeGb * 1000 - disk.totalGb * 1000 * RESERVE.diskFrac : 0;
  const reasons = [];
  if (limits.cpu > cpuFree) reasons.push(`CPU: нужно ${limits.cpu}, свободно с запасом ${Math.max(0, +cpuFree.toFixed(2))} из ${cores}`);
  if (limits.ramMb > ramFree) reasons.push(`Память: нужно ${limits.ramMb} МБ, свободно с запасом ${Math.max(0, Math.round(ramFree))} МБ`);
  if (limits.diskMb > diskFreeMb) reasons.push(`Диск: нужно ${limits.diskMb} МБ, свободно с запасом ${Math.max(0, Math.round(diskFreeMb))} МБ`);
  return { fits: reasons.length === 0, reasons, headroom: { cpu: +cpuFree.toFixed(2), ramMb: Math.round(ramFree), diskMb: Math.round(diskFreeMb) }, reserve: 'Запас для основных сервисов: 25 % CPU, 25 % (не меньше 2 ГБ) памяти, 20 % диска.' };
};
export const mainHostAssessment = (audit) => {
  const probe = fitCheck(audit, { cpu: 1, ramMb: 2048, diskMb: 10240 });
  return { verdict: probe.fits ? 'possible_with_limits' : 'not_recommended', probe: 'один небольшой сервер: 1 ядро, 2 ГБ памяти, 10 ГБ диска', ...probe,
    note: 'Рекомендация: игровые серверы держать на отдельном хосте. Запуск на основном сервере Sky требует подтверждения владельца и проверки запаса ресурсов при каждом старте.' };
};

/* ─── Хосты ─── */
const hostShape = (h) => ({ id: h.id, name: h.name, kind: h.kind, mainConfirmed: Boolean(h.main_confirmed_at), mainConfirmedAt: h.main_confirmed_at, online: Boolean(h.agent_last_seen) && Date.now() - new Date(h.agent_last_seen).getTime() < AGENT_ONLINE_SEC * 1000, lastSeen: h.agent_last_seen, agentVersion: h.agent_version, metrics: h.metrics });
export const listHosts = async () => (await query('SELECT * FROM gi_hosts ORDER BY created_at')).rows.map(hostShape);
export const createHost = async (actor, { name, kind }) => {
  const n = clean(name, 60); if (n.length < 2) return err('bad_field', { field: 'name' });
  if (!['dedicated', 'main'].includes(kind)) return err('bad_field', { field: 'kind' });
  if (kind === 'main') { const { rows } = await query("SELECT 1 FROM gi_hosts WHERE kind = 'main'"); if (rows.length) return err('main_exists'); }
  const hid = id('gh'); await query('INSERT INTO gi_hosts (id, name, kind, created_by) VALUES ($1,$2,$3,$4)', [hid, n, kind, actor]);
  await log(actor, '', 'host_created', `${kind}: ${n}`); await logAdmin({ actorId: actor, targetType: 'game_host', targetId: hid, type: 'game_host_create', detail: `${kind}: ${n}` });
  return { ok: true, id: hid };
};
/** Подтверждение владельца: запуск игровых серверов на основном сервере Sky разрешён (с кодом — проверяет маршрут). */
export const confirmMainHost = async (owner, hid, on) => {
  const { rows } = await query('SELECT * FROM gi_hosts WHERE id = $1', [hid]); if (!rows[0]) return err('not_found'); if (rows[0].kind !== 'main') return err('not_main');
  if (on) await query('UPDATE gi_hosts SET main_confirmed_by=$2, main_confirmed_at=now() WHERE id=$1', [hid, owner]);
  else await query('UPDATE gi_hosts SET main_confirmed_by=NULL, main_confirmed_at=NULL WHERE id=$1', [hid]);
  await log(owner, '', on ? 'main_confirmed' : 'main_revoked'); await logAdmin({ actorId: owner, targetType: 'game_host', targetId: hid, type: on ? 'game_main_confirm' : 'game_main_revoke', detail: '' });
  return { ok: true, mainConfirmed: on };
};

/* ─── Серверы ─── */
const srvShape = (s) => ({ id: s.id, kind: s.kind, name: s.name, hostId: s.host_id, status: s.status, config: s.config, limits: s.limits, port: s.port, lastError: s.last_error, lastStartedAt: s.last_started_at, createdAt: s.created_at });
export const accessLevel = async (profileId, serverId, { owner = false, hasRight = true } = {}) => {
  if (owner) return 'operate'; if (!hasRight) return null;
  const { rows } = await query('SELECT profile_id, level FROM gi_access WHERE server_id = $1', [serverId]);
  if (!rows.length) return 'operate';                         // список доступа не задан — любой с правом game_infra
  return rows.find((r) => r.profile_id === profileId)?.level ?? null;
};
export const listServers = async (profileId, { owner = false } = {}) => {
  const { rows } = await query('SELECT * FROM gi_servers ORDER BY created_at DESC LIMIT 200');
  const out = [];
  for (const s of rows) if (await accessLevel(profileId, s.id, { owner })) out.push(srvShape(s));
  return out;
};
const nextPort = async (hostId) => {
  const { rows } = await query('SELECT port FROM gi_servers WHERE host_id = $1 AND port IS NOT NULL', [hostId]); const used = new Set(rows.map((r) => r.port));
  for (let p = PORT_RANGE[0]; p <= PORT_RANGE[1]; p++) if (!used.has(p)) return p; return null;
};
export const createServer = async (actor, body = {}) => {
  const kind = String(body.kind ?? ''); if (!KINDS[kind]) return err('bad_field', { field: 'kind' });
  const name = clean(body.name, 60); if (name.length < 2) return err('bad_field', { field: 'name' });
  const cfg = cleanConfig(kind, body.config); if (cfg.error) return err(cfg.error, { field: cfg.field });
  const lim = cleanLimits(body.limits); if (lim.error) return err(lim.error, { field: lim.field });
  const { rows: h } = await query('SELECT id FROM gi_hosts WHERE id = $1', [String(body.hostId ?? '')]); if (!h[0]) return err('host_required');
  const port = await nextPort(h[0].id); if (!port) return err('no_free_port');
  const sid = id('gs');
  try { await query('INSERT INTO gi_servers (id, kind, name, host_id, config, limits, port, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)', [sid, kind, name, h[0].id, JSON.stringify(cfg.config), JSON.stringify(lim.limits), port, actor]); }
  catch (e) { if (e.code === '23505') return err('port_busy'); throw e; }
  await log(actor, sid, 'created', `${kind} ${name}`); await logAdmin({ actorId: actor, targetType: 'game_server', targetId: sid, type: 'game_server_create', detail: `${kind} ${name}` });
  return { ok: true, id: sid, port };
};
export const updateServer = async (actor, sid, body = {}) => {
  const { rows } = await query('SELECT * FROM gi_servers WHERE id = $1', [sid]); const s = rows[0]; if (!s) return err('not_found');
  if (s.status !== 'stopped' && s.status !== 'error') return err('stop_first');
  const patch = {};
  if (body.name !== undefined) { const n = clean(body.name, 60); if (n.length < 2) return err('bad_field', { field: 'name' }); patch.name = n; }
  if (body.config !== undefined) { const c = cleanConfig(s.kind, body.config); if (c.error) return err(c.error, { field: c.field }); patch.config = JSON.stringify(c.config); }
  if (body.limits !== undefined) { const l = cleanLimits(body.limits); if (l.error) return err(l.error, { field: l.field }); patch.limits = JSON.stringify(l.limits); }
  const keys = Object.keys(patch); if (!keys.length) return err('nothing_to_change');
  await query(`UPDATE gi_servers SET ${keys.map((k, i) => `${k} = $${i + 2}${k === 'config' || k === 'limits' ? '::jsonb' : ''}`).join(', ')}, updated_at = now() WHERE id = $1`, [sid, ...keys.map((k) => patch[k])]);
  await log(actor, sid, 'updated', keys.join(',')); await logAdmin({ actorId: actor, targetType: 'game_server', targetId: sid, type: 'game_server_update', detail: keys.join(',') });
  return { ok: true };
};
export const removeServer = async (actor, sid) => {
  const { rows } = await query('SELECT status FROM gi_servers WHERE id = $1', [sid]); if (!rows[0]) return err('not_found');
  if (!['stopped', 'error'].includes(rows[0].status)) return err('stop_first');
  await query('DELETE FROM gi_servers WHERE id = $1', [sid]); await log(actor, sid, 'removed'); await logAdmin({ actorId: actor, targetType: 'game_server', targetId: sid, type: 'game_server_remove', detail: '' });
  return { ok: true };                                         // файлы сервера и копии на хосте не удаляются — это отдельное осознанное действие на хосте
};

/* ─── Команды ─── */
const ACTIONS = { start: ['stopped', 'error'], stop: ['running', 'starting'], restart: ['running'], backup: ['stopped', 'running'], logs: ['stopped', 'running', 'error', 'starting'] };
export const enqueue = async (actor, sid, action) => {
  if (!ACTIONS[action]) return err('bad_action');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('SELECT s.*, h.kind AS host_kind, h.main_confirmed_at, h.agent_last_seen FROM gi_servers s LEFT JOIN gi_hosts h ON h.id = s.host_id WHERE s.id = $1 FOR UPDATE OF s', [sid]);
    const s = rows[0]; if (!s) { await c.query('ROLLBACK'); return err('not_found'); }
    if (!s.host_id) { await c.query('ROLLBACK'); return err('host_required'); }
    if (s.kind !== 'minecraft' && ['start', 'restart'].includes(action)) { await c.query('ROLLBACK'); return err('launch_not_supported', { note: 'Запуск GTA-серверов не автоматизирован: инфраструктура подготовлена, но совместимость и условия поставщика ПО не подтверждены.' }); }
    if (!ACTIONS[action].includes(s.status)) { await c.query('ROLLBACK'); return err('bad_state', { status: s.status }); }
    const online = s.agent_last_seen && Date.now() - new Date(s.agent_last_seen).getTime() < AGENT_ONLINE_SEC * 1000;
    if (!online) { await c.query('ROLLBACK'); return err('agent_offline'); }
    if (['start', 'restart'].includes(action) && s.host_kind === 'main') {
      if (!s.main_confirmed_at) { await c.query('ROLLBACK'); return err('main_host_not_confirmed'); }
      const { rows: others } = await c.query("SELECT limits FROM gi_servers WHERE host_id = $1 AND id <> $2 AND status IN ('running','starting')", [s.host_id, sid]);
      const fit = fitCheck(auditResources(), s.limits, { existing: others.map((o) => o.limits) });
      if (!fit.fits) { await c.query('ROLLBACK'); return err('insufficient_resources', { reasons: fit.reasons }); }
    }
    const cid = id('gc');
    try { await c.query('INSERT INTO gi_commands (id, server_id, host_id, action, requested_by) VALUES ($1,$2,$3,$4,$5)', [cid, sid, s.host_id, action, actor]); }
    catch (e) { await c.query('ROLLBACK'); if (e.code === '23505') return err('command_in_progress'); throw e; }
    if (action === 'start' || action === 'restart') await c.query("UPDATE gi_servers SET status='starting', updated_at=now() WHERE id=$1", [sid]);
    if (action === 'stop') await c.query("UPDATE gi_servers SET status='stopping', updated_at=now() WHERE id=$1", [sid]);
    await c.query('COMMIT');
    await log(actor, sid, `cmd_${action}`); await logAdmin({ actorId: actor, targetType: 'game_server', targetId: sid, type: `game_server_${action}`, detail: '' });
    return { ok: true, commandId: cid };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/* ─── Агент ─── */
export const agentPing = async (hostId, { version = '', metrics = {}, servers = [] } = {}) => {
  const m = {}; for (const k of ['cpuPct', 'load1', 'memTotalMb', 'memAvailMb', 'diskFreeGb']) if (Number.isFinite(Number(metrics[k]))) m[k] = Number(metrics[k]);
  const r = await query('UPDATE gi_hosts SET agent_last_seen=now(), agent_version=$2, metrics=$3::jsonb WHERE id=$1', [hostId, clean(version, 20), JSON.stringify(m)]);
  if (!r.rowCount) return err('not_found');
  for (const x of (Array.isArray(servers) ? servers : []).slice(0, 50)) {
    if (!/^gs-[0-9a-f-]{36}$/.test(String(x?.id))) continue;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    await query('INSERT INTO gi_samples (server_id, cpu_pct, mem_mb, disk_mb, players) SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM gi_servers WHERE id=$1 AND host_id=$6)', [x.id, num(x.cpuPct), num(x.memMb), num(x.diskMb), x.players == null ? null : Math.trunc(Number(x.players)), hostId]).catch(() => {});
    await query('DELETE FROM gi_samples WHERE server_id = $1 AND id < (SELECT COALESCE(min(id), 0) FROM (SELECT id FROM gi_samples WHERE server_id = $1 ORDER BY id DESC LIMIT 200) t)', [x.id]).catch(() => {});
    if (x.status === 'error' && x.reason) await query("UPDATE gi_servers SET status='error', last_error=$2, updated_at=now() WHERE id=$1 AND host_id=$3 AND status IN ('running','starting')", [x.id, clean(x.reason, 200), hostId]).catch(() => {});
  }
  return { ok: true };
};
/** Агент забирает следующую команду своего хоста. Для запуска ему отдаётся ПРОВЕРЕННАЯ спецификация, а не произвольная команда. */
export const agentClaim = async (hostId) => {
  const { rows } = await query("UPDATE gi_commands SET state='running', claimed_at=now() WHERE id = (SELECT id FROM gi_commands WHERE host_id=$1 AND state='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *", [hostId]);
  const c = rows[0]; if (!c) return { command: null };
  const { rows: sv } = await query('SELECT * FROM gi_servers WHERE id = $1', [c.server_id]); const s = sv[0];
  if (!s) { await query("UPDATE gi_commands SET state='failed', finished_at=now(), output='Сервер удалён' WHERE id=$1", [c.id]); return { command: null }; }
  let spec = null;
  if (c.action === 'start' || c.action === 'restart') {
    const b = buildLaunchSpec({ id: s.id, kind: s.kind, serial: s.serial, port: s.port, limits: s.limits, config: s.config }, { image: process.env.GAMEINFRA_MC_IMAGE || undefined });
    if (b.error || !assertSafeArgs(b.spec.args)) { await agentReport(hostId, c.id, { ok: false, output: `Спецификация отклонена: ${b.error ?? 'небезопасные аргументы'}` }); return { command: null }; }
    spec = b.spec;
  }
  return { command: { id: c.id, action: c.action, serverId: s.id, spec, uid: 20000 + Number(s.serial), dir: `/srv/skygames/${s.id}`, diskMb: s.limits?.diskMb ?? 0, container: `sky-gs-${s.id}` } };
};
export const agentReport = async (hostId, cid, { ok, output = '', backup = null } = {}) => {
  const out = scrubText(output).slice(0, 20000);
  const { rows } = await query("UPDATE gi_commands SET state=$3, output=$4, finished_at=now() WHERE id=$1 AND host_id=$2 AND state='running' RETURNING server_id, action", [cid, hostId, ok ? 'done' : 'failed', out]);
  const c = rows[0]; if (!c) return err('not_found');
  if (c.action === 'start' || c.action === 'restart') await query("UPDATE gi_servers SET status=$2, last_error=$3, last_started_at = CASE WHEN $2='running' THEN now() ELSE last_started_at END, updated_at=now() WHERE id=$1", [c.server_id, ok ? 'running' : 'error', ok ? '' : out.slice(0, 200)]);
  else if (c.action === 'stop') await query("UPDATE gi_servers SET status=$2, last_error=$3, updated_at=now() WHERE id=$1", [c.server_id, ok ? 'stopped' : 'error', ok ? '' : out.slice(0, 200)]);
  else if (c.action === 'backup' && ok && backup && /^[A-Za-z0-9._/-]{1,200}$/.test(String(backup.path ?? ''))) {
    await query('INSERT INTO gi_backups (id, server_id, path, bytes, sha256) VALUES ($1,$2,$3,$4,$5)', [id('gb'), c.server_id, backup.path, Math.max(0, Math.trunc(Number(backup.bytes) || 0)), /^[0-9a-f]{64}$/.test(String(backup.sha256)) ? backup.sha256 : '']);
    await query('DELETE FROM gi_backups WHERE server_id = $1 AND id NOT IN (SELECT id FROM gi_backups WHERE server_id = $1 ORDER BY created_at DESC LIMIT 7)', [c.server_id]);   // хранятся 7 последних записей учёта (файлы чистит агент)
  } else if (c.action === 'logs' && ok) {
    const lines = out.split('\n').slice(-300); await query('DELETE FROM gi_logs WHERE server_id = $1', [c.server_id]);
    for (const l of lines) if (l.trim()) await query('INSERT INTO gi_logs (server_id, line) VALUES ($1,$2)', [c.server_id, l.slice(0, 400)]);
  }
  return { ok: true };
};

/* ─── Просмотр ─── */
export const serverDetail = async (sid) => {
  const { rows } = await query('SELECT * FROM gi_servers WHERE id = $1', [sid]); if (!rows[0]) return err('not_found');
  const [cmds, samples, backups, logs, access] = await Promise.all([
    query('SELECT id, action, state, requested_by, left(output, 500) AS output, created_at, finished_at FROM gi_commands WHERE server_id = $1 ORDER BY created_at DESC LIMIT 20', [sid]),
    query('SELECT at, cpu_pct, mem_mb, disk_mb, players FROM gi_samples WHERE server_id = $1 ORDER BY id DESC LIMIT 60', [sid]),
    query('SELECT id, path, bytes, sha256, created_at FROM gi_backups WHERE server_id = $1 ORDER BY created_at DESC LIMIT 7', [sid]),
    query('SELECT at, line FROM gi_logs WHERE server_id = $1 ORDER BY id DESC LIMIT 300', [sid]),
    query('SELECT a.profile_id, a.level, p.username FROM gi_access a LEFT JOIN profiles p ON p.id = a.profile_id WHERE a.server_id = $1', [sid]),
  ]);
  return { server: srvShape(rows[0]), commands: cmds.rows, samples: samples.rows.reverse(), backups: backups.rows, logs: logs.rows.reverse(), access: access.rows.map((a) => ({ profileId: a.profile_id, username: a.username, level: a.level })) };
};
export const infraLog = async (sid = '') => (await query('SELECT at, actor_id, server_id, action, detail FROM gi_log WHERE ($1 = \'\' OR server_id = $1) ORDER BY id DESC LIMIT 100', [sid])).rows;
export const setAccess = async (owner, sid, username, level) => {
  const { rows: s } = await query('SELECT 1 FROM gi_servers WHERE id = $1', [sid]); if (!s[0]) return err('not_found');
  const { rows: p } = await query('SELECT id FROM profiles WHERE lower(username) = lower($1)', [String(username ?? '').replace(/^@/, '')]); if (!p[0]) return err('person_not_found');
  if (level === 'none') await query('DELETE FROM gi_access WHERE server_id=$1 AND profile_id=$2', [sid, p[0].id]);
  else if (['view', 'operate'].includes(level)) await query('INSERT INTO gi_access (server_id, profile_id, level, granted_by) VALUES ($1,$2,$3,$4) ON CONFLICT (server_id, profile_id) DO UPDATE SET level=$3, granted_by=$4', [sid, p[0].id, level, owner]);
  else return err('bad_field', { field: 'level' });
  await log(owner, sid, 'access', `${p[0].id}:${level}`); await logAdmin({ actorId: owner, targetType: 'game_server', targetId: sid, type: 'gi_access', detail: `${level}` });
  return { ok: true };
};
