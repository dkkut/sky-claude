#!/usr/bin/env node
/**
 * Раннер Sky Sandbox — отдельный процесс на хосте (не в API и не в контейнере API).
 *
 *   node sandbox/runner.mjs --once                 # одна итерация (проверка или публикация)
 *   node sandbox/runner.mjs                        # цикл: опрашивает API раз в 15 с
 *   --allow-deploy                                 # умеет ПУБЛИКАЦИЮ (только на боевом хосте)
 *
 * Окружение: SANDBOX_API (https://…), SANDBOX_SECRET (тот же, что в .env API), SANDBOX_REPO (git-адрес или путь),
 *   SANDBOX_WORK (рабочий каталог, по умолчанию /var/lib/sky-sandbox), SANDBOX_MODE=docker|local, SANDBOX_BRANCH,
 *   SANDBOX_PROD_SRC (клон боевого сервера: оттуда берётся «что сейчас в проде»), SANDBOX_PG_URL (локальный режим: админ-подключение
 *   к ВРЕМЕННОМУ Postgres — не к боевому), SANDBOX_REDIS_URL, SANDBOX_APP_DIR (/opt/sky), SANDBOX_NODE_IMAGE.
 *
 * Изоляция (mode=docker): проверки идут в контейнерах без доступа к хосту; установка зависимостей — отдельным шагом с сетью
 *   (`npm ci --ignore-scripts`), всё остальное (сборка, миграции, запуск сервера, сценарии) — в сети `--internal` без выхода наружу,
 *   со своим временным Postgres и Redis, с ограничением CPU/памяти/процессов и таймаутом, контейнеры и сеть удаляются в конце.
 *   У проверяемого кода нет ни .env, ни секретов API, ни доступа к боевой базе. Режим local (без docker) этого НЕ гарантирует —
 *   сервер пометит такую проверку как «изоляция не подтверждена» и не допустит её к публикации.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const E = process.env;
const API = (E.SANDBOX_API ?? '').replace(/\/$/, '');
const SECRET = E.SANDBOX_SECRET ?? '';
const WORK = E.SANDBOX_WORK ?? '/var/lib/sky-sandbox';
const MODE = E.SANDBOX_MODE === 'local' ? 'local' : 'docker';
const BRANCH = E.SANDBOX_BRANCH ?? 'claude/project-server-setup-opwwui';
const REPO = E.SANDBOX_REPO ?? '';
const NAME = E.SANDBOX_RUNNER_NAME ?? `${MODE}-${process.pid}`;
const NODE_IMAGE = E.SANDBOX_NODE_IMAGE ?? 'node:20-bookworm';
const STEP_TIMEOUT = Number(E.SANDBOX_STEP_TIMEOUT_SEC ?? 900) * 1000;
const CAPS = args.has('--allow-deploy') ? ['check', 'deploy'] : ['check'];
const log = (...a) => console.log(new Date().toISOString(), ...a);
if (!API || SECRET.length < 24) { console.error('Нужны SANDBOX_API и SANDBOX_SECRET (от 24 знаков)'); process.exit(2); }

/* ── Связь с API ── */
const call = async (method, p, body) => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(12).toString('hex');
  const sig = crypto.createHmac('sha256', SECRET).update(`${ts}\n${nonce}\n${method}\n${p}\n${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', 'x-sbx-ts': String(ts), 'x-sbx-nonce': nonce, 'x-sbx-sig': sig }, body: raw || undefined, signal: AbortSignal.timeout(30_000) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

/* ── Запуск команд ── */
const tail = (s, n = 3500) => (s.length > n ? '…' + s.slice(-n) : s);
const run = (argv, { cwd, env, timeout = STEP_TIMEOUT, input } = {}) => new Promise((resolve) => {
  const p = spawn(argv[0], argv.slice(1), { cwd, env: env ?? E, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; const add = (d) => { out += d; if (out.length > 200_000) out = out.slice(-100_000); };
  p.stdout.on('data', add); p.stderr.on('data', add);
  const to = setTimeout(() => { out += '\n[таймаут шага]'; p.kill('SIGKILL'); }, timeout);
  p.on('error', (e) => { clearTimeout(to); resolve({ code: 127, out: String(e.message) }); });
  p.on('close', (code) => { clearTimeout(to); resolve({ code: code ?? 1, out }); });
  if (input) p.stdin.end(input); else p.stdin.end();
});
const sh = (cmd, opts) => run(['bash', '-lc', cmd], opts);

/* ── Среда проверки: docker (изоляция) или local ── */
class Env {
  constructor(id, dir) { this.id = id; this.dir = dir; this.net = `sbx-net-${id}`; this.c = []; this.pg = null; this.redis = null; this.ports = { api: 18090, sig: 18091 }; }
  /** Команда в проверяемой копии. net: 'open' (только установка зависимостей) | 'inner' (сеть без выхода наружу). */
  exec(cmd, { net = 'inner', env = {}, timeout } = {}) {
    if (MODE === 'local') return sh(cmd, { cwd: this.dir, env: { ...E, NODE_ENV: 'development', ...env, ...this.localEnv() }, timeout });
    const e = Object.entries({ ...env }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const network = net === 'open' ? 'bridge' : this.net;
    return run(['docker', 'run', '--rm', '--network', network, '--cpus', '2', '--memory', '3g', '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', `${this.dir}:/work`, '-w', '/work', ...e, NODE_IMAGE, 'bash', '-lc', cmd], { timeout });
  }
  localEnv() { return this.pgUrl ? { DATABASE_URL: this.pgUrl, REDIS_URL: this.redisUrl } : {}; }
  async up() {
    if (MODE === 'local') {
      const admin = E.SANDBOX_PG_URL; if (!admin) throw new Error('local: нужен SANDBOX_PG_URL (ВРЕМЕННЫЙ Postgres, не боевой)');
      if (admin === E.DATABASE_URL) throw new Error('SANDBOX_PG_URL совпадает с DATABASE_URL — отказ');
      this.dbName = `sbx_${this.id.replace(/\W/g, '').slice(0, 24)}`;
      const r = await sh(`psql "${admin}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${this.dbName}"`);
      if (r.code) throw new Error('не создалась временная база: ' + tail(r.out, 300));
      const u = new URL(admin); u.pathname = '/' + this.dbName; this.pgUrl = u.toString(); this.redisUrl = E.SANDBOX_REDIS_URL ?? 'redis://127.0.0.1:6380/14'; this.admin = admin; return;
    }
    let r = await run(['docker', 'network', 'create', '--internal', this.net]); if (r.code) throw new Error('docker network: ' + tail(r.out, 200));
    const pw = crypto.randomBytes(12).toString('hex');
    r = await run(['docker', 'run', '-d', '--rm', '--name', `sbx-pg-${this.id}`, '--network', this.net, '--network-alias', 'pg', '--memory', '1g', '-e', `POSTGRES_PASSWORD=${pw}`, '-e', 'POSTGRES_USER=sky', '-e', 'POSTGRES_DB=sky', 'postgres:16']);
    if (r.code) throw new Error('docker postgres: ' + tail(r.out, 200)); this.c.push(`sbx-pg-${this.id}`);
    r = await run(['docker', 'run', '-d', '--rm', '--name', `sbx-rd-${this.id}`, '--network', this.net, '--network-alias', 'rd', '--memory', '256m', 'redis:7']);
    if (r.code) throw new Error('docker redis: ' + tail(r.out, 200)); this.c.push(`sbx-rd-${this.id}`);
    this.pgUrl = `postgres://sky:${pw}@pg:5432/sky`; this.redisUrl = 'redis://rd:6379';
    for (let i = 0; i < 40; i++) { const p = await run(['docker', 'exec', `sbx-pg-${this.id}`, 'pg_isready', '-U', 'sky']); if (!p.code) return; await new Promise((s) => setTimeout(s, 1500)); }
    throw new Error('Postgres не поднялся');
  }
  /** psql во временную базу. */
  psql(sql) {
    if (MODE === 'local') return run(['psql', this.pgUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql]);
    return run(['docker', 'exec', `sbx-pg-${this.id}`, 'psql', '-U', 'sky', '-d', 'sky', '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql]);
  }
  async down() {
    for (const c of this.c) await run(['docker', 'rm', '-f', c]);
    if (MODE === 'docker') await run(['docker', 'network', 'rm', this.net]);
    else if (this.dbName && this.admin) await sh(`psql "${this.admin}" -c "DROP DATABASE IF EXISTS ${this.dbName} WITH (FORCE)"`);
    await run(['rm', '-rf', this.dir]);
  }
}

/* ── Проверки ── */
const step = (id, title, status, detail = '', t0 = Date.now(), logText = '') => ({ id, title, status, detail, ms: Date.now() - t0, log: logText ? tail(logText) : '' });
const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/, /postgres(?:ql)?:\/\/[^\s:@'"]+:[^\s@'"]{4,}@(?!pg:|127\.|localhost)[^\s'"]+/];

const checkout = async (env, sha, report) => {
  const t0 = Date.now();
  if (!REPO) return step('checkout', 'Получение кода', 'fail', 'SANDBOX_REPO не задан', t0);
  const cache = path.join(WORK, 'repo.git');
  fs.mkdirSync(WORK, { recursive: true });
  if (!fs.existsSync(cache)) { const c = await run(['git', 'clone', '--mirror', REPO, cache]); if (c.code) return step('checkout', 'Получение кода', 'fail', 'clone: ' + tail(c.out, 300), t0); }
  else await run(['git', '-C', cache, 'remote', 'update', '--prune']);
  const has = await run(['git', '-C', cache, 'cat-file', '-e', `${sha}^{commit}`]);
  if (has.code) return step('checkout', 'Получение кода', 'fail', 'такого коммита нет в репозитории', t0);
  fs.mkdirSync(env.dir, { recursive: true });
  const x = await sh(`git -C "${cache}" archive ${sha} | tar -x -C "${env.dir}"`);
  if (x.code) return step('checkout', 'Получение кода', 'fail', tail(x.out, 300), t0);
  /* Для сканера секретов (git ls-files) нужен индекс: пустой репозиторий внутри копии, без связи с настоящим. */
  await sh('git init -q . && git add -A', { cwd: env.dir });
  /* Что изменилось относительно боевой версии (или ветки). */
  let base = '';
  if (E.SANDBOX_PROD_SRC) base = (await run(['git', '-C', E.SANDBOX_PROD_SRC, 'rev-parse', 'HEAD'])).out.trim();
  if (!/^[0-9a-f]{40}$/.test(base)) base = (await run(['git', '-C', cache, 'merge-base', sha, BRANCH])).out.trim();
  if (/^[0-9a-f]{40}$/.test(base) && base !== sha) {
    const d = await run(['git', '-C', cache, 'diff', '--name-only', base, sha]); report.changedFiles = d.out.split('\n').filter(Boolean).slice(0, 5000);
    report.baseSha = base; report.cache = cache;
  } else { report.changedFiles = []; report.baseSha = /^[0-9a-f]{40}$/.test(base) ? base : null; report.cache = cache; }
  return step('checkout', 'Получение кода', 'ok', `${sha.slice(0, 12)}, изменено файлов: ${report.changedFiles.length}${report.baseSha ? `, база ${report.baseSha.slice(0, 12)}` : ', база не определена'}`, t0);
};

const compat = async (env, report) => {
  const t0 = Date.now(); const base = report.baseSha; const cache = report.cache; const notes = []; let status = 'ok';
  if (!base) return step('compat', 'Совместимость', 'warn', 'не определена боевая версия — сравнение невозможно', t0);
  const ns = await run(['git', '-C', cache, 'diff', '--name-status', base, report.sha, '--', 'server/migrations']);
  const rows = ns.out.split('\n').filter(Boolean).map((l) => l.split('\t'));
  for (const [st, f, f2] of rows) if (st !== 'A') { status = 'fail'; notes.push(`существующая миграция изменена/удалена/переименована: ${f}${f2 ? ' → ' + f2 : ''} (${st})`); }
  const added = rows.filter(([st]) => st === 'A').map(([, f]) => f);
  const all = fs.readdirSync(path.join(env.dir, 'server/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const nums = all.map((f) => f.split('_')[0]);
  if (new Set(nums).size !== nums.length) { status = 'fail'; notes.push('номера миграций повторяются'); }
  const baseMax = (await run(['git', '-C', cache, 'ls-tree', '--name-only', base, 'server/migrations/'])).out.split('\n').map((f) => path.basename(f).split('_')[0]).filter(Boolean).sort().pop() ?? '000';
  for (const f of added) if (path.basename(f).split('_')[0] <= baseMax) { status = 'fail'; notes.push(`новая миграция ${path.basename(f)} вставлена раньше последней боевой (${baseMax})`); }
  report.destructive = false;
  for (const f of added) {
    const sql = fs.readFileSync(path.join(env.dir, f), 'utf8');
    const t = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|TYPE)\b|\bTRUNCATE\b|\bRENAME\s+(TO|COLUMN)\b|\bALTER\s+TABLE\s+\S+\s+ALTER\s+COLUMN\s+\S+\s+(TYPE|SET\s+NOT\s+NULL)|\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i.test(t)) { report.destructive = true; if (status === 'ok') status = 'warn'; notes.push(`${path.basename(f)}: разрушающий SQL — откат кода без восстановления базы небезопасен`); }
    if (/\b(CREATE|ALTER)\s+ROLE\b|\bCREATE\s+EXTENSION\b(?!\s+IF\s+NOT\s+EXISTS\s+(pgcrypto|pg_trgm|citext|uuid-ossp))/i.test(t)) { if (status === 'ok') status = 'warn'; notes.push(`${path.basename(f)}: требует прав суперпользователя`); }
  }
  /* Новые переменные окружения сервера должны быть в docker-compose.yml. */
  try {
    const compose = fs.readFileSync(path.join(env.dir, 'docker-compose.yml'), 'utf8');
    const oldSrc = await run(['bash', '-lc', `git -C "${cache}" grep -hoE "process\\.env\\.[A-Z0-9_]+" ${base} -- server | sort -u`]);
    const newSrc = await sh(`grep -rhoE --exclude-dir=node_modules "process\\.env\\.[A-Z0-9_]+" server | sort -u`, { cwd: env.dir });
    const known = new Set(oldSrc.out.split('\n').map((l) => l.replace(/^.*?:/, '').replace('process.env.', '').trim()));
    const fresh = newSrc.out.split('\n').map((l) => l.replace('process.env.', '').trim()).filter((v) => v && !known.has(v) && !new RegExp(`\\b${v}\\b`).test(compose));
    if (fresh.length) { if (status === 'ok') status = 'warn'; notes.push('новые переменные окружения не прописаны в docker-compose.yml: ' + fresh.slice(0, 8).join(', ')); }
  } catch { /* сравнение необязательно */ }
  return step('compat', 'Совместимость (миграции, переменные)', status, notes.join('; ') || `новых миграций: ${added.length}, существующие не тронуты`, t0);
};

const migrations = async (env, report) => {
  const t0 = Date.now();
  const base = report.baseSha; const cache = report.cache;
  if (!/^sbx_|^sky$/.test(env.dbName ?? 'sky')) return step('migrations', 'Миграции на тестовой копии', 'fail', 'неожиданное имя базы', t0);
  const mk = await env.psql('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  if (mk.code) return step('migrations', 'Миграции на тестовой копии', 'fail', tail(mk.out, 400), t0);
  /* Этап 1: схема боевой версии (по её миграциям) — пустая копия, данных людей в песочнице нет. */
  let phase1 = 'без базовой схемы (только чистая установка)';
  if (base) {
    const list = (await run(['git', '-C', cache, 'ls-tree', '--name-only', base, 'server/migrations/'])).out.split('\n').filter((f) => f.endsWith('.sql')).sort();
    const dump = path.join(env.dir, '.sbx-base.sql');
    const parts = [];
    for (const f of list) { const s = (await run(['git', '-C', cache, 'show', `${base}:${f}`])).out; parts.push(`BEGIN;\n${s}\nINSERT INTO schema_migrations(name) VALUES ('${path.basename(f)}');\nCOMMIT;`); }
    fs.writeFileSync(dump, parts.join('\n'));
    const ap = MODE === 'local' ? await run(['psql', env.pgUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-f', dump]) : await run(['bash', '-c', `docker exec -i sbx-pg-${env.id} psql -U sky -d sky -v ON_ERROR_STOP=1 -q < "${dump}"`]);
    fs.rmSync(dump, { force: true });
    if (ap.code) return step('migrations', 'Миграции на тестовой копии', 'fail', 'боевая схема не поднялась: ' + tail(ap.out, 500), t0, ap.out);
    phase1 = `схема боевой версии (${list.length} миграций)`;
  }
  /* Этап 2: миграции проверяемой сборки поверх, затем повторно — ничего не должно примениться. */
  const script = `node --input-type=module -e "import { migrate, pendingMigrations, closeDb } from './server/db.mjs'; await migrate(); const p = await pendingMigrations(); console.log('PENDING:' + p.length); await migrate(); await closeDb();"`;
  const m = await env.exec(script, { env: { NODE_ENV: 'development', DATABASE_URL: env.pgUrl, REDIS_URL: env.redisUrl } });
  if (m.code || !/PENDING:0/.test(m.out)) return step('migrations', 'Миграции на тестовой копии', 'fail', tail(m.out, 500), t0, m.out);
  return step('migrations', 'Миграции на тестовой копии', 'ok', `${phase1} → миграции сборки применены, повтор безопасен`, t0);
};

const boot = async (env, sha) => {
  const t0 = Date.now();
  const e = { NODE_ENV: 'development', DATABASE_URL: env.pgUrl, REDIS_URL: env.redisUrl, API_PORT: String(env.ports.api), SIGNAL_PORT: String(env.ports.sig), JWT_SECRET: crypto.randomBytes(24).toString('hex'), REFRESH_TOKEN_SECRET: crypto.randomBytes(24).toString('hex'), ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), ADMIN_GATE: 'off', RATE_LIMIT_PER_MINUTE: '5000', EMAIL_MODE: 'log', SKIP_MIGRATE_ON_START: '0', DOMAIN: 'sandbox.invalid', TRANSFER_DIR: '/tmp/sbx-transfer' };
  const dirs = 'mkdir -p /tmp/sbx-transfer';
  const start = `${dirs}; nohup node server/server.mjs > /tmp/api.log 2>&1 & echo $! > /tmp/api.pid`;
  const smoke = `for i in $(seq 1 60); do curl -fs http://127.0.0.1:${env.ports.api}/healthz >/dev/null && break; sleep 1; done; curl -fs http://127.0.0.1:${env.ports.api}/healthz >/dev/null || { echo SERVER_DID_NOT_START; tail -n 40 /tmp/api.log; exit 3; }; echo BOOT_OK`;
  const cmd = `${start}; ${smoke}; API_BASE=http://127.0.0.1:${env.ports.api} node scripts/audit/sandbox-smoke.mjs /tmp > /tmp/smoke.out 2>&1; echo SMOKE_CODE:$?; cat /tmp/smoke.out; kill $(cat /tmp/api.pid) 2>/dev/null; echo ---API---; tail -n 25 /tmp/api.log`;
  const r = await env.exec(cmd, { env: e, timeout: 300_000 });
  const booted = /BOOT_OK/.test(r.out);
  const smokeOk = /SMOKE_CODE:0/.test(r.out);
  const bootStep = step('boot', 'Запуск сервера на тестовой базе', booted ? 'ok' : 'fail', booted ? 'сервер поднялся и ответил на /healthz' : 'сервер не поднялся за 60 с', t0, booted ? '' : r.out);
  const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 6).join('; ');
  const smokeStep = step('smoke', 'Критические сценарии', booted && smokeOk ? 'ok' : 'fail', booted ? (smokeOk ? `${(r.out.match(/^ok /gm) ?? []).length} проверок пройдено` : `не пройдено: ${fails || 'сценарий оборвался'}`) : 'сервер не запущен', t0, r.out.split('---API---')[0]);
  return [bootStep, smokeStep];
};

const runCheck = async (job) => {
  const { id, sha, profile } = job.build; const t0 = Date.now();
  const env = new Env(id.replace(/\W/g, ''), path.join(WORK, 'run', id)); const checks = []; const rep = { sha };
  const push = async (c) => { checks.push(c); log(`${c.status.padEnd(4)} ${c.id} ${c.detail.slice(0, 100)}`); await call('POST', `/api/sandbox/runner/build/${id}/progress`, { checks }).catch(() => {}); return c; };
  let result;
  try {
    await env.up().catch((e) => { throw new Error('среда: ' + e.message); });
    const co = await push(await checkout(env, sha, rep));
    if (co.status !== 'fail') {
      const inst = await (async () => { const t = Date.now(); const r = await env.exec('npm ci --ignore-scripts --no-audit --no-fund && (cd server && npm ci --ignore-scripts --no-audit --no-fund)', { net: 'open', timeout: 900_000 }); return step('install', 'Установка зависимостей (без скриптов пакетов)', r.code ? 'fail' : 'ok', r.code ? 'npm ci не прошёл' : 'зависимости установлены', t, r.code ? r.out : ''); })();
      await push(inst);
      const quick = profile === 'quick';
      const sc = await (async () => { const t = Date.now(); const r = await env.exec('bash scripts/secret-scan.sh', {}); return step('secrets', 'Поиск секретов в коде', r.code ? 'fail' : 'ok', r.code ? tail(r.out, 400) : 'секретов не найдено', t, r.code ? r.out : ''); })();
      await push(sc);
      await push(await compat(env, rep).catch((e) => step('compat', 'Совместимость', 'fail', String(e.message))));
      if (inst.status === 'ok') {
        await push(await (async () => { const t = Date.now(); const sum = {}; let any = false; for (const dir of ['.', 'server']) { const r = await env.exec(`cd ${dir} && npm audit --omit=dev --json || true`, { net: 'open', timeout: 120_000 }); let j; try { j = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { continue; } any = true; for (const [k, n] of Object.entries(j?.metadata?.vulnerabilities ?? {})) sum[k] = (sum[k] ?? 0) + n; } if (!any) return step('audit', 'Уязвимости зависимостей', 'warn', 'реестр недоступен или ответ не разобран — проверка не выполнена', t); const v = sum; const crit = v.critical ?? 0, high = v.high ?? 0; return step('audit', 'Уязвимости зависимостей', crit ? 'fail' : high ? 'warn' : 'ok', `критических ${crit}, высоких ${high}, средних ${v.moderate ?? 0}`, t); })());
        await push(await (async () => { const t = Date.now(); const r = await env.exec('npx tsc --noEmit', {}); return step('types', 'Типы (tsc)', r.code ? 'fail' : 'ok', r.code ? tail(r.out, 300) : 'ошибок нет', t, r.code ? r.out : ''); })());
        await push(await (async () => { const t = Date.now(); const r = await env.exec('npm run i18n:check', {}); return step('i18n', 'Переводы', r.code ? 'fail' : 'ok', r.code ? tail(r.out, 300) : 'все строки переведены', t, r.code ? r.out : ''); })());
        if (!quick) {
          await push(await (async () => { const t = Date.now(); const r = await env.exec('npx vite build --outDir dist-web', {}); return step('build_web', 'Сборка веб-версии', r.code ? 'fail' : 'ok', r.code ? tail(r.out, 300) : 'собрано', t, r.code ? r.out : ''); })());
          await push(await (async () => { const t = Date.now(); const r = await env.exec('npx vite build --mode native --outDir dist-native', {}); return step('build_native', 'Сборка Android/Windows (native)', r.code ? 'fail' : 'ok', r.code ? tail(r.out, 300) : 'собрано', t, r.code ? r.out : ''); })());
          await push((() => { const t = Date.now(); const hits = []; const walk = (d) => { for (const f of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { if (/\.map$/.test(f.name) || /^\.env/.test(f.name)) hits.push(`${p.replace(env.dir, '')}: лишний файл`); else if (/\.(js|css|html|json|txt)$/.test(f.name) && fs.statSync(p).size < 6e6) { const s = fs.readFileSync(p, 'utf8'); for (const re of SECRET_PATTERNS) if (re.test(s)) hits.push(`${p.replace(env.dir, '')}: похоже на секрет`); } } } }; walk(path.join(env.dir, 'dist-web')); walk(path.join(env.dir, 'dist-native')); return step('dist_scan', 'Сборки: секреты и карты исходников', hits.length ? 'fail' : 'ok', hits.slice(0, 5).join('; ') || 'карт исходников и секретов в сборках нет', t); })());
        }
        const mg = await push(await migrations(env, rep).catch((e) => step('migrations', 'Миграции на тестовой копии', 'fail', String(e.message))));
        if (mg.status === 'ok') { for (const c of await boot(env, sha)) await push(c); }
        else { await push(step('boot', 'Запуск сервера на тестовой базе', 'skip', 'миграции не прошли')); await push(step('smoke', 'Критические сценарии', 'skip', 'сервер не запускался')); }
      }
    }
    result = { checks, mode: MODE === 'docker' ? 'isolated' : 'local', changedFiles: rep.changedFiles ?? [], baseSha: rep.baseSha, destructive: !!rep.destructive, durationMs: Date.now() - t0 };
  } catch (e) { result = { error: String(e.message).slice(0, 400) }; }
  finally { await env.down().catch((e) => log('очистка:', e.message)); }
  return result;
};

/* ── Публикация на боевом хосте ── */
const runDeploy = async (job) => {
  const p = job.publication; const SRC = E.SANDBOX_PROD_SRC; const APP = E.SANDBOX_APP_DIR ?? '/opt/sky'; const steps = []; let prevSha = null, backupRef = null;
  const push = async (id, title, status, detail = '') => { const i = steps.findIndex((s) => s.id === id); const s = { id, title, status, detail }; if (i >= 0) steps[i] = s; else steps.push(s); log(`${status.padEnd(4)} ${id} ${detail.slice(0, 100)}`); await call('POST', `/api/sandbox/runner/pub/${p.id}/progress`, { steps, prevSha, backupRef }).catch(() => {}); };
  const finish = (outcome, note, health = {}) => call('POST', `/api/sandbox/runner/pub/${p.id}/result`, { outcome, note, steps, health, prevSha, backupRef });
  if (!SRC || !fs.existsSync(path.join(SRC, '.git'))) return finish('failed', 'SANDBOX_PROD_SRC не задан или не git-клон — публикация не начата');
  const g = (a) => run(['git', '-C', SRC, ...a]);
  const health = async () => {
    const out = {}; let ok = true;
    for (let i = 0; i < 40; i++) { const r = await fetch(`${E.SANDBOX_HEALTH_URL ?? 'http://127.0.0.1:8080/healthz'}`, { signal: AbortSignal.timeout(5000) }).catch(() => null); out.healthz = r?.status ?? 0; if (r?.ok) break; await new Promise((s) => setTimeout(s, 3000)); }
    ok = out.healthz === 200;
    const ps = await fetch(`${API}/api/platform/status`, { signal: AbortSignal.timeout(8000) }).catch(() => null); out.platform = ps?.status ?? 0; ok = ok && ps?.status === 200;
    return { ok, ...out };
  };
  prevSha = (await g(['rev-parse', 'HEAD'])).out.trim();
  await push('prev', 'Текущая боевая версия', /^[0-9a-f]{40}$/.test(prevSha) ? 'ok' : 'fail', prevSha.slice(0, 12));
  if (!/^[0-9a-f]{40}$/.test(prevSha)) return finish('failed', 'не удалось определить текущую версию');
  if (prevSha === p.sha) { await push('same', 'Версия уже стоит', 'ok'); return finish('deployed', 'Эта версия уже работает'); }
  const dirty = (await g(['status', '--porcelain', '--untracked-files=no'])).out.trim();
  if (dirty) { await push('clean', 'Рабочий каталог чист', 'fail', 'есть локальные изменения'); return finish('failed', 'в боевом каталоге есть локальные изменения — публикация не начата'); }
  /* 1. Резервная копия (по действующей политике: scripts/backup.sh, ключ age обязателен). */
  const bk = await sh(`bash "${SRC}/scripts/backup.sh"`, { cwd: SRC, timeout: 1800_000 });
  backupRef = (bk.out.match(/(\S+\.(?:sql|tar)\.gz(?:\.age)?)/g) ?? []).pop() ?? null;
  await push('backup', 'Резервная копия', bk.code ? 'fail' : 'ok', bk.code ? tail(bk.out, 300) : (backupRef ?? 'создана'));
  if (bk.code) return finish('failed', 'резервная копия не создана — публикация остановлена до изменений');
  /* 2. Код нужной версии. */
  await g(['fetch', 'origin', BRANCH]);
  const has = await g(['cat-file', '-e', `${p.sha}^{commit}`]); if (has.code) { await push('fetch', 'Получение версии', 'fail', 'коммита нет'); return finish('failed', 'коммит не найден — ничего не менялось'); }
  const co = await g(['checkout', '--detach', p.sha]); await push('checkout', 'Переключение на версию', co.code ? 'fail' : 'ok', co.code ? tail(co.out, 200) : p.sha.slice(0, 12));
  if (co.code) return finish('failed', 'не переключилось — ничего не менялось');
  /* 3. Развёртывание (deploy-local проверяет nginx -t до перезапуска). */
  const dp = await sh(`SKIP_PULL=1 SRC_DIR="${SRC}" APP_DIR="${APP}" bash "${SRC}/scripts/deploy-local.sh"`, { cwd: SRC, timeout: 2400_000 });
  await push('deploy', 'Развёртывание', dp.code ? 'fail' : 'ok', dp.code ? tail(dp.out, 400) : 'выполнено');
  /* 4. Проверка здоровья. */
  let h = dp.code ? { ok: false } : await health(); await push('health', 'Проверка работы после публикации', h.ok ? 'ok' : 'fail', JSON.stringify(h));
  if (h.ok) return finish('deployed', 'Опубликовано, проверка работы пройдена', h);
  /* 5. Откат: код — всегда; базу не трогаем. Если миграции были разрушающими — откат кода не делаем, решает владелец. */
  if (p.destructive) { await push('rollback', 'Откат', 'skip', 'в сборке были разрушающие миграции: нужно восстановление базы из копии (владелец)'); return finish('failed', `Сбой после публикации. Автооткат не выполнен (разрушающие миграции). Копия: ${backupRef ?? 'см. журнал'}`, h); }
  const rc = await g(['checkout', '--detach', prevSha]);
  const rd = rc.code ? rc : await sh(`SKIP_PULL=1 SRC_DIR="${SRC}" APP_DIR="${APP}" bash "${SRC}/scripts/deploy-local.sh"`, { cwd: SRC, timeout: 2400_000 });
  h = rd.code ? { ok: false } : await health();
  await push('rollback', 'Откат кода на прежнюю версию', h.ok ? 'ok' : 'fail', h.ok ? prevSha.slice(0, 12) : tail(rd.out ?? '', 200));
  return finish(h.ok ? 'rolled_back' : 'failed', h.ok ? 'Публикация не прошла проверку; код возвращён на прежнюю версию. Схема базы осталась новой (миграции только добавляют).' : `Публикация и откат не удались: сервер требует ручного вмешательства. Копия: ${backupRef ?? 'см. журнал'}`, h);
};

/* ── Цикл ── */
const once = async () => {
  const r = await call('POST', '/api/sandbox/runner/claim', { runner: NAME, caps: CAPS });
  if (r.status !== 200) { log('claim:', r.status, r.data?.error); return false; }
  const job = r.data?.job; if (!job) return false;
  if (job.kind === 'check') {
    log('проверка', job.build.id, job.build.sha.slice(0, 12), job.build.profile);
    const res = await runCheck(job);
    const f = await call('POST', `/api/sandbox/runner/build/${job.build.id}/result`, res); log('итог', f.status, f.data?.status ?? f.data?.error);
  } else { log('публикация', job.kind, job.publication.id, job.publication.sha.slice(0, 12)); await runDeploy(job); }
  return true;
};
if (args.has('--once')) { const did = await once(); process.exit(did ? 0 : 0); }
log(`раннер ${NAME}: режим ${MODE}, возможности ${CAPS.join('+')}`);
for (;;) { try { if (!(await once())) await new Promise((s) => setTimeout(s, 15_000)); } catch (e) { log('ошибка:', e.message); await new Promise((s) => setTimeout(s, 30_000)); } }
