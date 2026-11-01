/**
 * Музыка: файлы есть, записей в каталоге нет.
 *
 * Бывает после восстановления базы из старой копии или потери таблицы `music_tracks`: файлы `trk-…` лежат в хранилище
 * (на диске или в S3), а Sky Music их не показывает, потому что каталог — это строки в базе. Обычное «Восстановление раздела»
 * возвращает только то, на что каталог ссылается, поэтому таких файлов не видит.
 *
 * Здесь по реестру Sky Storage (`storage_objects`, его обновляет сканирование) находим файлы без строки и собираем строку заново:
 * название, исполнитель, альбом, жанр, год — из тегов ID3 внутри самого файла, длительность — оценка по заголовку MP3, размер — настоящий;
 * владелец — из реестра, если он там сохранился. Обложка/видеофон с тем же хвостом id подключаются, если файл есть.
 * Ничего не удаляется и не перезаписывается: уже существующие записи не трогаем.
 */
import { query } from './db.mjs';
import { serviceRoots, locateFile } from './skystoragelimits.mjs';
import { scanAll } from './skystorageindex.mjs';
import { openDecryptedRangeStream, plaintextSizeOf } from './mediacrypto.mjs';
import { logEvent, newId } from './skystoragestate.mjs';

const readRange = async (path, start, end) => {
  const parts = [];
  for await (const c of openDecryptedRangeStream(path, { start, end })) parts.push(c);
  return Buffer.concat(parts);
};

const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

const decodeText = (buf) => {
  if (!buf.length) return '';
  const enc = buf[0]; const body = buf.subarray(1);
  let s;
  try {
    if (enc === 0) s = body.toString('latin1');
    else if (enc === 3) s = body.toString('utf8');
    else if (enc === 1 || enc === 2) {
      if (enc === 1 && body[0] === 0xff && body[1] === 0xfe) s = body.subarray(2).toString('utf16le');
      else if (enc === 1 && body[0] === 0xfe && body[1] === 0xff) s = Buffer.from(body.subarray(2)).swap16().toString('utf16le');
      else if (enc === 2) s = Buffer.from(body).swap16().toString('utf16le');
      else s = body.toString('utf16le');
    } else s = body.toString('utf8');
  } catch { s = ''; }
  // Кириллица в тегах старых плееров часто записана как cp1251 под видом latin1 — признаки: нет настоящей кириллицы, но много символов 0xC0–0xFF.
  if (enc === 0 && /[À-ÿ]{3,}/.test(s) && !/[Ѐ-ӿ]/.test(s)) {
    try { s = new TextDecoder('windows-1251').decode(body); } catch { /* оставляем как есть */ }
  }
  return s.replace(/\0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
};

/** Теги ID3v2 (2.2–2.4) из начала файла. */
export const parseId3 = (b) => {
  const out = {};
  if (b.length < 10 || b.toString('latin1', 0, 3) !== 'ID3') return out;
  const ver = b[3]; const size = synchsafe(b, 6);
  const idLen = ver === 2 ? 3 : 4; const hdr = ver === 2 ? 6 : 10;
  let o = 10; const end = Math.min(b.length, 10 + size);
  while (o + hdr <= end) {
    const id = b.toString('latin1', o, o + idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let len;
    if (ver === 2) len = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
    else if (ver === 4) len = synchsafe(b, o + 4);
    else len = b.readUInt32BE(o + 4);
    if (len <= 0 || o + hdr + len > b.length) break;
    const data = b.subarray(o + hdr, o + hdr + len);
    const key = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre', TYER: 'year', TYE: 'year', TDRC: 'year' }[id];
    if (key && !out[key]) out[key] = decodeText(data);
    o += hdr + len;
  }
  if (out.genre) out.genre = out.genre.replace(/^\(\d+\)/, '').trim();
  if (out.year) { const y = parseInt(String(out.year).slice(0, 4), 10); out.year = y >= 1900 && y <= 2100 ? y : null; }
  return out;
};

const BITRATES = { // MPEG1 Layer III
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};
/** Оценка длительности MP3 по первому кадру (CBR). Для VBR — приблизительно; 0, если не распознали. */
export const estimateDuration = (head, totalBytes) => {
  const start = head.toString('latin1', 0, 3) === 'ID3' && head.length > 10 ? 10 + synchsafe(head, 6) : 0;
  for (let i = start; i < Math.min(head.length - 4, start + 4096); i += 1) {
    if (head[i] !== 0xff || (head[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (head[i + 1] >> 3) & 3; const layer = (head[i + 1] >> 1) & 3; const br = (head[i + 2] >> 4) & 15;
    if (version === 1 || layer !== 1 || br === 0 || br === 15) continue;
    const kbps = version === 3 ? BITRATES[1][br] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][br];
    if (!kbps) continue;
    const sec = Math.round(((totalBytes - start) * 8) / (kbps * 1000));
    return sec > 0 && sec < 6 * 3600 ? sec : 0;
  }
  return 0;
};

const sniffMime = (head) => {
  if (head.toString('latin1', 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (head.toString('latin1', 0, 4) === 'fLaC') return 'audio/flac';
  if (head.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
  if (head.toString('latin1', 0, 4) === 'RIFF') return 'audio/wav';
  if (head.toString('latin1', 4, 8) === 'ftyp') return 'audio/mp4';
  return null;
};

/** Файлы музыки в реестре, на которые не ссылается ни одна запись каталога. */
export const findOrphans = async (limit = 5000) => {
  const { rows } = await query(
    `SELECT o.id, o.size, o.mime, o.owner_id, o.uploaded_at
       FROM storage_objects o
      WHERE o.service = 'music' AND o.id LIKE 'trk-%' AND o.status IN ('ok','orphan')
        AND NOT EXISTS (SELECT 1 FROM music_tracks t WHERE t.id = o.id OR t.audio_file = o.id)
      ORDER BY o.uploaded_at LIMIT $1`, [limit]);
  return rows;
};

/** Только чтение: сколько файлов без записи (реестр должен быть свежим — см. rescan). */
export const orphanReport = async ({ rescan = false } = {}) => {
  if (rescan) await scanAll();
  const rows = await findOrphans(100000);
  const bytes = rows.reduce((n, r) => n + Number(r.size || 0), 0);
  return { count: rows.length, bytes, sample: rows.slice(0, 20).map((r) => ({ id: r.id, size: Number(r.size) })) };
};

const STATUSES = new Set(['published', 'private', 'pending']);

/** Собрать недостающие записи каталога по файлам. status — в каком статусе появятся треки. */
let running = false;
export const rebuildCatalog = async (actorId, { status = 'published', rescan = true } = {}) => {
  if (!STATUSES.has(status)) return { error: 'bad_status' };
  if (running) return { error: 'busy' };
  running = true;
  try { return await rebuildInner(actorId, status, rescan); } finally { running = false; }
};

const rebuildInner = async (actorId, status, rescan) => {
  if (rescan) await scanAll();
  const orphans = await findOrphans(100000);
  const out = { found: orphans.length, created: 0, withTags: 0, noTags: 0, covers: 0, ownerKept: 0, failed: [] };
  for (const o of orphans) {
    try {
      const path = await locateFile('music', o.id);
      if (!path) { out.failed.push(`${o.id}: файл не найден`); continue; }
      const size = (await plaintextSizeOf(path)) ?? Number(o.size) ?? 0;
      if (!size) { out.failed.push(`${o.id}: пустой файл`); continue; }
      const head = await readRange(path, 0, Math.min(size, 256 * 1024) - 1);
      const tags = parseId3(head);
      const mime = sniffMime(head) ?? (String(o.mime).startsWith('audio/') && o.mime !== 'audio/octet-stream' ? o.mime : 'audio/mpeg');
      const dur = mime === 'audio/mpeg' ? estimateDuration(head, size) : 0;
      const sfx = o.id.slice(4);
      const hasCover = !!(await locateFile('music', `cov-${sfx}`).catch(() => null));
      const hasVideo = !!(await locateFile('music', `vid-${sfx}`).catch(() => null));
      let owner = null;
      if (o.owner_id) { const { rows } = await query('SELECT 1 FROM profiles WHERE id = $1', [o.owner_id]); if (rows[0]) { owner = o.owner_id; out.ownerKept += 1; } }
      const title = tags.title || `Трек ${sfx.slice(0, 6)}`;
      const artist = tags.artist || 'Неизвестный исполнитель';
      const r = await query(
        `INSERT INTO music_tracks (id, owner_id, title, artist, album, genre, year, duration_sec, mime, bytes, has_cover, cover_mime, has_video, video_mime, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
         ON CONFLICT (id) DO NOTHING`,
        [o.id, owner, title, artist, tags.album ?? '', tags.genre ?? '', tags.year ?? null, dur, mime, size,
          hasCover, hasCover ? 'image/jpeg' : null, hasVideo, hasVideo ? 'video/mp4' : null, status, o.uploaded_at ?? new Date()]);
      if (r.rowCount) { out.created += 1; if (tags.title) out.withTags += 1; else out.noTags += 1; if (hasCover) out.covers += 1; }
    } catch (e) { out.failed.push(`${o.id}: ${e.code ?? e.message}`); }
  }
  await logEvent('restore', out.failed.length ? 'critical' : 'warn', { id: newId('rb'), group: 'music_rebuild', created: out.created, found: out.found, failed: out.failed.length }, actorId);
  return { ok: true, status, ...out, failed: out.failed.slice(0, 50) };
};
