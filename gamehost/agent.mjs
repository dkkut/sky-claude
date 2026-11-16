#!/usr/bin/env node
/**
 * Агент игрового хоста Sky Games — отдельный процесс на ОТДЕЛЬНОМ сервере (не на основном сервере Sky без решения владельца). Ходит в API за командами
 * и выполняет их из закрытого списка: start / stop / restart / backup / logs. Для запуска берёт спецификацию, проверенную API, и ещё раз проверяет её
 * (server/gamespec.mjs::assertSafeArgs). Произвольных команд не принимает. Следит за квотой диска: сервер, перешагнувший лимит, останавливается.
 *
 * Окружение: GAMEINFRA_API (https://домен приложения), GAMEINFRA_HOST_ID (gh-…), GAMEINFRA_HOST_KEY (ключ хоста из админки, показывается владельцу по запросу),
 * GAMEINFRA_DOCKER (по умолчанию docker). Работает от root только ради docker и chown каталогов серверов; сами игры идут под отдельными uid в контейнерах.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { assertSafeArgs, NETWORK, BASE_DIR, UID_BASE } from '../server/gamespec.mjs';

const E = process.env;
const API = (E.GAMEINFRA_API ?? '').replace(/\/$/, ''); const HOST = E.GAMEINFRA_HOST_ID ?? ''; const KEY = E.GAMEINFRA_HOST_KEY ?? '';
const DOCKER = E.GAMEINFRA_DOCKER ?? 'docker'; const POLL = Math.max(300, Number(E.GAMEINFRA_POLL_MS) || 5000); const ROOT = E.GAMEINFRA_BASE_DIR || BASE_DIR;
const ONCE = E.GAMEINFRA_ONCE === '1';
if (!API || !/^gh-[0-9a-f-]{36}$/.test(HOST) || KEY.length < 32) { console.error('Нужны GAMEINFRA_API, GAMEINFRA_HOST_ID и GAMEINFRA_HOST_KEY'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (args, opt = {}) => { const r = spawnSync(DOCKER, args, { encoding: 'utf8', timeout: opt.timeout ?? 120_000, maxBuffer: 8 * 1024 * 1024 }); return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }; };

const call = async (p, body) => {
  const raw = JSON.stringify(body ?? {}); const ts = Math.floor(Date.now() / 1000); const nonce = crypto.randomBytes(12).toString('hex');
  const sig = crypto.createHmac('sha256', KEY).update(`${ts}\n${nonce}\nPOST\n${p}\n${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-game-host': HOST, 'x-ops-ts': String(ts), 'x-ops-nonce': nonce, 'x-ops-sig': sig }, body: raw, signal: AbortSignal.timeout(20_000) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const metrics = () => {
  let diskFreeGb = null; try { const s = fs.statfsSync(ROOT.startsWith('/') && fs.existsSync(ROOT) ? ROOT : '/'); diskFreeGb = +((s.bavail * s.bsize) / 1e9).toFixed(1); } catch { /* нет каталога */ }
  return { load1: os.loadavg()[0], memTotalMb: Math.round(os.totalmem() / 1048576), memAvailMb: Math.round(os.freemem() / 1048576), diskFreeGb };
};
const dirMb = (dir) => { const r = spawnSync('du', ['-sm', dir], { encoding: 'utf8' }); const n = Number(String(r.stdout).split(/\s/)[0]); return Number.isFinite(n) ? n : 0; };

/** Состояние серверов хоста: что запущено, сколько ест, не превышена ли квота диска (тогда сервер останавливается). */
const survey = () => {
  const ps = sh(['ps', '--filter', 'label=sky.server', '--format', '{{.Names}}\t{{.Label "sky.server"}}\t{{.Label "sky.disk_mb"}}']); if (!ps.ok) return [];
  const stats = {}; const st = sh(['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}']);
  if (st.ok) for (const l of st.out.split('\n')) { const [n, cpu, mem] = l.split('\t'); stats[n] = { cpuPct: parseFloat(cpu) || 0, memMb: parseFloat(String(mem).split('/')[0]) * (/GiB/.test(mem) ? 1024 : 1) || 0 }; }
  const out = [];
  for (const l of ps.out.split('\n').filter(Boolean)) {
    const [name, id, disk] = l.split('\t'); const used = dirMb(`${ROOT}/${id}`); const x = { id, ...(stats[name] ?? {}), diskMb: used, status: 'running' };
    if (Number(disk) > 0 && used > Number(disk)) { sh(['stop', '-t', '30', name]); x.status = 'error'; x.reason = `Превышена квота диска: ${used} МБ из ${disk} МБ — сервер остановлен`; }
    out.push(x);
  }
  return out;
};

const ensureNetwork = () => { if (!sh(['network', 'inspect', NETWORK]).ok) return sh(['network', 'create', '--driver', 'bridge', '-o', 'com.docker.network.bridge.enable_icc=false', NETWORK]); return { ok: true, out: '' }; };

const run = (c) => {
  const name = c.container; if (!/^sky-gs-gs-[0-9a-f-]{36}$/.test(name)) return { ok: false, output: 'Неверное имя контейнера' };
  if (c.action === 'start' || c.action === 'restart') {
    if (!c.spec || !assertSafeArgs(c.spec.args)) return { ok: false, output: 'Спецификация небезопасна — отказ' };
    if (!(c.uid >= UID_BASE) || c.dir !== `${BASE_DIR}/${c.serverId}`) return { ok: false, output: 'Неверный каталог или пользователь сервера' };
    const dir = `${ROOT}/${c.serverId}`;
    try { fs.mkdirSync(`${dir}/data`, { recursive: true, mode: 0o750 }); fs.chownSync(dir, c.uid, c.uid); fs.chownSync(`${dir}/data`, c.uid, c.uid); fs.chmodSync(dir, 0o750); } catch (e) { return { ok: false, output: `Каталог сервера: ${e.message}` }; }
    const n = ensureNetwork(); if (!n.ok) return { ok: false, output: `Сеть ${NETWORK}: ${n.out}` };
    sh(['rm', '-f', name]);
    const args = c.spec.args.map((a, i, all) => (all[i - 1] === '-v' ? a.replace(`${BASE_DIR}/`, `${ROOT}/`) : a));
    const r = sh(args); if (!r.ok) return { ok: false, output: r.out };
    const t = Date.now(); while (Date.now() - t < 4000) { if (sh(['inspect', '-f', '{{.State.Running}}', name]).out === 'true') break; }
    const up = sh(['inspect', '-f', '{{.State.Running}}', name]).out === 'true';
    return { ok: up, output: up ? 'Запущен' : `Контейнер не работает: ${sh(['logs', '--tail', '40', name]).out}` };
  }
  if (c.action === 'stop') { const r = sh(['stop', '-t', '60', name], { timeout: 90_000 }); sh(['rm', '-f', name]); return { ok: r.ok || /No such container/.test(r.out), output: r.out || 'Остановлен' }; }
  if (c.action === 'logs') { const r = sh(['logs', '--tail', '300', name]); return { ok: r.ok, output: r.out }; }
  if (c.action === 'backup') {
    const dir = `${ROOT}/${c.serverId}`; const bdir = `${ROOT}/backups`; fs.mkdirSync(bdir, { recursive: true, mode: 0o750 });
    const file = `${bdir}/${c.serverId}-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const t = spawnSync('tar', ['-C', dir, '-czf', file, 'data'], { encoding: 'utf8', timeout: 600_000 }); if (t.status !== 0) return { ok: false, output: t.stderr || 'tar не выполнен' };
    const buf = fs.readFileSync(file); const files = fs.readdirSync(bdir).filter((f) => f.startsWith(`${c.serverId}-`)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 7))) fs.rmSync(`${bdir}/${old}`, { force: true });
    return { ok: true, output: 'Копия готова', backup: { path: file, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') } };
  }
  return { ok: false, output: 'Неизвестное действие' };
};

const cycle = async () => {
  const claim = await call('/api/ops/agent/games/claim', { version: '1', metrics: metrics(), servers: survey() });
  const c = claim.data?.command; if (!c) return false;
  let res; try { res = run(c); } catch (e) { res = { ok: false, output: String(e.message) }; }
  await call('/api/ops/agent/games/report', { commandId: c.id, ok: res.ok, output: res.output, backup: res.backup });
  return true;
};
for (;;) {
  let busy = false; try { busy = await cycle(); } catch (e) { console.error(new Date().toISOString(), 'цикл:', e.message); }
  if (ONCE) break; if (!busy) await sleep(POLL);
}
