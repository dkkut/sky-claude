/**
 * Обнаружение утечек. Четыре класса сигналов (все уходят в selfdefense.handleSignal):
 *  1) массовая выгрузка — объём JSON-ответов, число запросов, обращения к выгрузкам/спискам;
 *  2) секреты и ключи — секрет сервера или приманка (canary) в URL/заголовках входящего запроса;
 *  3) подозрительные действия администраторов — всплеск действий и выдач прав, новый адрес;
 *  4) изменение кода и конфигурации — хеши server/*.mjs против эталона.
 * Плюс сканирование: поток 4xx с одного адреса — упреждающая блокировка ДО взлома.
 * Считаем только метаданные (метод, путь с :id, размер): содержимого ответов и запросов не читаем и не храним.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { clientIp, readAccessToken } from './http.mjs';
import { ipFp, ipMask } from './ipmask.mjs';
import { normalizeRoute } from './auditlog.mjs';
import { getSettings } from './defensecfg.mjs';
import { handleSignal, isIpBlocked, ownerInfo } from './selfdefense.mjs';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const clip = (s, n) => String(s ?? '').slice(0, n);

/* ─── Окна счётчиков в памяти ─── */
const win = new Map();   // key → [{t, v}]
const bump = (key, v, ms) => {
  const t = Date.now(); const a = (win.get(key) ?? []).filter((x) => t - x.t < ms); a.push({ t, v }); win.set(key, a);
  return a.reduce((s, x) => s + x.v, 0);
};
setInterval(() => { const t = Date.now(); for (const [k, a] of win) { if (!a.length || t - a[a.length - 1].t > 15 * 60_000) win.delete(k); } }, 60_000).unref();

/* Владелец и его адрес не считаем нарушителем (иначе нечем отменять) — кэш на минуту. */
let ownerCache = { at: 0, id: null };
const ownerId = async () => { if (Date.now() - ownerCache.at > 60_000) ownerCache = { at: Date.now(), id: (await ownerInfo().catch(() => null))?.id ?? null }; return ownerCache.id; };

const EXPORT_PATH = /\/(export|download|dump|backup|csv)(\/|$)|\/members(\/|$)|\/users(\/|$)|\/directory(\/|$)/;
const NOISY = /^\/api\/(platform\/status|telemetry|guard\/|defense\/)/;

/** Подсчёт в конце ответа. bytes — размер тела JSON-ответа (0, если не JSON). */
export const onResponse = async (req, res, rctx, bytes) => {
  try {
    const s = await getSettings(); if (!s.enabled) return;
    const url = String(req.url ?? '').split('?')[0]; if (!url.startsWith('/api/') || NOISY.test(url)) return;
    const ip = clientIp(req); const actor = rctx?.actor ?? null; const subj = actor ? `profile:${actor}` : `ip:${ipFp(ip)}`;
    if (actor && actor === (await ownerId())) return;
    const T = s.thresholds; const route = normalizeRoute(url);

    // сканирование: много 4xx с одного адреса (404/401/403/400 — подбор путей и ключей)
    // считаем только запросы БЕЗ вошедшего человека: у вошедших 4xx — обычная жизнь (протухший токен, нет прав), на общем адресе они дали бы ложную блокировку всем
    // запросы с токеном доступа (даже протухшим или закрытым PIN/замком: 403 pin_required, 423 app_locked, limited_session) — не подбор путей
    if (!actor && res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 429 && res.statusCode !== 423 && !readAccessToken(req)) {
      if (bump(`p4:${ip}`, 1, 60_000) >= T.probing4xxPerMin) { win.delete(`p4:${ip}`); await handleSignal({ kind: 'probing', severity: 'medium', ip, subject: `ip:${ipFp(ip)}`, detail: { perMin: T.probing4xxPerMin }, summary: 'Поток отказов 4xx с одного адреса' }); }
    }
    if (res.statusCode >= 400) return;

    const n = bump(`rq:${subj}`, 1, 60_000);
    if (n >= T.reqPerMin) { win.delete(`rq:${subj}`); await handleSignal({ kind: 'mass_export', severity: 'medium', ip, profileId: actor, subject: subj, detail: { reqPerMin: n, route }, summary: 'Слишком частые запросы' }); }
    if (bytes > 0) {
      const sum = bump(`by:${subj}`, bytes, 5 * 60_000);
      if (sum >= T.bytes5min) { win.delete(`by:${subj}`); await handleSignal({ kind: 'mass_export', severity: 'high', ip, profileId: actor, subject: subj, detail: { bytes5min: sum, route }, summary: 'Большой объём данных за 5 минут' }); }
    }
    if (req.method === 'GET' && EXPORT_PATH.test(route)) {
      const c = bump(`ex:${subj}`, 1, 10 * 60_000);
      if (c >= T.exports10min) { win.delete(`ex:${subj}`); await handleSignal({ kind: 'mass_export', severity: 'high', ip, profileId: actor, subject: subj, detail: { exports10min: c, route }, summary: 'Частые обращения к выгрузкам и спискам людей' }); }
    }
    // обход чужих сущностей: много РАЗНЫХ идентификаторов в путях
    if (req.method === 'GET' && /\/[0-9a-f-]{20,}/.test(url)) {
      const key = `ids:${subj}`; const id = sha(url).slice(0, 10); const a = win.get(key) ?? []; const t = Date.now();
      const fresh = a.filter((x) => t - x.t < 10 * 60_000);
      if (!fresh.some((x) => x.v === id)) fresh.push({ t, v: id }); win.set(key, fresh);
      if (fresh.length >= T.distinctUsers10min) { win.delete(key); await handleSignal({ kind: 'mass_export', severity: 'high', ip, profileId: actor, subject: subj, detail: { distinct10min: fresh.length }, summary: 'Перебор большого числа разных записей' }); }
    }
  } catch (e) { console.error('[leak] учёт:', e.message); }
};

/** Обёртка res: считает байты JSON-ответа без чтения содержимого. Вызывается один раз на запрос. */
export const watchResponse = (req, res, rctx) => {
  let bytes = 0; const w = res.write.bind(res); const e = res.end.bind(res);
  const isJson = () => String(res.getHeader('content-type') ?? '').includes('json');
  res.write = (chunk, ...a) => { if (chunk && isJson()) bytes += Buffer.byteLength(chunk); return w(chunk, ...a); };
  res.end = (chunk, ...a) => { if (chunk && typeof chunk !== 'function' && isJson()) bytes += Buffer.byteLength(chunk); return e(chunk, ...a); };
  res.on('finish', () => { void onResponse(req, res, rctx, bytes); });
};

/* ─── Секреты и приманки во входящем запросе ─── */
let secretHashes = null;
const secretValues = () => {
  if (secretHashes) return secretHashes;
  const vals = [config.jwtSecret, process.env.REFRESH_TOKEN_SECRET, process.env.ENCRYPTION_KEY, process.env.GUARD_SECRET, process.env.AI_API_KEY, process.env.STORAGE_S3_SECRET_KEY]
    .filter((v) => typeof v === 'string' && v.length >= 20);
  secretHashes = vals;
  return vals;
};
let canaries = { at: 0, set: new Map() };
const loadCanaries = async () => { if (Date.now() - canaries.at < 30_000) return canaries.set; try { canaries = { at: Date.now(), set: new Map((await query('SELECT id, token_hash, label FROM defense_canaries WHERE active').catch(() => ({ rows: [] }))).rows.map((r) => [r.token_hash, r])) }; } catch { /* нет таблицы */ } return canaries.set; };
export const forgetCanaries = () => { canaries.at = 0; };

/** Проверка запроса. true — запрос надо отклонить (приманка/секрет предъявлены). Содержимого не логируем. */
export const scanRequest = async (req) => {
  try {
    const raw = `${req.url ?? ''}\n${req.headers.authorization ?? ''}\n${req.headers['x-sky-beta'] ?? ''}\n${req.headers['x-api-key'] ?? ''}`;
    if (raw.length < 24) return false;
    const ip = clientIp(req);
    const m = raw.match(/skc_[A-Za-z0-9_-]{20,64}/g);
    if (m) {
      const set = await loadCanaries();
      for (const tok of m) { const c = set.get(sha(`canary:${tok}`)); if (c) {
        await query('UPDATE defense_canaries SET hits = hits + 1, last_hit_at = now() WHERE id = $1', [c.id]).catch(() => {});
        await handleSignal({ kind: 'canary', severity: 'critical', ip, subject: `canary:${c.id}`, detail: { canary: clip(c.label, 60) }, summary: `Предъявлена приманка «${clip(c.label, 40)}»` });
        return true; } }
    }
    for (const v of secretValues()) if (raw.includes(v)) {
      await handleSignal({ kind: 'secret_in_request', severity: 'critical', ip, subject: `ip:${ipFp(ip)}`, detail: { where: 'request' }, summary: 'В запросе предъявлен секрет сервера' });
      return true;
    }
  } catch (e) { console.error('[leak] скан запроса:', e.message); }
  return false;
};
export const createCanary = async (actorId, label, hint) => {
  const tok = `skc_${crypto.randomBytes(24).toString('base64url')}`; const id = `can-${crypto.randomUUID()}`;
  await query('INSERT INTO defense_canaries (id, label, token_hash, hint, created_by) VALUES ($1,$2,$3,$4,$5)', [id, clip(label, 60), sha(`canary:${tok}`), clip(hint, 200), actorId]);
  forgetCanaries();
  return { id, token: tok };   // открытый токен показывается один раз
};

/* ─── Действия администраторов ─── */
const PRIV = /(grant|role|rights|perm|admin_add|staff_add|promote)/i;
export const onAdminAction = async ({ actorId, type, ip }) => {
  try {
    if (!actorId) return; const s = await getSettings(); if (!s.enabled) return;
    if (actorId === (await ownerId())) return;
    const T = s.thresholds; const subj = `profile:${actorId}`;
    const n = bump(`adm:${actorId}`, 1, 10 * 60_000);
    if (n >= T.adminActions10min) { win.delete(`adm:${actorId}`); await handleSignal({ kind: 'admin_anomaly', severity: 'high', profileId: actorId, subject: subj, detail: { actions10min: n }, summary: 'Всплеск действий администратора' }); return; }
    if (PRIV.test(String(type))) {
      const p = bump(`admp:${actorId}`, 1, 10 * 60_000);
      if (p >= T.adminPriv10min) { win.delete(`admp:${actorId}`); await handleSignal({ kind: 'admin_anomaly', severity: 'critical', profileId: actorId, subject: subj, detail: { privChanges10min: p }, summary: 'Серия выдач прав' }); return; }
    }
    // новый адрес администратора: первое появление запоминаем; на ВТОРОМ новом адресе в сутки — тревога средней важности
    if (ip) {
      const f = String(ip).slice(0, 24);   // ip здесь уже отпечаток из requestMeta
      const seen = (await query('SELECT 1 FROM defense_admin_seen WHERE profile_id = $1 AND ip_fp = $2', [actorId, f])).rowCount;
      if (!seen) {
        const known = (await query("SELECT count(*)::int AS n FROM defense_admin_seen WHERE profile_id = $1", [actorId])).rows[0].n;
        await query('INSERT INTO defense_admin_seen (profile_id, ip_fp) VALUES ($1,$2) ON CONFLICT DO NOTHING', [actorId, f]);
        const recent = (await query("SELECT count(*)::int AS n FROM defense_admin_seen WHERE profile_id = $1 AND first_seen > now() - interval '24 hours'", [actorId])).rows[0].n;
        if (known > 0 && recent >= 3) await handleSignal({ kind: 'admin_anomaly', severity: 'medium', profileId: actorId, subject: subj, detail: { newAddresses24h: recent }, summary: 'Администратор действует с нескольких новых адресов' });
      }
    }
  } catch (e) { console.error('[leak] админ:', e.message); }
};

/* ─── Целостность кода приложения ─── */
const here = path.dirname(fileURLToPath(import.meta.url));
const manifestNow = () => {
  const out = {};
  const walk = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name); const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p, r); else if (/\.(mjs|js|json|sql)$/.test(e.name)) out[r] = sha(fs.readFileSync(p));
  } };
  walk(here, '');
  return out;
};
let bootManifest = null;
export const integrityCheck = async () => {
  try {
    const s = await getSettings(); if (!s.enabled) return { skipped: true };
    const now = manifestNow(); const build = process.env.BUILD_ID || '';
    let base = bootManifest;
    if (build) {   // эталон хранится в базе только при известной сборке: иначе каждый деплой выглядел бы как взлом
      const row = (await query('SELECT build_id, manifest FROM defense_integrity WHERE id').catch(() => ({ rows: [] }))).rows[0];
      if (!row || row.build_id !== build) { await query('INSERT INTO defense_integrity (id, build_id, manifest) VALUES (TRUE,$1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET build_id = $1, manifest = $2::jsonb, updated_at = now()', [build, JSON.stringify(now)]).catch(() => {}); bootManifest = now; return { baseline: true }; }
      base = row.manifest;
    }
    if (!base) { bootManifest = now; return { baseline: true }; }
    const changed = [];
    for (const k of new Set([...Object.keys(base), ...Object.keys(now)])) if (base[k] !== now[k]) changed.push(k);
    if (changed.length) await handleSignal({ kind: 'integrity', severity: 'critical', subject: 'system:integrity', detail: { files: changed.slice(0, 20), total: changed.length }, summary: `Изменены файлы приложения: ${changed.length}` });
    return { changed: changed.length };
  } catch (e) { console.error('[leak] целостность:', e.message); return { error: e.message }; }
};
export const rebaseline = async () => { bootManifest = manifestNow(); if (process.env.BUILD_ID) await query('INSERT INTO defense_integrity (id, build_id, manifest) VALUES (TRUE,$1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET build_id=$1, manifest=$2::jsonb, updated_at=now()', [process.env.BUILD_ID, JSON.stringify(bootManifest)]); return { files: Object.keys(bootManifest).length }; };

export const leakList = async ({ status, kind, limit = 100 } = {}) => {
  const { rows } = await query(`SELECT id, kind, severity, subject, ip_mask, detail, status, incident_id, created_at FROM leak_events
     WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR kind = $2) ORDER BY created_at DESC LIMIT $3`, [status || null, kind || null, Math.min(300, limit)]);
  return rows.map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, subject: r.subject, ip: r.ip_mask, detail: r.detail, status: r.status, incidentId: r.incident_id, at: r.created_at.toISOString() }));
};
export const leakMark = async (id, status) => (['open', 'acknowledged', 'false_positive'].includes(status) ? query('UPDATE leak_events SET status = $2 WHERE id = $1', [String(id), status]).then((r) => ({ ok: r.rowCount > 0 })) : { error: 'bad_status' });
export { isIpBlocked, ipMask };
