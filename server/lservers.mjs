/**
 * Sky Launcher: каталог серверов GTA V (FiveM, RAGE MP) и Minecraft (Vanilla/Paper/Fabric/Forge), профили, пробы доступности.
 * Правила: числа игроков и «онлайн» берутся ТОЛЬКО из реальной пробы (Minecraft Server List Ping, FiveM info/players.json); где проверить нечем
 * (RAGE MP) статус не показывается. Исходящие запросы — только на публичные адреса, по уже разрешённому IP, с жёсткими лимитами.
 * Скрипты и команды на инфраструктуре Sky отсюда не выполняются: администратор правит только поля карточки.
 */
import net from 'node:net';
import http from 'node:http';
import dns from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { query, pool } from './db.mjs';
import { isPublicIp } from './bloxnet.mjs';

const ALLOW_PRIVATE = process.env.LAUNCHER_ALLOW_PRIVATE === '1' && process.env.NODE_ENV !== 'production';
export const PLATFORMS = { gta: ['fivem', 'ragemp'], minecraft: ['vanilla', 'paper', 'fabric', 'forge'] };
const PING_PLATFORMS = new Set(['vanilla', 'paper', 'fabric', 'forge', 'fivem']);   // у RAGE MP публичного протокола статуса нет
const STATUSES = ['draft', 'published', 'hidden'];
const FIELDS = ['name', 'kind', 'platform', 'host', 'port', 'version', 'mode', 'region', 'descr', 'status', 'statusSource', 'params'];
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Проверка карточки сервера. partial — правка: проверяются только присланные поля. */
export const cleanServer = (raw, { partial = false, strictFields = false } = {}) => {
  const errors = []; const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['Ожидался объект'], value: null };
  if (strictFields) for (const k of Object.keys(raw)) if (!FIELDS.includes(k)) errors.push(`Неизвестное поле «${txt(k, 30)}»`);
  const has = (k) => raw[k] !== undefined;
  const kind = has('kind') ? String(raw.kind) : undefined;
  if (kind !== undefined) { if (!PLATFORMS[kind]) errors.push('kind: gta или minecraft'); else out.kind = kind; } else if (!partial) errors.push('kind обязателен');
  const platform = has('platform') ? String(raw.platform) : undefined;
  if (platform !== undefined) { const all = Object.values(PLATFORMS).flat(); if (!all.includes(platform)) errors.push('platform не поддерживается'); else out.platform = platform; } else if (!partial) errors.push('platform обязателен');
  if (out.kind && out.platform && !PLATFORMS[out.kind].includes(out.platform)) errors.push(`Платформа ${out.platform} несовместима с типом ${out.kind}`);
  if (has('name') || !partial) { const n = txt(raw.name, 60); if (n.length < 2) errors.push('name: от 2 знаков'); else out.name = n; }
  if (has('host') || !partial) {
    const h = String(raw.host ?? '').trim().toLowerCase();
    if (!h || /[\s/:@?#\\]/.test(h) && !net.isIPv6(h)) errors.push('host: только имя или IP, без схемы, порта и пути');
    else if (!net.isIP(h) && !HOST_RE.test(h)) errors.push('host: неверное имя сервера');
    else out.host = h;
  }
  if (has('port') || !partial) { const p = Number(raw.port); if (!Number.isInteger(p) || p < 1 || p > 65535) errors.push('port: 1–65535'); else out.port = p; }
  for (const [k, n] of [['version', 30], ['mode', 40], ['region', 40], ['descr', 600]]) if (has(k)) out[k] = txt(raw[k], n);
  if (has('status')) { if (!STATUSES.includes(raw.status)) errors.push('status: draft, published или hidden'); else out.status = raw.status; }
  if (has('statusSource')) { if (!['ping', 'none'].includes(raw.statusSource)) errors.push('statusSource: ping или none'); else out.status_source = raw.statusSource; }
  if (has('params')) {
    const p = raw.params;
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const bad = Object.keys(p).filter((k) => !['note', 'passwordRequired'].includes(k));
      if (bad.length) errors.push(`params: неизвестные поля (${bad.map((b) => txt(b, 20)).join(', ')})`);
      else out.params = { ...(p.note !== undefined ? { note: txt(p.note, 200) } : {}), ...(typeof p.passwordRequired === 'boolean' ? { passwordRequired: p.passwordRequired } : {}) };
    } else errors.push('params: ожидался объект');
  }
  const plat = out.platform ?? raw.platform;
  if (out.status_source === 'ping' && plat && !PING_PLATFORMS.has(plat)) errors.push('Для этой платформы проверка доступности не поддерживается: statusSource = none');
  return { errors, value: errors.length ? null : out };
};

/* ───────── проба доступности ───────── */
const resolvePublic = async (host) => {
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  const ok = addrs.filter((a) => ALLOW_PRIVATE || isPublicIp(a));
  if (!ok.length) throw new Error('internal_address');
  return ok[0];
};
const varint = (n) => { const b = []; let v = n >>> 0; do { let x = v & 0x7f; v >>>= 7; if (v) x |= 0x80; b.push(x); } while (v); return Buffer.from(b); };
const readVarint = (buf, off = 0) => { let r = 0; let shift = 0; for (let i = off; i < Math.min(buf.length, off + 5); i += 1) { r |= (buf[i] & 0x7f) << shift; if (!(buf[i] & 0x80)) return { v: r, len: i - off + 1 }; shift += 7; } return null; };

/** Minecraft Server List Ping (Java). Возвращает { online, players, max, motd, version }. */
export const pingMinecraft = async (host, port, { timeoutMs = 4000 } = {}) => {
  const ip = await resolvePublic(host);
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port });
    let buf = Buffer.alloc(0); let done = false;
    const end = (err, val) => { if (done) return; done = true; sock.destroy(); err ? reject(err) : resolve(val); };
    sock.setTimeout(timeoutMs, () => end(new Error('timeout')));
    sock.on('error', (e) => end(new Error(e.code || 'connect_failed')));
    sock.on('connect', () => {
      const h = Buffer.from(host, 'utf8');
      const body = Buffer.concat([varint(0), varint(765), varint(h.length), h, Buffer.from([(port >> 8) & 255, port & 255]), varint(1)]);
      sock.write(Buffer.concat([varint(body.length), body, Buffer.from([1, 0])]));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]); if (buf.length > 262144) return end(new Error('too_large'));
      const l = readVarint(buf); if (!l) return;
      if (buf.length < l.len + l.v) return;
      const pk = buf.subarray(l.len, l.len + l.v); const id = readVarint(pk); if (!id || id.v !== 0) return end(new Error('bad_response'));
      const sl = readVarint(pk, id.len); if (!sl) return end(new Error('bad_response'));
      try {
        const j = JSON.parse(pk.subarray(id.len + sl.len, id.len + sl.len + sl.v).toString('utf8'));
        const motd = typeof j.description === 'string' ? j.description : (j.description?.text ?? (j.description?.extra ?? []).map((x) => x.text ?? '').join(''));
        end(null, { online: true, players: Number(j.players?.online ?? 0), max: Number(j.players?.max ?? 0), motd: txt(motd, 120), version: txt(j.version?.name, 30) });
      } catch { end(new Error('bad_response')); }
    });
  });
};

const httpGetJson = (ip, port, host, path, timeoutMs) => new Promise((resolve, reject) => {
  const req = http.request({ host: ip, port, path, method: 'GET', headers: { Host: host, 'User-Agent': 'SkyLauncher/1', Accept: 'application/json', Connection: 'close' }, timeout: timeoutMs }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return reject(new Error(`http_${res.statusCode}`)); }
    let n = 0; const chunks = [];
    res.on('data', (c) => { n += c.length; if (n > 1048576) { req.destroy(); reject(new Error('too_large')); } else chunks.push(c); });
    res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad_response')); } });
  });
  req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  req.on('error', (e) => reject(new Error(e.code || 'connect_failed')));
  req.end();
});

/** FiveM: /info.json (максимум слотов, сервер) и /players.json (число игроков). */
export const pingFivem = async (host, port, { timeoutMs = 4000 } = {}) => {
  const ip = await resolvePublic(host);
  const [info, players] = await Promise.all([httpGetJson(ip, port, host, '/info.json', timeoutMs), httpGetJson(ip, port, host, '/players.json', timeoutMs)]);
  if (!Array.isArray(players)) throw new Error('bad_response');
  return { online: true, players: players.length, max: Number(info?.vars?.sv_maxClients ?? 0), motd: txt(info?.vars?.sv_projectName ?? info?.vars?.sv_projectDesc ?? '', 120), version: txt(info?.server ?? '', 30) };
};

export const probeRow = async (row) => {
  try {
    const r = row.kind === 'minecraft' ? await pingMinecraft(row.host, row.port) : row.platform === 'fivem' ? await pingFivem(row.host, row.port) : null;
    if (!r) return { online: null, error: 'unsupported' };
    return { ...r, error: '' };
  } catch (e) { return { online: false, players: null, max: null, motd: '', version: '', error: String(e.message || 'failed').slice(0, 60) }; }
};

export const probeAndStore = async (id) => {
  const row = (await query('SELECT * FROM launcher_servers WHERE id=$1', [id])).rows[0]; if (!row) return null;
  const r = await probeRow(row);
  await query(`UPDATE launcher_servers SET online=$2, players=$3, max_players=$4, motd=COALESCE(NULLIF($5,''), motd), checked_at=now(), last_error=$6 WHERE id=$1`,
    [id, r.online, r.players ?? null, r.max ?? null, r.motd ?? '', r.error ?? '']);
  return r;
};

let lastSweep = 0;
/** Фоновая проверка: только опубликованные карточки с statusSource=ping, не чаще интервала, порцией и с ограничением параллелизма. */
export const sweepServers = async ({ intervalMin = 5, batch = 30, force = false } = {}) => {
  if (!force && Date.now() - lastSweep < 55000) return 0;
  lastSweep = Date.now();
  const { rows } = await query(
    `SELECT id FROM launcher_servers WHERE status='published' AND status_source='ping' AND (checked_at IS NULL OR checked_at < now() - ($1::int * interval '1 minute'))
      ORDER BY checked_at NULLS FIRST LIMIT $2`, [Math.max(2, intervalMin), batch]);
  let i = 0; const worker = async () => { while (i < rows.length) { const r = rows[i]; i += 1; await probeAndStore(r.id).catch(() => {}); } };
  await Promise.all(Array.from({ length: 5 }, worker));
  return rows.length;
};

/* ───────── каталог для людей ───────── */
const pub = (r, fav) => ({
  id: r.id, kind: r.kind, platform: r.platform, name: r.name, descr: r.descr, host: r.host, port: r.port, version: r.version, mode: r.mode, region: r.region,
  statusKnown: r.status_source === 'ping' && r.checked_at !== null, online: r.status_source === 'ping' ? r.online : null,
  players: r.status_source === 'ping' ? r.players : null, maxPlayers: r.status_source === 'ping' ? r.max_players : null, motd: r.motd,
  checkedAt: r.checked_at ? r.checked_at.toISOString() : null, passwordRequired: r.params?.passwordRequired === true, note: r.params?.note ?? '', favorite: Boolean(fav),
});

export const listServers = async (me, { kind, q, mode, platform, region, onlineOnly, favoritesOnly, limit = 50, offset = 0 } = {}) => {
  const a = [me]; const w = [`s.status = 'published'`];
  if (PLATFORMS[kind]) { a.push(kind); w.push(`s.kind = $${a.length}`); }
  if (platform) { a.push(String(platform)); w.push(`s.platform = $${a.length}`); }
  if (mode) { a.push(txt(mode, 40).toLowerCase()); w.push(`lower(s.mode) = $${a.length}`); }
  if (region) { a.push(txt(region, 40).toLowerCase()); w.push(`lower(s.region) = $${a.length}`); }
  if (q) { a.push(`%${txt(q, 60).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`); w.push(`(lower(s.name) LIKE $${a.length} ESCAPE '\\' OR lower(s.descr) LIKE $${a.length} ESCAPE '\\')`); }
  if (onlineOnly) w.push(`s.online IS TRUE`);
  if (favoritesOnly) w.push(`f.profile_id IS NOT NULL`);
  a.push(Math.min(100, Math.max(1, Number(limit) || 50))); a.push(Math.max(0, Number(offset) || 0));
  const { rows } = await query(
    `SELECT s.*, (f.profile_id IS NOT NULL) AS fav FROM launcher_servers s LEFT JOIN launcher_server_favs f ON f.server_id = s.id AND f.profile_id = $1
      WHERE ${w.join(' AND ')} ORDER BY (f.profile_id IS NOT NULL) DESC, s.online DESC NULLS LAST, s.players DESC NULLS LAST, s.name LIMIT $${a.length - 1} OFFSET $${a.length}`, a);
  return { servers: rows.map((r) => pub(r, r.fav)) };
};

export const serverFacets = async (kind) => {
  const { rows } = await query(`SELECT DISTINCT mode, region, platform FROM launcher_servers WHERE status='published' AND kind=$1`, [kind]);
  const u = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))].sort();
  return { modes: u('mode'), regions: u('region'), platforms: u('platform') };
};

export const toggleFavorite = async (me, id, on) => {
  const ex = (await query(`SELECT 1 FROM launcher_servers WHERE id=$1 AND status='published'`, [id])).rows[0]; if (!ex) return { error: 'not_found' };
  if (on) {
    const n = (await query('SELECT count(*)::int AS n FROM launcher_server_favs WHERE profile_id=$1', [me])).rows[0].n; if (n >= 200) return { error: 'too_many' };
    await query('INSERT INTO launcher_server_favs (profile_id, server_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, id]);
  } else await query('DELETE FROM launcher_server_favs WHERE profile_id=$1 AND server_id=$2', [me, id]);
  return { ok: true, favorite: on };
};

/** «Подключиться»: записывает историю и отдаёт то, что действительно поддерживается платформой. Игру и клиент Sky не скачивает и не запускает сам. */
export const connectInfo = async (me, id) => {
  const r = (await query(`SELECT * FROM launcher_servers WHERE id=$1 AND status='published'`, [id])).rows[0]; if (!r) return { error: 'not_found' };
  await query(`INSERT INTO launcher_server_history (profile_id, server_id) VALUES ($1,$2) ON CONFLICT (profile_id, server_id) DO UPDATE SET last_at=now(), count=launcher_server_history.count+1`, [me, id]);
  const addr = `${r.host}:${r.port}`;
  const base = { address: addr, host: r.host, port: r.port, passwordRequired: r.params?.passwordRequired === true };
  if (r.platform === 'fivem') return { ...base, launchSupported: true, uri: `fivem://connect/${addr}`, instructions: 'Нужен установленный клиент FiveM: ссылка откроет его и подключит к серверу. Sky не скачивает GTA V и FiveM.' };
  if (r.platform === 'ragemp') return { ...base, launchSupported: false, uri: null, instructions: 'Автоматический запуск RAGE MP не поддерживается: откройте клиент RAGE MP и введите адрес сервера вручную.' };
  return { ...base, launchSupported: false, uri: null, instructions: `Откройте Minecraft (версия ${r.version || 'указана на странице сервера'}), «Сетевая игра» → «Добавить сервер» и вставьте адрес. Sky не запускает и не авторизует Minecraft: вход через официальный лаунчер Mojang/Microsoft.` };
};

export const listHistory = async (me) => {
  const { rows } = await query(`SELECT s.*, h.last_at, h.count FROM launcher_server_history h JOIN launcher_servers s ON s.id=h.server_id WHERE h.profile_id=$1 AND s.status='published' ORDER BY h.last_at DESC LIMIT 30`, [me]);
  return { history: rows.map((r) => ({ ...pub(r, false), lastAt: r.last_at.toISOString(), count: r.count })) };
};
export const clearHistory = async (me) => { await query('DELETE FROM launcher_server_history WHERE profile_id=$1', [me]); return { ok: true }; };

/* ───────── профили запуска ───────── */
const JVM_OK = [/^-XX:\+(UseG1GC|UseZGC|UseShenandoahGC|UseParallelGC|UnlockExperimentalVMOptions|DisableExplicitGC|AlwaysPreTouch|ParallelRefProcEnabled)$/,
  /^-XX:(MaxGCPauseMillis|G1NewSizePercent|G1MaxNewSizePercent|G1ReservePercent|G1HeapRegionSize|InitiatingHeapOccupancyPercent)=\d{1,6}[mMkK]?$/, /^-Dfile\.encoding=UTF-8$/];
export const MC_MEM_MIN = 512; export const MC_MEM_MAX = 16384;
export const cleanProfile = (kind, name, data) => {
  const n = txt(name, 40); if (n.length < 1) return { error: 'name_required' };
  const d = data && typeof data === 'object' ? data : {};
  if (kind === 'minecraft') {
    const version = String(d.version ?? '').trim(); if (!/^[0-9A-Za-z._+-]{1,32}$/.test(version)) return { error: 'bad_version' };
    const mem = Number(d.memoryMb ?? 2048); if (!Number.isInteger(mem) || mem < MC_MEM_MIN || mem > MC_MEM_MAX) return { error: 'bad_memory' };
    const args = Array.isArray(d.jvmArgs) ? d.jvmArgs.map((x) => String(x).trim()).filter(Boolean) : [];
    if (args.length > 12 || args.some((a) => !JVM_OK.some((re) => re.test(a)))) return { error: 'bad_jvm_args' };
    const dir = String(d.gameDir ?? n).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profile';
    const loader = ['vanilla', 'fabric', 'forge', 'paper'].includes(d.loader) ? d.loader : 'vanilla';
    return { name: n, data: { version, memoryMb: mem, jvmArgs: args, gameDir: dir, loader } };
  }
  if (kind === 'gta') {
    const platform = ['fivem', 'ragemp'].includes(d.platform) ? d.platform : null; if (!platform) return { error: 'bad_platform' };
    const path = String(d.gamePath ?? '').slice(0, 260); if (/[\u0000-\u001f"<>|*?]/.test(path)) return { error: 'bad_path' };
    return { name: n, data: { platform, gamePath: path, autoReconnect: d.autoReconnect === true } };
  }
  return { error: 'bad_kind' };
};
export const listProfiles = async (me, kind) => {
  const { rows } = await query(`SELECT id, kind, name, data, updated_at FROM launcher_profiles WHERE profile_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at`, [me, kind || null]);
  return { profiles: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, data: r.data, updatedAt: r.updated_at.toISOString() })) };
};
export const saveProfile = async (me, { id, kind, name, data }) => {
  const c = cleanProfile(kind, name, data); if (c.error) return c;
  if (id) {
    const r = await query(`UPDATE launcher_profiles SET name=$3, data=$4, updated_at=now() WHERE id=$1 AND profile_id=$2 AND kind=$5 RETURNING id`, [id, me, c.name, JSON.stringify(c.data), kind]);
    return r.rows[0] ? { ok: true, id } : { error: 'not_found' };
  }
  const n = (await query('SELECT count(*)::int AS n FROM launcher_profiles WHERE profile_id=$1 AND kind=$2', [me, kind])).rows[0].n; if (n >= 20) return { error: 'too_many' };
  const nid = `lpr-${randomUUID()}`; await query('INSERT INTO launcher_profiles (id, profile_id, kind, name, data) VALUES ($1,$2,$3,$4,$5)', [nid, me, kind, c.name, JSON.stringify(c.data)]);
  return { ok: true, id: nid };
};
export const deleteProfile = async (me, id) => ({ ok: (await query('DELETE FROM launcher_profiles WHERE id=$1 AND profile_id=$2', [id, me])).rowCount > 0 });
/** Сброс настроек конкретного профиля к значениям по умолчанию (другие профили не затрагиваются). */
export const resetProfile = async (me, id) => {
  const p = (await query('SELECT kind, name FROM launcher_profiles WHERE id=$1 AND profile_id=$2', [id, me])).rows[0]; if (!p) return { error: 'not_found' };
  const def = p.kind === 'minecraft' ? { version: '1.20.1', memoryMb: 2048, jvmArgs: [], gameDir: 'profile', loader: 'vanilla' } : { platform: 'fivem', gamePath: '', autoReconnect: false };
  await query('UPDATE launcher_profiles SET data=$3, updated_at=now() WHERE id=$1 AND profile_id=$2', [id, me, JSON.stringify(def)]);
  return { ok: true };
};

/* ───────── администрирование ───────── */
const adm = (r) => ({ ...pub(r, false), status: r.status, statusSource: r.status_source, params: r.params, lastError: r.last_error, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });
export const adminListServers = async ({ kind, q, status } = {}) => {
  const a = []; const w = ['TRUE'];
  if (PLATFORMS[kind]) { a.push(kind); w.push(`kind=$${a.length}`); }
  if (STATUSES.includes(status)) { a.push(status); w.push(`status=$${a.length}`); }
  if (q) { a.push(`%${txt(q, 60).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`); w.push(`(lower(name) LIKE $${a.length} ESCAPE '\\' OR lower(host) LIKE $${a.length} ESCAPE '\\')`); }
  const { rows } = await query(`SELECT * FROM launcher_servers WHERE ${w.join(' AND ')} ORDER BY updated_at DESC LIMIT 300`, a);
  return { servers: rows.map(adm) };
};
const snap = (r) => (r ? { kind: r.kind, platform: r.platform, name: r.name, descr: r.descr, host: r.host, port: r.port, version: r.version, mode: r.mode, region: r.region, status: r.status, status_source: r.status_source, params: r.params } : null);
const logChange = (c, id, actor, action, before, after, batch = null) => c.query('INSERT INTO launcher_server_log (server_id, actor_id, action, before, after, batch) VALUES ($1,$2,$3,$4,$5,$6)', [id, actor, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, batch]);
const withTx = async (fn) => { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } };

export const adminSaveServer = async (actor, id, raw) => {
  const { errors, value } = cleanServer(raw, { partial: Boolean(id) });
  if (errors.length) return { error: 'invalid', errors };
  try {
    return await withTx(async (c) => {
      if (id) {
        const cur = (await c.query('SELECT * FROM launcher_servers WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!cur) return { error: 'not_found' };
        const m = { ...snap(cur), ...value }; if (m.status_source === 'ping' && !PING_PLATFORMS.has(m.platform)) return { error: 'invalid', errors: ['Проверка недоступна для этой платформы'] };
        if (!PLATFORMS[m.kind].includes(m.platform)) return { error: 'invalid', errors: ['Платформа несовместима с типом'] };
        await c.query(`UPDATE launcher_servers SET kind=$2, platform=$3, name=$4, descr=$5, host=$6, port=$7, version=$8, mode=$9, region=$10, status=$11, status_source=$12, params=$13, updated_at=now(),
                          online=CASE WHEN host<>$6 OR port<>$7 THEN NULL ELSE online END, checked_at=CASE WHEN host<>$6 OR port<>$7 THEN NULL ELSE checked_at END WHERE id=$1`,
          [id, m.kind, m.platform, m.name, m.descr, m.host, m.port, m.version, m.mode, m.region, m.status, m.status_source, JSON.stringify(m.params)]);
        await logChange(c, id, actor, 'update', snap(cur), m); return { ok: true, id };
      }
      const nid = `lsv-${randomUUID()}`; const m = { descr: '', version: '', mode: '', region: '', status: 'draft', status_source: PING_PLATFORMS.has(value.platform) ? 'ping' : 'none', params: {}, ...value };
      await c.query(`INSERT INTO launcher_servers (id, kind, platform, name, descr, host, port, version, mode, region, status, status_source, params, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [nid, m.kind, m.platform, m.name, m.descr, m.host, m.port, m.version, m.mode, m.region, m.status, m.status_source, JSON.stringify(m.params), actor]);
      await logChange(c, nid, actor, 'create', null, m); return { ok: true, id: nid };
    });
  } catch (e) { if (e.code === '23505') return { error: 'duplicate' }; throw e; }
};
export const adminDeleteServer = async (actor, id) => withTx(async (c) => {
  const cur = (await c.query('SELECT * FROM launcher_servers WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!cur) return { error: 'not_found' };
  await logChange(c, id, actor, 'delete', snap(cur), null); await c.query('DELETE FROM launcher_servers WHERE id=$1', [id]); return { ok: true };
});

/** Импорт конфигурации: предпросмотр (ничего не пишет) и применение одной транзакцией с общим batch для отката. */
export const IMPORT_MAX_BYTES = 262144; export const IMPORT_MAX_SERVERS = 200;
export const planImport = async (doc) => {
  if (JSON.stringify(doc ?? null).length > IMPORT_MAX_BYTES) return { error: 'invalid', errors: [`Файл больше ${IMPORT_MAX_BYTES / 1024} КБ`] };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'invalid', errors: ['Ожидался объект {"schema":1,"servers":[…]}'] };
  const bad = Object.keys(doc).filter((k) => !['schema', 'servers'].includes(k)); if (bad.length) return { error: 'invalid', errors: [`Неизвестные поля верхнего уровня: ${bad.map((b) => txt(b, 20)).join(', ')}`] };
  if (doc.schema !== 1) return { error: 'invalid', errors: ['schema должен быть 1'] };
  if (!Array.isArray(doc.servers) || !doc.servers.length || doc.servers.length > IMPORT_MAX_SERVERS) return { error: 'invalid', errors: [`servers: от 1 до ${IMPORT_MAX_SERVERS} записей`] };
  const items = []; const seen = new Set(); let errCount = 0;
  for (const [i, raw] of doc.servers.entries()) {
    const { errors, value } = cleanServer(raw, { strictFields: true });
    if (errors.length) { errCount += 1; items.push({ index: i, action: 'error', errors }); continue; }
    const key = `${value.kind}|${value.host}|${value.port}`; if (seen.has(key)) { errCount += 1; items.push({ index: i, action: 'error', errors: ['Дубликат адреса в файле'] }); continue; } seen.add(key);
    const cur = (await query('SELECT * FROM launcher_servers WHERE kind=$1 AND lower(host)=$2 AND port=$3', [value.kind, value.host, value.port])).rows[0];
    if (!cur) { items.push({ index: i, action: 'create', name: value.name, value }); continue; }
    const m = { ...snap(cur), ...value }; const before = snap(cur);
    const changed = Object.keys(m).filter((k) => JSON.stringify(m[k]) !== JSON.stringify(before[k]));
    items.push({ index: i, action: changed.length ? 'update' : 'unchanged', name: value.name, id: cur.id, changed, value });
  }
  return { ok: errCount === 0, items: items.map(({ value, ...x }) => ({ ...x, _v: value })), counts: { create: items.filter((x) => x.action === 'create').length, update: items.filter((x) => x.action === 'update').length, unchanged: items.filter((x) => x.action === 'unchanged').length, errors: errCount } };
};
export const applyImport = async (actor, doc) => {
  const plan = await planImport(doc); if (plan.error) return plan; if (!plan.ok) return { error: 'invalid', errors: ['В файле есть ошибки — исправьте их и повторите'], plan };
  const batch = `lib-${randomUUID()}`;
  await withTx(async (c) => {
    for (const it of plan.items) {
      if (it.action === 'create') {
        const m = { descr: '', version: '', mode: '', region: '', status: 'draft', status_source: PING_PLATFORMS.has(it._v.platform) ? 'ping' : 'none', params: {}, ...it._v }; const nid = `lsv-${randomUUID()}`;
        await c.query(`INSERT INTO launcher_servers (id, kind, platform, name, descr, host, port, version, mode, region, status, status_source, params, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [nid, m.kind, m.platform, m.name, m.descr, m.host, m.port, m.version, m.mode, m.region, m.status, m.status_source, JSON.stringify(m.params), actor]);
        await logChange(c, nid, actor, 'import_create', null, m, batch);
      } else if (it.action === 'update') {
        const cur = (await c.query('SELECT * FROM launcher_servers WHERE id=$1 FOR UPDATE', [it.id])).rows[0]; if (!cur) continue; const m = { ...snap(cur), ...it._v };
        await c.query(`UPDATE launcher_servers SET name=$2, descr=$3, version=$4, mode=$5, region=$6, status=$7, status_source=$8, params=$9, platform=$10, updated_at=now() WHERE id=$1`,
          [it.id, m.name, m.descr, m.version, m.mode, m.region, m.status, m.status_source, JSON.stringify(m.params), m.platform]);
        await logChange(c, it.id, actor, 'import_update', snap(cur), m, batch);
      }
    }
  });
  return { ok: true, batch, counts: plan.counts };
};
export const rollbackBatch = async (actor, batch) => withTx(async (c) => {
  const { rows } = await c.query('SELECT * FROM launcher_server_log WHERE batch=$1 ORDER BY id DESC', [batch]); if (!rows.length) return { error: 'not_found' };
  if ((await c.query(`SELECT 1 FROM launcher_server_log WHERE action LIKE 'rollback%' AND batch=$1`, [`rb:${batch}`])).rows[0]) return { error: 'already_rolled_back' };
  for (const l of rows) {
    const later = (await c.query('SELECT 1 FROM launcher_server_log WHERE server_id=$1 AND id>$2 AND (batch IS NULL OR batch<>$3) LIMIT 1', [l.server_id, l.id, batch])).rows[0];
    if (later) return { error: 'changed_since', serverId: l.server_id };
  }
  for (const l of rows) {
    if (!l.before) await c.query('DELETE FROM launcher_servers WHERE id=$1', [l.server_id]);
    else { const b = l.before; await c.query(`UPDATE launcher_servers SET name=$2, descr=$3, version=$4, mode=$5, region=$6, status=$7, status_source=$8, params=$9, platform=$10, updated_at=now() WHERE id=$1`, [l.server_id, b.name, b.descr, b.version, b.mode, b.region, b.status, b.status_source, JSON.stringify(b.params), b.platform]); }
    await logChange(c, l.server_id, actor, 'rollback', l.after, l.before, `rb:${batch}`);
  }
  return { ok: true, reverted: rows.length };
});
export const serverLog = async (id) => {
  const { rows } = await query(`SELECT id, server_id, actor_id, action, batch, at FROM launcher_server_log WHERE ($1::text IS NULL OR server_id=$1) ORDER BY id DESC LIMIT 100`, [id || null]);
  return { log: rows.map((r) => ({ id: Number(r.id), serverId: r.server_id, actorId: r.actor_id, action: r.action, batch: r.batch, at: r.at.toISOString() })) };
};
