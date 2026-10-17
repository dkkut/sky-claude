/**
 * Единая система журналирования Sky.
 *
 * Принципы:
 *  • Пишем СОБЫТИЯ (кто, что, где, чем кончилось), а не содержимое: пароли, токены, ключи, коды, реквизиты, тексты сообщений и частные файлы
 *    вырезаются из `detail` до записи (`scrub`), адрес клиента хранится только хешем.
 *  • Журнал не должен ронять сервер: запись идёт через буфер (пачками раз в секунду). Если база недоступна, события копятся в памяти
 *    (предел 3000; при переполнении вытесняются самые старые НЕ критические), критические дополнительно уходят в stderr и не вытесняются.
 *  • Аудиторские категории (`admin`, `security`) получают цепочку хешей: правка или удаление записи «в середине» ломает проверку `verifyChain`.
 *    Это обнаруживает вмешательство, но не отменяет того, что администратор сервера физически может переписать всю базу целиком.
 *  • Сроки хранения по категориям; DEBUG включается на ограниченное время и сам выключается.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { config } from './config.mjs';
import { getRequestContext } from './reqctx.mjs';

export const CATEGORIES = ['user', 'admin', 'server', 'client', 'security'];
export const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];
const AUDIT = new Set(['admin', 'security']);
const LEVEL_RANK = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

const FORBIDDEN_KEY = /(pass|pwd|secret|token|api[_-]?key|private|otp|authorization|cookie|cvv|cvc|iban|card|pin\b|signature|^code$|_code$|email_?code|twofactor)/i;
const CONTENT_KEY = /^(text|message|body|content|caption|transcript|lyrics|bio|address|requisite|identifier|sender)$/i;

/** Убрать из события секреты и частное содержимое. Глубина и размер ограничены. */
export const scrub = (v, depth = 0) => {
  if (v == null) return v;
  if (typeof v === 'string') return v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= 3) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 30)) {
      out[k] = FORBIDDEN_KEY.test(k) || CONTENT_KEY.test(k) ? '[скрыто]' : scrub(x, depth + 1);
    }
    return out;
  }
  return String(v).slice(0, 100);
};

const ipHash = (ip) => (ip ? crypto.createHmac('sha256', config.jwtSecret).update(`log-ip:${ip}`).digest('hex').slice(0, 16) : '');
const deviceOf = (ua) => {
  const s = String(ua ?? '');
  if (/SkyAndroid|Android/i.test(s)) return 'android';
  if (/iPhone|iPad|iOS/i.test(s)) return 'ios';
  if (/SkyDesktop|Electron/i.test(s)) return 'desktop';
  if (/SmartTV|Tizen|WebOS|HbbTV|Android TV/i.test(s)) return 'tv';
  if (/PlayStation|Xbox|Nintendo/i.test(s)) return 'console';
  if (/Mozilla/i.test(s)) return 'web';
  return s ? 'other' : '';
};

/* ─── Буфер ───────────────────────────────────────────────────────── */

const MAX_BUFFER = 3000;
let buffer = [];
let timer = null;
let flushing = false;
let debugUntil = 0;
let settingsAt = 0;
let settings = { retention_days: { user: 180, admin: 730, server: 60, client: 30, security: 365 }, telemetry: true };
export const stats = { written: 0, dropped: 0, failedFlushes: 0, buffered: () => buffer.length };

const loadSettings = async () => {
  if (Date.now() - settingsAt < 30_000) return settings;
  settingsAt = Date.now();
  try {
    const { rows } = await query('SELECT retention_days, debug_until, telemetry FROM sky_log_settings WHERE id');
    if (rows[0]) { settings = rows[0]; debugUntil = rows[0].debug_until ? new Date(rows[0].debug_until).getTime() : 0; }
  } catch { /* таблицы ещё нет — работаем с умолчаниями */ }
  return settings;
};

/** Postgres хранит jsonb с ключами «по длине, затем по байтам»; хеш при записи считаем по тому же порядку, иначе проверка по прочитанной из базы записи не сойдётся. */
const jsonbOrder = (v) => {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return Object.fromEntries(keys.map((k) => [k, jsonbOrder(v[k])]));
  }
  return v;
};

const chainHash = (prev, e) => crypto.createHash('sha256')
  .update(`${prev}|${e.event_id}|${e.at.toISOString()}|${e.category}|${e.type}|${e.actor_id ?? ''}|${e.target_id ?? ''}|${e.result}|${e.reason}|${JSON.stringify(e.detail)}`).digest('hex');

const flush = async () => {
  if (flushing || !buffer.length) return;
  flushing = true;
  const batch = buffer.splice(0, 200);
  const c = await pool.connect().catch(() => null);
  if (!c) { buffer = [...batch, ...buffer]; stats.failedFlushes += 1; flushing = false; return; }
  try {
    await c.query('BEGIN');
    // Одна цепочка на всех: замок гарантирует, что два сервера/потока не возьмут один и тот же prev_hash.
    await c.query('SELECT pg_advisory_xact_lock(7710001)');
    const { rows: last } = await c.query(`SELECT chain_seq, hash FROM sky_events WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1`);
    let seq = Number(last[0]?.chain_seq ?? 0); let prev = last[0]?.hash ?? 'genesis';
    for (const e of batch) {
      let cs = null, ph = null, h = null;
      if (AUDIT.has(e.category)) { seq += 1; cs = seq; ph = prev; h = chainHash(prev, { ...e, detail: jsonbOrder(e.detail) }); prev = h; }
      await c.query(
        `INSERT INTO sky_events (event_id, at, category, level, type, service, actor_id, target_id, result, reason, device, ip_hash, request_id, detail, chain_seq, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (event_id) DO NOTHING`,
        [e.event_id, e.at, e.category, e.level, e.type, e.service, e.actor_id, e.target_id, e.result, e.reason, e.device, e.ip_hash, e.request_id, JSON.stringify(e.detail), cs, ph, h]);
    }
    await c.query('COMMIT');
    stats.written += batch.length;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    buffer = [...batch, ...buffer]; stats.failedFlushes += 1;
    if (stats.failedFlushes % 20 === 1) console.error('[skylog] запись не удалась:', err.message);
  } finally { c.release(); flushing = false; }
  if (buffer.length) schedule(0);
};
const schedule = (ms = 1000) => { if (timer) return; timer = setTimeout(() => { timer = null; void flush(); }, ms); timer.unref?.(); };

const trim = () => {
  if (buffer.length <= MAX_BUFFER) return;
  // вытесняем самые старые некритические
  let over = buffer.length - MAX_BUFFER;
  const keep = [];
  for (const e of buffer) { if (over > 0 && e.level !== 'CRITICAL' && !AUDIT.has(e.category)) { over -= 1; stats.dropped += 1; } else keep.push(e); }
  buffer = keep;
};

/**
 * Записать событие. Никогда не бросает исключений и не ждёт базы.
 * { category, type, level?, service?, actorId?, targetId?, result?, reason?, ip?, ua?, requestId?, detail? }
 */
export const logEvent = (ev) => {
  try {
    const level = LEVELS.includes(ev.level) ? ev.level : (ev.result === 'error' ? 'ERROR' : 'INFO');
    if (level === 'DEBUG' && Date.now() > debugUntil) return;
    if (!CATEGORIES.includes(ev.category)) return;
    const ctx = getRequestContext?.() ?? {};
    const e = {
      event_id: `ev-${crypto.randomUUID()}`, at: new Date(), category: ev.category, level, type: String(ev.type ?? 'unknown').slice(0, 80),
      service: String(ev.service ?? '').slice(0, 40), actor_id: ev.actorId ? String(ev.actorId).slice(0, 80) : null, target_id: ev.targetId ? String(ev.targetId).slice(0, 120) : null,
      result: ['ok', 'denied', 'error'].includes(ev.result) ? ev.result : 'ok', reason: String(ev.reason ?? '').slice(0, 200),
      device: deviceOf(ev.ua), ip_hash: ipHash(ev.ip), request_id: String(ev.requestId ?? ctx.requestId ?? '').slice(0, 60), detail: scrub(ev.detail ?? {}),
    };
    buffer.push(e);
    if (level === 'CRITICAL') console.error(`[skylog] CRITICAL ${e.category}/${e.type} ${e.reason}`);
    trim();
    if (buffer.length >= 100 || level === 'CRITICAL') schedule(0); else schedule();
    void loadSettings();
  } catch (err) { console.error('[skylog]', err.message); }
};

export const flushNow = async () => { for (let i = 0; i < 20 && buffer.length; i += 1) await flush(); };

/* ─── Целостность, хранение, настройки ────────────────────────────── */

/** Проверка цепочки аудиторских записей. Возвращает { ok, checked, brokenAt? }. */
export const verifyChain = async (limit = 5000) => {
  const { rows } = await query(
    `SELECT event_id, at, category, type, actor_id, target_id, result, reason, detail, chain_seq, prev_hash, hash
       FROM sky_events WHERE chain_seq IS NOT NULL ORDER BY chain_seq ASC LIMIT $1`, [limit]);
  let prev = null; let checked = 0;
  for (const r of rows) {
    if (prev !== null && Number(r.chain_seq) !== prev.seq + 1) return { ok: false, checked, brokenAt: Number(r.chain_seq), why: 'пропущена запись' };
    if (prev !== null && r.prev_hash !== prev.hash) return { ok: false, checked, brokenAt: Number(r.chain_seq), why: 'не совпадает предыдущий хеш' };
    const h = chainHash(r.prev_hash, { ...r, actor_id: r.actor_id, target_id: r.target_id });
    if (h !== r.hash) return { ok: false, checked, brokenAt: Number(r.chain_seq), why: 'запись изменена' };
    prev = { seq: Number(r.chain_seq), hash: r.hash }; checked += 1;
  }
  return { ok: true, checked };
};

/** Уборка по срокам. Начало цепочки сдвигается: проверка идёт от первой оставшейся записи. */
export const sweepLogs = async () => {
  const s = await loadSettings(); let removed = 0;
  for (const cat of CATEGORIES) {
    const days = Math.max(1, Math.min(3650, Number(s.retention_days?.[cat]) || 90));
    const r = await query(`DELETE FROM sky_events WHERE category = $1 AND at < now() - ($2 || ' days')::interval`, [cat, String(days)]);
    removed += r.rowCount;
  }
  if (debugUntil && Date.now() > debugUntil) await query('UPDATE sky_log_settings SET debug_until = NULL WHERE id').catch(() => {});
  return removed;
};

export const getSettings = async () => { settingsAt = 0; const s = await loadSettings(); return { retentionDays: s.retention_days, debugUntil: s.debug_until ?? null, telemetry: s.telemetry !== false }; };
export const telemetryEnabled = async () => (await loadSettings()).telemetry !== false;
export const levelAtLeast = (a, b) => LEVEL_RANK[a] >= LEVEL_RANK[b];

/* ─── Чтение для админки (право `logs`) ───────────────────────────── */

const toRow = (r) => ({
  id: Number(r.id), eventId: r.event_id, at: r.at.toISOString(), category: r.category, level: r.level, type: r.type, service: r.service || undefined,
  actorId: r.actor_id ?? undefined, targetId: r.target_id ?? undefined, result: r.result, reason: r.reason || undefined, device: r.device || undefined,
  requestId: r.request_id || undefined, detail: r.detail, audit: r.chain_seq !== null,
});

/** Условие поиска по журналу. Все значения — параметрами. */
const where = (f, args) => {
  const w = [];
  if (f.category && CATEGORIES.includes(f.category)) { args.push(f.category); w.push(`category = $${args.length}`); }
  // Разделы журнала: люди / администрация / сервер и хранилище
  const SECTIONS = { users: ['user', 'client'], admin: ['admin', 'security'], server: ['server'] };
  if (f.section === 'storage') { w.push(`(service = 'storage' OR service LIKE 'storage%' OR type LIKE 'storage%')`); }
  else if (SECTIONS[f.section]) { args.push(SECTIONS[f.section]); w.push(`category = ANY($${args.length})`); }
  if (f.level && LEVELS.includes(f.level)) { args.push(f.level); w.push(`level = $${args.length}`); }
  if (f.minLevel && LEVELS.includes(f.minLevel)) { args.push(LEVELS.filter((l) => LEVEL_RANK[l] >= LEVEL_RANK[f.minLevel])); w.push(`level = ANY($${args.length})`); }
  if (f.result && ['ok', 'denied', 'error'].includes(f.result)) { args.push(f.result); w.push(`result = $${args.length}`); }
  if (f.type) { args.push(`${String(f.type).replace(/([\\%_])/g, '\\$1').slice(0, 80)}%`); w.push(`type LIKE $${args.length} ESCAPE '\\'`); }
  if (f.service) { args.push(String(f.service).slice(0, 40)); w.push(`service = $${args.length}`); }
  if (f.actor) { args.push(String(f.actor).slice(0, 80)); w.push(`(actor_id = $${args.length} OR target_id = $${args.length})`); }
  if (f.requestId) { args.push(String(f.requestId).slice(0, 60)); w.push(`request_id = $${args.length}`); }
  if (f.q) { args.push(`%${String(f.q).toLowerCase().replace(/([\\%_])/g, '\\$1').slice(0, 100)}%`); w.push(`(lower(type) LIKE $${args.length} ESCAPE '\\' OR lower(reason) LIKE $${args.length} ESCAPE '\\' OR lower(detail::text) LIKE $${args.length} ESCAPE '\\')`); }
  const d = (v) => { const t = new Date(v); return Number.isNaN(t.getTime()) ? null : t; };
  if (f.from && d(f.from)) { args.push(d(f.from)); w.push(`at >= $${args.length}`); }
  if (f.to && d(f.to)) { args.push(d(f.to)); w.push(`at <= $${args.length}`); }
  if (f.before && /^\d+$/.test(String(f.before))) { args.push(Number(f.before)); w.push(`id < $${args.length}`); }
  return w.length ? `WHERE ${w.join(' AND ')}` : '';
};

/** Страница журнала: новые сверху, курсор — `before` (id последней записи прошлой страницы). */
export const searchEvents = async (filters = {}, limit = 100) => {
  await flushNow().catch(() => {});
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const args = [];
  const w = where(filters, args);
  args.push(lim + 1);
  const { rows } = await query(`SELECT * FROM sky_events ${w} ORDER BY id DESC LIMIT $${args.length}`, args);
  const items = rows.slice(0, lim).map(toRow);
  return { items, next: rows.length > lim ? items[items.length - 1].id : null };
};

export const exportEvents = async (filters = {}, max = 20000) => {
  await flushNow().catch(() => {});
  const args = [];
  const w = where({ ...filters, before: undefined }, args);
  args.push(Math.min(50000, Math.max(1, Number(max) || 20000)));
  const { rows } = await query(`SELECT * FROM sky_events ${w} ORDER BY id DESC LIMIT $${args.length}`, args);
  return rows.map(toRow);
};

export const summary = async () => {
  await flushNow().catch(() => {});
  const byCat = (await query(`SELECT category, count(*)::int AS n, count(*) FILTER (WHERE level IN ('ERROR','CRITICAL'))::int AS errors FROM sky_events WHERE at > now() - interval '24 hours' GROUP BY category`)).rows;
  const byLevel = (await query(`SELECT level, count(*)::int AS n FROM sky_events WHERE at > now() - interval '24 hours' GROUP BY level`)).rows;
  const top = (await query(`SELECT type, count(*)::int AS n FROM sky_events WHERE at > now() - interval '24 hours' AND level IN ('WARN','ERROR','CRITICAL') GROUP BY type ORDER BY n DESC LIMIT 8`)).rows;
  const total = Number((await query('SELECT count(*) AS n FROM sky_events')).rows[0].n);
  return { last24h: { byCategory: Object.fromEntries(byCat.map((r) => [r.category, { count: r.n, errors: r.errors }])), byLevel: Object.fromEntries(byLevel.map((r) => [r.level, r.n])), topProblems: top }, total, writer: { written: stats.written, dropped: stats.dropped, failedFlushes: stats.failedFlushes, buffered: stats.buffered() } };
};

/** Изменение настроек: сроки хранения (аудит — не меньше 90 дней), временный DEBUG (до 24 ч), приём клиентской телеметрии. */
export const saveSettings = async (actorId, body = {}) => {
  const cur = await loadSettings();
  const retention = { ...cur.retention_days };
  if (body.retentionDays && typeof body.retentionDays === 'object') {
    for (const cat of CATEGORIES) {
      if (body.retentionDays[cat] === undefined) continue;
      const n = Math.trunc(Number(body.retentionDays[cat]));
      const min = AUDIT.has(cat) ? 90 : 1;
      if (!Number.isFinite(n) || n < min || n > 3650) return { error: AUDIT.has(cat) ? 'audit_retention_min_90' : 'bad_retention' };
      retention[cat] = n;
    }
  }
  let debugUntilNew = cur.debug_until;
  if (body.debugMinutes !== undefined) {
    const m = Math.trunc(Number(body.debugMinutes));
    if (!Number.isFinite(m) || m < 0 || m > 24 * 60) return { error: 'bad_debug' };
    debugUntilNew = m === 0 ? null : new Date(Date.now() + m * 60_000);
  }
  const telemetry = typeof body.telemetry === 'boolean' ? body.telemetry : cur.telemetry !== false;
  await query('UPDATE sky_log_settings SET retention_days=$1, debug_until=$2, telemetry=$3, updated_by=$4, updated_at=now() WHERE id', [JSON.stringify(retention), debugUntilNew, telemetry, actorId]);
  settingsAt = 0; await loadSettings();
  return { ok: true, settings: await getSettings() };
};
