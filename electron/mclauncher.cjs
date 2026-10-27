'use strict';
/**
 * Minecraft: установка из ОФИЦИАЛЬНОГО манифеста Mojang, вход через Microsoft (device code) и запуск. Windows-приложение.
 * Чистый Node (без Electron API) — проверяется `scripts/audit/mclauncher-test.mjs` на поддельном Mojang.
 *
 * Принципы:
 *  • Файлы только с узлов Mojang (список HOSTS); каждый файл сверяется по SHA-1 из манифеста. Чужие адреса не принимаются.
 *  • Пароль не запрашивается и не хранится. Вход — официальный поток Microsoft; хранится только refresh-токен (в secretStore — safeStorage).
 *  • Запуск ТОЛЬКО с проверенной лицензией (профиль Minecraft есть у аккаунта). Офлайн-режима и «пиратского» входа нет.
 *  • Токен игры живёт в памяти и передаётся процессу в аргументах, в журнал и события не попадает.
 *  • Не поддержано (честно): версии с `inheritsFrom` (моды/Forge/Fabric), старые версии с распаковкой natives и виртуальными ассетами, скачивание Java.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const HOSTS = new Set(['piston-meta.mojang.com', 'piston-data.mojang.com', 'launchermeta.mojang.com', 'launcher.mojang.com', 'libraries.minecraft.net', 'resources.download.minecraft.net']);
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MS = { device: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', xbl: 'https://user.auth.xboxlive.com/user/authenticate', xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize', mc: 'https://api.minecraftservices.com/authentication/login_with_xbox', profile: 'https://api.minecraftservices.com/minecraft/profile' };
const SAFE_VERSION = /^[A-Za-z0-9._-]{1,40}$/;
const SAFE_HOST = /^[A-Za-z0-9.-]{1,120}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const safeRel = (p) => {
  p = String(p ?? '');
  if (!p || p.length > 240 || /[\u0000-\u001f\\:*?"<>|]/.test(p) || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/');
  for (const s of parts) if (!s || s === '.' || s === '..' || s.length > 120 || /[. ]$/.test(s) || RESERVED.test(s)) return null;
  return parts.join('/');
};
const inside = (root, p) => { const r = path.resolve(root); const x = path.resolve(p); return x === r || x.startsWith(r + path.sep); };
const err = (code) => Object.assign(new Error(code), { code });

/** Правила Mojang: os / features. Возвращает true, если элемент действует на Windows с заданными возможностями. */
function allowed(rules, features = {}) {
  if (!Array.isArray(rules) || !rules.length) return true;
  let ok = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== 'windows') match = false;
      if (r.os.arch && r.os.arch !== 'x86' && r.os.arch !== process.arch) match = false;
      if (r.os.version) match = false;
    }
    if (r.features) for (const [k, v] of Object.entries(r.features)) if (Boolean(features[k]) !== Boolean(v)) match = false;
    if (match) ok = r.action === 'allow';
  }
  return ok;
}

function createMc(opts) {
  const root = opts.root; // <root>/{versions,libraries,assets,instances}
  const fetchImpl = opts.fetchImpl || fetch;
  const hostOk = opts.hostAllowed || ((u) => { try { const x = new URL(u); return x.protocol === 'https:' && HOSTS.has(x.hostname); } catch { return false; } });
  const manifestUrl = opts.manifestUrl || MANIFEST;
  const ep = { ...MS, ...(opts.endpoints || {}) };
  const clientId = String(opts.clientId || '');
  const secrets = opts.secretStore || (() => { let v = null; return { get: () => v, set: (x) => { v = x; } }; })();
  const emit = (ev) => { try { opts.onEvent && opts.onEvent(ev); } catch { /* ignore */ } };
  const state = { installing: null, cancel: false, auth: null, mcToken: null, running: new Map() };

  const getJson = async (url, init) => {
    if (!hostOk(url)) throw err('host_not_allowed');
    const r = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw err('http_' + r.status);
    return r.json();
  };

  const sha1File = (file) => new Promise((resolve, reject) => { const h = crypto.createHash('sha1'); const s = fs.createReadStream(file); s.on('data', (c) => h.update(c)); s.on('error', reject); s.on('end', () => resolve(h.digest('hex'))); });

  /** Скачивание с проверкой SHA-1 и размера; уже верный файл пропускается. */
  async function download(url, dest, sha1, size) {
    if (!hostOk(url)) throw err('host_not_allowed');
    try { const st = await fsp.stat(dest); if ((!size || st.size === size) && sha1 && (await sha1File(dest)) === sha1) return false; } catch { /* нет файла */ }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!r.ok || !r.body) throw err('http_' + r.status);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
    const st = await fsp.stat(tmp);
    if (size && st.size !== size) { await fsp.rm(tmp, { force: true }); throw err('size_mismatch'); }
    if (sha1 && (await sha1File(tmp)) !== sha1) { await fsp.rm(tmp, { force: true }); throw err('hash_mismatch'); }
    await fsp.rename(tmp, dest);
    return true;
  }

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { if (state.cancel) throw err('cancelled'); const it = items[i++]; await fn(it); } }));
  }

  async function versions(type) {
    const m = await getJson(manifestUrl);
    const list = (m.versions || []).filter((v) => SAFE_VERSION.test(v.id) && (type ? v.type === type : v.type === 'release' || v.type === 'snapshot'));
    return { latest: m.latest || null, versions: list.slice(0, 400).map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })) };
  }

  const vdir = (id) => path.join(root, 'versions', id);
  async function readVersion(id) { return JSON.parse(await fsp.readFile(path.join(vdir(id), id + '.json'), 'utf8')); }

  function unsupported(v) {
    if (v.inheritsFrom) return 'modded_unsupported';
    if ((v.libraries || []).some((l) => l.natives && allowed(l.rules))) return 'legacy_natives_unsupported';
    return null;
  }

  async function install(id) {
    id = String(id || '');
    if (!SAFE_VERSION.test(id)) throw err('bad_version');
    if (state.installing) throw err('busy');
    state.installing = id; state.cancel = false;
    const progress = (stage, done, total) => emit({ type: 'mc:progress', version: id, stage, done, total });
    try {
      const m = await getJson(manifestUrl);
      const entry = (m.versions || []).find((v) => v.id === id);
      if (!entry) throw err('version_not_found');
      progress('manifest', 0, 1);
      const vj = await getJson(entry.url);
      const bad = unsupported(vj);
      if (bad) throw err(bad);
      if (!vj.downloads || !vj.downloads.client) throw err('no_client');
      await fsp.mkdir(vdir(id), { recursive: true });
      // 1) клиент
      const c = vj.downloads.client;
      progress('client', 0, 1); await download(c.url, path.join(vdir(id), id + '.jar'), c.sha1, c.size);
      // 2) библиотеки
      const libs = [];
      for (const l of vj.libraries || []) {
        if (!allowed(l.rules)) continue;
        const a = l.downloads && l.downloads.artifact; if (!a) continue;
        const rel = safeRel(a.path); if (!rel) throw err('bad_library_path');
        libs.push({ url: a.url, dest: path.join(root, 'libraries', rel), sha1: a.sha1, size: a.size });
      }
      let n = 0; progress('libraries', 0, libs.length);
      await pool(libs, 6, async (l) => { await download(l.url, l.dest, l.sha1, l.size); n += 1; progress('libraries', n, libs.length); });
      // 3) ассеты
      const ai = vj.assetIndex; if (!ai || !SAFE_VERSION.test(String(ai.id))) throw err('no_assets');
      const idxFile = path.join(root, 'assets', 'indexes', ai.id + '.json');
      await download(ai.url, idxFile, ai.sha1, ai.size);
      const idx = JSON.parse(await fsp.readFile(idxFile, 'utf8'));
      if (idx.virtual || idx.map_to_resources) throw err('legacy_assets_unsupported');
      const objs = Object.values(idx.objects || {}).filter((o) => /^[0-9a-f]{40}$/.test(o.hash));
      const base = opts.assetsBase || 'https://resources.download.minecraft.net';
      n = 0; progress('assets', 0, objs.length);
      await pool(objs, 8, async (o) => { const h2 = o.hash.slice(0, 2); await download(`${base}/${h2}/${o.hash}`, path.join(root, 'assets', 'objects', h2, o.hash), o.hash, o.size); n += 1; if (n % 20 === 0 || n === objs.length) progress('assets', n, objs.length); });
      // 4) описание версии пишем ПОСЛЕДНИМ: его наличие = установка завершена
      await fsp.writeFile(path.join(vdir(id), id + '.json'), JSON.stringify(vj));
      progress('done', 1, 1); emit({ type: 'mc:installed', version: id });
      return { ok: true, version: id, javaMajor: vj.javaVersion ? vj.javaVersion.majorVersion : 8 };
    } finally { state.installing = null; }
  }

  async function installed() {
    let dirs = []; try { dirs = await fsp.readdir(path.join(root, 'versions')); } catch { return []; }
    const out = [];
    for (const d of dirs) { if (!SAFE_VERSION.test(d)) continue; try { const v = await readVersion(d); out.push({ id: d, javaMajor: v.javaVersion ? v.javaVersion.majorVersion : 8, type: v.type || 'release' }); } catch { /* недоустановлена */ } }
    return out;
  }

  /** Проверка уже установленных файлов по хешам (без сети). */
  async function verify(id) {
    if (!SAFE_VERSION.test(String(id))) throw err('bad_version');
    const vj = await readVersion(id); const bad = [];
    const c = vj.downloads.client; const jar = path.join(vdir(id), id + '.jar');
    try { if ((await sha1File(jar)) !== c.sha1) bad.push(id + '.jar'); } catch { bad.push(id + '.jar'); }
    for (const l of vj.libraries || []) { if (!allowed(l.rules)) continue; const a = l.downloads && l.downloads.artifact; if (!a) continue; const f = path.join(root, 'libraries', safeRel(a.path) || '_'); try { if ((await sha1File(f)) !== a.sha1) bad.push(a.path); } catch { bad.push(a.path); } }
    return { ok: bad.length === 0, bad: bad.slice(0, 50), badCount: bad.length };
  }

  async function uninstall(id) {
    if (!SAFE_VERSION.test(String(id))) throw err('bad_version');
    const d = vdir(id); if (!inside(path.join(root, 'versions'), d)) throw err('bad_path');
    await fsp.rm(d, { recursive: true, force: true }); return { ok: true };
  }

  // ── Java ──
  const javaMajor = (bin) => new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 8000, windowsHide: true }, (e, so, se) => {
      const t = String(se || so || ''); const m = /version "(\d+)(?:\.(\d+))?/.exec(t);
      if (!m) return resolve(null); resolve(m[1] === '1' ? Number(m[2]) : Number(m[1]));
    });
  });
  async function findJava(need) {
    const cands = [];
    if (opts.javaPath) cands.push(opts.javaPath);
    if (process.env.JAVA_HOME) cands.push(path.join(process.env.JAVA_HOME, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java'));
    cands.push('java');
    let best = null;
    for (const c of cands) { const mj = await javaMajor(c); if (mj && mj >= need) return { bin: c, major: mj }; if (mj && !best) best = { bin: c, major: mj }; }
    return { missing: true, need, have: best ? best.major : null };
  }

  // ── Вход Microsoft (device code) ──
  const form = (o) => new URLSearchParams(o).toString();
  const post = async (url, body, json) => {
    const r = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', accept: 'application/json' }, body: json ? JSON.stringify(body) : form(body), signal: AbortSignal.timeout(30000) });
    let d = null; try { d = await r.json(); } catch { /* пусто */ }
    return { status: r.status, data: d };
  };
  async function chain(msAccess) {
    const x = await post(ep.xbl, { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccess }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }, true);
    if (x.status !== 200 || !x.data) throw err('xbox_failed');
    const uhs = x.data.DisplayClaims && x.data.DisplayClaims.xui && x.data.DisplayClaims.xui[0] && x.data.DisplayClaims.xui[0].uhs;
    const s = await post(ep.xsts, { Properties: { SandboxId: 'RETAIL', UserTokens: [x.data.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }, true);
    if (s.status !== 200 || !s.data) {
      const xe = s.data && s.data.XErr;
      throw err(xe === 2148916233 ? 'no_xbox_account' : xe === 2148916238 ? 'child_account' : 'xsts_failed');
    }
    const m = await post(ep.mc, { identityToken: `XBL3.0 x=${uhs};${s.data.Token}` }, true);
    if (m.status !== 200 || !m.data || !m.data.access_token) throw err('minecraft_login_failed');
    const pr = await fetchImpl(ep.profile, { headers: { authorization: 'Bearer ' + m.data.access_token }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (pr.status === 404) throw err('no_license');
    if (!pr.ok) throw err('profile_failed');
    const p = await pr.json();
    if (!p || !p.id || !p.name) throw err('no_license');
    return { token: m.data.access_token, expiresAt: Date.now() + Math.max(60, Number(m.data.expires_in) || 3600) * 1000 - 60000, name: String(p.name), uuid: String(p.id) };
  }

  async function authStart() {
    if (!clientId) throw err('client_id_missing');
    if (state.auth && state.auth.phase === 'waiting') return state.auth.public;
    const d = await post(ep.device, { client_id: clientId, scope: 'XboxLive.signin offline_access' });
    if (d.status !== 200 || !d.data || !d.data.device_code) throw err('device_code_failed');
    const a = { phase: 'waiting', cancelled: false, public: { userCode: String(d.data.user_code), url: String(d.data.verification_uri), expiresIn: Number(d.data.expires_in) || 900 } };
    state.auth = a;
    (async () => {
      const until = Date.now() + (Number(d.data.expires_in) || 900) * 1000; let wait = Math.max(1, Number(d.data.interval) || 5);
      while (Date.now() < until && !a.cancelled) {
        await new Promise((r) => setTimeout(r, (opts.pollMs != null ? opts.pollMs : wait * 1000)));
        if (a.cancelled) return;
        const t = await post(ep.token, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: d.data.device_code }).catch(() => null);
        if (!t) continue;
        if (t.data && t.data.error === 'authorization_pending') continue;
        if (t.data && t.data.error === 'slow_down') { wait += 5; continue; }
        if (t.status === 200 && t.data && t.data.access_token) {
          try {
            const s = await chain(t.data.access_token);
            state.mcToken = s; secrets.set(JSON.stringify({ refresh: t.data.refresh_token, name: s.name, uuid: s.uuid }));
            a.phase = 'done'; emit({ type: 'mc:auth', ok: true, name: s.name });
          } catch (e) { a.phase = 'error'; a.error = e.code || 'auth_failed'; emit({ type: 'mc:auth', ok: false, error: a.error }); }
          return;
        }
        a.phase = 'error'; a.error = (t.data && t.data.error) || 'auth_failed'; emit({ type: 'mc:auth', ok: false, error: a.error }); return;
      }
      if (!a.cancelled) { a.phase = 'error'; a.error = 'expired'; emit({ type: 'mc:auth', ok: false, error: 'expired' }); }
    })();
    return a.public;
  }
  const authStatus = () => state.auth ? { phase: state.auth.phase, error: state.auth.error || null, ...(state.auth.phase === 'waiting' ? state.auth.public : {}) } : { phase: 'idle' };
  const authCancel = () => { if (state.auth) state.auth.cancelled = true; state.auth = null; return { ok: true }; };
  const account = () => { try { const s = JSON.parse(secrets.get() || 'null'); return s ? { name: s.name, uuid: s.uuid } : null; } catch { return null; } };
  const logout = () => { state.mcToken = null; state.auth = null; secrets.set(''); return { ok: true }; };
  async function session() {
    if (state.mcToken && state.mcToken.expiresAt > Date.now()) return state.mcToken;
    let s = null; try { s = JSON.parse(secrets.get() || 'null'); } catch { /* пусто */ }
    if (!s || !s.refresh) throw err('login_required');
    const t = await post(ep.token, { grant_type: 'refresh_token', client_id: clientId, refresh_token: s.refresh, scope: 'XboxLive.signin offline_access' });
    if (t.status !== 200 || !t.data || !t.data.access_token) { secrets.set(''); throw err('login_required'); }
    state.mcToken = await chain(t.data.access_token);
    secrets.set(JSON.stringify({ refresh: t.data.refresh_token || s.refresh, name: state.mcToken.name, uuid: state.mcToken.uuid }));
    return state.mcToken;
  }

  // ── Запуск ──
  const fill = (s, vars) => String(s).replace(/\$\{([A-Za-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const flat = (arr, features, vars) => {
    const out = [];
    for (const a of arr || []) {
      if (typeof a === 'string') { out.push(fill(a, vars)); continue; }
      if (!allowed(a.rules, features)) continue;
      for (const v of Array.isArray(a.value) ? a.value : [a.value]) out.push(fill(v, vars));
    }
    return out;
  };

  /** o: { version, instance (имя папки профиля), memoryMb, server?: {host, port} } */
  async function launch(o) {
    const id = String(o && o.version || ''); if (!SAFE_VERSION.test(id)) throw err('bad_version');
    const inst = String(o.instance || 'default').replace(/[^A-Za-z0-9._ -]/g, '').slice(0, 40).trim() || 'default';
    if (RESERVED.test(inst) || /^\.+$/.test(inst)) throw err('bad_instance');
    const vj = await readVersion(id).catch(() => null); if (!vj) throw err('not_installed');
    const bad = unsupported(vj); if (bad) throw err(bad);
    const mem = Math.min(32768, Math.max(512, Number(o.memoryMb) || 2048));
    const java = await findJava(vj.javaVersion ? vj.javaVersion.majorVersion : 8);
    if (java.missing) throw Object.assign(err('java_missing'), { need: java.need, have: java.have });
    const sess = await session();
    const gameDir = path.join(root, 'instances', inst); await fsp.mkdir(gameDir, { recursive: true });
    const cp = [];
    for (const l of vj.libraries || []) { if (!allowed(l.rules)) continue; const a = l.downloads && l.downloads.artifact; if (!a) continue; const rel = safeRel(a.path); if (rel) cp.push(path.join(root, 'libraries', rel)); }
    cp.push(path.join(vdir(id), id + '.jar'));
    const srv = o.server && SAFE_HOST.test(String(o.server.host || '')) ? { host: String(o.server.host), port: Math.min(65535, Math.max(1, Number(o.server.port) || 25565)) } : null;
    const features = srv ? { has_quick_plays_support: true, is_quick_play_multiplayer: true } : {};
    const natives = path.join(vdir(id), 'natives'); await fsp.mkdir(natives, { recursive: true });
    const vars = {
      auth_player_name: sess.name, auth_uuid: sess.uuid, auth_access_token: sess.token, auth_xuid: '0', clientid: '', user_type: 'msa', user_properties: '{}',
      version_name: id, version_type: vj.type || 'release', game_directory: gameDir, assets_root: path.join(root, 'assets'), assets_index_name: vj.assetIndex.id, game_assets: path.join(root, 'assets'),
      classpath: cp.join(path.delimiter), natives_directory: natives, launcher_name: 'SkyLauncher', launcher_version: '1',
      quickPlayMultiplayer: srv ? `${srv.host}:${srv.port}` : '', quickPlayPath: '', quickPlaySingleplayer: '', quickPlayRealms: '',
    };
    let jvm; let game;
    if (vj.arguments) { jvm = flat(vj.arguments.jvm, features, vars); game = flat(vj.arguments.game, features, vars); }
    else { jvm = ['-Djava.library.path=' + natives, '-cp', vars.classpath]; game = String(vj.minecraftArguments || '').split(' ').filter(Boolean).map((s) => fill(s, vars)); }
    if (srv && !(vj.arguments && JSON.stringify(vj.arguments.game || []).includes('quickPlayMultiplayer'))) game.push('--server', srv.host, '--port', String(srv.port));
    const args = [`-Xmx${mem}M`, ...jvm, vj.mainClass, ...game];
    const child = spawn(java.bin, args, { cwd: gameDir, stdio: 'ignore', detached: false, windowsHide: false });
    const key = `${id}:${inst}`;
    state.running.set(key, child.pid);
    child.on('exit', (code) => { state.running.delete(key); emit({ type: 'mc:exit', version: id, instance: inst, code }); });
    child.on('error', () => { state.running.delete(key); emit({ type: 'mc:exit', version: id, instance: inst, code: -1 }); });
    return { ok: true, pid: child.pid, instance: inst };
  }

  return {
    config: { root }, versions, install, installed, verify, uninstall, launch,
    cancelInstall: () => { state.cancel = true; return { ok: true }; },
    installing: () => state.installing,
    running: () => [...state.running.keys()],
    stopAll: () => { state.cancel = true; },
    java: (need) => findJava(Number(need) || 8),
    authStart, authStatus, authCancel, account, logout,
    hasClientId: () => Boolean(clientId),
  };
}

module.exports = { createMc, allowed, safeRel, HOSTS };
