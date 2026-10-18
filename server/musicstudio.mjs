/**
 * Sky Music Studio: кабинет владельца карточки музыканта.
 * Работает на существующих сущностях: карточка (`music_artist_cards.owner_id`), трек (`music_tracks`), файл (`musicstore`).
 * Редактировать можно только свои (загруженные тобой) треки, привязанные к твоей карточке; чужие треки на карточке — только чтение.
 * Замена аудио: новый файл пишется ОТДЕЛЬНО, затем одна транзакция переключает трек на него; прежний файл остаётся версией
 * и возвращается откатом. Опубликованный трек после замены уходит на повторную проверку (звук мог измениться).
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { saveBytes, remove as removeFile } from './musicstore.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { clean } from './gocore.mjs';

export const MAX_MP3_BYTES = 30 * 1024 * 1024;
const KEEP_VERSIONS = 3;                       // текущая + две предыдущие

/** Настоящая проверка MP3 по содержимому: необязательный тег ID3v2, затем корректный заголовок кадра MPEG Audio. */
export const checkMp3 = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 1024) return { error: 'unsupported_type' };
  let pos = 0;
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') {
    if (buf.length < 10) return { error: 'unsupported_type' };
    const sz = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    if ((buf[6] | buf[7] | buf[8] | buf[9]) & 0x80) return { error: 'unsupported_type' };
    pos = 10 + sz + ((buf[5] & 0x10) ? 10 : 0);
  }
  // кадр может не начинаться ровно за тегом (нули-заполнение) — ищем в небольшом окне
  for (let i = pos; i < Math.min(buf.length - 4, pos + 4096); i += 1) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[i + 1] >> 3) & 3; const layer = (buf[i + 1] >> 1) & 3;
    const br = (buf[i + 2] >> 4) & 15; const sr = (buf[i + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || br === 0 || br === 15 || sr === 3) continue;
    return { ok: true, mime: 'audio/mpeg' };
  }
  return { error: 'unsupported_type' };
};

const ev = (cardId, trackId, actor, action, detail = {}) =>
  query('INSERT INTO music_studio_events (card_id, track_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [cardId, trackId, actor, action, JSON.stringify(detail)]).catch(() => {});

const trackRow = (t) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album, genre: t.genre, year: t.year, status: t.status, bytes: Number(t.bytes), plays: Number(t.plays ?? 0), hasCover: t.has_cover, explicit: t.explicit === true, updatedAt: t.updated_at, versions: Number(t.versions ?? 0) });

/** Мои карточки: только подтверждённое владение. */
export const myCards = async (me) => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.bio, c.genres,
            (SELECT count(*) FROM music_tracks t WHERE t.artist_card_id=c.id AND t.status='published')::int AS published,
            (SELECT count(*) FROM music_tracks t WHERE t.artist_card_id=c.id AND t.owner_id=$1)::int AS mine
       FROM music_artist_cards c WHERE c.owner_id=$1 AND c.merged_into IS NULL AND NOT c.hidden ORDER BY c.name`, [me]);
  return { cards: rows.map((c) => ({ id: c.id, name: c.name, genres: c.genres ? c.genres.split(',').filter(Boolean) : [], published: c.published, mine: c.mine })) };
};

const ownCard = async (me, cardId) => (await query('SELECT id, name FROM music_artist_cards WHERE id=$1 AND owner_id=$2 AND merged_into IS NULL AND NOT hidden', [String(cardId ?? ''), me])).rows[0] ?? null;

export const cardTracks = async (me, cardId, q = {}) => {
  const card = await ownCard(me, cardId); if (!card) return { error: 'not_found' };
  const lim = Math.min(100, Math.max(1, Number(q.limit) || 50)); const off = Math.max(0, Number(q.offset) || 0);
  const st = ['published', 'private', 'pending', 'rejected'].includes(q.status) ? q.status : null;
  const { rows } = await query(
    `SELECT t.*, (SELECT count(*) FROM music_track_versions v WHERE v.track_id=t.id)::int AS versions FROM music_tracks t
      WHERE t.artist_card_id=$1 AND t.owner_id=$2 AND ($3::text IS NULL OR t.status=$3) ORDER BY t.updated_at DESC LIMIT $4 OFFSET $5`, [card.id, me, st, lim, off]);
  const others = Number((await query("SELECT count(*)::int c FROM music_tracks WHERE artist_card_id=$1 AND owner_id IS DISTINCT FROM $2 AND status='published'", [card.id, me])).rows[0].c);
  return { card, tracks: rows.map(trackRow), othersPublished: others, limit: lim, offset: off };
};

const myTrack = async (me, trackId, client = null, lock = false) => {
  const q = client ?? { query };
  const t = (await q.query(`SELECT t.*, c.owner_id AS card_owner FROM music_tracks t LEFT JOIN music_artist_cards c ON c.id=t.artist_card_id WHERE t.id=$1${lock ? ' FOR UPDATE OF t' : ''}`, [String(trackId ?? '')])).rows[0];
  if (!t || t.owner_id !== me || t.card_owner !== me) return null;     // чужой трек и трек не на моей карточке — «нет такого»
  return t;
};

export const versions = async (me, trackId) => {
  const t = await myTrack(me, trackId); if (!t) return { error: 'not_found' };
  const { rows } = await query('SELECT version, bytes, mime, note, created_at, is_current FROM music_track_versions WHERE track_id=$1 ORDER BY version DESC', [t.id]);
  return { versions: rows.map((v) => ({ version: v.version, bytes: Number(v.bytes), mime: v.mime, note: v.note, at: v.created_at, current: v.is_current })), status: t.status };
};

export const replaceAudio = async (me, trackId, buf, noteRaw) => {
  const chk = checkMp3(buf); if (chk.error) return chk;
  if (buf.length > MAX_MP3_BYTES) return { error: 'file_too_large' };
  const pre = await myTrack(me, trackId); if (!pre) return { error: 'not_found' };
  const newId = `trk-${crypto.randomUUID()}`;
  try { await saveBytes(newId, buf); } catch (e) { await removeFile(newId).catch(() => {}); return { error: e?.code === 'storage_provider_unavailable' ? 'storage_provider_unavailable' : 'storage_failed' }; }
  const note = clean(noteRaw, 200);
  const client = await pool.connect();
  let dropped = [];
  try {
    await client.query('BEGIN');
    const t = await myTrack(me, trackId, client, true);
    if (!t) { await client.query('ROLLBACK'); await removeFile(newId).catch(() => {}); return { error: 'not_found' }; }
    const curFile = t.audio_file || t.id;
    const have = Number((await client.query('SELECT count(*)::int c FROM music_track_versions WHERE track_id=$1', [t.id])).rows[0].c);
    if (!have) await client.query('INSERT INTO music_track_versions (file_id, track_id, version, bytes, mime, note, created_by, is_current) VALUES ($1,$2,1,$3,$4,$5,$6,true)', [curFile, t.id, t.bytes, t.mime, 'Первая загрузка', t.owner_id]);
    const next = Number((await client.query('SELECT COALESCE(MAX(version),0)+1 AS n FROM music_track_versions WHERE track_id=$1', [t.id])).rows[0].n);
    await client.query('UPDATE music_track_versions SET is_current=false, status_when_replaced=$2 WHERE track_id=$1 AND is_current', [t.id, t.status]);
    await client.query('INSERT INTO music_track_versions (file_id, track_id, version, bytes, mime, note, created_by, is_current) VALUES ($1,$2,$3,$4,$5,$6,$7,true)', [newId, t.id, next, buf.length, chk.mime, note, me]);
    const toReview = t.status === 'published';
    await client.query(`UPDATE music_tracks SET audio_file=$2, bytes=$3, mime=$4${toReview ? ", status='pending'" : ''}, updated_at=now() WHERE id=$1`, [t.id, newId, buf.length, chk.mime]);
    // хранится не больше KEEP_VERSIONS: самые старые не текущие уходят
    const old = (await client.query('SELECT file_id FROM music_track_versions WHERE track_id=$1 AND NOT is_current ORDER BY version DESC OFFSET $2', [t.id, KEEP_VERSIONS - 1])).rows;
    for (const o of old) { await client.query('DELETE FROM music_track_versions WHERE file_id=$1', [o.file_id]); dropped.push(o.file_id); }
    await client.query('INSERT INTO music_studio_events (card_id, track_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [t.artist_card_id, t.id, me, 'audio_replaced', JSON.stringify({ version: next, bytes: buf.length, toReview })]);
    await client.query('COMMIT');
    for (const f of dropped) if (f !== t.id) await removeFile(f).catch(() => {});
    if (toReview) void notifyStaff('content', { title: 'Трек на повторной проверке', body: 'Владелец заменил звук опубликованного трека', dedupe: `mstudio:${t.id}:${next}`, except: me }).catch(() => {});
    return { ok: true, version: next, status: toReview ? 'pending' : t.status, backToReview: toReview };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await removeFile(newId).catch(() => {});
    return { error: 'replace_failed' };
  } finally { client.release(); }
};

export const rollback = async (me, trackId, version) => {
  const v = Math.floor(Number(version)); if (!Number.isFinite(v) || v < 1) return { error: 'bad_version' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await myTrack(me, trackId, client, true);
    if (!t) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    const tv = (await client.query('SELECT * FROM music_track_versions WHERE track_id=$1 AND version=$2 FOR UPDATE', [t.id, v])).rows[0];
    if (!tv) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (tv.is_current) { await client.query('ROLLBACK'); return { error: 'already_current' }; }
    const cur = (await client.query('SELECT version FROM music_track_versions WHERE track_id=$1 AND is_current', [t.id])).rows[0];
    await client.query('UPDATE music_track_versions SET is_current=false, status_when_replaced=$2 WHERE track_id=$1 AND is_current', [t.id, t.status]);
    await client.query('UPDATE music_track_versions SET is_current=true WHERE file_id=$1', [tv.file_id]);
    // откат к версии, которая уже была опубликована, возвращает публикацию; иначе статус не повышается
    const restore = t.status === 'pending' && tv.status_when_replaced === 'published';
    await client.query(`UPDATE music_tracks SET audio_file=$2, bytes=$3, mime=$4${restore ? ", status='published'" : ''}, updated_at=now() WHERE id=$1`, [t.id, tv.file_id === t.id ? null : tv.file_id, tv.bytes, tv.mime]);
    await client.query('INSERT INTO music_studio_events (card_id, track_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [t.artist_card_id, t.id, me, 'audio_rollback', JSON.stringify({ from: cur?.version ?? null, to: v, restored: restore })]);
    await client.query('COMMIT');
    return { ok: true, version: v, status: restore ? 'published' : t.status };
  } catch { await client.query('ROLLBACK').catch(() => {}); return { error: 'rollback_failed' }; } finally { client.release(); }
};

export const trackEvents = async (me, trackId) => {
  const t = await myTrack(me, trackId); if (!t) return { error: 'not_found' };
  const { rows } = await query('SELECT id, actor_id, action, detail, at FROM music_studio_events WHERE track_id=$1 ORDER BY id DESC LIMIT 50', [t.id]);
  return { events: rows };
};

/** Файлы версий, чьи треки уже удалены (удаление трека стирает только его основной файл). */
export const sweepVersionFiles = async () => {
  const { rows } = await query('DELETE FROM music_track_versions v WHERE NOT EXISTS (SELECT 1 FROM music_tracks t WHERE t.id=v.track_id) RETURNING file_id, track_id');
  for (const r of rows) if (r.file_id !== r.track_id) await removeFile(r.file_id).catch(() => {});
  return rows.length;
};
