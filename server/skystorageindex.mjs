/**
 * Sky Storage — реестр объектов, проверка целостности, поиск осиротевших файлов и карантин.
 *
 * Реестр (storage_objects) описывает файлы, которые лежат в каталогах сервисов: сервис, категория, владелец и MIME
 * (из таблиц сервиса, где соответствие подтверждено — музыка, кино), размер, SHA-256 зашифрованных байт, статус.
 * Идентификаторы файлов НЕ меняются: сервисы продолжают работать со своими id, реестр лишь описывает их.
 * Права на выдачу проверяет сервис-владелец (членство в чате, приватность, подписка) — реестр доступа не даёт.
 *
 * Осиротевшие файлы: сначала пометка «orphan» (два прохода с интервалом), затем КАРАНТИН (перенос, не удаление),
 * повторная проверка связей прямо перед переносом, окончательное удаление — только после срока карантина и
 * если ссылок по-прежнему нет. Файлы моложе суток не трогаем (идущая загрузка).
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { readdir, stat, mkdir, rename, rm } from 'node:fs/promises';
import { join, basename, relative } from 'node:path';
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { serviceRoots, setUsage, CATEGORIES, usage, capacity, loadQuotas, locateFile } from './skystoragelimits.mjs';
import { logEvent, snapshot, levelFor } from './skystoragestate.mjs';
import * as primary from './skystorageprimary.mjs';

export const quarantineRoot = () => process.env.STORAGE_QUARANTINE_DIR || '/data/storage-quarantine';
const GRACE_MS = 24 * 3600_000;

/** Перенос файла: rename, а между разными дисками — копия с проверкой размера и только потом удаление исходника. */
const moveFile = async (from, to) => {
  await primary.ensureLocal(from);   // файл мог остаться только в S3 — сначала вернуть на диск
  try { await rename(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await pipeline(createReadStream(from), createWriteStream(to, { mode: 0o600 }));
    if ((await stat(to)).size !== (await stat(from)).size) { await rm(to, { force: true }); throw new Error('move_size_mismatch'); }
    await rm(from);
  }
};

const sha256File = async (path) => {
  const h = crypto.createHash('sha256');
  for await (const c of await primary.openRaw(path)) h.update(c);
  return h.digest('hex');
};

/** Обход каталога сервиса: только файлы с нашими именами, без временных. */
async function* walk(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && !e.name.endsWith('.part') && !e.name.startsWith('.')) yield p;
  }
}

/** Что знаем о файле из таблиц сервиса (только подтверждённые соответствия). */
const refInfo = async (service, id) => {
  if (service === 'music') {
    const track = id.startsWith('cov-') ? `trk-${id.slice(4)}` : id;
    const { rows } = await query('SELECT owner_id, mime, cover_mime, has_cover FROM music_tracks WHERE id = $1', [track]);
    if (!rows[0]) return { mapped: true, referenced: false };
    if (id.startsWith('cov-') && !rows[0].has_cover) return { mapped: true, referenced: false };
    return { mapped: true, referenced: true, owner: rows[0].owner_id, mime: id.startsWith('cov-') ? rows[0].cover_mime : rows[0].mime };
  }
  if (service === 'film') {
    const movie = id.startsWith('pst-') ? `mov-${id.slice(4)}` : id;
    const { rows } = await query('SELECT owner_id, mime, poster_mime, has_poster FROM film_movies WHERE id = $1', [movie]);
    if (!rows[0]) return { mapped: true, referenced: false };
    if (id.startsWith('pst-') && !rows[0].has_poster) return { mapped: true, referenced: false };
    return { mapped: true, referenced: true, owner: rows[0].owner_id, mime: id.startsWith('pst-') ? rows[0].poster_mime : rows[0].mime };
  }
  return { mapped: false, referenced: true };
};

const DEFAULT_MIME = { music: 'audio/octet-stream', film: 'video/octet-stream', podcasts: 'application/octet-stream', skyvideo: 'video/octet-stream', video: 'video/octet-stream', books: 'application/octet-stream' };

/**
 * Полный проход: обновляет реестр по факту на диске, помечает пропавшие и осиротевшие, пересчитывает занятое место.
 * Ничего не удаляет и не переносит.
 */
export const scanAll = async ({ onProgress } = {}) => {
  const started = new Date();
  const found = { files: 0, bytes: 0, orphans: 0, missing: 0, byService: {} };
  for (const { service, category, root } of serviceRoots()) {
    let n = 0;
    const seen = new Set();
    const entries = (async function* () {
      for await (const path of walk(root)) { const st = await stat(path).catch(() => null); if (st) { seen.add(path); yield { path, st }; } }
      // Файлы, которых нет на диске, но есть в S3 (основное хранение в S3)
      let remote = []; try { remote = await primary.listRemote(root); } catch (e) { await logEvent('scan_remote_failed', 'warn', { code: e.code ?? e.message }); }
      for (const r of remote) {
        const name = basename(r.path);
        if (seen.has(r.path) || name.startsWith('.') || name.endsWith('.part')) continue;
        const { rows } = await query('SELECT uploaded_at FROM storage_objects WHERE service = $1 AND id = $2', [service, name]);
        const at = rows[0]?.uploaded_at ? new Date(rows[0].uploaded_at) : new Date();
        yield { path: r.path, st: { size: r.size, mtime: at, mtimeMs: at.getTime() } };
      }
    })();
    for await (const { path, st } of entries) {
      const id = basename(path);
      const info = await refInfo(service, id);
      const old = Date.now() - st.mtimeMs > GRACE_MS;
      const status = info.mapped && !info.referenced ? (old ? 'orphan' : 'ok') : 'ok';
      await query(
        `INSERT INTO storage_objects (service, id, category, owner_id, mime, size, status, uploaded_at, seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (service, id) DO UPDATE SET
           category = EXCLUDED.category, owner_id = COALESCE(EXCLUDED.owner_id, storage_objects.owner_id),
           mime = CASE WHEN EXCLUDED.mime <> 'application/octet-stream' THEN EXCLUDED.mime ELSE storage_objects.mime END,
           sha256 = CASE WHEN storage_objects.size <> EXCLUDED.size THEN NULL ELSE storage_objects.sha256 END,
           size = EXCLUDED.size,
           uploaded_at = LEAST(storage_objects.uploaded_at, EXCLUDED.uploaded_at),
           status = CASE WHEN storage_objects.status IN ('corrupt', 'quarantine') THEN storage_objects.status ELSE EXCLUDED.status END,
           seen_at = now()`,
        [service, id, category, info.owner ?? null, info.mime ?? DEFAULT_MIME[service] ?? 'application/octet-stream', st.size, status, st.mtime]);
      found.files += 1; found.bytes += st.size; n += 1;
      if (status === 'orphan') found.orphans += 1;
      if (n % 200 === 0) onProgress?.(found);
    }
    found.byService[service] = n;
  }
  // Не встреченные в этом проходе — файла нет на диске (кроме уже перенесённых в карантин)
  const { rowCount } = await query(
    `UPDATE storage_objects SET status = 'missing', checked_at = now() WHERE seen_at < $1 AND status IN ('ok', 'orphan', 'missing')`, [started]);
  found.missing = rowCount;
  await refreshUsage();
  await logEvent('scan', 'info', { files: found.files, bytes: found.bytes, orphans: found.orphans, missing: found.missing });
  return found;
};

/** Занятое место по категориям — из реестра (без «пропавших» и карантина). */
export const refreshUsage = async () => {
  const { rows } = await query(`SELECT category, coalesce(sum(size),0) AS bytes, count(*) AS files FROM storage_objects WHERE status IN ('ok','orphan','corrupt') GROUP BY category`);
  setUsage(rows);
  // Вложения мессенджера лежат в базе: считаем отдельно и добавляем как категории messenger / messenger_voice.
  const { rows: a } = await query(
    `SELECT CASE WHEN mime ~ '^(audio|video)/' THEN 'messenger_voice' ELSE 'messenger' END AS category, coalesce(sum(size),0) AS bytes, count(*) AS files FROM attachments GROUP BY 1`);
  for (const r of a) { const cur = usage.get(r.category) ?? { bytes: 0, files: 0 }; usage.set(r.category, { bytes: cur.bytes + Number(r.bytes), files: cur.files + Number(r.files) }); }
  await loadQuotas().catch(() => {});
};

/** Порция вычисления SHA-256 для объектов без отпечатка / с давней проверкой. Фоновая, ограниченная. */
export const hashPending = async (limit = 20) => {
  const { rows } = await query(
    `SELECT service, id FROM storage_objects WHERE status IN ('ok','orphan') AND (sha256 IS NULL OR checked_at IS NULL OR checked_at < now() - interval '14 days')
      ORDER BY checked_at NULLS FIRST LIMIT $1`, [limit]);
  let ok = 0; let bad = 0;
  for (const r of rows) {
    const path = await locateFile(r.service, r.id);
    if (!path) { await query(`UPDATE storage_objects SET status = 'missing', checked_at = now() WHERE service = $1 AND id = $2`, [r.service, r.id]); continue; }
    const sum = await sha256File(path).catch(() => null);
    const { rows: cur } = await query('SELECT sha256 FROM storage_objects WHERE service = $1 AND id = $2', [r.service, r.id]);
    if (!sum) continue;
    if (cur[0]?.sha256 && cur[0].sha256 !== sum) {
      // Отпечаток изменился при том же размере: либо файл заменили (обложка), либо он повреждён. Файлы сервисов неизменяемы
      // после записи; запись через слой квот сбрасывает отпечаток. Значит, расхождение — повреждение.
      await query(`UPDATE storage_objects SET status = 'corrupt', checked_at = now() WHERE service = $1 AND id = $2`, [r.service, r.id]);
      await logEvent('object_corrupt', 'critical', { service: r.service, id: r.id });
      bad += 1;
    } else {
      await query(`UPDATE storage_objects SET sha256 = $3, checked_at = now() WHERE service = $1 AND id = $2`, [r.service, r.id, sum]);
      ok += 1;
    }
  }
  return { checked: rows.length, ok, corrupt: bad };
};

/* ─── Карантин ─────────────────────────────────────────────────────── */

/**
 * Перенос осиротевших файлов в карантин. Перед переносом связь перепроверяется заново; файл переносится
 * (rename), а не удаляется, и может быть возвращён. Возвращает список перенесённых.
 */
export const quarantineOrphans = async (actorId, { dryRun = true, limit = 200 } = {}) => {
  const { rows } = await query(`SELECT service, id, size FROM storage_objects WHERE status = 'orphan' AND uploaded_at < now() - interval '1 day' LIMIT $1`, [limit]);
  const plan = []; const moved = [];
  for (const r of rows) {
    const info = await refInfo(r.service, r.id);
    if (info.referenced) { await query(`UPDATE storage_objects SET status = 'ok' WHERE service = $1 AND id = $2`, [r.service, r.id]); continue; }
    plan.push(r);
  }
  if (dryRun) return { dryRun: true, count: plan.length, bytes: plan.reduce((s, r) => s + Number(r.size), 0), items: plan.slice(0, 50) };
  const days = snapshot()?.settings.quarantineDays ?? 14;
  for (const r of plan) {
    const root = serviceRoots().find((s) => s.service === r.service)?.root;
    const from = await locateFile(r.service, r.id);
    if (!from) continue;
    const to = join(quarantineRoot(), r.service, r.id);
    await mkdir(join(quarantineRoot(), r.service), { recursive: true, mode: 0o700 });
    await moveFile(from, to);
    await primary.removeRemote(from).catch(() => {});   // в S3 копию не оставляем: возврат из карантина загрузит её заново
    await query(`UPDATE storage_objects SET status = 'quarantine' WHERE service = $1 AND id = $2`, [r.service, r.id]);
    await query(
      `INSERT INTO storage_quarantine (service, object_id, orig_path, quar_path, size, reason, purge_after) VALUES ($1,$2,$3,$4,$5,'нет ссылок в таблицах сервиса', now() + ($6 || ' days')::interval)`,
      [r.service, r.id, relative(root, from), to, r.size, String(days)]);
    moved.push(r);
  }
  await logEvent('quarantine', 'info', { moved: moved.length }, actorId);
  return { dryRun: false, moved: moved.length };
};

export const restoreFromQuarantine = async (actorId, quarId) => {
  const { rows } = await query(`SELECT * FROM storage_quarantine WHERE id = $1 AND state = 'held'`, [quarId]);
  const q = rows[0]; if (!q) return { error: 'not_found' };
  const root = serviceRoots().find((s) => s.service === q.service)?.root;
  if (!root) return { error: 'bad_service' };
  const to = join(root, q.orig_path);
  await mkdir(join(to, '..'), { recursive: true });
  await moveFile(q.quar_path, to);
  await primary.afterWrite(to);
  await query(`UPDATE storage_quarantine SET state = 'restored' WHERE id = $1`, [quarId]);
  await query(`UPDATE storage_objects SET status = 'ok', seen_at = now() WHERE service = $1 AND id = $2`, [q.service, q.object_id]);
  await logEvent('quarantine_restore', 'info', { service: q.service, id: q.object_id }, actorId);
  return { ok: true };
};

/** Окончательное удаление: только после срока и только если ссылок всё ещё нет. */
export const purgeQuarantine = async () => {
  const { rows } = await query(`SELECT * FROM storage_quarantine WHERE state = 'held' AND purge_after < now() LIMIT 100`);
  let purged = 0;
  for (const q of rows) {
    const info = await refInfo(q.service, q.object_id);
    if (info.referenced) { // ссылка появилась — возвращаем, а не удаляем
      await restoreFromQuarantine(null, q.id).catch(() => {});
      continue;
    }
    await rm(q.quar_path, { force: true });
    await query(`UPDATE storage_quarantine SET state = 'purged' WHERE id = $1`, [q.id]);
    await query(`DELETE FROM storage_objects WHERE service = $1 AND id = $2 AND status = 'quarantine'`, [q.service, q.object_id]);
    purged += 1;
  }
  if (purged) await logEvent('quarantine_purge', 'info', { purged });
  return purged;
};

/* ─── Сводка для панели ────────────────────────────────────────────── */

export const stats = async () => {
  const cap = await capacity();
  const st = snapshot();
  const used = [...usage.values()].reduce((s, u) => s + u.bytes, 0);
  const files = [...usage.values()].reduce((s, u) => s + u.files, 0);
  const pct = cap.total ? (used / cap.total) * 100 : 0;
  const { rows: byStatus } = await query('SELECT status, count(*)::int AS n FROM storage_objects GROUP BY status');
  const { rows: q } = await query(`SELECT count(*)::int AS n, coalesce(sum(size),0)::bigint AS b FROM storage_quarantine WHERE state = 'held'`);
  return {
    capacity: { ...cap, used, files, pct: Math.round(pct * 10) / 10, level: levelFor(pct, st?.settings.thresholds ?? { warn: 70, critical: 85, block: 95, full: 100 }) },
    categories: CATEGORIES.map((c) => ({ category: c, bytes: usage.get(c)?.bytes ?? 0, files: usage.get(c)?.files ?? 0 })),
    objects: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    quarantine: { held: q[0].n, bytes: Number(q[0].b) },
  };
};
