/**
 * Sky Storage — квоты, лимиты и параллелизм на горячем пути записи/чтения.
 *
 * Сюда заходят ВСЕ обращения к зашифрованным медиафайлам (mediacrypto.mjs) и вложения мессенджера:
 *   beginWrite(path, limit) — проверка состояния, порогов заполнения, квот и параллелизма; атомарно резервирует
 *                             место ДО начала загрузки (в одном процессе Node проверка и резерв — один синхронный шаг);
 *   beginRead(path)         — проверка состояния и ограничение числа одновременных чтений.
 * Резерв всегда освобождается (done/abort), в том числе при ошибке или обрыве.
 *
 * Пороги по умолчанию: 70% — предупреждение, 85% — критическое, 95% — блокировка необязательных
 * загрузок, 100% — запрет новых записей. Все настраиваются в состоянии хранилища. Данные
 * пользователей при нехватке места НЕ удаляются, чтение и скачивание остаются.
 */
import * as primary from './skystorageprimary.mjs';
import { basename, join } from 'node:path';
import { stat as fsStat, readdir } from 'node:fs/promises';
import { query } from './db.mjs';
import { assertRead, assertWrite, snapshot, StorageBlocked, counters, diskInfo, levelFor, logEvent, notifyOwners } from './skystoragestate.mjs';

/** Каталоги сервисов → сервис и категория. Порядок не важен: пути не вложены друг в друга. */
const SERVICES = [
  ['music', 'music', 'MUSIC_DIR', '/data/music'],
  ['film', 'film', 'FILM_DIR', '/data/film'],
  ['podcasts', 'podcasts', 'PODCAST_DIR', '/data/podcasts'],
  ['skyvideo', 'skyvideo', 'SKYVIDEO_DIR', '/data/skyvideo'],
  ['video', 'skyvideo', 'VIDEO_DIR', '/data/video'],
  ['books', 'books', 'BOOKS_DIR', '/data/books'],
  ['bloom', 'media_other', 'BLOOM_DIR', '/data/bloom'],
  ['stories', 'media_other', 'STORY_DIR', '/data/stories'],
  ['gifts', 'media_other', 'GIFTS_DIR', '/data/gifts'],
  ['ads', 'media_other', 'ADS_DIR', '/data/ads'],
  ['campaigns', 'media_other', 'CAMPAIGNS_DIR', '/data/campaigns'],
  ['skins', 'media_other', 'SKIN_DIR', '/data/skins'],
  ['market', 'market', 'MARKET_DIR', '/data/market'],
  ['evidence', 'evidence', 'EVIDENCE_DIR', '/data/evidence'],
  ['tickets', 'media_other', 'TICKETS_DIR', '/data/tickets'],
  ['aifiles', 'media_other', 'AI_FILES_DIR', '/data/aifiles'],
];
/** Что НЕ отключаем при 95% (нужно для работы и безопасности, объёмы малы). */
const ESSENTIAL = new Set(['messenger', 'messenger_voice', 'market', 'evidence']);
export const CATEGORIES = ['music', 'film', 'podcasts', 'skyvideo', 'books', 'messenger', 'messenger_voice', 'market', 'evidence', 'media_other', 'backups'];

export const serviceRoots = () => SERVICES.map(([service, category, env, def]) => ({ service, category, root: (process.env[env] || def).replace(/\/+$/, '') }));
export const serviceOfPath = (path) => {
  const p = String(path);
  for (const s of serviceRoots()) if (p === s.root || p.startsWith(`${s.root}/`)) return s;
  return { service: 'other', category: 'media_other', root: '' };
};

/* ─── Учёт занятого места (по категориям) ──────────────────────────── */

export const usage = new Map();       // category → {bytes, files}
const reserved = new Map();           // category → байт в резерве
const active = { uploads: 0, io: 0, byCat: new Map() };
let quotas = new Map();               // category → {hard, maxFile, maxFiles, maxConcurrent}
let lastReport = 0;

export const setUsage = (rows) => { usage.clear(); for (const r of rows) usage.set(r.category, { bytes: Number(r.bytes), files: Number(r.files) }); };
export const addUsage = (category, bytes, files = 1) => { const u = usage.get(category) ?? { bytes: 0, files: 0 }; u.bytes += bytes; u.files += files; usage.set(category, u); };
export const totalUsed = () => [...usage.values()].reduce((s, u) => s + u.bytes, 0);
const totalReserved = () => [...reserved.values()].reduce((s, n) => s + n, 0);

export const loadQuotas = async () => {
  const { rows } = await query('SELECT * FROM storage_quotas');
  quotas = new Map(rows.map((r) => [r.category, {
    hard: r.hard_bytes == null ? null : Number(r.hard_bytes), maxFile: r.max_file_bytes == null ? null : Number(r.max_file_bytes),
    maxFiles: r.max_files == null ? null : Number(r.max_files), maxConcurrent: r.max_concurrent,
  }]));
};
export const quotaOf = (c) => quotas.get(c) ?? {};

const uploadWindow = [];            // отметки времени начала загрузок за минуту

/** Общая ёмкость: заданный предел или размер диска данных. */
export const capacity = async () => {
  const st = snapshot();
  const disk = await diskInfo();
  // Файлы лежат в S3 — размер диска сервера к ним не относится: ёмкость — заданный предел (напр. 1 ТБ тарифа).
  const s3 = (process.env.STORAGE_PRIMARY ?? '').toLowerCase() === 's3';
  const limit = st?.settings.totalBytes || 0;
  const total = s3 && limit ? limit : limit ? Math.min(limit, disk.total || limit) : disk.total;
  const source = s3 && limit ? 'limit' : s3 ? 'disk-fallback' : 'disk';
  return { total, diskTotal: disk.total, diskFree: disk.free, source, s3 };
};

let capCache = { at: 0, k: null, v: { total: 0, diskTotal: 0, diskFree: Infinity } };
const capacityCached = async () => {
  const k = snapshot()?.settings.totalBytes ?? null;       // смена предела объёма вступает в силу сразу
  if (Date.now() - capCache.at > 15_000 || capCache.k !== k) capCache = { at: Date.now(), k, v: await capacity() };
  return capCache.v;
};

/** Начало записи. Возвращает { limit, done(actualBytes), abort() }. */
export const beginWrite = async (path, limitBytes, { bytesHint = null } = {}) => {
  assertWrite();
  const st = snapshot();
  const { service, category } = serviceOfPath(path);
  const set = st?.settings;
  const q = quotaOf(category);

  let limit = Math.min(Number(limitBytes) || Infinity, set?.maxFileBytes ?? Infinity, q.maxFile ?? Infinity);

  // Параллелизм и частота
  const now = Date.now();
  while (uploadWindow.length && now - uploadWindow[0] > 60_000) uploadWindow.shift();
  if (set && uploadWindow.length >= set.uploadsPerMinute) { counters.writesBlocked += 1; throw Object.assign(new StorageBlocked('too_many_uploads', 'Слишком много загрузок, повторите позже.'), { status: 429 }); }
  if (set && active.uploads >= set.maxConcurrentUploads) { counters.writesBlocked += 1; throw Object.assign(new StorageBlocked('too_many_uploads', 'Слишком много одновременных загрузок.'), { status: 429 }); }
  const catActive = active.byCat.get(category) ?? 0;
  if (q.maxConcurrent && catActive >= q.maxConcurrent) { counters.writesBlocked += 1; throw Object.assign(new StorageBlocked('too_many_uploads', 'Для этого раздела уже идёт максимум загрузок.'), { status: 429 }); }

  // Заполнение: пороги и резерв свободного места
  const cap = await capacityCached();
  const used = totalUsed() + totalReserved();
  const pct = cap.total ? (used / cap.total) * 100 : 0;
  const level = levelFor(pct, set?.thresholds ?? { warn: 70, critical: 85, block: 95, full: 100 });
  if (level === 'full' || (cap.diskFree !== undefined && cap.diskFree < (set?.reserveFreeBytes ?? 0))) {
    counters.writesBlocked += 1; reportLevel('full', pct);
    throw Object.assign(new StorageBlocked('storage_full', 'В хранилище нет свободного места.'), { status: 507 });
  }
  if (level === 'block' && !ESSENTIAL.has(category)) {
    counters.writesBlocked += 1; reportLevel('block', pct);
    throw Object.assign(new StorageBlocked('storage_nearly_full', 'Хранилище почти заполнено: новые загрузки временно отключены.'), { status: 507 });
  }
  reportLevel(level, pct);

  // Квота категории: резерв атомарно (этот участок синхронный)
  if (q.hard != null) {
    const cu = usage.get(category)?.bytes ?? 0;
    const left = q.hard - cu - (reserved.get(category) ?? 0);
    if (left <= 0) { counters.writesBlocked += 1; throw Object.assign(new StorageBlocked('quota_exceeded', 'Квота раздела исчерпана.'), { status: 507 }); }
    limit = Math.min(limit, left);
  }
  if (q.maxFiles != null && (usage.get(category)?.files ?? 0) >= q.maxFiles) { counters.writesBlocked += 1; throw Object.assign(new StorageBlocked('quota_files', 'Достигнут предел числа файлов раздела.'), { status: 507 }); }
  if (set?.maxFiles != null && [...usage.values()].reduce((s, u) => s + u.files, 0) >= set.maxFiles) { counters.writesBlocked += 1; throw Object.assign(new StorageBlocked('quota_files', 'Достигнут общий предел числа файлов.'), { status: 507 }); }

  const reserve = Number.isFinite(limit) ? limit : (bytesHint ?? 0);
  const held = Math.min(reserve, 1024 ** 4);
  reserved.set(category, (reserved.get(category) ?? 0) + held);
  active.uploads += 1; active.byCat.set(category, catActive + 1); uploadWindow.push(now);
  let finished = false;
  const release = () => {
    if (finished) return false; finished = true;
    reserved.set(category, Math.max(0, (reserved.get(category) ?? 0) - held));
    active.uploads = Math.max(0, active.uploads - 1);
    active.byCat.set(category, Math.max(0, (active.byCat.get(category) ?? 1) - 1));
    return true;
  };
  return {
    limit, service, category,
    done: (bytes) => { if (release()) { counters.uploadsOk += 1; if (bytes) { addUsage(category, bytes, 1); upsertObject(service, category, path, bytes).catch(() => {}); } } },
    abort: () => { if (release()) counters.uploadsFailed += 1; },
  };
};

/** Начало чтения. Возвращает release() — вызвать при закрытии потока. */
export const beginRead = (path) => {
  assertRead();
  const st = snapshot();
  const max = st?.settings.maxConcurrentIO ?? 64;
  if (active.io >= max) { counters.readsBlocked += 1; throw Object.assign(new StorageBlocked('storage_busy', 'Хранилище перегружено, повторите позже.'), { status: 503 }); }
  active.io += 1;
  let done = false;
  return () => { if (!done) { done = true; active.io = Math.max(0, active.io - 1); counters.downloadsOk += 1; } };
};

export const activity = () => ({ uploads: active.uploads, io: active.io, reservedBytes: totalReserved() });

const upsertObject = async (service, category, path, bytes) => {
  await query(
    `INSERT INTO storage_objects (service, id, category, size, status, uploaded_at, seen_at) VALUES ($1,$2,$3,$4,'ok', now(), now())
     ON CONFLICT (service, id) DO UPDATE SET size = EXCLUDED.size, sha256 = NULL, checked_at = NULL, status = 'ok', seen_at = now()`,
    [service, basename(path), category, bytes]);
};

/** Событие порога: не чаще раза в 10 минут на уровень; уведомление владельцу без секретов. */
const reportLevel = (level, pct) => {
  if (level === 'ok' || Date.now() - lastReport < 10 * 60_000) return;
  lastReport = Date.now();
  const critical = level !== 'warn';
  void logEvent('capacity', critical ? 'critical' : 'warn', { level, pct: Math.round(pct * 10) / 10 });
  void notifyOwners(`capacity:${level}`, 'Заполнение хранилища', `Занято ${Math.round(pct)}% (уровень «${level}»). Новые необязательные загрузки ${level === 'warn' ? 'пока разрешены' : 'ограничены'}.`, { critical });
};

/**
 * Запись, которая не идёт через файловый слой (вложения мессенджера лежат в базе): те же состояния,
 * пороги и квоты, без параллелизма потока. Бросает StorageBlocked; после успешной записи вызвать addUsage.
 */
export const checkInlineWrite = async (category, bytes) => {
  assertWrite();
  const st = snapshot();
  const q = quotaOf(category);
  if (q.maxFile != null && bytes > q.maxFile) throw Object.assign(new StorageBlocked('file_too_large', 'Файл больше допустимого размера.'), { status: 413 });
  const cap = await capacityCached();
  const pct = cap.total ? ((totalUsed() + totalReserved() + bytes) / cap.total) * 100 : 0;
  const level = levelFor(pct, st?.settings.thresholds ?? { warn: 70, critical: 85, block: 95, full: 100 });
  if (level === 'full') throw Object.assign(new StorageBlocked('storage_full', 'В хранилище нет свободного места.'), { status: 507 });
  if (q.hard != null && (usage.get(category)?.bytes ?? 0) + bytes > q.hard) throw Object.assign(new StorageBlocked('quota_exceeded', 'Квота раздела исчерпана.'), { status: 507 });
  if (q.maxFiles != null && (usage.get(category)?.files ?? 0) >= q.maxFiles) throw Object.assign(new StorageBlocked('quota_files', 'Достигнут предел числа файлов раздела.'), { status: 507 });
};

/** Подкаталог по правилам хранилищ сервисов (musicstore, filmstore, …); для остальных — обход каталога. */
const subdirFor = (service, id) => (service === 'skyvideo' || service === 'video' ? id.slice(5, 7) : ['music', 'film', 'podcasts', 'books'].includes(service) ? id.slice(4, 6) : null);

/** Путь файла по сервису и id: сначала прямой (быстро), затем обход каталога сервиса. */
export const locateFile = async (service, id) => {
  const root = serviceRoots().find((s) => s.service === service)?.root;
  if (!root || !/^[A-Za-z0-9._-]{1,120}$/.test(id)) return null;
  const sub = subdirFor(service, id);
  if (sub) { const p = join(root, sub, id); try { if ((await fsStat(p)).isFile()) return p; } catch { /* не там */ } }
  const walk = async (d) => {
    let es; try { es = await readdir(d, { withFileTypes: true }); } catch { return null; }
    for (const e of es) { const p = join(d, e.name); if (e.isDirectory()) { const r = await walk(p); if (r) return r; } else if (e.name === id) return p; }
    return null;
  };
  const found = await walk(root);
  if (found) return found;
  // Основное хранение в S3: на диске файла может не быть (убран из кэша) — тогда виртуальный путь, по которому его найдёт слой S3
  if (sub && primary.enabled()) { const p = join(root, sub, id); if (await primary.exists(p)) return p; }
  return null;
};
