'use strict';
/**
 * Менеджер установки и запуска игр Sky Game Launcher (Windows-приложение).
 * Чистый Node (без Electron API), поэтому проверяется тестом `scripts/audit/launcher-dl-test.mjs`.
 *
 * Принципы:
 *  • Источник файлов один — API Sky (манифест + `/blob/<сборка>/<sha256>`); произвольные URL не принимаются.
 *  • Каждый файл проверяется по SHA-256 из манифеста ДО попадания в папку игры: качается в `.sky-staging`, после проверки всех файлов
 *    изменившиеся заменяются разом (прежние уходят в `.sky-backup`, при сбое возвращаются). Рабочая установка не портится недокачанным.
 *  • Потоковая запись на диск (память не растёт), докачка Range, пауза/отмена, очередь (одновременно N игр, M файлов), ограничение скорости.
 *  • Пути из манифеста проверяются: никаких `..`, абсолютных, дисков, служебных имён; удаление — только своей папки с маркером `.sky-install.json`.
 *  • Запуск — только по явной команде, только exe из манифеста и аргументы из него же; процесс не скрывается и антивирус не трогается.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const safeRel = (p) => {
  p = String(p ?? '');
  if (!p || p.length > 240 || /[\u0000-\u001f\\:*?"<>|]/.test(p) || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/');
  if (parts.length > 20) return null;
  for (const s of parts) if (!s || s === '.' || s === '..' || s.length > 120 || /[. ]$/.test(s) || RESERVED.test(s)) return null;
  return parts.join('/');
};
const SAFE_ARG = /^[-A-Za-z0-9_=.:/+]{1,60}$/;
const SAFE_ID = /^lgm-[0-9a-f-]{36}$/;
const MARK = '.sky-install.json';
const inside = (root, p) => { const r = path.resolve(root); const x = path.resolve(p); return x === r || x.startsWith(r + path.sep); };

const sha256File = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256'); const s = fs.createReadStream(file);
  s.on('data', (c) => h.update(c)); s.on('error', reject); s.on('end', () => resolve(h.digest('hex')));
});

/** opts: { apiOrigin, getToken(), root (папка установки по умолчанию), statePath (json), onEvent(ev), concurrentGames=2, concurrentFiles=3, maxBytesPerSec=0, fetchImpl } */
function createManager(opts) {
  const fetchFn = opts.fetchImpl || fetch;
  const cfg = { concurrentGames: opts.concurrentGames || 2, concurrentFiles: opts.concurrentFiles || 3, maxBytesPerSec: opts.maxBytesPerSec || 0, apiOrigin: opts.apiOrigin, root: opts.root };
  const tasks = new Map();      // gameId -> task
  const queue = [];
  const running = new Set();
  const procs = new Map();      // gameId -> child
  let state = { installed: {} };
  try { state = JSON.parse(fs.readFileSync(opts.statePath, 'utf8')); if (!state.installed) state.installed = {}; } catch { /* первый запуск */ }
  const saveState = async () => { await fsp.mkdir(path.dirname(opts.statePath), { recursive: true }); const tmp = `${opts.statePath}.tmp`; await fsp.writeFile(tmp, JSON.stringify(state)); await fsp.rename(tmp, opts.statePath); };
  const emit = (ev) => { try { opts.onEvent && opts.onEvent(ev); } catch { /* слушатель не должен ронять загрузку */ } };

  // ограничение скорости: простое ведро токенов на общий поток
  let bucket = 0; let bucketAt = Date.now();
  const throttle = async (n) => {
    if (!cfg.maxBytesPerSec) return;
    const now = Date.now(); bucket = Math.min(cfg.maxBytesPerSec, bucket + ((now - bucketAt) / 1000) * cfg.maxBytesPerSec); bucketAt = now;
    bucket -= n; if (bucket < 0) { const wait = (-bucket / cfg.maxBytesPerSec) * 1000; await new Promise((r) => setTimeout(r, Math.min(wait, 2000))); }
  };

  const api = async (p, init = {}, signal) => {
    const token = await opts.getToken();
    const res = await fetchFn(`${cfg.apiOrigin}${p}`, { ...init, signal, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    return res;
  };

  const freeSpace = async (dir) => { try { await fsp.mkdir(dir, { recursive: true }); const s = await fsp.statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; } };

  const publicTask = (t) => ({ gameId: t.gameId, kind: t.kind, status: t.status, doneBytes: t.done, totalBytes: t.total, speed: t.speed, etaSec: t.eta, error: t.error || null, version: t.version || null });
  const touch = (t, force) => { const now = Date.now(); if (!force && now - (t.lastEmit || 0) < 500) return; t.lastEmit = now; emit({ type: 'progress', ...publicTask(t) }); };

  /* ───── загрузка одного файла в staging с докачкой ───── */
  const downloadFile = async (t, buildId, f, stagingDir) => {
    const dest = path.join(stagingDir, f.sha256 + '.part');
    let have = 0; try { have = (await fsp.stat(dest)).size; } catch { /* нет */ }
    if (have > f.size) { await fsp.rm(dest, { force: true }); have = 0; }
    if (have < f.size || f.size === 0) {
      const res = await api(`/api/launcher/blob/${buildId}/${f.sha256}`, have ? { headers: { Range: `bytes=${have}-` } } : {}, t.abort.signal);
      if (!res.ok && res.status !== 206) throw new Error(`download_${res.status}`);
      if (have && res.status !== 206) { await fsp.rm(dest, { force: true }); have = 0; }   // сервер проигнорировал Range — начинаем заново
      const out = fs.createWriteStream(dest, { flags: have ? 'a' : 'w' });
      t.done += 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          await throttle(value.length);
          if (!out.write(value)) await new Promise((r) => out.once('drain', r));
          t.done += value.length; t.window.push([Date.now(), value.length]); touch(t);
        }
      } finally { await new Promise((r) => out.end(r)); }
    }
    const stat = await fsp.stat(dest);
    if (stat.size !== f.size) throw new Error('size_mismatch');
    if ((await sha256File(dest)) !== f.sha256) { await fsp.rm(dest, { force: true }); throw new Error('hash_mismatch'); }
    return dest;
  };

  const speedOf = (t) => { const now = Date.now(); t.window = t.window.filter(([at]) => now - at < 5000); const sum = t.window.reduce((a, [, n]) => a + n, 0); const span = t.window.length ? Math.max(1000, now - t.window[0][0]) : 0; t.speed = span ? Math.round(sum / (span / 1000)) : 0; t.eta = t.speed > 0 && now - t.started > 3000 ? Math.round((t.total - t.done) / t.speed) : null; };

  /* ───── установка / обновление ───── */
  const doInstall = async (t) => {
    const mres = await api(`/api/launcher/games/${t.gameId}/manifest${t.channel === 'test' ? '?channel=test' : ''}`, {}, t.abort.signal);
    if (!mres.ok) throw new Error(`manifest_${mres.status}`);
    const { manifest } = await mres.json();
    if (!manifest || !Array.isArray(manifest.files)) throw new Error('bad_manifest');
    const files = [];
    for (const f of manifest.files) {
      const p = safeRel(f.path);
      if (!p || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0) throw new Error('bad_manifest_entry');
      files.push({ path: p, sha256: f.sha256, size: f.size });
    }
    const exe = safeRel(manifest.launch && manifest.launch.exe); if (!exe || !/\.exe$/i.test(exe) || !files.some((f) => f.path === exe)) throw new Error('bad_manifest_launch');
    const args = (manifest.launch.args || []).map(String); if (args.length > 8 || args.some((a) => !SAFE_ARG.test(a))) throw new Error('bad_manifest_args');
    const prev = state.installed[t.gameId];
    const dir = t.dir || (prev && prev.dir) || path.join(cfg.root, t.gameId);
    if (!path.isAbsolute(dir)) throw new Error('bad_dir');
    t.version = manifest.version; t.kind = prev ? 'update' : 'install';
    // что нужно скачать: только отсутствующее или изменившееся (дельта)
    const need = []; for (const f of files) {
      const cur = path.join(dir, f.path); let ok = false;
      try { const st = await fsp.stat(cur); ok = st.size === f.size && (prev && prev.files && prev.files[f.path] === f.sha256 ? true : (await sha256File(cur)) === f.sha256); } catch { /* нет файла */ }
      if (!ok) need.push(f);
    }
    t.total = need.reduce((a, f) => a + f.size, 0);
    const free = await freeSpace(path.dirname(dir) === dir ? dir : (fs.existsSync(dir) ? dir : path.dirname(dir)));
    if (free !== null && free < t.total * 1.05 + 50 * 1024 * 1024) throw new Error('no_space');
    await fsp.mkdir(dir, { recursive: true });
    const staging = path.join(dir, '.sky-staging'); await fsp.mkdir(staging, { recursive: true });
    t.status = 'downloading'; touch(t, true);
    // параллельно, но ограниченно
    let i = 0; let failed = null;
    const worker = async () => { while (!failed && i < need.length) { const f = need[i]; i += 1; try { f.staged = await downloadFile(t, manifest.buildId, f, staging); } catch (e) { failed = failed || e; try { t.abort.abort(); } catch { /* уже остановлено */ } } } };
    const tick = setInterval(() => { speedOf(t); touch(t); }, 1000);
    try { await Promise.all(Array.from({ length: Math.min(cfg.concurrentFiles, Math.max(1, need.length)) }, worker)); } finally { clearInterval(tick); }
    if (failed) throw failed;
    if (t.abort.signal.aborted) throw new Error('aborted');
    // применение: проверенные файлы заменяют старые разом; прежние сохраняются в .sky-backup на случай сбоя
    t.status = 'applying'; touch(t, true);
    const backup = path.join(dir, '.sky-backup'); await fsp.rm(backup, { recursive: true, force: true }); await fsp.mkdir(backup, { recursive: true });
    const moved = [];
    try {
      for (const f of need) {
        const target = path.join(dir, f.path); if (!inside(dir, target)) throw new Error('path_escape');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        let hadOld = false; try { await fsp.stat(target); hadOld = true; } catch { /* новый файл */ }
        if (hadOld) { const b = path.join(backup, f.path); await fsp.mkdir(path.dirname(b), { recursive: true }); await fsp.rename(target, b); }
        moved.push({ target, backup: hadOld ? path.join(backup, f.path) : null });
        await fsp.rename(f.staged, target);
      }
      // файлы прежней версии, которых нет в новой, удаляем (только перечисленные в прошлой записи)
      if (prev && prev.files) for (const old of Object.keys(prev.files)) if (!files.some((f) => f.path === old)) { const target = path.join(dir, old); if (inside(dir, target)) { await fsp.rm(target, { force: true }); } }
    } catch (e) {
      for (const m of moved.reverse()) { await fsp.rm(m.target, { force: true }).catch(() => {}); if (m.backup) await fsp.rename(m.backup, m.target).catch(() => {}); }
      throw e;
    }
    state.installed[t.gameId] = { gameId: t.gameId, dir, buildId: manifest.buildId, version: manifest.version, exe, args, files: Object.fromEntries(files.map((f) => [f.path, f.sha256])), installedAt: new Date().toISOString(), history: (() => { const h = ((prev && prev.history) || []).slice(-9); return h.length && h[h.length - 1].version === manifest.version ? h : [...h, { version: manifest.version, at: new Date().toISOString() }]; })() };
    await fsp.writeFile(path.join(dir, MARK), JSON.stringify({ gameId: t.gameId })); await saveState();
    await fsp.rm(staging, { recursive: true, force: true }); await fsp.rm(backup, { recursive: true, force: true });   // чистим только после подтверждённого завершения
  };

  const pump = () => {
    while (running.size < cfg.concurrentGames && queue.length) {
      const t = queue.shift(); if (t.status !== 'queued') continue;
      running.add(t.gameId); t.status = 'starting'; t.started = Date.now(); t.abort = new AbortController(); t.window = [];
      (async () => {
        try { await doInstall(t); t.status = 'done'; t.error = null; emit({ type: 'done', ...publicTask(t) }); }
        catch (e) {
          if (t.paused) { t.status = 'paused'; }
          else if (t.cancelled) { t.status = 'cancelled'; await cleanupStaging(t); }
          else { t.status = 'error'; t.error = String(e.message || e).slice(0, 80); }
          emit({ type: t.status === 'error' ? 'error' : 'state', ...publicTask(t) });
        } finally { running.delete(t.gameId); touch(t, true); pump(); }
      })();
    }
  };
  const cleanupStaging = async (t) => { const prev = state.installed[t.gameId]; const dir = t.dir || (prev && prev.dir) || path.join(cfg.root, t.gameId); const st = path.join(dir, '.sky-staging'); if (inside(cfg.root, dir) || fs.existsSync(path.join(dir, MARK))) await fsp.rm(st, { recursive: true, force: true }).catch(() => {}); };

  const enqueue = (gameId, o = {}) => {
    if (!SAFE_ID.test(gameId)) throw new Error('bad_game_id');
    const cur = tasks.get(gameId); if (cur && ['queued', 'starting', 'downloading', 'applying'].includes(cur.status)) return publicTask(cur);
    const t = { gameId, kind: 'install', status: 'queued', done: 0, total: 0, speed: 0, eta: null, error: null, dir: o.dir || null, channel: o.channel || 'release', paused: false, cancelled: false, abort: new AbortController(), window: [], started: Date.now() };
    tasks.set(gameId, t); queue.push(t); emit({ type: 'state', ...publicTask(t) }); pump(); return publicTask(t);
  };

  return {
    config: cfg,
    setLimits(l) { if (l.concurrentGames) cfg.concurrentGames = Math.max(1, Math.min(4, l.concurrentGames)); if (l.concurrentFiles) cfg.concurrentFiles = Math.max(1, Math.min(8, l.concurrentFiles)); if (l.maxBytesPerSec !== undefined) cfg.maxBytesPerSec = Math.max(0, l.maxBytesPerSec); pump(); },
    install: (gameId, o) => enqueue(gameId, o),
    update: (gameId) => enqueue(gameId, {}),
    pause(gameId) { const t = tasks.get(gameId); if (!t) return null; if (t.status === 'queued') { t.status = 'paused'; t.paused = true; } else if (running.has(gameId)) { t.paused = true; t.abort.abort(); } return publicTask(t); },
    resume(gameId) { const t = tasks.get(gameId); if (!t || t.status !== 'paused' && t.status !== 'error') return null; t.paused = false; t.status = 'queued'; t.error = null; queue.push(t); emit({ type: 'state', ...publicTask(t) }); pump(); return publicTask(t); },
    cancel(gameId) { const t = tasks.get(gameId); if (!t) return null; t.cancelled = true; if (running.has(gameId)) t.abort.abort(); else { t.status = 'cancelled'; cleanupStaging(t); } return publicTask(t); },
    tasks: () => [...tasks.values()].map(publicTask),
    installed: () => Object.values(state.installed).map((r) => ({ gameId: r.gameId, dir: r.dir, version: r.version, buildId: r.buildId, installedAt: r.installedAt, history: r.history })),
    freeSpace,
    /** Проверка целостности установленных файлов; ничего не меняет. */
    async verify(gameId) {
      const r = state.installed[gameId]; if (!r) return { error: 'not_installed' };
      const bad = []; for (const [rel, sha] of Object.entries(r.files)) { const f = path.join(r.dir, rel); if (!inside(r.dir, f)) { bad.push({ path: rel, problem: 'bad_path' }); continue; } try { if ((await sha256File(f)) !== sha) bad.push({ path: rel, problem: 'corrupt' }); } catch { bad.push({ path: rel, problem: 'missing' }); } }
      return { ok: bad.length === 0, bad, checked: Object.keys(r.files).length };
    },
    /** Обнаружение уже установленной игры в папке, выбранной пользователем: сверка с манифестом, ничего не сканируется. */
    async adopt(gameId, dir) {
      if (!SAFE_ID.test(gameId) || !path.isAbsolute(dir)) return { error: 'bad_args' };
      const res = await api(`/api/launcher/games/${gameId}/manifest`); if (!res.ok) return { error: `manifest_${res.status}` };
      const { manifest } = await res.json(); const files = {}; let matched = 0;
      for (const f of manifest.files) { const rel = safeRel(f.path); if (!rel) return { error: 'bad_manifest_entry' }; try { if ((await sha256File(path.join(dir, rel))) === f.sha256) { matched += 1; files[rel] = f.sha256; } } catch { /* нет */ } }
      if (matched !== manifest.files.length) return { error: 'mismatch', matched, total: manifest.files.length };
      const exe = safeRel(manifest.launch.exe);
      state.installed[gameId] = { gameId, dir, buildId: manifest.buildId, version: manifest.version, exe, args: manifest.launch.args || [], files, installedAt: new Date().toISOString(), history: [{ version: manifest.version, at: new Date().toISOString() }] };
      await fsp.writeFile(path.join(dir, MARK), JSON.stringify({ gameId })).catch(() => {}); await saveState(); return { ok: true };
    },
    /** Удаляет только файлы, перечисленные в записи об установке, и пустые папки; пользовательские файлы (сохранения) остаются. Право на игру на сервере не затрагивается. */
    async uninstall(gameId, { removeAll = false } = {}) {
      const r = state.installed[gameId]; if (!r) return { error: 'not_installed' };
      if (procs.has(gameId)) return { error: 'running' };
      let kept = 0;
      for (const rel of Object.keys(r.files)) { const f = path.join(r.dir, rel); if (inside(r.dir, f)) await fsp.rm(f, { force: true }); }
      await fsp.rm(path.join(r.dir, '.sky-staging'), { recursive: true, force: true }); await fsp.rm(path.join(r.dir, '.sky-backup'), { recursive: true, force: true });
      const prune = async (d) => { let ents = []; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; } for (const e of ents) if (e.isDirectory()) await prune(path.join(d, e.name)); try { await fsp.rmdir(d); } catch { kept += 1; } };
      if (removeAll && fs.existsSync(path.join(r.dir, MARK)) && inside(cfg.root, r.dir)) await fsp.rm(r.dir, { recursive: true, force: true });
      else { await fsp.rm(path.join(r.dir, MARK), { force: true }); await prune(r.dir); }
      delete state.installed[gameId]; await saveState(); return { ok: true, leftover: kept > 0 };
    },
    /** Запуск по явной команде пользователя. */
    async launch(gameId) {
      const r = state.installed[gameId]; if (!r) return { error: 'not_installed' };
      if (procs.has(gameId)) return { error: 'already_running' };
      const exe = path.join(r.dir, r.exe); if (!inside(r.dir, exe)) return { error: 'bad_path' };
      for (const [rel, sha] of Object.entries(r.files)) { try { const st = await fsp.stat(path.join(r.dir, rel)); if (!st.isFile()) return { error: 'missing_files' }; } catch { return { error: 'missing_files' }; } void sha; }
      const args = (r.args || []).filter((a) => SAFE_ARG.test(a));
      return new Promise((resolve) => {
        let child; try { child = spawn(exe, args, { cwd: r.dir, stdio: 'ignore', windowsHide: false }); } catch (e) { return resolve({ error: 'spawn_failed', detail: String(e.message).slice(0, 80) }); }
        let settled = false;
        child.once('error', (e) => { if (!settled) { settled = true; resolve({ error: 'spawn_failed', detail: String(e.code || e.message).slice(0, 60) }); } emit({ type: 'launch_error', gameId, detail: String(e.code || e.message).slice(0, 60) }); });
        child.once('spawn', () => { procs.set(gameId, child); settled = true; emit({ type: 'running', gameId }); resolve({ ok: true, pid: child.pid }); });
        child.once('exit', (code, sig) => { procs.delete(gameId); emit({ type: 'exited', gameId, code, signal: sig }); });
      });
    },
    running: () => [...procs.keys()],
    stopAll() { for (const t of tasks.values()) if (running.has(t.gameId)) { t.paused = true; t.abort.abort(); } },
  };
}

module.exports = { createManager, safeRel, sha256File };
