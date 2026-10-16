/**
 * Sky Storage — резервное копирование, проверка, хранение, восстановление и выгрузка копий.
 *
 * Что внутри копии (всё зашифровано отдельным ключом хранилища, формат SBK1, см. skystoragecrypto.mjs):
 *   manifest.sbk  — манифест: версия формата, тип, область, список объектов (сервис, id, размер, SHA-256 исходных байт,
 *                   ключ в цели), таблицы (число строк, SHA-256), ссылка на базовую копию;
 *   f/<h>.sbk     — объекты-файлы сервисов (в том виде, как лежат на диске: они уже зашифрованы форматом сервиса,
 *                   поэтому для восстановления нужны ОБА ключа: ключ хранилища и ключ приложения ENCRYPTION_KEY);
 *   t/<имя>.sbk   — строки таблиц в JSON Lines (содержимое переписки остаётся зашифрованным так, как лежит в базе);
 *   DONE          — маркер завершённости; пишется ПОСЛЕДНИМ, копия без него считается незавершённой.
 * Инкрементальность: неизменившийся объект не загружается повторно, а ссылается на объект базовой копии
 * (цепочка; базовую копию нельзя удалить, пока на неё ссылаются). Каждые N копий делается полная.
 *
 * Конфигурацию восстановления (без секретов) можно положить в копию типом «config».
 */
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pool, query } from './db.mjs';
import { getTarget, TargetError, describeTarget } from './skystoragetarget.mjs';
import { encryptStream, decryptStream, activeKid, keyStatus, CryptoError, checkValue } from './skystoragecrypto.mjs';
import { serviceRoots, locateFile } from './skystoragelimits.mjs';
import { scanAll, quarantineRoot } from './skystorageindex.mjs';
import { snapshot, effective, logEvent, notifyOwners, newId } from './skystoragestate.mjs';

const FORMAT = 1;
const LOCK_KEY = 7_340_001;
const MAX_CHAIN = 7;

/** Таблицы, входящие в копии (проверенные имена; порядок — для восстановления по зависимостям). */
export const TABLES = {
  messenger: ['chats', 'chat_members', 'messages', 'attachments'],
  music: ['music_tracks'], film: ['film_movies'], podcasts: ['podcasts', 'podcast_episodes'], books: ['books'], skyvideo: ['sky_videos'],
  registry: ['storage_objects'],
};
const ALL_TABLES = new Set(Object.values(TABLES).flat());
const SERVICE_TABLES = { music: 'music', film: 'film', podcasts: 'podcasts', books: 'books', skyvideo: 'skyvideo', video: null };

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const key = (id, rest) => `backups/${id}/${rest}`;
const objKey = (id, service, oid) => key(id, `f/${sha256(`${service}/${oid}`).slice(0, 40)}.sbk`);

const readAll = async (s) => { const c = []; for await (const x of s) c.push(x); return Buffer.concat(c); };
const hashing = () => { const h = crypto.createHash('sha256'); let n = 0; const t = new Transform({ transform(c, _e, cb) { h.update(c); n += c.length; cb(null, c); } }); return { t, digest: () => h.digest('hex'), size: () => n }; };
const countingHash = () => { const h = crypto.createHash('sha256'); let n = 0; return { feed: (c) => { h.update(c); n += c.length; }, digest: () => h.digest('hex'), size: () => n }; };

/* ─── Блокировка: одна тяжёлая задача за раз ───────────────────────── */

let lockClient = null;
const acquire = async () => {
  if (lockClient) return false;
  const c = await pool.connect();
  const { rows } = await c.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
  if (!rows[0].ok) { c.release(); return false; }
  lockClient = c; return true;
};
const release = async () => { if (!lockClient) return; const c = lockClient; lockClient = null; await c.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {}); c.release(); };
export const jobRunning = () => lockClient !== null;
const cancelFlags = new Set();
export const cancelBackup = (id) => { cancelFlags.add(id); };

export class BackupError extends Error { constructor(code, detail = '') { super(code); this.code = code; this.detail = detail; } }

/* ─── Экспорт таблицы: серверный курсор, JSON Lines, поток ─────────── */

async function* tableLines(table) {
  if (!ALL_TABLES.has(table)) throw new BackupError('bad_table', table);
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query(`DECLARE sky_bk CURSOR FOR SELECT row_to_json(t)::text AS r FROM ${table} t`);
    for (;;) {
      const { rows } = await c.query('FETCH 500 FROM sky_bk');
      if (!rows.length) break;
      yield Buffer.from(`${rows.map((r) => r.r).join('\n')}\n`);
    }
    await c.query('COMMIT');
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}

/* ─── Файл объекта ─────────────────────────────────────────────────── */

const findPath = (service, id) => locateFile(service, id);

/** Что войдёт в копию: объекты по области и таблицы. */
const plan = async (kind, scope) => {
  const services = Array.isArray(scope?.services) && scope.services.length ? scope.services : null;
  const cats = Array.isArray(scope?.categories) && scope.categories.length ? scope.categories : null;
  const filesWanted = ['full', 'media', 'service', 'category'].includes(kind);
  let objects = [];
  if (filesWanted) {
    const args = []; const where = [`status IN ('ok','orphan')`];
    if (kind === 'service' && services) { args.push(services); where.push(`service = ANY($${args.length}::text[])`); }
    if (kind === 'category' && cats) { args.push(cats); where.push(`category = ANY($${args.length}::text[])`); }
    const { rows } = await query(`SELECT service, id, category, size, sha256 FROM storage_objects WHERE ${where.join(' AND ')} ORDER BY service, id`, args);
    objects = rows;
  }
  let tables = [];
  if (kind === 'full') tables = [...TABLES.messenger, ...TABLES.music, ...TABLES.film, ...TABLES.podcasts, ...TABLES.books, ...TABLES.skyvideo, ...TABLES.registry];
  else if (kind === 'messenger') tables = [...TABLES.messenger];
  else if (kind === 'metadata') tables = [...TABLES.registry, ...TABLES.music, ...TABLES.film, ...TABLES.podcasts, ...TABLES.books, ...TABLES.skyvideo];
  else if (kind === 'service' && services) tables = [...new Set(services.map((s) => SERVICE_TABLES[s]).filter(Boolean).flatMap((k) => TABLES[k]))];
  else if (kind === 'media') tables = [...TABLES.registry];
  return { objects, tables };
};

const configSnapshot = async () => {
  const secretLike = /KEY|SECRET|TOKEN|PASSWORD|PASS|JSON|CREDENTIAL|DSN|DATABASE_URL/i;
  const env = Object.fromEntries(Object.keys(process.env).filter((k) => /^(STORAGE_|MUSIC_|FILM_|PODCAST_|SKYVIDEO_|VIDEO_|BOOKS_|MARKET_|NODE_ENV|DOMAIN|PERSONAL_RETENTION|ADMIN_GATE)/.test(k)).sort()
    .map((k) => [k, secretLike.test(k) ? '[задано, значение не сохраняется]' : process.env[k] ?? '']));
  const { rows } = await query('SELECT name FROM schema_migrations ORDER BY name').catch(() => ({ rows: [] }));
  return { createdAt: new Date().toISOString(), note: 'Секреты не включены. Для восстановления нужны отдельно сохранённые ключи: STORAGE_KEK_* и ENCRYPTION_KEY.', env, migrations: rows.map((r) => r.name), keys: { storageKids: keyStatus().kids } };
};

/* ─── Создание копии ───────────────────────────────────────────────── */

const setProgress = (id, p, files, bytes) => query('UPDATE storage_backups SET progress = $2, files = $3, bytes = $4 WHERE id = $1', [id, Math.min(99, Math.round(p)), files, bytes]).catch(() => {});

export const startBackup = async ({ kind = 'full', scope = {}, trigger = 'manual', actorId = null, verify = 'full', incremental = true } = {}) => {
  if (!['full', 'media', 'messenger', 'service', 'category', 'metadata', 'config'].includes(kind)) return { error: 'bad_kind' };
  const st = snapshot();
  if (st && !effective(st).read) return { error: 'storage_unavailable' };
  if (st?.maintenance?.active && st.maintenance.mode === 'emergency') return { error: 'storage_maintenance' };
  const ks = keyStatus();
  if (!ks.configured) return { error: 'kek_not_configured' };
  let target;
  try { target = getTarget(); } catch (e) { return { error: e.code ?? 'target_not_configured', detail: e.detail }; }
  const h = await target.health();
  if (!h.ok) return { error: 'target_unavailable', detail: h.code };
  if (!(await acquire())) return { error: 'busy' };

  const id = newId('bk');
  const kid = activeKid();
  try {
    // база цепочки
    let base = null;
    if (incremental && ['full', 'media', 'service', 'category'].includes(kind)) {
      const { rows } = await query(`SELECT id, files FROM storage_backups WHERE status = 'verified' AND kind = $1 AND scope = $2::jsonb ORDER BY started_at DESC LIMIT 1`, [kind, JSON.stringify(scope)]);
      if (rows[0]) {
        let depth = 1; let cur = rows[0].id;
        for (;;) { const { rows: p } = await query('SELECT base_id FROM storage_backups WHERE id = $1', [cur]); if (!p[0]?.base_id) break; depth += 1; cur = p[0].base_id; }
        if (depth < MAX_CHAIN) base = rows[0].id;
      }
    }
    await query(`INSERT INTO storage_backups (id, kind, scope, status, target, base_id, key_id, trigger, created_by) VALUES ($1,$2,$3::jsonb,'running',$4,$5,$6,$7,$8)`,
      [id, kind, JSON.stringify(scope), target.kind, base, kid, trigger, actorId]);
    await logEvent('backup_start', 'info', { id, kind, trigger }, actorId);
    // Длинная часть — в фоне: вызывающему отвечаем сразу, ход виден по прогрессу.
    void runBackup({ id, kind, scope, base, target, kid, verify, actorId }).finally(() => release());
    return { ok: true, id };
  } catch (e) { await release(); throw e; }
};

const runBackup = async ({ id, kind, scope, base, target, kid, verify, actorId }) => {
  const manifest = { format: FORMAT, id, kind, scope, createdAt: new Date().toISOString(), base, keyId: kid, keyCheck: checkValue(kid), objects: [], tables: [], skipped: [] };
  let uploaded = 0; let bytes = 0;
  try {
    if (['full', 'media', 'service', 'category'].includes(kind)) await scanAll();   // реестр актуален на момент копии
    const { objects, tables } = await plan(kind, scope);
    // Объекты базовой копии (для ссылок)
    const baseMap = new Map();
    if (base) {
      const bm = await readManifest(target, base).catch(() => null);
      for (const o of bm?.objects ?? []) baseMap.set(`${o.service}/${o.id}`, o);
    }
    const total = objects.length + tables.length + 1;
    let done = 0;
    for (const o of objects) {
      if (cancelFlags.has(id)) throw new BackupError('cancelled');
      const path = await findPath(o.service, o.id);
      if (!path) { manifest.skipped.push({ service: o.service, id: o.id, why: 'нет файла' }); done += 1; continue; }
      const prev = baseMap.get(`${o.service}/${o.id}`);
      if (prev && o.sha256 && prev.sha256 === o.sha256 && prev.size === Number(o.size)) {
        manifest.objects.push({ ...prev, ref: prev.ref ?? base });
      } else {
        const hs = hashing();
        const k = objKey(id, o.service, o.id);
        const src = createReadStream(path).pipe(hs.t);
        const put = await target.put(k, encryptStream(src, { id: `${o.service}/${o.id}`, kid }));
        manifest.objects.push({ service: o.service, id: o.id, category: o.category, size: hs.size(), sha256: hs.digest(), key: k, stored: put.size });
        uploaded += 1; bytes += put.size ?? 0;
      }
      done += 1;
      if (done % 5 === 0) await setProgress(id, (done / total) * 100, manifest.objects.length, bytes);
    }
    for (const t of tables) {
      if (cancelFlags.has(id)) throw new BackupError('cancelled');
      const hs = countingHash(); let rows = 0;
      const src = Readable.from((async function* () { for await (const chunk of tableLines(t)) { hs.feed(chunk); rows += chunk.toString().split('\n').length - 1; yield chunk; } })());
      const k = key(id, `t/${t}.sbk`);
      const put = await target.put(k, encryptStream(src, { id: `${id}/t/${t}`, kid }));
      manifest.tables.push({ name: t, rows, sha256: hs.digest(), key: k, size: hs.size(), stored: put.size });
      bytes += put.size ?? 0; done += 1;
      await setProgress(id, (done / total) * 100, manifest.objects.length, bytes);
    }
    if (kind === 'config') {
      const cfg = Buffer.from(JSON.stringify(await configSnapshot(), null, 1));
      const k = key(id, 'config.sbk');
      const put = await target.put(k, encryptStream(Readable.from([cfg]), { id: `${id}/config`, kid }));
      manifest.config = { key: k, sha256: sha256(cfg), size: cfg.length, stored: put.size };
    }
    const mbuf = Buffer.from(JSON.stringify(manifest));
    const mk = key(id, 'manifest.sbk');
    const enc = await readAll(encryptStream(Readable.from([mbuf]), { id: `${id}/manifest`, kid }));
    await target.put(mk, Readable.from([enc]));
    const msha = sha256(enc);
    const chk = await target.head(mk);
    if (!chk || chk.size !== enc.length) throw new BackupError('manifest_not_stored');
    await target.put(key(id, 'DONE'), Readable.from([Buffer.from(JSON.stringify({ id, manifest: msha, format: FORMAT, at: new Date().toISOString() }))]));
    await query(`UPDATE storage_backups SET status = 'ok', files = $2, bytes = $3, manifest_sha = $4, progress = 100, finished_at = now() WHERE id = $1`, [id, manifest.objects.length, bytes, msha]);
    await logEvent('backup_done', 'info', { id, files: manifest.objects.length, uploaded, bytes, skipped: manifest.skipped.length }, actorId);
    // Успех копии — только после проверки целостности
    const v = await verifyBackup(id, { mode: verify, target, internal: true });
    if (!v.ok) await notifyOwners('backup_verify_failed', 'Копия не прошла проверку', `Резервная копия ${id} создана, но проверка целостности не пройдена.`, { critical: true });
  } catch (e) {
    cancelFlags.delete(id);
    const msg = e instanceof BackupError || e instanceof TargetError || e instanceof CryptoError ? `${e.code}${e.detail ? `: ${e.detail}` : ''}` : (e.code ?? e.message ?? 'error');
    await query(`UPDATE storage_backups SET status = $2, error = $3, finished_at = now() WHERE id = $1`, [id, e.code === 'cancelled' ? 'cancelled' : 'failed', String(msg).slice(0, 300)]);
    await logEvent('backup_failed', 'critical', { id, error: String(msg).slice(0, 200) }, actorId);
    if (e.code !== 'cancelled') await notifyOwners('backup_failed', 'Ошибка резервного копирования', `Копия ${id} не создана: ${String(msg).slice(0, 120)}.`, { critical: true });
    await cleanupPartial(target, id).catch(() => {});
  }
};

/** Удалить объекты незавершённой копии (без маркера DONE). Затрагивает только свой префикс backups/<id>/. */
const cleanupPartial = async (target, id) => {
  if (await target.head(key(id, 'DONE'))) return 0;
  const items = await target.list(`backups/${id}/`);
  for (const it of items) await target.del(it.key);
  return items.length;
};

/* ─── Чтение манифеста ─────────────────────────────────────────────── */

export const readManifest = async (target, id) => {
  const buf = await readAll(decryptStream(await target.get(key(id, 'manifest.sbk')), { id: `${id}/manifest` }));
  return JSON.parse(buf.toString('utf8'));
};

/* ─── Проверка целостности ─────────────────────────────────────────── */

/**
 * Проверка копии. full — каждый объект читается из цели, расшифровывается (проверяются все теги чанков) и сверяется SHA-256
 * с манифестом; sample — манифест, все таблицы и случайная десятая часть файлов (для очень больших копий).
 */
export const verifyBackup = async (id, { mode = 'full', target = null, internal = false } = {}) => {
  const tg = target ?? getTarget();
  const { rows } = await query('SELECT * FROM storage_backups WHERE id = $1', [id]);
  const b = rows[0]; if (!b) return { ok: false, error: 'not_found' };
  if (!['ok', 'verified', 'corrupt', 'verifying'].includes(b.status)) return { ok: false, error: 'bad_state' };
  await query(`UPDATE storage_backups SET status = 'verifying' WHERE id = $1`, [id]);
  const report = { mode, checked: 0, failed: [], missing: [], started: new Date().toISOString() };
  try {
    const done = await tg.head(key(id, 'DONE'));
    if (!done) report.failed.push('нет маркера завершённости DONE');
    const mhead = await tg.head(key(id, 'manifest.sbk'));
    if (!mhead) throw new BackupError('manifest_missing');
    const encm = await readAll(await tg.get(key(id, 'manifest.sbk')));
    if (b.manifest_sha && sha256(encm) !== b.manifest_sha) throw new BackupError('manifest_sha_mismatch');
    const manifest = JSON.parse((await readAll(decryptStream(Readable.from([encm]), { id: `${id}/manifest` }))).toString('utf8'));
    if (manifest.format !== FORMAT) throw new BackupError('bad_format_version');
    const checkOne = async (rel, k, expect, label) => {
      const head = await tg.head(k);
      if (!head) { report.missing.push(label); return; }
      const hs = countingHash();
      try {
        for await (const c of decryptStream(await tg.get(k), { id: rel })) hs.feed(c);
      } catch (e) { report.failed.push(`${label}: ${e.code ?? e.message}`); return; }
      if (hs.digest() !== expect.sha256 || hs.size() !== expect.size) report.failed.push(`${label}: не совпала контрольная сумма`);
      report.checked += 1;
    };
    for (const t of manifest.tables) await checkOne(`${id}/t/${t.name}`, t.key, t, `таблица ${t.name}`);
    if (manifest.config) await checkOne(`${id}/config`, manifest.config.key, manifest.config, 'конфигурация');
    const objs = manifest.objects.filter(() => mode === 'full' || Math.random() < 0.1);
    for (const o of objs) await checkOne(`${o.service}/${o.id}`, o.key, o, `${o.service}/${o.id}`);
    // Цепочка: базовая копия обязана быть на месте
    if (manifest.base) { const bh = await tg.head(key(manifest.base, 'DONE')); if (!bh) report.missing.push(`базовая копия ${manifest.base}`); }
  } catch (e) { report.failed.push(e.code ?? e.message); }
  const ok = report.failed.length === 0 && report.missing.length === 0;
  report.finished = new Date().toISOString();
  await query(`UPDATE storage_backups SET status = $2, verify = $3::jsonb, verified_at = now() WHERE id = $1`, [id, ok ? 'verified' : 'corrupt', JSON.stringify(report)]);
  await logEvent(ok ? 'backup_verified' : 'backup_corrupt', ok ? 'info' : 'critical', { id, checked: report.checked, failed: report.failed.length, missing: report.missing.length });
  return { ok, report, internal };
};

export const verifyBackupExclusive = async (id, opts = {}) => {
  if (!(await acquire())) return { ok: false, error: 'busy' };
  try { return await verifyBackup(id, opts); } finally { await release(); }
};

/* ─── Хранение: просмотр и применение ──────────────────────────────── */

/** План очистки: что будет удалено и почему. Ничего не меняет. */
export const retentionPlan = async () => {
  const st = snapshot();
  const rt = st?.settings.retention ?? { days: 30, maxBytes: null, minKeep: 2 };
  const { rows } = await query(`SELECT id, kind, status, bytes, started_at, base_id, pinned FROM storage_backups WHERE status IN ('verified','ok','failed','corrupt','cancelled') ORDER BY started_at DESC`);
  const usable = rows.filter((r) => r.status === 'verified');
  const referenced = new Set(rows.map((r) => r.base_id).filter(Boolean));
  const plan = []; const keep = [];
  let usableLeft = usable.length;
  const total = rows.filter((r) => r.status !== 'failed').reduce((s, r) => s + Number(r.bytes), 0);
  let over = rt.maxBytes ? Math.max(0, total - rt.maxBytes) : 0;
  for (const r of [...rows].reverse()) {                 // от старых к новым
    const age = (Date.now() - new Date(r.started_at).getTime()) / 86_400_000;
    const why = [];
    if (['failed', 'cancelled'].includes(r.status) && age > 1) why.push('неудачная попытка старше суток');
    if (r.status === 'corrupt' && age > rt.days) why.push('повреждённая копия');
    if (['verified', 'ok'].includes(r.status) && age > rt.days) why.push(`старше ${rt.days} дн.`);
    if (['verified', 'ok'].includes(r.status) && over > 0) why.push('превышен лимит объёма');
    if (!why.length) { keep.push(r.id); continue; }
    const blockers = [];
    if (r.pinned) blockers.push('закреплена владельцем');
    if (referenced.has(r.id) && !plan.some((p) => p.base === r.id)) { /* на неё ссылаются более новые — проверяем ниже */ }
    const children = rows.filter((c) => c.base_id === r.id && !plan.some((p) => p.id === c.id));
    if (children.length) blockers.push('участвует в цепочке восстановления (на неё ссылаются более новые копии)');
    if (r.status === 'verified') {
      if (usableLeft - 1 < Math.max(1, rt.minKeep)) blockers.push(`останется меньше ${Math.max(1, rt.minKeep)} проверенных копий`);
      const newer = usable.some((u) => new Date(u.started_at) > new Date(r.started_at) && !plan.some((p) => p.id === u.id));
      if (!newer) blockers.push('нет более новой проверенной копии');
    }
    if (blockers.length) { keep.push(r.id); continue; }
    plan.push({ id: r.id, kind: r.kind, status: r.status, bytes: Number(r.bytes), startedAt: r.started_at, why: why.join('; '), base: r.base_id });
    if (r.status === 'verified') usableLeft -= 1;
    over -= Number(r.bytes);
  }
  return { plan, keepCount: keep.length, policy: rt };
};

export const applyRetention = async (actorId, ids) => {
  const { plan } = await retentionPlan();
  const allowed = new Set(plan.map((p) => p.id));
  const todo = ids ? ids.filter((i) => allowed.has(i)) : [...allowed];
  if (!todo.length) return { deleted: 0 };
  if (!(await acquire())) return { error: 'busy' };
  try {
    const target = getTarget();
    let deleted = 0;
    for (const id of todo) {
      const items = await target.list(`backups/${id}/`);
      for (const it of items) await target.del(it.key);
      await query(`UPDATE storage_backups SET status = 'deleted' WHERE id = $1`, [id]);
      await logEvent('retention_delete', 'info', { id, objects: items.length }, actorId);
      deleted += 1;
    }
    return { deleted };
  } finally { await release(); }
};

export const pinBackup = (id, pinned) => query('UPDATE storage_backups SET pinned = $2 WHERE id = $1', [id, pinned === true]);

/** Чистка зависших/незавершённых задач и частичных загрузок цели. Вызывается периодически. */
export const sweepBackups = async () => {
  const { rows } = await query(`UPDATE storage_backups SET status = 'failed', error = 'прервана: сервер перезапускался или задача зависла', finished_at = now()
    WHERE status IN ('running','verifying') AND started_at < now() - interval '3 hours' AND NOT $1::boolean RETURNING id`, [jobRunning()]);
  let partial = 0;
  try { const t = getTarget(); partial = await t.abortIncomplete(); } catch { /* цель не настроена */ }
  return { interrupted: rows.length, partial };
};

/* ─── Скачивание копии (одноразовая ссылка + потоковый tar) ────────── */

const tarHeader = (name, size) => {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0); h.write('0000600\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124); h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
};

export const createDownloadLink = async (actorId, backupId, ttlMin, ipHash) => {
  const { rows } = await query('SELECT status FROM storage_backups WHERE id = $1', [backupId]);
  if (!rows[0] || !['verified', 'ok'].includes(rows[0].status)) return { error: 'bad_state' };
  const token = crypto.randomBytes(32).toString('base64url');
  const id = newId('dl');
  await query(`INSERT INTO storage_downloads (id, backup_id, token_hash, created_by, expires_at, ip_hash) VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval, $6)`,
    [id, backupId, sha256(token), actorId, String(ttlMin), ipHash ?? null]);
  await logEvent('download_link', 'warn', { id, backupId }, actorId);
  await notifyOwners(`download:${backupId}`, 'Выгрузка резервной копии', `Подготовлена ссылка на скачивание копии ${backupId}. Действует ${ttlMin} мин., одноразовая.`, { critical: true });
  return { id, token, expiresInMin: ttlMin };
};

/** Потребить ссылку (один раз) и вернуть поток tar. */
export const openDownload = async (token, ipHash) => {
  const h = sha256(String(token));
  const { rows } = await query(`UPDATE storage_downloads SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING id, backup_id, created_by`, [h]);
  if (!rows[0]) return null;
  const d = rows[0];
  const target = getTarget();
  const manifest = await readManifest(target, d.backup_id);
  // Объекты самой копии + объекты цепочки, на которые она ссылается (архив самодостаточен)
  const keys = new Map();
  const add = (k) => keys.set(k, null);
  add(key(d.backup_id, 'manifest.sbk')); add(key(d.backup_id, 'DONE'));
  for (const o of manifest.objects) add(o.key);
  for (const t of manifest.tables) add(t.key);
  if (manifest.config) add(manifest.config.key);
  let n = 0; const index = [];
  for (const k of keys.keys()) { const hd = await target.head(k); if (!hd) throw new BackupError('object_missing', k); keys.set(k, { size: hd.size, name: `o/${String(n).padStart(6, '0')}` }); index.push({ file: `o/${String(n).padStart(6, '0')}`, key: k, size: hd.size }); n += 1; }
  const summary = Buffer.from(JSON.stringify({ backup: d.backup_id, format: FORMAT, keyId: manifest.keyId, objects: index.length, note: 'Все файлы зашифрованы (SBK1). Ключи в архив не входят: храните STORAGE_KEK_* и ENCRYPTION_KEY отдельно.' }, null, 1));
  const idx = Buffer.from(JSON.stringify(index, null, 1));
  const sums = [];
  async function* gen() {
    for (const [name, buf] of [['SUMMARY.json', summary], ['INDEX.json', idx]]) { yield tarHeader(name, buf.length); yield buf; yield Buffer.alloc((512 - (buf.length % 512)) % 512); }
    for (const [k, meta] of keys) {
      yield tarHeader(meta.name, meta.size);
      const hs = crypto.createHash('sha256'); let got = 0;
      for await (const c of await target.get(k)) { hs.update(c); got += c.length; yield c; }
      if (got !== meta.size) throw new BackupError('download_size_mismatch', k);
      yield Buffer.alloc((512 - (got % 512)) % 512);
      sums.push(`${hs.digest('hex')}  ${meta.name}`);
    }
    const sumBuf = Buffer.from(`${sums.join('\n')}\n`);
    yield tarHeader('SHA256SUMS', sumBuf.length); yield sumBuf; yield Buffer.alloc((512 - (sumBuf.length % 512)) % 512);
    yield Buffer.alloc(1024);
    await logEvent('download_done', 'warn', { id: d.id, backupId: d.backup_id, files: index.length, ip: ipHash ?? null }, d.created_by);
  }
  const total = 512 * 2 + summary.length + idx.length + [...keys.values()].reduce((s, m) => s + m.size + 512 + ((512 - (m.size % 512)) % 512), 0);
  return { stream: Readable.from(gen(), { objectMode: false }), approxSize: total, name: `sky-backup-${d.backup_id}.tar`, id: d.id };
};

/* ─── Восстановление ───────────────────────────────────────────────── */

const stagingRoot = () => process.env.STORAGE_STAGING_DIR || '/data/storage-staging';

const inScope = (o, scope) => {
  if (scope?.ids?.length) return scope.ids.some((x) => x.service === o.service && x.id === o.id);
  if (scope?.services?.length && !scope.services.includes(o.service)) return false;
  if (scope?.categories?.length && !scope.categories.includes(o.category)) return false;
  return true;
};

/** Проверка и план восстановления. Ничего не записывает на живые данные. */
export const restorePlan = async (backupId, scope = {}, actorId = null) => {
  const { rows } = await query('SELECT * FROM storage_backups WHERE id = $1', [backupId]);
  const b = rows[0];
  if (!b || !['verified', 'ok'].includes(b.status)) return { error: 'bad_backup_state' };
  const ks = keyStatus();
  if (!ks.usable.includes(b.key_id)) return { error: 'kek_missing', detail: b.key_id };
  let target; try { target = getTarget(); } catch (e) { return { error: e.code }; }
  const h = await target.health(); if (!h.ok) return { error: 'target_unavailable' };
  const manifest = await readManifest(target, backupId);
  const items = manifest.objects.filter((o) => inScope(o, scope));
  const out = { missing: [], same: 0, conflict: [], noFile: 0 };
  for (const o of items) {
    const p = await findPath(o.service, o.id);
    if (!p) { out.missing.push({ service: o.service, id: o.id, size: o.size }); continue; }
    const s = await stat(p);
    if (s.size === o.size) { const hs = countingHash(); for await (const c of createReadStream(p)) hs.feed(c); if (hs.digest() === o.sha256) { out.same += 1; continue; } }
    out.conflict.push({ service: o.service, id: o.id });
  }
  const tables = (manifest.tables ?? []).filter((t) => !scope?.tables || scope.tables.includes(t.name)).filter(() => !scope?.ids?.length);
  const id = newId('rs');
  await query(`INSERT INTO storage_restores (id, backup_id, scope, mode, status, result, created_by, finished_at) VALUES ($1,$2,$3::jsonb,'plan','ok',$4::jsonb,$5, now())`,
    [id, backupId, JSON.stringify(scope), JSON.stringify({ toRestore: out.missing.length, same: out.same, conflicts: out.conflict.length, tables: tables.map((t) => ({ name: t.name, rows: t.rows })) }), actorId]);
  return { ok: true, planId: id, toRestore: out.missing.length, bytes: out.missing.reduce((s, m) => s + m.size, 0), same: out.same, conflicts: out.conflict.slice(0, 100), conflictCount: out.conflict.length, tables: tables.map((t) => ({ name: t.name, rows: t.rows })), keyId: b.key_id };
};

/**
 * Восстановление по плану. Файлы сначала раскладываются во временный каталог (staging) и проверяются по SHA-256, и только
 * затем перемещаются на место; существующие файлы НЕ перезаписываются, если не указан overwrite (владелец, подтверждение).
 * Строки таблиц добавляются только если их ещё нет (ON CONFLICT DO NOTHING) — актуальные данные не затираются.
 */
export const restoreApply = async (actorId, planId, { overwrite = false } = {}) => {
  const { rows } = await query(`SELECT * FROM storage_restores WHERE id = $1 AND mode = 'plan'`, [planId]);
  const p = rows[0];
  if (!p) return { error: 'plan_not_found' };
  if (Date.now() - new Date(p.started_at).getTime() > 30 * 60_000) return { error: 'plan_expired' };
  const { rows: used } = await query(`SELECT 1 FROM storage_restores WHERE mode = 'apply' AND result->>'planId' = $1`, [planId]);
  if (used.length) return { error: 'plan_already_applied' };
  const st = snapshot(); if (st?.emergency?.active) return { error: 'storage_unavailable' };
  if (!(await acquire())) return { error: 'busy' };
  const rid = newId('rs');
  const res = { planId, restored: 0, skippedSame: 0, conflicts: 0, overwritten: 0, failed: [], rows: {} };
  try {
    await query(`INSERT INTO storage_restores (id, backup_id, scope, mode, status, result, created_by) VALUES ($1,$2,$3::jsonb,'apply','running',$4::jsonb,$5)`, [rid, p.backup_id, JSON.stringify(p.scope), JSON.stringify({ planId }), actorId]);
    const target = getTarget();
    const manifest = await readManifest(target, p.backup_id);
    const staging = join(stagingRoot(), rid);
    await mkdir(staging, { recursive: true, mode: 0o700 });
    for (const o of manifest.objects.filter((x) => inScope(x, p.scope))) {
      try {
        const existing = await findPath(o.service, o.id);
        if (existing) {
          const s = await stat(existing); let same = false;
          if (s.size === o.size) { const hs = countingHash(); for await (const c of createReadStream(existing)) hs.feed(c); same = hs.digest() === o.sha256; }
          if (same) { res.skippedSame += 1; continue; }
          if (!overwrite) { res.conflicts += 1; continue; }
        }
        const tmp = join(staging, `${o.service}-${o.id}`);
        const hs = countingHash();
        const { createWriteStream } = await import('node:fs');
        await pipeline(decryptStream(await target.get(o.key), { id: `${o.service}/${o.id}` }), new Transform({ transform(c, _e, cb) { hs.feed(c); cb(null, c); } }), createWriteStream(tmp, { mode: 0o600 }));
        if (hs.digest() !== o.sha256) throw new BackupError('sha_mismatch', o.id);
        const root = serviceRoots().find((s) => s.service === o.service)?.root;
        if (!root) throw new BackupError('bad_service', o.service);
        // Путь на место: каталог по правилу сервиса (как у musicstore/filmstore: подпапка из id) — берём прежний, если файл был.
        const dest = existing ?? join(root, o.service === 'skyvideo' ? o.id.slice(5, 7) : o.id.slice(4, 6), o.id);
        await mkdir(dirname(dest), { recursive: true });
        if (existing) { const bak = join(quarantineRoot(), 'restore-replaced', `${o.service}-${o.id}-${Date.now()}`); await mkdir(dirname(bak), { recursive: true, mode: 0o700 }); await rename(existing, bak).catch(async () => { /* разные диски */ }); res.overwritten += 1; }
        await rename(tmp, dest).catch(async (e) => { if (e.code !== 'EXDEV') throw e; const { copyFile } = await import('node:fs/promises'); await copyFile(tmp, dest); await rm(tmp); });
        res.restored += 1;
        await query(`INSERT INTO storage_objects (service, id, category, size, status, sha256) VALUES ($1,$2,$3,$4,'ok',NULL) ON CONFLICT (service, id) DO UPDATE SET status = 'ok', sha256 = NULL, seen_at = now()`, [o.service, o.id, o.category ?? 'media', (await stat(dest)).size]);
      } catch (e) { res.failed.push(`${o.service}/${o.id}: ${e.code ?? e.message}`); }
    }
    for (const t of (manifest.tables ?? []).filter((x) => !p.scope?.tables || p.scope.tables.includes(x.name)).filter(() => !p.scope?.ids?.length)) {
      let ins = 0; let skip = 0;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const hs = countingHash();
        let buf = '';
        for await (const c of decryptStream(await target.get(t.key), { id: `${p.backup_id}/t/${t.name}` })) { hs.feed(c); buf += c.toString('utf8'); const parts = buf.split('\n'); buf = parts.pop(); for (const line of parts) { if (!line) continue; const r = await insertRow(client, t.name, line); if (r) ins += 1; else skip += 1; } }
        if (buf) { const r = await insertRow(client, t.name, buf); if (r) ins += 1; else skip += 1; }
        if (hs.digest() !== t.sha256) { await client.query('ROLLBACK'); res.failed.push(`таблица ${t.name}: не совпала контрольная сумма (строки не добавлены)`); ins = 0; skip = 0; }
        else await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.failed.push(`таблица ${t.name}: ${e.code ?? e.message}`); } finally { client.release(); }
      res.rows[t.name] = { inserted: ins, skipped: skip };
    }
    await rm(staging, { recursive: true, force: true });
  } catch (e) { res.failed.push(e.code ?? e.message); }
  const status = res.failed.length === 0 ? 'ok' : (res.restored + Object.values(res.rows).reduce((s, r) => s + r.inserted, 0) > 0 ? 'partial' : 'failed');
  await query(`UPDATE storage_restores SET status = $2, result = $3::jsonb, finished_at = now() WHERE id = $1`, [rid, status, JSON.stringify(res)]);
  await logEvent('restore', status === 'ok' ? 'warn' : 'critical', { id: rid, status, restored: res.restored, conflicts: res.conflicts, failed: res.failed.length }, actorId);
  await release();
  return { id: rid, status, ...res };
};

/** Вставка строки: только если её нет; ошибки связей (FK) одной строки не прерывают остальные (SAVEPOINT). */
const insertRow = async (client, table, line) => {
  if (!ALL_TABLES.has(table)) throw new BackupError('bad_table', table);
  await client.query('SAVEPOINT r');
  try {
    const { rowCount } = await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_record(NULL::${table}, $1::json) ON CONFLICT DO NOTHING`, [line]);
    await client.query('RELEASE SAVEPOINT r');
    return rowCount > 0;
  } catch { await client.query('ROLLBACK TO SAVEPOINT r'); return false; }
};

/* ─── Расписание ───────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
/** Какие слоты расписания наступили сегодня и ещё не выполнены (догоняем пропущенное в пределах 3 часов). */
export const dueSlots = (sch, now = new Date()) => {
  const out = [];
  if (!sch.enabled) return out;
  if (sch.frequency === 'weekly' && now.getDay() !== Number(sch.weekday)) return out;
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const times = sch.frequency === 'daily' ? [sch.times?.[0] ?? '03:00'] : (sch.times ?? ['03:00']);
  for (const t of times) {
    const [hh, mm] = String(t).split(':').map(Number);
    const at = new Date(now); at.setHours(hh, mm, 0, 0);
    const slot = `${day} ${pad(hh)}:${pad(mm)}`;
    if (now >= at && now - at < 3 * 3600_000 && sch.last_slot < slot) out.push(slot);
  }
  return out.sort();
};

export const runSchedules = async (now = new Date()) => {
  const { rows } = await query('SELECT * FROM storage_schedules WHERE enabled');
  let started = 0;
  for (const sch of rows) {
    const slots = dueSlots(sch, now);
    if (!slots.length) continue;
    const r = await startBackup({ kind: sch.kind, scope: sch.scope ?? {}, trigger: 'schedule' });
    if (r.error === 'busy') continue;               // повторим на следующем тике
    await query('UPDATE storage_schedules SET last_slot = $2, last_run_at = now() WHERE id = $1', [sch.id, slots[slots.length - 1]]);
    if (r.error) { await logEvent('schedule_skipped', 'critical', { schedule: sch.id, error: r.error }); await notifyOwners(`sched:${r.error}`, 'Резервное копирование по расписанию не запущено', `Причина: ${r.error}.`, { critical: true }); }
    else started += 1;
  }
  return started;
};

export const backupSummary = async () => {
  const { rows: last } = await query(`SELECT id, kind, status, started_at, finished_at, verified_at, bytes, files, error FROM storage_backups ORDER BY started_at DESC LIMIT 1`);
  const { rows: lastOk } = await query(`SELECT id, kind, verified_at, bytes FROM storage_backups WHERE status = 'verified' ORDER BY verified_at DESC LIMIT 1`);
  const { rows: cnt } = await query(`SELECT status, count(*)::int AS n FROM storage_backups WHERE status <> 'deleted' GROUP BY status`);
  return { last: last[0] ?? null, lastVerified: lastOk[0] ?? null, counts: Object.fromEntries(cnt.map((r) => [r.status, r.n])), running: jobRunning(), target: describeTarget(), keys: keyStatus() };
};
