/**
 * Sky Ops — управление сервером из админки: диагностика, «починить всё», деплой, сборка приложений.
 *
 * Здесь (в API) только очередь и учёт: API не имеет доступа ни к docker, ни к хосту. Задание выполняет агент на хосте
 * (ops/agent.mjs, служба systemd), который сам приходит за заданиями с подписью HMAC OPS_SECRET. Список заданий закрыт (opscmds.mjs):
 * произвольной команды отправить нельзя. Изменяющие задания — только с правом `server_ops`, кодом подтверждения и по одному за раз.
 * Вывод сохраняется чистым от секретов (scrubText) и виден только тем, у кого есть право.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { cleanJob, getCommand, catalog, scrubText } from './opscmds.mjs';

export const opsEnabled = () => String(process.env.OPS_SECRET ?? '').length >= 24;
export const MAX_OUTPUT = 400_000;
const AGENT_FRESH_SEC = 60;
const newId = () => `ops-${crypto.randomBytes(8).toString('hex')}`;
const iso = (d) => (d ? new Date(d).toISOString() : null);

const view = (r) => r && ({
  id: r.id, kind: r.kind, label: getCommand(r.kind)?.label ?? r.kind, params: r.params, status: r.status, mutating: r.mutating,
  requestedBy: r.requested_by, exitCode: r.exit_code, note: r.note, cancelRequested: r.cancel,
  createdAt: iso(r.created_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
});

export const agentStatus = async () => {
  const r = (await query('SELECT runner, version, seen_at FROM ops_agent WHERE id = 1')).rows[0];
  const ageSec = r?.seen_at ? (Date.now() - new Date(r.seen_at).getTime()) / 1000 : null;
  return { enabled: opsEnabled(), online: ageSec != null && ageSec < AGENT_FRESH_SEC, lastSeen: iso(r?.seen_at), runner: r?.runner ?? null, version: r?.version ?? null };
};

export const touchAgent = async (runner, version) => {
  await query(`INSERT INTO ops_agent (id, runner, version, seen_at) VALUES (1, $1, $2, now())
               ON CONFLICT (id) DO UPDATE SET runner = EXCLUDED.runner, version = EXCLUDED.version, seen_at = now()`, [String(runner ?? '').slice(0, 60), String(version ?? '').slice(0, 20)]);
};

export const overview = async () => {
  const jobs = (await query('SELECT * FROM ops_jobs ORDER BY created_at DESC LIMIT 25')).rows.map(view);
  return { enabled: opsEnabled(), agent: await agentStatus(), jobs, commands: catalog() };
};

export const createJob = async (actorId, kind, rawParams) => {
  if (!opsEnabled()) return { error: 'ops_disabled' };
  const j = cleanJob(kind, rawParams);
  if (j.error) return j;
  const queued = Number((await query(`SELECT count(*)::int AS n FROM ops_jobs WHERE status = 'queued'`)).rows[0].n);
  if (queued >= 30) return { error: 'queue_full' };
  const id = newId();
  try {
    await query('INSERT INTO ops_jobs (id, kind, params, mutating, requested_by) VALUES ($1,$2,$3::jsonb,$4,$5)', [id, j.kind, JSON.stringify(j.params), j.mutating, String(actorId)]);
  } catch (e) {
    if (e.code === '23505') return { error: 'busy' };
    throw e;
  }
  return { ok: true, id, kind: j.kind, params: j.params, mutating: j.mutating };
};

export const getJob = async (id, from = 0) => {
  const r = (await query('SELECT * FROM ops_jobs WHERE id = $1', [String(id)])).rows[0];
  if (!r) return null;
  const out = scrubText(r.output);
  const start = Math.max(0, Math.min(out.length, Number(from) || 0));
  return { ...view(r), output: out.slice(start), length: out.length };
};

export const cancelJob = async (id) => {
  const r = (await query(`UPDATE ops_jobs SET status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END, cancel = TRUE,
                            finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END, note = CASE WHEN status = 'queued' THEN 'отменено до начала' ELSE note END
                          WHERE id = $1 AND status IN ('queued','running') RETURNING id, status`, [String(id)])).rows[0];
  return r ? { ok: true, status: r.status } : { error: 'not_cancellable' };
};

/* ── Для агента ── */

/** Берёт следующее задание. busyMutating: агент уже выполняет изменяющее — отдаём только чтение. */
export const claimJob = async (runner, busyMutating) => {
  const r = (await query(
    `UPDATE ops_jobs SET status = 'running', runner = $1, started_at = now(), heartbeat_at = now()
       WHERE id = (SELECT id FROM ops_jobs WHERE status = 'queued' AND ($2::boolean = FALSE OR mutating = FALSE) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, kind, params`, [String(runner ?? '').slice(0, 60), Boolean(busyMutating)])).rows[0];
  return r ? { id: r.id, kind: r.kind, params: cleanJob(r.kind, r.params).params ?? {} } : null;
};

/** Кусок вывода с порядковым номером: повтор того же куска безвреден, пропуск — агент присылает недостающее. */
export const appendOutput = async (id, seq, text) => {
  const s = Math.floor(Number(seq));
  if (!Number.isFinite(s) || s < 1) return { error: 'bad_seq' };
  const chunk = scrubText(String(text ?? '').slice(0, 20_000));
  const cur = (await query(`UPDATE ops_jobs SET heartbeat_at = now() WHERE id = $1 AND status = 'running' RETURNING chunks, cancel, length(output) AS len`, [String(id)])).rows[0];
  if (!cur) return { error: 'not_running' };
  if (s <= cur.chunks) return { ok: true, expect: cur.chunks + 1, cancel: cur.cancel };
  if (s !== cur.chunks + 1) return { error: 'gap', expect: cur.chunks + 1, cancel: cur.cancel };
  if (cur.len < MAX_OUTPUT) await query(`UPDATE ops_jobs SET output = left(output || $2, $3), chunks = $4 WHERE id = $1 AND status = 'running' AND chunks = $5`, [String(id), chunk, MAX_OUTPUT, s, cur.chunks]);
  else await query(`UPDATE ops_jobs SET chunks = $2 WHERE id = $1 AND status = 'running' AND chunks = $3`, [String(id), s, cur.chunks]);
  return { ok: true, expect: s + 1, cancel: cur.cancel };
};

export const heartbeat = async (id) => {
  const r = (await query(`UPDATE ops_jobs SET heartbeat_at = now() WHERE id = $1 AND status = 'running' RETURNING cancel, chunks`, [String(id)])).rows[0];
  return r ? { ok: true, cancel: r.cancel, expect: r.chunks + 1 } : { error: 'not_running' };
};

export const finishJob = async (id, { code, note }) => {
  const c = Number.isFinite(Number(code)) ? Math.round(Number(code)) : 1;
  const r = (await query(`UPDATE ops_jobs SET status = CASE WHEN cancel AND $2 <> 0 THEN 'cancelled' WHEN $2 = 0 THEN 'done' ELSE 'failed' END,
                            exit_code = $2, note = $3, finished_at = now() WHERE id = $1 AND status = 'running' RETURNING status, kind`,
    [String(id), c, scrubText(String(note ?? '')).slice(0, 300)])).rows[0];
  return r ? { ok: true, status: r.status, kind: r.kind } : { error: 'not_running' };
};

/** Зависшее и старое: задание без пульса 10 минут — потеряно; ожидающее без агента 15 минут — снято; записи старше 30 дней — удаляются. */
export const sweepOps = async () => {
  await query(`UPDATE ops_jobs SET status = 'failed', note = 'агент перестал отвечать', finished_at = now() WHERE status = 'running' AND heartbeat_at < now() - interval '10 minutes'`);
  await query(`UPDATE ops_jobs SET status = 'cancelled', note = 'агент не взял задание', finished_at = now() WHERE status = 'queued' AND created_at < now() - interval '15 minutes'`);
  await query(`DELETE FROM ops_jobs WHERE created_at < now() - interval '30 days'`);
};
