/**
 * Sky Storage — основное хранение медиафайлов в S3.
 *
 *   STORAGE_PRIMARY=s3            включает режим (нужны STORAGE_S3_*, см. skystorages3.mjs)
 *   STORAGE_PRIMARY_CACHE_DAYS    сколько дней локальная копия лежит на диске сервера как кэш (по умолчанию 7;
 *                                 0 — не убирать копии с диска)
 *   STORAGE_PRIMARY_CACHE_MAX_GB  если локальных медиа больше — самые давние убираются раньше срока (0 — без предела)
 *
 * Схема. Файл по-прежнему пишется на диск в зашифрованном виде (SKE1, mediacrypto.mjs) — и ТОЛЬКО после того, как он
 * целиком загружен в S3 и размер подтверждён запросом HEAD, запись считается успешной. Не загрузился — файл на диске
 * удаляется, человек получает ошибку (хранилище недоступно), «тихих» потерь нет.
 * Чтение: если файл есть на диске (кэш) — с диска; иначе читается прямо из S3 диапазонами (перемотка работает, файл
 * целиком на диск не скачивается). Удаление убирает и локальный файл, и объект в S3.
 * Шифрование остаётся прежним: S3 хранит тот же шифротекст SKE1, ключи в S3 не попадают.
 *
 * Ключ объекта — путь файла относительно /data, под префиксом `media/` (и общим STORAGE_S3_PREFIX).
 */
import { open as fsOpen, stat, rm, mkdir, rename, readdir, utimes } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createS3, s3Config } from './skystorages3.mjs';
import { StorageBlocked } from './skystoragestate.mjs';

export const enabled = () => (process.env.STORAGE_PRIMARY ?? '').toLowerCase() === 's3' && s3Config().ok;

let client = null;
let clientSig = '';
const s3 = () => {
  const cfg = s3Config();
  const sig = `${cfg.endpoint}|${cfg.bucket}|${cfg.accessKey ?? ''}|${cfg.prefix}`;
  if (!client || sig !== clientSig) { client = createS3(cfg); clientSig = sig; }
  return client;
};
/** Для тестов. */
export const _reset = () => { client = null; clientSig = ''; blocks.clear(); sizes.clear(); };

const cacheDays = () => { const v = Number(process.env.STORAGE_PRIMARY_CACHE_DAYS ?? 7); return Number.isFinite(v) && v >= 0 ? v : 7; };

export const keyFor = (path) => `media/${String(path).replace(/^\/data\//, '').replace(/^\/+/, '')}`;
const providerDown = (e) => Object.assign(new StorageBlocked('storage_provider_unavailable', 'Внешнее хранилище недоступно.'), { status: 503, cause: e });

/* ─── Запись ───────────────────────────────────────────────────────── */

/** Загрузить готовый локальный файл в S3 и сверить размер. Бросает StorageBlocked, если не вышло. */
export const upload = async (path) => {
  if (!enabled()) return false;
  const size = (await stat(path)).size;
  const key = keyFor(path);
  try {
    await s3().put(key, createReadStream(path));
    const h = await s3().head(key);
    if (!h || h.size !== size) throw new Error('size_mismatch');
  } catch (e) {
    throw providerDown(e);   // прежний объект (если был) не трогаем; недозагруженное S3 не публикует
  }
  sizes.set(key, size);
  return true;
};

/** Файл только что записан на диск: подтвердить в S3 либо убрать локальный и отказать. */
export const afterWrite = async (path) => {
  if (!enabled()) return;
  try { await upload(path); } catch (e) { await rm(path, { force: true }).catch(() => {}); throw e; }
};

/* ─── Чтение ───────────────────────────────────────────────────────── */

const BLOCK = 4 * 1024 * 1024;
const blocks = new Map();       // key|n → Buffer (небольшой LRU)
const sizes = new Map();        // key → размер объекта
const MAX_BLOCKS = 24;

const remoteSize = async (key) => {
  if (sizes.has(key)) return sizes.get(key);
  let h; try { h = await s3().head(key); } catch (e) { throw providerDown(e); }
  if (!h) return null;
  if (sizes.size > 5000) sizes.clear();
  sizes.set(key, h.size);
  return h.size;
};

const getBlock = async (key, n, size) => {
  const id = `${key}|${n}`;
  const hit = blocks.get(id);
  if (hit) { blocks.delete(id); blocks.set(id, hit); return hit; }
  const start = n * BLOCK; const end = Math.min(size, start + BLOCK) - 1;
  let buf;
  try { buf = await s3().readAll(await s3().get(key, { start, end })); } catch (e) { throw providerDown(e); }
  if (buf.length !== end - start + 1) throw providerDown(new Error('short_read'));
  blocks.set(id, buf);
  while (blocks.size > MAX_BLOCKS) blocks.delete(blocks.keys().next().value);
  return buf;
};

const touched = new Map();
const touchLocal = (path) => {
  const now = Date.now();
  if ((touched.get(path) ?? 0) > now - 600_000) return;
  if (touched.size > 20000) touched.clear();
  touched.set(path, now);
  const d = new Date(); utimes(path, d, d).catch(() => {});   // «давность» кэша считается от последнего чтения
};

/**
 * Открыть файл для чтения: диск, а если там нет — S3. Возвращает объект с методами `read`, `stat`, `close`
 * (подмножество FileHandle), поэтому шифрованный читатель работает одинаково с обоими источниками.
 */
export const openRead = async (path) => {
  try {
    const fh = await fsOpen(path, 'r');
    if (enabled()) touchLocal(path);
    return fh;
  } catch (e) {
    if (e.code !== 'ENOENT' || !enabled()) throw e;
  }
  const key = keyFor(path);
  const size = await remoteSize(key);
  if (size == null) { const err = new Error('ENOENT: not found in storage'); err.code = 'ENOENT'; throw err; }
  return {
    async read(buf, off, len, pos) {
      let done = 0;
      while (done < len && pos + done < size) {
        const at = pos + done; const n = Math.floor(at / BLOCK);
        const b = await getBlock(key, n, size);
        const from = at - n * BLOCK; const take = Math.min(len - done, b.length - from);
        b.copy(buf, off + done, from, from + take); done += take;
      }
      return { bytesRead: done, buffer: buf };
    },
    async stat() { return { size }; },
    async close() {},
  };
};

/** Есть ли файл (на диске или в S3). */
export const exists = async (path) => {
  try { if ((await stat(path)).isFile()) return true; } catch { /* нет на диске */ }
  if (!enabled()) return false;
  return (await remoteSize(keyFor(path))) != null;
};

/** Размер зашифрованного файла (диск или S3), null — нет нигде. */
export const statAny = async (path) => {
  try { const s = await stat(path); return { size: s.size, mtimeMs: s.mtimeMs, local: true }; } catch { /* не на диске */ }
  if (!enabled()) return null;
  const size = await remoteSize(keyFor(path));
  return size == null ? null : { size, mtimeMs: null, local: false };
};

/** Убрать только объект в S3 (файл уже перенесён в карантин на диске). */
export const removeRemote = async (path) => {
  if (!enabled()) return;
  const key = keyFor(path);
  try { await s3().del(key); } catch (e) { throw providerDown(e); }
  sizes.delete(key);
  for (const id of [...blocks.keys()]) if (id.startsWith(`${key}|`)) blocks.delete(id);
};

/** Сырой поток файла (шифротекст) для копирования: диск, иначе S3. */
export const openRaw = async (path) => {
  try { await stat(path); return createReadStream(path); } catch { /* возможно, только в S3 */ }
  if (!enabled()) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  try { return await s3().get(keyFor(path)); } catch (e) { throw providerDown(e); }
};

/** Вернуть файл на диск (для операций, которым нужен локальный файл: смена ключа, старые открытые файлы). */
export const ensureLocal = async (path) => {
  try { await stat(path); return true; } catch { /* скачиваем */ }
  if (!enabled()) return false;
  const key = keyFor(path);
  if ((await remoteSize(key)) == null) return false;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.part`;
  try {
    await pipeline(await s3().get(key), createWriteStream(tmp, { mode: 0o600 }));
    await rename(tmp, path);
  } catch (e) { await rm(tmp, { force: true }).catch(() => {}); throw providerDown(e); }
  return true;
};

/* ─── Удаление ─────────────────────────────────────────────────────── */

/** Удалить файл и на диске, и в S3. Сначала S3: если он недоступен, локальный файл остаётся и ошибка видна. */
export const removeMedia = async (path) => {
  if (enabled()) {
    const key = keyFor(path);
    try { await s3().del(key); } catch (e) { throw providerDown(e); }
    sizes.delete(key);
    for (const id of [...blocks.keys()]) if (id.startsWith(`${key}|`)) blocks.delete(id);
  }
  await rm(path, { force: true });
};

/** Файлы под каталогом в S3 (для реестра и поиска пропавших). */
export const listRemote = async (rootDir) => {
  if (!enabled()) return [];
  const prefix = `${keyFor(rootDir).replace(/\/+$/, '')}/`;
  const root = rootDir.replace(/\/+$/, '');
  return (await s3().list(prefix)).map((o) => ({ path: join(root, o.key.slice(prefix.length)), size: o.size }));
};

/* ─── Синхронизация и кэш ──────────────────────────────────────────── */

async function* walkLocal(root) {
  let es; try { es = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = join(root, e.name);
    if (e.isDirectory()) yield* walkLocal(p);
    else if (e.isFile() && !e.name.endsWith('.part') && !e.name.startsWith('.')) yield p;
  }
}

/**
 * Периодическая работа: (1) догружает в S3 локальные файлы, которых там ещё нет (записанные до включения режима);
 * (2) убирает с диска копии, которые подтверждённо лежат в S3 и старше срока кэша.
 * Лимит файлов за проход — чтобы не нагружать диск и канал; возвращает счётчики.
 */
export const syncAndEvict = async (roots, { maxFiles = 300 } = {}) => {
  const out = { uploaded: 0, evicted: 0, failed: 0, checked: 0, evictedBytes: 0 };
  if (!enabled()) return out;
  const days = cacheDays();
  const maxBytes = Number(process.env.STORAGE_PRIMARY_CACHE_MAX_GB ?? 0) * 1024 ** 3;
  const files = [];
  for (const root of roots) for await (const p of walkLocal(root)) { const st = await stat(p).catch(() => null); if (st) files.push({ p, size: st.size, at: st.mtimeMs }); }
  const total = files.reduce((a, f) => a + f.size, 0);
  files.sort((a, b) => a.at - b.at);
  let over = maxBytes > 0 ? Math.max(0, total - maxBytes) : 0;
  for (const f of files) {
    if (out.checked >= maxFiles) break;
    const old = days > 0 && Date.now() - f.at > days * 86400_000;
    const needSpace = over > 0;
    out.checked += 1;
    try {
      const key = keyFor(f.p);
      let h = await s3().head(key);
      if (!h || h.size !== f.size) { await upload(f.p); out.uploaded += 1; h = { size: f.size }; }
      if (days > 0 && (old || needSpace) && h.size === f.size) {
        await rm(f.p, { force: true }); out.evicted += 1; out.evictedBytes += f.size; over -= f.size;
      }
    } catch { out.failed += 1; }
  }
  return out;
};

export const status = () => ({ enabled: enabled(), cacheDays: cacheDays(), cacheMaxGb: Number(process.env.STORAGE_PRIMARY_CACHE_MAX_GB ?? 0) });
