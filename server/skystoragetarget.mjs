/**
 * Sky Storage — цель резервных копий: S3-совместимое хранилище ИЛИ отдельный каталог.
 *
 *   STORAGE_BACKUP_TARGET = s3 | local     (пусто — резервное копирование не настроено и запуск отклоняется)
 *   s3:    STORAGE_S3_* (см. skystorages3.mjs) — независимая площадка
 *   local: STORAGE_BACKUP_DIR — каталог на ОТДЕЛЬНОМ диске/смонтированном томе;
 *          STORAGE_BACKUP_INDEPENDENT=1 — владелец подтверждает, что это другой физический носитель.
 *          Иначе панель честно показывает «не независимая площадка».
 *
 * В копии лежат только зашифрованные объекты (SBK1), манифесты и цепочка; открытых данных нет.
 * Запись локально — через временный файл `.part` с переименованием: частично записанный объект не виден.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readdir, statfs, open as fsOpen } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createS3, s3Config, backupS3Config, backupBucketDedicated, S3Error } from './skystorages3.mjs';
import { enabled as primaryEnabled } from './skystorageprimary.mjs';

export class TargetError extends Error { constructor(code, detail = '') { super(code); this.code = code; this.detail = detail; } }

const KEY_RE = /^[A-Za-z0-9._\-/]{1,300}$/;
const checkKey = (k) => { if (!KEY_RE.test(k) || k.includes('..') || k.startsWith('/')) throw new TargetError('bad_key', k); return k; };

export const targetKind = () => (process.env.STORAGE_BACKUP_TARGET ?? '').toLowerCase();

const makeLocal = () => {
  const dir = process.env.STORAGE_BACKUP_DIR;
  if (!dir) throw new TargetError('target_not_configured', 'STORAGE_BACKUP_DIR');
  const path = (k) => join(dir, checkKey(k));
  return {
    kind: 'local', independent: process.env.STORAGE_BACKUP_INDEPENDENT === '1', label: dir,
    async put(key, source) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true, mode: 0o700 });
      const tmp = `${p}.part`;
      try {
        await pipeline(source, createWriteStream(tmp, { mode: 0o600 }));
        await rename(tmp, p);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        if (e.code === 'ENOSPC') throw new TargetError('target_no_space');
        throw e;
      }
      return { size: (await stat(p)).size };
    },
    async get(key, range) { const p = path(key); await stat(p).catch(() => { throw new TargetError('not_found', key); }); return createReadStream(p, range ? { start: range.start, end: range.end } : {}); },
    async head(key) { try { const s = await stat(path(key)); return { size: s.size }; } catch { return null; } },
    async del(key) { await rm(path(key), { force: true }); },
    async list(prefix = '') {
      const out = [];
      const walk = async (rel) => {
        let es; try { es = await readdir(join(dir, rel), { withFileTypes: true }); } catch { return; }
        for (const e of es) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(r);
          else if (e.isFile() && !e.name.endsWith('.part') && r.startsWith(prefix)) out.push({ key: r, size: (await stat(join(dir, r))).size });
        }
      };
      await walk('');
      return out;
    },
    async health() {
      const t0 = Date.now();
      const work = (async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const probe = join(dir, `.probe-${process.pid}`);
        const fh = await fsOpen(probe, 'w'); await fh.write('ok'); await fh.close(); await rm(probe);
        const s = await statfs(dir);
        return { ok: true, ms: Date.now() - t0, free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
      })();
      // Зависшая точка монтирования (сетевой диск) не должна подвешивать задачи: ограничиваем проверку по времени.
      const limit = new Promise((resolve) => { const t = setTimeout(() => resolve({ ok: false, ms: Date.now() - t0, code: 'timeout' }), 8000); t.unref?.(); });
      try { return await Promise.race([work, limit]); } catch (e) { return { ok: false, ms: Date.now() - t0, code: e.code ?? 'error' }; }
    },
    async abortIncomplete() {
      let n = 0;
      const walk = async (d) => { let es; try { es = await readdir(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.part') && Date.now() - (await stat(p)).mtimeMs > 3600_000) { await rm(p, { force: true }); n += 1; } } };
      await walk(dir); return n;
    },
  };
};

const makeS3 = () => {
  const cfg = backupS3Config();
  if (!cfg.ok) throw new TargetError('target_not_configured', cfg.missing.join(','));
  const s3 = createS3(cfg);
  // Независимая площадка: отдельный бакет (или хостер), отличный от основного хранения медиа. Общий бакет — не независим.
  const main = s3Config();
  const sameAsMain = main.ok && main.endpoint === cfg.endpoint && main.bucket === cfg.bucket;
  const independent = backupBucketDedicated() ? !sameAsMain : !primaryEnabled();
  return {
    kind: 's3', independent, dedicated: backupBucketDedicated(), prefix: cfg.prefix,
    label: `${new URL(cfg.endpoint).host}/${cfg.bucket}`,
    put: (k, src) => s3.put(checkKey(k), src),
    get: (k, range) => s3.get(checkKey(k), range ? { start: range.start, end: range.end } : {}),
    head: (k) => s3.head(checkKey(k)),
    del: (k) => s3.del(checkKey(k)),
    list: (p) => s3.list(p),
    health: () => s3.health(),
    async abortIncomplete() {
      let n = 0;
      for (const u of await s3.listUploads()) { if (Date.now() - Date.parse(u.initiated) > 3600_000) { await s3.abort(u.key, u.uploadId).catch(() => {}); n += 1; } }
      return n;
    },
  };
};

/** Текущая цель по окружению. Бросает TargetError, если не настроена. */
export const getTarget = () => {
  const k = targetKind();
  if (k === 's3') return makeS3();
  if (k === 'local') return makeLocal();
  throw new TargetError('target_not_configured', 'STORAGE_BACKUP_TARGET');
};

/** Описание без секретов — для панели. */
export const describeTarget = () => {
  const k = targetKind();
  try {
    const t = getTarget();
    return { configured: true, kind: t.kind, independent: t.independent, dedicated: Boolean(t.dedicated), label: t.label, prefix: t.prefix ?? null };
  } catch (e) {
    return { configured: false, kind: k || null, independent: false, missing: e.detail ? String(e.detail).split(',') : [], reason: e.code };
  }
};

export { S3Error };
