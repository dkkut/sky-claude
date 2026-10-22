/**
 * Sky Sandbox — проверка обновления ДО публикации.
 *
 * Что здесь, а что нет:
 *  • Здесь (в API): очередь сборок, приём отчётов раннера, РЕШЕНИЕ о вердикте и о допуске к публикации, одобрение, журнал.
 *  • Не здесь: сами проверки (npm ci, сборки, миграции на временной базе, запуск) делает раннер на хосте — sandbox/runner.mjs.
 *    У API нет доступа ни к docker, ни к исходникам, ни к хосту; у раннера для проверок нет доступа к боевой базе и секретам админки.
 *  • Вердикт НЕ берётся со слов раннера: раннер присылает только результаты отдельных проверок, статус считает `verdictOf`.
 *
 * Публикация: проверенная сборка (точный sha) → ручное одобрение сотрудником с `sandbox_publish` и кодом подтверждения →
 * раннер на ПРОДАКШН-хосте: сверка sha, резервная копия, deploy-local, проверка здоровья, при сбое — откат кода.
 * Откат не откатывает базу: миграции Sky только добавляют, и прежний код с новой схемой работает; если в сборке были
 * разрушающие миграции, автооткат не делается — решение за владельцем (восстановление из копии).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';

export const PROFILES = ['full', 'quick'];
export const SHA_RE = /^[0-9a-f]{40}$/;
/** Проверки, обязательные для полного профиля. Нет результата = не пройдена. */
export const REQUIRED = ['checkout', 'install', 'audit', 'secrets', 'types', 'i18n', 'build_web', 'build_native', 'dist_scan', 'compat', 'migrations', 'boot', 'smoke'];
export const CHECK_STATUS = ['ok', 'warn', 'fail', 'skip'];
const MAX_AGE_H = () => Math.max(1, Number(process.env.SANDBOX_MAX_AGE_H) || 24);
const ALLOW_LOCAL_PUBLISH = () => process.env.SANDBOX_ALLOW_LOCAL_PUBLISH === '1' && process.env.NODE_ENV !== 'production';

export const sandboxEnabled = () => String(process.env.SANDBOX_SECRET ?? '').length >= 24;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, n);
const newId = (p) => `${p}-${crypto.randomBytes(8).toString('hex')}`;

/* ── Чистые функции (покрыты тестом без базы) ── */

/** Вырезает из текста отчёта то, что похоже на секрет: отчёт видят все с правом `sandbox`. */
export const scrubText = (t) => String(t ?? '')
  .replace(/(postgres(?:ql)?|redis|mongodb|amqp):\/\/[^\s'"]+/gi, '$1://***')
  .replace(/\b(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/g, '***')
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 ***')
  .replace(/\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASS|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*[=:]\s*\S+/g, '$1=***')
  .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***');

export const cleanChecks = (raw) => (Array.isArray(raw) ? raw : []).slice(0, 60).map((c) => ({
  id: clip(c?.id, 40).replace(/[^\w.-]/g, '_'),
  title: clip(c?.title, 120),
  status: CHECK_STATUS.includes(c?.status) ? c.status : 'fail',
  detail: scrubText(clip(c?.detail, 1500)),
  ms: Math.max(0, Math.min(36e5, Number(c?.ms) || 0)),
  log: scrubText(clip(c?.log, 4000)),
})).filter((c) => c.id);

/**
 * Вердикт сборки. Считает только сервер.
 *  failed   — упала любая проверка, или (полный профиль) обязательной нет в отчёте;
 *  warnings — есть предупреждения/пропуски, ИЛИ изоляция не подтверждена (mode≠isolated), ИЛИ профиль не полный;
 *  passed   — всё обязательное выполнено и ok, изолированно.
 * Раннер, работавший без изоляции, «Проверку пройдена» получить не может — как бы хорошо ни прошли шаги.
 */
export const verdictOf = (checks, { mode, profile = 'full' } = {}) => {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const reasons = [];
  let failed = checks.some((c) => c.status === 'fail');
  if (profile === 'full') for (const id of REQUIRED) if (!byId.has(id)) { failed = true; reasons.push(`нет результата проверки «${id}»`); }
  if (failed) return { status: 'failed', reasons };
  let warn = checks.some((c) => c.status === 'warn' || c.status === 'skip');
  if (mode !== 'isolated') { warn = true; reasons.push('изоляция не подтверждена: проверка шла не в изолированной среде'); }
  if (profile !== 'full') { warn = true; reasons.push('сокращённый профиль: часть проверок не выполнялась'); }
  return { status: warn ? 'warnings' : 'passed', reasons };
};

export const statusLabel = (s) => ({ passed: 'Проверка пройдена', warnings: 'Есть замечания', failed: 'Проверка не пройдена', error: 'Проверка не пройдена', queued: 'В очереди', running: 'Выполняется', cancelled: 'Отменена' }[s] ?? s);

const CRITICAL_RULES = [
  [/^server\/migrations\//, 'миграции базы данных'],
  [/^server\/(auth|session|sessionstore|crypto|mediacrypto|wallet|adminsec|admin|roles|admingate|sshgate|applock|passkeys|oidc|accountrecovery|selfdefense|skystorage[a-z]*)\.mjs$/, 'ядро входа, прав, шифрования или денег'],
  [/^server\/server\.mjs$/, 'точка входа сервера'],
  [/^(docker-compose\.yml|Dockerfile(\.api)?|nginx\/)/, 'контейнеры и nginx'],
  [/^scripts\/(deploy-local|backup|ssh-gate|sky-guard|rescue-access|install-[a-z-]+)\.sh$/, 'скрипты развёртывания и защиты хоста'],
  [/^\.github\/workflows\//, 'конвейеры сборки'],
  [/^sandbox\//, 'сам Sky Sandbox'],
];
/** Критичность по списку изменённых файлов относительно боевой версии. Критичное одобряет только владелец. */
export const analyzeChange = (files) => {
  const list = (Array.isArray(files) ? files : []).slice(0, 5000).map((f) => String(f).replace(/^\.?\//, ''));
  const reasons = new Set();
  for (const f of list) for (const [re, why] of CRITICAL_RULES) if (re.test(f)) reasons.add(why);
  const mig = list.filter((f) => /^server\/migrations\/.+\.sql$/.test(f));
  return { critical: reasons.size > 0, reasons: [...reasons], hasMigrations: mig.length > 0, migrations: mig };
};

/** Признаки разрушающего SQL в тексте новой миграции (откат кода после них небезопасен). */
export const destructiveSql = (sql) => {
  const t = String(sql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return /\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|TYPE|INDEX\s+(?!IF\s+EXISTS\s+\w+_tmp))|\bTRUNCATE\b|\bRENAME\s+(TO|COLUMN)\b|\bALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+(TYPE|SET\s+NOT\s+NULL)|\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i.test(t);
};

/**
 * Допуск к публикации. Чистая функция: сборка + запрос → { ok } или { error }.
 *  • статус passed — публиковать можно; warnings — только с явным подтверждением и только если замечания не про изоляцию/профиль;
 *  • sha в запросе должен совпасть с проверенным; отчёт не старше SANDBOX_MAX_AGE_H;
 *  • критичное (миграции, ядро, развёртывание) — только владелец.
 */
export const publishGate = (build, { sha, acceptWarnings = false, actorIsOwner = false, actorId, now = Date.now() } = {}) => {
  if (!build) return { error: 'build_not_found' };
  if (!SHA_RE.test(String(sha ?? '')) || sha !== build.sha) return { error: 'sha_mismatch' };
  if (build.status === 'failed' || build.status === 'error') return { error: 'not_publishable', hint: 'Проверка не пройдена' };
  if (build.status !== 'passed' && build.status !== 'warnings') return { error: 'not_checked' };
  const weak = build.mode !== 'isolated' || build.profile !== 'full';
  if (weak && !ALLOW_LOCAL_PUBLISH()) return { error: 'isolation_required', hint: 'Сборка проверялась без изоляции или по сокращённому профилю — публиковать нельзя. Повторите проверку на раннере с изоляцией.' };
  if (build.status === 'warnings' && !acceptWarnings) return { error: 'warnings_not_accepted' };
  const finished = build.finished_at ? new Date(build.finished_at).getTime() : 0;
  if (!finished || now - finished > MAX_AGE_H() * 3600e3) return { error: 'report_stale', hint: `Отчёту больше ${MAX_AGE_H()} ч — запустите проверку заново.` };
  if (build.critical && !actorIsOwner) return { error: 'owner_required', reasons: build.critical_reasons };
  if (build.requested_by === actorId && !actorIsOwner) return { error: 'self_approval' };
  return { ok: true, critical: !!build.critical };
};

/** Можно ли откатывать код автоматически: схема только росла. */
export const rollbackPlan = ({ hasMigrations, destructive }) => destructive
  ? { auto: false, how: 'db_restore', note: 'В сборке были разрушающие миграции: прежний код может не работать с новой схемой. Нужно восстановление базы из резервной копии (решает владелец).' }
  : hasMigrations
    ? { auto: true, how: 'code', note: 'Миграции только добавляли: откатывается код, база остаётся новой (прежний код с ней совместим).' }
    : { auto: true, how: 'code', note: 'Откат возвращает прежний код.' };

/* ── База ── */

const rowBuild = (r) => r && ({ ...r, created_at: r.created_at, report: r.report ?? {} });

export const listBuilds = async (limit = 50) => {
  const { rows } = await query(
    `SELECT id, sha, ref, note, profile, mode, status, requested_by, rerun_of, counts, has_migrations, destructive, critical, critical_reasons, error, created_at, claimed_at, finished_at
       FROM sandbox_builds ORDER BY created_at DESC LIMIT $1`, [Math.min(200, Math.max(1, Number(limit) || 50))]);
  return rows.map((r) => ({ ...r, label: statusLabel(r.status) }));
};
export const getBuild = async (id) => {
  const { rows } = await query('SELECT * FROM sandbox_builds WHERE id = $1', [String(id).slice(0, 40)]);
  return rows[0] ? { ...rowBuild(rows[0]), label: statusLabel(rows[0].status) } : null;
};

export const createBuild = async (actor, { sha, ref, note, profile, rerunOf } = {}) => {
  const s = String(sha ?? '').toLowerCase();
  if (!SHA_RE.test(s)) return { error: 'bad_sha', hint: 'Нужен полный идентификатор коммита (40 знаков)' };
  const pr = PROFILES.includes(profile) ? profile : 'full';
  const open = await query(`SELECT count(*)::int AS n FROM sandbox_builds WHERE status IN ('queued','running')`);
  if (open.rows[0].n >= 5) return { error: 'queue_full' };
  const id = newId('sbx');
  await query(
    `INSERT INTO sandbox_builds (id, sha, ref, note, profile, requested_by, rerun_of) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, s, clip(ref, 120), clip(note, 300), pr, actor, rerunOf ?? null]);
  return { id, sha: s };
};

export const cancelBuild = async (id) => {
  const { rowCount } = await query(`UPDATE sandbox_builds SET status='cancelled', finished_at=now() WHERE id=$1 AND status IN ('queued','running')`, [id]);
  return rowCount ? { ok: true } : { error: 'not_cancellable' };
};

/** Раннер берёт самое старое задание: проверку сборки или публикацию (если умеет и то и другое). */
export const claimJob = async (runner, caps = ['check']) => {
  const r = clip(runner, 60) || 'runner';
  if (caps.includes('deploy')) {
    const { rows } = await query(
      `UPDATE sandbox_publications SET status='running', started_at=now(), runner=$1
        WHERE id = (SELECT id FROM sandbox_publications WHERE status='approved' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [r]);
    if (rows[0]) return { kind: rows[0].kind, publication: rows[0] };
  }
  if (caps.includes('check')) {
    const { rows } = await query(
      `UPDATE sandbox_builds SET status='running', claimed_at=now(), runner=$1
        WHERE id = (SELECT id FROM sandbox_builds WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, sha, ref, profile`, [r]);
    if (rows[0]) return { kind: 'check', build: rows[0] };
  }
  return null;
};

/** Итог проверки от раннера. Вердикт считается здесь. */
export const finishBuild = async (id, body = {}) => {
  const b = await getBuild(id);
  if (!b) return { error: 'not_found' };
  if (b.status !== 'running') return { error: 'not_running' };
  if (body.error) {
    await query(`UPDATE sandbox_builds SET status='error', error=$2, finished_at=now() WHERE id=$1`, [id, scrubText(clip(body.error, 500))]);
    return { ok: true, status: 'error' };
  }
  const checks = cleanChecks(body.checks);
  const mode = body.mode === 'isolated' ? 'isolated' : 'local';
  const v = verdictOf(checks, { mode, profile: b.profile });
  const change = analyzeChange(body.changedFiles);
  const destructive = !!body.destructive;
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) counts[c.status]++;
  const report = { checks, reasons: v.reasons, files: change.migrations.slice(0, 50), changed: Math.min(5000, Array.isArray(body.changedFiles) ? body.changedFiles.length : 0), baseSha: /^[0-9a-f]{40}$/.test(body.baseSha ?? '') ? body.baseSha : null, durationMs: Math.max(0, Number(body.durationMs) || 0) };
  await query(
    `UPDATE sandbox_builds SET status=$2, mode=$3, report=$4::jsonb, counts=$5::jsonb, has_migrations=$6, destructive=$7, critical=$8, critical_reasons=$9::jsonb, finished_at=now()
      WHERE id=$1 AND status='running'`,
    [id, v.status, mode, JSON.stringify(report), JSON.stringify(counts), change.hasMigrations, destructive, change.critical || destructive, JSON.stringify(destructive ? [...change.reasons, 'разрушающая миграция'] : change.reasons)]);
  return { ok: true, status: v.status };
};

/** Промежуточный отчёт: видно, как идёт проверка. Вердикт не выставляется. */
export const progressBuild = async (id, body = {}) => {
  const checks = cleanChecks(body.checks);
  const { rowCount } = await query(`UPDATE sandbox_builds SET report = jsonb_build_object('checks', $2::jsonb, 'partial', true) WHERE id=$1 AND status='running'`, [id, JSON.stringify(checks)]);
  return rowCount ? { ok: true } : { error: 'not_running' };
};

/** Раннер, умерший посреди проверки, не должен держать очередь. */
export const sweepSandbox = async () => {
  await query(`UPDATE sandbox_builds SET status='error', error='Раннер не прислал результат вовремя', finished_at=now() WHERE status='running' AND claimed_at < now() - interval '45 minutes'`);
  await query(`UPDATE sandbox_builds SET status='cancelled', finished_at=now(), error='Не взято раннером за 6 часов' WHERE status='queued' AND created_at < now() - interval '6 hours'`);
  /* Публикация, зависшая у раннера: помечаем как сбой и честно говорим, что состояние неизвестно. */
  await query(`UPDATE sandbox_publications SET status='failed', finished_at=now(), outcome_note='Раннер не сообщил результат: состояние боевого сервера неизвестно — проверьте вручную' WHERE status='running' AND started_at < now() - interval '120 minutes'`);
  await query(`UPDATE sandbox_publications SET status='cancelled', finished_at=now(), outcome_note='Не взята раннером за 2 часа' WHERE status='approved' AND created_at < now() - interval '2 hours'`);
};

/* ── Публикации ── */

export const listPublications = async (limit = 30) => {
  const { rows } = await query(`SELECT * FROM sandbox_publications ORDER BY created_at DESC LIMIT $1`, [Math.min(100, Math.max(1, Number(limit) || 30))]);
  return rows.map((r) => ({ ...r, plan: rollbackPlan({ hasMigrations: r.has_migrations, destructive: r.destructive }) }));
};

export const approvePublication = async (actor, actorIsOwner, { buildId, sha, acceptWarnings, note } = {}) => {
  const b = await getBuild(buildId);
  const g = publishGate(b, { sha, acceptWarnings: !!acceptWarnings, actorIsOwner, actorId: actor });
  if (g.error) return g;
  const id = newId('pub');
  try {
    await query(
      `INSERT INTO sandbox_publications (id, build_id, sha, approved_by, owner_confirmed, accept_warnings, critical, has_migrations, destructive, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, b.id, b.sha, actor, actorIsOwner, !!acceptWarnings, !!b.critical, b.has_migrations, b.destructive, clip(note, 300)]);
  } catch (e) {
    if (e.code === '23505') return { error: 'publication_in_progress' };
    throw e;
  }
  return { id, sha: b.sha, critical: !!b.critical, plan: rollbackPlan({ hasMigrations: b.has_migrations, destructive: b.destructive }) };
};

/** Откат на версию, стоявшую до публикации. Всегда владелец, если схема менялась. */
export const requestRollback = async (actor, actorIsOwner, pubId, { confirmSchema } = {}) => {
  const { rows } = await query('SELECT * FROM sandbox_publications WHERE id = $1', [String(pubId).slice(0, 40)]);
  const p = rows[0];
  if (!p || p.kind !== 'deploy') return { error: 'not_found' };
  if (!['deployed', 'failed'].includes(p.status) || !SHA_RE.test(p.prev_sha ?? '')) return { error: 'nothing_to_roll_back', hint: 'Нет сведений о прежней версии' };
  const newer = await query(`SELECT 1 FROM sandbox_publications WHERE created_at > $1 AND status = 'deployed' LIMIT 1`, [p.created_at]);
  if (newer.rows.length) return { error: 'newer_deployed', hint: 'После этой публикации выходили другие — откатывайте последнюю' };
  const plan = rollbackPlan({ hasMigrations: p.has_migrations, destructive: p.destructive });
  if (!plan.auto) return { error: 'manual_restore_required', hint: plan.note };
  if ((p.has_migrations || p.critical) && !actorIsOwner) return { error: 'owner_required' };
  if (p.has_migrations && !confirmSchema) return { error: 'confirm_schema', hint: plan.note };
  const id = newId('pub');
  try {
    await query(
      `INSERT INTO sandbox_publications (id, kind, build_id, sha, approved_by, owner_confirmed, critical, has_migrations, destructive, note, of_publication)
       VALUES ($1,'rollback',NULL,$2,$3,$4,$5,FALSE,FALSE,$6,$7)`,
      [id, p.prev_sha, actor, actorIsOwner, !!p.critical, `Откат публикации ${p.id}`, p.id]);
  } catch (e) { if (e.code === '23505') return { error: 'publication_in_progress' }; throw e; }
  return { id, sha: p.prev_sha, plan };
};

export const cancelPublication = async (id) => {
  const { rowCount } = await query(`UPDATE sandbox_publications SET status='cancelled', finished_at=now(), outcome_note='Отменена до начала' WHERE id=$1 AND status='approved'`, [id]);
  return rowCount ? { ok: true } : { error: 'not_cancellable' };
};

const cleanSteps = (raw) => (Array.isArray(raw) ? raw : []).slice(0, 40).map((s) => ({
  id: clip(s?.id, 40).replace(/[^\w.-]/g, '_'), title: clip(s?.title, 120),
  status: ['ok', 'warn', 'fail', 'skip', 'run'].includes(s?.status) ? s.status : 'fail', detail: scrubText(clip(s?.detail, 800)),
})).filter((s) => s.id);

export const progressPublication = async (id, body = {}) => {
  const steps = cleanSteps(body.steps);
  const { rowCount } = await query(`UPDATE sandbox_publications SET steps=$2::jsonb, prev_sha = COALESCE($3, prev_sha), backup_ref = COALESCE($4, backup_ref) WHERE id=$1 AND status='running'`,
    [id, JSON.stringify(steps), SHA_RE.test(body.prevSha ?? '') ? body.prevSha : null, body.backupRef ? clip(body.backupRef, 200) : null]);
  return rowCount ? { ok: true } : { error: 'not_running' };
};

/** Итог публикации. outcome: deployed | failed | rolled_back. */
export const finishPublication = async (id, body = {}) => {
  const outcome = ['deployed', 'failed', 'rolled_back'].includes(body.outcome) ? body.outcome : 'failed';
  const steps = cleanSteps(body.steps);
  const { rowCount } = await query(
    `UPDATE sandbox_publications SET status=$2, steps=$3::jsonb, health=$4::jsonb, outcome_note=$5, prev_sha=COALESCE($6, prev_sha), backup_ref=COALESCE($7, backup_ref), finished_at=now()
      WHERE id=$1 AND status='running'`,
    [id, outcome, JSON.stringify(steps), JSON.stringify(body.health && typeof body.health === 'object' ? JSON.parse(scrubText(JSON.stringify(body.health)).slice(0, 4000) || '{}') : {}), scrubText(clip(body.note, 500)),
      SHA_RE.test(body.prevSha ?? '') ? body.prevSha : null, body.backupRef ? clip(body.backupRef, 200) : null]);
  return rowCount ? { ok: true, status: outcome } : { error: 'not_running' };
};

const runnersSeen = new Map();
export const touchRunner = (name, caps) => { runnersSeen.set(clip(name, 60) || 'runner', { at: Date.now(), caps: (Array.isArray(caps) ? caps : []).filter((c) => ['check', 'deploy'].includes(c)) }); };

export const overview = async () => {
  const [builds, pubs, last] = await Promise.all([
    listBuilds(40), listPublications(20),
    query(`SELECT id, sha, finished_at FROM sandbox_publications WHERE status='deployed' ORDER BY finished_at DESC LIMIT 1`),
  ]);
  for (const [k, v] of runnersSeen) if (Date.now() - v.at > 3600e3) runnersSeen.delete(k);
  const rn = [...runnersSeen.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, 3).map(([runner, v]) => ({ runner, seen: new Date(v.at).toISOString(), caps: v.caps, online: Date.now() - v.at < 60_000 }));
  return { enabled: sandboxEnabled(), builds, publications: pubs, lastDeployed: last.rows[0] ?? null, runners: rn, requiredChecks: REQUIRED, maxAgeHours: MAX_AGE_H() };
};
