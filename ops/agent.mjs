#!/usr/bin/env node
/**
 * Агент Sky Ops — отдельный процесс на ХОСТЕ (служба systemd, не в контейнере API). Приходит в API за заданиями из админки
 * («Починить всё», деплой, сборка приложений, диагностика) и выполняет их из ЗАКРЫТОГО списка (server/opscmds.mjs).
 * Произвольных команд агент не принимает: из задания берутся только вид и проверенные параметры, команды собирает он сам.
 *
 * Окружение (/etc/sky-ops.env): OPS_API (https://домен приложения), OPS_SECRET (тот же, что в .env API, от 24 знаков),
 *   OPS_APP_DIR (/opt/sky — compose и .env), OPS_SRC_DIR (/opt/sky-src — клон репозитория), OPS_RUNNER_NAME.
 * Связь: подпись HMAC (время ±120 с + одноразовое значение + метод + путь + хеш тела). Вывод очищается от секретов до отправки.
 * Деплой перезапускает API — агент это переживает: куски вывода копятся и досылаются, когда API снова отвечает.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { getCommand, cleanJob, scrubText } from '../server/opscmds.mjs';

const E = process.env;
const API = (E.OPS_API ?? '').replace(/\/$/, '');
const SECRET = E.OPS_SECRET ?? '';
const APP = E.OPS_APP_DIR ?? '/opt/sky';
const SRC = E.OPS_SRC_DIR ?? '/opt/sky-src';
const NAME = E.OPS_RUNNER_NAME ?? `host-${process.pid}`;
const VERSION = '1';
const POLL_MS = Math.max(500, Number(E.OPS_POLL_MS) || 4000);
const MAX_AGENT_OUT = 1_000_000;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!API || SECRET.length < 24) { console.error('Нужны OPS_API и OPS_SECRET (от 24 знаков)'); process.exit(2); }

const call = async (method, p, body) => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(12).toString('hex');
  const sig = crypto.createHmac('sha256', SECRET).update(`${ts}\n${nonce}\n${method}\n${p}\n${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', 'x-ops-ts': String(ts), 'x-ops-nonce': nonce, 'x-ops-sig': sig }, body: raw || undefined, signal: AbortSignal.timeout(20_000) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

/** Окружение дочерних процессов: без секретов самого агента. */
const childEnv = (extra = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(E)) if (!/^OPS_/.test(k)) out[k] = v;
  return { ...out, ...extra };
};

/* ── Приёмник вывода: целые строки, очистка от секретов, куски с номерами, досылка при обрыве ── */
class Sink {
  constructor(id) { this.id = id; this.partial = ''; this.buf = ''; this.chunks = []; this.sent = 0; this.total = 0; this.cancel = false; this.cut = false; this.flushing = null; this.timer = setInterval(() => void this.flush(), 1000); }
  write(text) {
    this.partial += String(text);
    const i = this.partial.lastIndexOf('\n');
    if (i < 0) { if (this.partial.length > 8000) { this.line(this.partial); this.partial = ''; } return; }
    const lines = this.partial.slice(0, i + 1); this.partial = this.partial.slice(i + 1);
    this.line(lines);
  }
  line(t) {
    if (this.cut) return;
    this.total += t.length;
    if (this.total > MAX_AGENT_OUT) { this.cut = true; t += '\n[вывод обрезан: слишком длинный]\n'; }
    this.buf += scrubText(t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n'));
    if (this.buf.length >= 8000) this.cutChunk();
  }
  say(t) { this.write(`${t}\n`); }
  cutChunk() { while (this.buf.length) { this.chunks.push(this.buf.slice(0, 8000)); this.buf = this.buf.slice(8000); } }
  async flush(final = false) {
    if (this.flushing) { if (!final) return this.flushing; await this.flushing; }
    if (final) { if (this.partial) { this.line(this.partial + '\n'); this.partial = ''; } }
    if (this.buf) this.cutChunk();
    this.flushing = (async () => {
      let fails = 0;
      while (this.sent < this.chunks.length) {
        let r; try { r = await call('POST', `/api/ops/agent/job/${this.id}/progress`, { seq: this.sent + 1, text: this.chunks[this.sent] }); } catch { r = null; }
        if (!r || r.status >= 500 || r.status === 429) { if (!final || ++fails > 120) break; await sleep(Math.min(5000, 500 * fails)); continue; }   // API перезапускается (деплой) — ждём
        if (r.data?.cancel) this.cancel = true;
        if (r.data?.error === 'not_running') { this.sent = this.chunks.length; break; }
        if (typeof r.data?.expect === 'number' && r.data.expect >= 1) this.sent = Math.min(this.chunks.length, r.data.expect - 1); else this.sent += 1;
        fails = 0;
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  async close() { clearInterval(this.timer); await this.flush(true); }
}

/* ── Запуск команды ── */
const cwdOf = (w) => (w === 'src' ? SRC : w === 'app' ? APP : undefined);
const runProc = (argv, { cwd, env, timeoutSec = 120, sink, stream = true, isCancelled }) => new Promise((resolve) => {
  let out = '';
  let p;
  try { p = spawn(argv[0], argv.slice(1), { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true }); }
  catch (e) { resolve({ code: 127, out: String(e.message) }); return; }
  const kill = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* уже завершён */ } } };
  const on = (d) => { const s = d.toString('utf8'); if (out.length < 5_000_000) out += s; if (stream) sink.write(s); };
  p.stdout.on('data', on); p.stderr.on('data', on);
  const to = setTimeout(() => { sink.say('\n[время шага вышло — остановлено]'); kill(); }, timeoutSec * 1000);
  const watch = setInterval(() => { if (isCancelled()) { sink.say('\n[отменено из панели]'); kill(); } }, 1500);
  p.on('error', (e) => { clearTimeout(to); clearInterval(watch); sink.say(`не удалось запустить ${argv[0]}: ${e.message}`); resolve({ code: 127, out }); });
  p.on('close', (code) => { clearTimeout(to); clearInterval(watch); resolve({ code: code ?? 1, out }); });
});
const quiet = (argv, opts = {}) => runProc(argv, { ...opts, stream: false, sink: { write() {}, say() {} }, isCancelled: opts.isCancelled ?? (() => false) });

const applyFilter = (text, f) => {
  let lines = text.split('\n');
  if (f.contains) { const n = f.contains.toLowerCase(); lines = lines.filter((l) => l.toLowerCase().includes(n)); }
  if (f.regex) { const re = new RegExp(f.regex, 'i'); lines = lines.filter((l) => re.test(l)); }
  if (f.last) lines = lines.slice(-f.last);
  return lines.join('\n');
};

/* ── «Починить всё»: закрытая последовательность безопасных действий ── */
const repair = async (params, sink, isCancelled) => {
  const bad = [];
  const ok = (t) => sink.say(`✔ ${t}`); const no = (t) => { bad.push(t); sink.say(`✖ ${t}`); }; const info = (t) => sink.say(`• ${t}`);
  const q = (argv, o = {}) => quiet(argv, { cwd: APP, isCancelled, ...o });
  const step = async (title, fn) => { if (isCancelled()) return; sink.say(`\n— ${title}`); try { await fn(); } catch (e) { no(`${title}: ${e.message}`); } };

  await step('Docker', async () => {
    const r = await q(['systemctl', 'is-active', 'docker']);
    if (r.out.trim() === 'active') ok('служба docker работает');
    else { info('docker не запущен — запускаю'); await q(['systemctl', 'start', 'docker'], { timeoutSec: 90 }); await sleep(4000); (await q(['systemctl', 'is-active', 'docker'])).out.trim() === 'active' ? ok('docker запущен') : no('docker не запустился'); }
  });
  await step('Контейнеры', async () => {
    if (!fs.existsSync(`${APP}/docker-compose.yml`)) { no(`нет ${APP}/docker-compose.yml`); return; }
    const up = await q(['docker', 'compose', 'up', '-d'], { timeoutSec: 300 });
    up.code === 0 ? ok('все службы запущены (compose up -d)') : no(`compose up -d: код ${up.code} — ${up.out.trim().split('\n').slice(-3).join(' | ')}`);
    const ps = await q(['docker', 'compose', 'ps', '-a', '--format', 'json']);
    const rows = ps.out.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (const c of rows) {
      const name = c.Service; const sick = c.State !== 'running' || c.Health === 'unhealthy';
      if (!sick) { ok(`${name}: ${c.Health || c.State}`); continue; }
      info(`${name}: ${c.State}${c.Health ? ` / ${c.Health}` : ''} — перезапускаю (docker compose restart ${name})`);
      await q(['docker', 'compose', 'restart', name], { timeoutSec: 240 });
    }
  });
  await step('Права на файлы', async () => {
    if (fs.existsSync(`${APP}/.env`)) { await q(['chmod', '600', `${APP}/.env`]); ok('.env доступен только владельцу (600)'); }
    for (const d of ['server', 'scripts', 'nginx', 'src']) if (fs.existsSync(`${SRC}/${d}`)) await q(['chmod', '-R', 'go+rX', `${SRC}/${d}`]);
    ok('файлы репозитория читаемы (иначе образ API падает с EACCES)');
  });
  await step('Диск', async () => {
    const pct = async () => Number((await q(['df', '--output=pcent', '/'])).out.replace(/\D+/g, ' ').trim().split(' ').pop()) || 0;
    let p = await pct(); info(`занято ${p}%`);
    if (p >= 85) {
      await q(['docker', 'builder', 'prune', '-f'], { timeoutSec: 300 }); await q(['docker', 'image', 'prune', '-f'], { timeoutSec: 300 }); p = await pct();
      if (p >= 92) { await q(['journalctl', '--vacuum-size=200M'], { timeoutSec: 60 }); p = await pct(); }
      p >= 92 ? no(`после очистки занято ${p}% — нужно освободить место вручную`) : ok(`место освобождено, занято ${p}%`);
    } else ok('места достаточно');
  });
  await step('SSH', async () => {
    for (const u of ['ssh', 'sshd']) {
      const st = (await q(['systemctl', 'is-active', u])).out.trim();
      if (st === 'active') { ok(`${u} работает`); return; }
    }
    const units = (await q(['systemctl', 'list-unit-files', 'ssh.service', 'sshd.service', '--no-legend'])).out;
    const unit = /\bssh\.service/.test(units) ? 'ssh' : /\bsshd\.service/.test(units) ? 'sshd' : null;
    if (!unit) { info('служба SSH не найдена'); return; }
    await q(['systemctl', 'start', unit], { timeoutSec: 60 });
    (await q(['systemctl', 'is-active', unit])).out.trim() === 'active' ? ok(`${unit} запущен`) : no(`${unit} не запустился`);
  });
  if (params.clearBlocks) {
    await step('Блокировки адресов самозащитой', async () => {
      const r = await q(['docker', 'compose', 'exec', '-T', 'db', 'psql', '-U', 'sky', '-tA', '-c', 'WITH d AS (DELETE FROM defense_ip_blocks RETURNING 1) SELECT count(*) FROM d']);
      r.code === 0 ? ok(`снято блокировок: ${r.out.trim().split('\n').pop()}`) : info('таблицы блокировок нет или база недоступна');
    });
  }
  await step('Конфигурация nginx', async () => {
    const r = await q(['docker', 'compose', 'exec', '-T', 'web', 'nginx', '-t']);
    r.code === 0 ? ok('nginx -t: конфигурация верна') : no(`nginx -t: ${r.out.trim().split('\n').slice(-2).join(' | ')}`);
  });
  await step('Ответ API', async () => {
    let good = false;
    for (let i = 0; i < 18 && !good && !isCancelled(); i++) {
      const r = await q(['docker', 'compose', 'exec', '-T', 'api', 'node', '-e', "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"], { timeoutSec: 20 });
      good = r.code === 0; if (!good) await sleep(5000);
    }
    good ? ok('API отвечает') : no('API не отвечает после починки — смотрите «Ошибки в журнале API»');
  });
  // Если API так и не ответил — тяжёлая лестница лечения (scripts/sky-heal.sh: перезапуск стека по порядку db → redis → api → web
  // с проверкой после каждой ступени). Откат образов она делает ТОЛЬКО по флагу --rollback, которого здесь нет.
  if (bad.some((b) => /API не отвечает/.test(b)) && !isCancelled() && fs.existsSync(`${SRC}/scripts/sky-heal.sh`)) {
    await step('Экстренное лечение (sky-heal.sh)', async () => {
      const r = await runProc(['bash', `${SRC}/scripts/sky-heal.sh`, '--fix', '--yes'], { cwd: APP, isCancelled, stream: true, sink, timeoutSec: 600 });
      if (r.code === 0) { const i = bad.findIndex((b) => /API не отвечает/.test(b)); if (i >= 0) bad.splice(i, 1); ok('sky-heal.sh вылечил'); }
      else no(`sky-heal.sh: не вылечил (код ${r.code}) — смотрите вывод выше`);
    });
  }
  sink.say(`\n${bad.length ? `Не всё удалось исправить (${bad.length}):\n  ${bad.join('\n  ')}` : 'Готово: проблем не осталось.'}`);
  return bad.length ? 1 : 0;
};

/* ── Задание целиком ── */
const runJob = async (job) => {
  const sink = new Sink(job.id);
  const cmd = getCommand(job.kind); const clean = cleanJob(job.kind, job.params);
  let code = 0; let note = '';
  const isCancelled = () => sink.cancel;
  const ping = setInterval(() => { void call('POST', `/api/ops/agent/job/${job.id}/ping`, {}).then((r) => { if (r.data?.cancel) sink.cancel = true; }).catch(() => {}); }, 20_000);
  try {
    if (!cmd || clean.error) { sink.say(`Неизвестное или неверное задание: ${job.kind}`); code = 2; note = 'bad_job'; }
    else {
      sink.say(`▶ ${cmd.label}${Object.keys(clean.params).length ? `  ${JSON.stringify(clean.params)}` : ''}\n`);
      const ctx = { app: APP, src: SRC };
      for (const s of cmd.steps(ctx, clean.params)) {
        if (isCancelled()) { code = code || 130; note = 'отменено'; break; }
        if (s.type === 'repair') { code = (await repair(clean.params, sink, isCancelled)) || code; continue; }
        if (s.type === 'tail') {
          try { const t = fs.readFileSync(s.file, 'utf8').split('\n').slice(-s.n).join('\n'); sink.say(t); } catch (e) { sink.say(`нет файла ${s.file}: ${e.code ?? e.message}`); }
          continue;
        }
        if (s.type === 'run') {
          sink.say(`$ ${s.argv.join(' ').replace(/^bash -c .*? _ /, 'bash ')}`);
          const r = await runProc(s.argv, { cwd: cwdOf(s.cwd), env: s.env, timeoutSec: s.timeout ?? cmd.timeoutSec ?? 120, sink, stream: !s.filter, isCancelled });
          if (s.filter) { const t = applyFilter(r.out, s.filter); sink.say(t || '(подходящих строк нет)'); }
          const okCodes = s.okCodes ?? [0];
          if (!okCodes.includes(r.code)) { sink.say(`✖ код выхода ${r.code}`); code = code || r.code || 1; }
        }
      }
      if (!note) note = code === 0 ? 'готово' : `код ${code}`;
    }
  } catch (e) { sink.say(`✖ ошибка агента: ${e.message}`); code = code || 1; note = 'ошибка агента'; }
  clearInterval(ping);
  await sink.close();
  for (let i = 0; i < 120; i++) {   // результат важен: при перезапуске API (деплой) ждём, пока он снова отвечает
    try { const r = await call('POST', `/api/ops/agent/job/${job.id}/result`, { code, note }); if (r.status < 500 && r.status !== 429) break; } catch { /* API ещё поднимается */ }
    await sleep(Math.min(5000, 500 * (i + 1)));
  }
  return code;
};

/* ── Основной цикл ── */
const running = new Map();
let busyMutating = false;
const tick = async () => {
  if (running.size >= 4) return;
  let r; try { r = await call('POST', '/api/ops/agent/claim', { runner: NAME, version: VERSION, busyMutating }); } catch (e) { return void log('API недоступен:', e.message); }
  if (r.status !== 200) return void log('claim:', r.status, r.data?.error ?? '');
  const job = r.data?.job; if (!job) return;
  const mutating = Boolean(getCommand(job.kind)?.mutating);
  if (mutating) busyMutating = true;
  running.set(job.id, job);
  log('задание', job.id, job.kind);
  void runJob(job).then((code) => {
    log('готово', job.id, job.kind, 'код', code);
    // после деплоя код агента мог обновиться — выходим, systemd запустит новый
    if (job.kind === 'deploy') setTimeout(() => process.exit(0), 1500);
  }).finally(() => { running.delete(job.id); if (mutating) busyMutating = false; });
};
log(`агент Sky Ops ${VERSION} запущен: ${NAME}, API ${API}, app ${APP}, src ${SRC}`);
const loop = async () => { for (;;) { try { await tick(); } catch (e) { log('ошибка цикла:', e.message); } await sleep(POLL_MS); } };
if (process.argv.includes('--once')) { await tick(); await sleep(1500); while (running.size) await sleep(500); process.exit(0); }
void loop();
