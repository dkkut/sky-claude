/**
 * Музыка: данные и права.
 *
 * Каждая функция сама решает, можно ли этому человеку то, что он
 * просит. Клиент здесь не участвует: он присылает только
 * идентификаторы, а кому что видно — знает сервер.
 *
 * Правила простые и одинаковые везде:
 *   • трек виден всем, если опубликован; иначе — только владельцу;
 *   • плейлист меняет только владелец, читают — владелец и все, если он
 *     сделал плейлист открытым;
 *   • избранное, история и позиция прослушивания — строго свои.
 */
import crypto from 'node:crypto';
import { retentionOf } from './storagequota.mjs';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can } from './admin.mjs';
import { sharedTrackInSession } from './watchgrant.mjs';
import { sharedDirectly } from './storageshare.mjs';

const newId = (p) => `${p}-${crypto.randomUUID()}`;

const MAX_TITLE = 200;
const MAX_ARTIST = 200;
const MAX_LYRICS = 20000;
const MAX_PLAYLIST_NAME = 120;
/** Столько плейлистов на человека — верхний предел, а не рекомендация. */
const MAX_PLAYLISTS = 300;
const MAX_ITEMS_PER_PLAYLIST = 2000;

/** Обрезка и очистка от управляющих символов: в названиях им не место. */
const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/* ─── Представление наружу ─────────────────────────────────────────── */

/**
 * Что уходит клиенту. Служебных полей здесь нет: ни путей на диске, ни
 * внутренних отметок — только то, что нужно показать.
 */
export const toTrack = (row) => ({
  ...retentionOf(row),
  id: row.id,
  title: row.title,
  artist: row.artist,
  album: row.album || undefined,
  genre: row.genre || undefined,
  year: row.year ?? undefined,
  duration: row.duration_sec ?? 0,
  hasCover: Boolean(row.has_cover),
  status: row.status,
  plays: Number(row.plays ?? 0),
  own: row.own === true || undefined,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  // Причину отказа видит только владелец: это разговор с ним, а не
  // сведения о треке.
  rejectReason: row.own === true && row.reject_reason
    ? (decryptContent(row.reject_reason) ?? undefined) : undefined,
  submittedAt: row.own === true ? (row.submitted_at?.toISOString?.() ?? undefined) : undefined,
});

const toPlaylist = (row, tracks) => ({
  id: row.id,
  name: decryptContent(row.name) ?? '',
  isPublic: row.is_public,
  own: row.own === true || undefined,
  count: Number(row.count ?? (tracks ? tracks.length : 0)),
  updatedAt: row.updated_at?.toISOString?.() ?? undefined,
  tracks,
});

/* ─── Доступ к треку ───────────────────────────────────────────────── */

/** Строка трека, если этот человек имеет право её видеть. */
export const visibleTrack = async (trackId, viewerId) => {
  const { rows } = await query('SELECT * FROM music_tracks WHERE id = $1', [String(trackId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  if (row.status === 'published') return row;
  if (row.owner_id && row.owner_id === viewerId) return { ...row, own: true };
  if (await can(viewerId, 'content')) return row;

  if (row.status === 'private') {
    // Слушательский аналог sharedInSession у кино: участник живого
    // listen-сеанса, в котором звучит именно этот трек.
    if (await sharedTrackInSession(row.id, viewerId)) return { ...row, viaSession: true };
    // Прямой доступ («Поделиться») — не зависит от сеанса.
    const share = await sharedDirectly('track', row.id, viewerId);
    if (share.view) return { ...row, viaShare: true, canDownload: share.download };
  }

  return null;
};

/* ─── Каталог и поиск ──────────────────────────────────────────────── */

/**
 * Каталог: опубликованное плюс своё. Поиск идёт параметром, а не
 * склейкой строки, поэтому кавычка в запросе — это просто кавычка.
 */
export const listTracks = async (viewerId, { q, limit, offset, mine } = {}) => {
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const args = [viewerId, lim, off];
  const where = [mine ? 'owner_id = $1' : "(status = 'published' OR owner_id = $1)"];

  const needle = text(q, 100).toLowerCase();
  if (needle) {
    // ESCAPE обязателен: без него _ и % из запроса стали бы шаблоном
    // и «%» вернул бы весь каталог одним символом.
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`(lower(title) LIKE $${args.length} ESCAPE '\\'
              OR lower(artist) LIKE $${args.length} ESCAPE '\\'
              OR lower(album)  LIKE $${args.length} ESCAPE '\\')`);
  }

  const { rows } = await query(
    `SELECT *, owner_id = $1 AS own FROM music_tracks
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    args,
  );
  return rows.map(toTrack);
};

export const readTrack = async (trackId, viewerId) => {
  const row = await visibleTrack(trackId, viewerId);
  return row ? toTrack({ ...row, own: row.owner_id === viewerId }) : null;
};

/* ─── Загрузка ─────────────────────────────────────────────────────── */

/**
 * Запись о треке заводится до того, как файл ляжет на диск: файл
 * называется по идентификатору, а его выдаёт база.
 */
export const createTrack = async (ownerId, meta) => {
  const title = text(meta.title, MAX_TITLE);
  const artist = text(meta.artist, MAX_ARTIST);
  if (!title || !artist) return { error: 'invalid_meta' };

  const id = newId('trk');
  await query(
    `INSERT INTO music_tracks
       (id, owner_id, title, artist, album, genre, year, duration_sec, mime, bytes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'private')`,
    [id, ownerId, title, artist, text(meta.album, MAX_TITLE), text(meta.genre, 60),
      Number.isFinite(Number(meta.year)) ? Number(meta.year) : null,
      Math.max(0, Math.min(86400, Number(meta.duration) || 0)),
      String(meta.mime ?? 'audio/mpeg'), Math.max(0, Number(meta.bytes) || 0)],
  );
  return { id };
};

/** Размер и тип проставляются по факту записи, а не по словам клиента. */
export const finishTrack = async (trackId, ownerId, { bytes, mime }) => {
  await query(
    'UPDATE music_tracks SET bytes = $3, mime = $4, updated_at = now() WHERE id = $1 AND owner_id = $2',
    [trackId, ownerId, Number(bytes) || 0, String(mime)],
  );
};

/** Владелец правит своё; чужое не правит никто, включая администратора. */
export const updateTrack = async (trackId, ownerId, patch) => {
  const { rows } = await query('SELECT owner_id FROM music_tracks WHERE id = $1', [String(trackId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };

  const sets = [];
  const args = [trackId];
  const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };

  if (patch.title !== undefined) put('title', text(patch.title, MAX_TITLE));
  if (patch.artist !== undefined) put('artist', text(patch.artist, MAX_ARTIST));
  if (patch.album !== undefined) put('album', text(patch.album, MAX_TITLE));
  if (patch.genre !== undefined) put('genre', text(patch.genre, 60));
  if (patch.lyrics !== undefined) {
    const l = String(patch.lyrics ?? '').slice(0, MAX_LYRICS);
    put('lyrics', l ? encryptContent(l) : null);
  }
  if (patch.status !== undefined) {
    // Снять с публикации или отозвать заявку владелец может сам.
    // Выложить в общий каталог — нет: туда трек попадает только через
    // проверку, а 'pending' и 'rejected' ставит она же.
    const s = String(patch.status);
    if (s === 'private') { put('status', s); put('submitted_at', null); }
    else if (s === 'published' && await can(ownerId, 'content')) { put('status', s); }
    else if (s === 'published') return { error: 'needs_review' };
    else return { error: 'invalid_status' };
  }
  if (sets.length === 0) return { ok: true };

  await query(`UPDATE music_tracks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  return { ok: true };
};

/* ─── Проверка перед публикацией ───────────────────────────────────── */

/** Максимум причины отказа: это короткое объяснение, а не переписка. */
const MAX_REASON = 500;

/**
 * Владелец отправляет свой трек на проверку. Отправить можно закрытый
 * или отклонённый — отклонённый после правок идёт по тому же пути.
 */
export const submitTrack = async (trackId, ownerId) => {
  const { rows } = await query(
    'SELECT owner_id, status FROM music_tracks WHERE id = $1', [String(trackId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.owner_id !== ownerId) return { error: 'not_allowed' };
  if (row.status === 'pending') return { error: 'already_pending' };
  if (row.status === 'published') return { error: 'already_published' };

  await query(
    `UPDATE music_tracks
        SET status = 'pending', submitted_at = now(),
            reject_reason = NULL, moderated_at = NULL, moderated_by = NULL,
            updated_at = now()
      WHERE id = $1`,
    [trackId],
  );
  return { ok: true };
};

/** Очередь проверки. Только для администратора. */
export const moderationQueue = async (adminId, { limit } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    `SELECT t.*, p.username AS owner_name
       FROM music_tracks t
       LEFT JOIN profiles p ON p.id = t.owner_id
      WHERE t.status = 'pending'
      ORDER BY t.submitted_at ASC NULLS LAST
      LIMIT $1`,
    [lim],
  );
  return {
    tracks: rows.map((r) => ({
      ...toTrack(r),
      ownerName: r.owner_name ?? undefined,
      submittedAt: r.submitted_at?.toISOString?.() ?? undefined,
    })),
  };
};

/**
 * Решение по заявке. Принять — трек уходит в общий каталог; отклонить —
 * возвращается владельцу с причиной.
 */
export const moderateTrack = async (trackId, adminId, { approve, reason } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status FROM music_tracks WHERE id = $1', [String(trackId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].status !== 'pending') return { error: 'not_pending' };

  if (approve) {
    await query(
      `UPDATE music_tracks
          SET status = 'published', moderated_at = now(), moderated_by = $2,
              reject_reason = NULL, updated_at = now()
        WHERE id = $1`,
      [trackId, adminId],
    );
    return { ok: true, status: 'published' };
  }

  const why = text(reason, MAX_REASON);
  await query(
    `UPDATE music_tracks
        SET status = 'rejected', moderated_at = now(), moderated_by = $2,
            reject_reason = $3, updated_at = now()
      WHERE id = $1`,
    [trackId, adminId, why ? encryptContent(why) : null],
  );
  return { ok: true, status: 'rejected' };
};

export const deleteTrack = async (trackId, actorId) => {
  const { rows } = await query('SELECT owner_id FROM music_tracks WHERE id = $1', [String(trackId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const owner = rows[0].owner_id === actorId;
  if (!owner && !(await can(actorId, 'content'))) return { error: 'not_allowed' };
  await query('DELETE FROM music_tracks WHERE id = $1', [trackId]);
  return { ok: true };
};

export const setCover = async (trackId, ownerId, mime) => {
  const { rowCount } = await query(
    'UPDATE music_tracks SET has_cover = TRUE, cover_mime = $3, updated_at = now() WHERE id = $1 AND owner_id = $2',
    [trackId, ownerId, String(mime)],
  );
  return rowCount > 0;
};

/** Счётчик прослушиваний. Отдельно от истории: он общий, она личная. */
export const countPlay = async (trackId) => {
  await query('UPDATE music_tracks SET plays = plays + 1 WHERE id = $1', [String(trackId ?? '')]);
};

/* ─── Тексты песен ─────────────────────────────────────────────────── */

export const readLyrics = async (trackId, viewerId) => {
  const row = await visibleTrack(trackId, viewerId);
  if (!row) return null;
  return {
    lyrics: row.lyrics ? (decryptContent(row.lyrics) ?? '') : '',
    canEdit: row.owner_id === viewerId,
  };
};

/* ─── Плейлисты ────────────────────────────────────────────────────── */

const playlistFor = async (playlistId, actorId, { write }) => {
  const { rows } = await query('SELECT * FROM music_playlists WHERE id = $1', [String(playlistId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.owner_id === actorId) return { row, own: true };
  if (write) return { error: 'not_allowed' };
  if (row.is_public) return { row, own: false };
  // Чужой закрытый плейлист неотличим от несуществующего: иначе по
  // разнице ответов можно было бы нащупать чужие идентификаторы.
  return { error: 'not_found' };
};

export const listPlaylists = async (ownerId) => {
  const { rows } = await query(
    `SELECT p.*, TRUE AS own,
            (SELECT count(*) FROM music_playlist_items i WHERE i.playlist_id = p.id) AS count
       FROM music_playlists p
      WHERE p.owner_id = $1
      ORDER BY p.updated_at DESC
      LIMIT $2`,
    [ownerId, MAX_PLAYLISTS],
  );
  return rows.map((r) => toPlaylist(r));
};

export const createPlaylist = async (ownerId, name) => {
  const clean = text(name, MAX_PLAYLIST_NAME);
  if (!clean) return { error: 'invalid_name' };
  const { rows: cnt } = await query(
    'SELECT count(*)::int AS n FROM music_playlists WHERE owner_id = $1', [ownerId]);
  if ((cnt[0]?.n ?? 0) >= MAX_PLAYLISTS) return { error: 'too_many' };

  const id = newId('pl');
  await query('INSERT INTO music_playlists (id, owner_id, name) VALUES ($1,$2,$3)',
    [id, ownerId, encryptContent(clean)]);
  return { playlist: await readPlaylist(id, ownerId) };
};

export const renamePlaylist = async (playlistId, actorId, name) => {
  const access = await playlistFor(playlistId, actorId, { write: true });
  if (access.error) return access;
  const clean = text(name, MAX_PLAYLIST_NAME);
  if (!clean) return { error: 'invalid_name' };
  await query('UPDATE music_playlists SET name = $2, updated_at = now() WHERE id = $1',
    [playlistId, encryptContent(clean)]);
  return { playlist: await readPlaylist(playlistId, actorId) };
};

export const setPlaylistPublic = async (playlistId, actorId, isPublic) => {
  const access = await playlistFor(playlistId, actorId, { write: true });
  if (access.error) return access;
  await query('UPDATE music_playlists SET is_public = $2, updated_at = now() WHERE id = $1',
    [playlistId, Boolean(isPublic)]);
  return { playlist: await readPlaylist(playlistId, actorId) };
};

export const deletePlaylist = async (playlistId, actorId) => {
  const access = await playlistFor(playlistId, actorId, { write: true });
  if (access.error) return access;
  await query('DELETE FROM music_playlists WHERE id = $1', [playlistId]);
  return { ok: true };
};

export const readPlaylist = async (playlistId, viewerId) => {
  const access = await playlistFor(playlistId, viewerId, { write: false });
  if (access.error) return null;
  const { rows } = await query(
    `SELECT t.*, t.owner_id = $2 AS own
       FROM music_playlist_items i
       JOIN music_tracks t ON t.id = i.track_id
      WHERE i.playlist_id = $1
        AND (t.status = 'published' OR t.owner_id = $2)
      ORDER BY i.position`,
    [playlistId, viewerId],
  );
  return toPlaylist({ ...access.row, own: access.own, count: rows.length }, rows.map(toTrack));
};

/**
 * Добавление трека. Позиция считается в той же транзакции, что и
 * вставка, иначе два одновременных добавления встали бы на одно место.
 */
export const addToPlaylist = async (playlistId, actorId, trackId) => {
  const access = await playlistFor(playlistId, actorId, { write: true });
  if (access.error) return access;
  if (!(await visibleTrack(trackId, actorId))) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Замок на плейлист: позиции считает по одному пишущему за раз.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [playlistId]);
    const { rows: cnt } = await client.query(
      'SELECT count(*)::int AS n FROM music_playlist_items WHERE playlist_id = $1', [playlistId]);
    if ((cnt[0]?.n ?? 0) >= MAX_ITEMS_PER_PLAYLIST) {
      await client.query('ROLLBACK');
      return { error: 'too_many' };
    }
    await client.query(
      `INSERT INTO music_playlist_items (playlist_id, track_id, position)
       VALUES ($1,$2,(SELECT COALESCE(max(position),0)+1 FROM music_playlist_items WHERE playlist_id = $1))
       ON CONFLICT (playlist_id, track_id) DO NOTHING`,
      [playlistId, trackId],
    );
    await client.query('UPDATE music_playlists SET updated_at = now() WHERE id = $1', [playlistId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { playlist: await readPlaylist(playlistId, actorId) };
};

export const removeFromPlaylist = async (playlistId, actorId, trackId) => {
  const access = await playlistFor(playlistId, actorId, { write: true });
  if (access.error) return access;
  await query('DELETE FROM music_playlist_items WHERE playlist_id = $1 AND track_id = $2',
    [playlistId, String(trackId ?? '')]);
  await query('UPDATE music_playlists SET updated_at = now() WHERE id = $1', [playlistId]);
  return { playlist: await readPlaylist(playlistId, actorId) };
};

/** Новый порядок целиком: пришедший список сверяется с тем, что внутри. */
export const reorderPlaylist = async (playlistId, actorId, order) => {
  const access = await playlistFor(playlistId, actorId, { write: true });
  if (access.error) return access;
  const ids = Array.isArray(order) ? order.map((x) => String(x)).slice(0, MAX_ITEMS_PER_PLAYLIST) : [];
  if (ids.length === 0) return { error: 'invalid_order' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [playlistId]);
    const { rows } = await client.query(
      'SELECT track_id FROM music_playlist_items WHERE playlist_id = $1', [playlistId]);
    const inside = new Set(rows.map((r) => r.track_id));
    let pos = 0;
    for (const id of ids) {
      // Чужие идентификаторы просто пропускаем: перестановка не должна
      // становиться способом затащить в плейлист посторонний трек.
      if (!inside.has(id)) continue;
      pos += 1;
      await client.query(
        'UPDATE music_playlist_items SET position = $3 WHERE playlist_id = $1 AND track_id = $2',
        [playlistId, id, pos]);
    }
    await client.query('UPDATE music_playlists SET updated_at = now() WHERE id = $1', [playlistId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { playlist: await readPlaylist(playlistId, actorId) };
};

/* ─── Избранное, история, позиция ──────────────────────────────────── */

export const listFavorites = async (userId) => {
  const { rows } = await query(
    `SELECT t.*, t.owner_id = $1 AS own
       FROM music_favorites f JOIN music_tracks t ON t.id = f.track_id
      WHERE f.user_id = $1 AND (t.status = 'published' OR t.owner_id = $1)
      ORDER BY f.created_at DESC LIMIT 500`,
    [userId],
  );
  return rows.map(toTrack);
};

export const setFavorite = async (userId, trackId, on) => {
  if (!(await visibleTrack(trackId, userId))) return { error: 'not_found' };
  if (on) {
    await query(
      'INSERT INTO music_favorites (user_id, track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, trackId]);
  } else {
    await query('DELETE FROM music_favorites WHERE user_id = $1 AND track_id = $2', [userId, trackId]);
  }
  return { ok: true };
};

export const addHistory = async (userId, trackId) => {
  if (!(await visibleTrack(trackId, userId))) return { error: 'not_found' };
  await query('INSERT INTO music_history (id, user_id, track_id) VALUES ($1,$2,$3)',
    [newId('mh'), userId, trackId]);
  // Держим последние двести записей: история — не архив.
  await query(
    `DELETE FROM music_history WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM music_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT 200)`,
    [userId]);
  return { ok: true };
};

export const listHistory = async (userId) => {
  const { rows } = await query(
    `SELECT DISTINCT ON (t.id) t.*, t.owner_id = $1 AS own, h.played_at
       FROM music_history h JOIN music_tracks t ON t.id = h.track_id
      WHERE h.user_id = $1 AND (t.status = 'published' OR t.owner_id = $1)
      ORDER BY t.id, h.played_at DESC`,
    [userId],
  );
  return rows
    .sort((a, b) => b.played_at - a.played_at)
    .slice(0, 100)
    .map(toTrack);
};

export const setProgress = async (userId, trackId, seconds) => {
  if (!(await visibleTrack(trackId, userId))) return { error: 'not_found' };
  const pos = Math.max(0, Math.min(86400, Math.floor(Number(seconds) || 0)));
  await query(
    `INSERT INTO music_progress (user_id, track_id, position_sec) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, track_id) DO UPDATE SET position_sec = $3, updated_at = now()`,
    [userId, trackId, pos]);
  return { ok: true };
};

export const listProgress = async (userId) => {
  const { rows } = await query(
    'SELECT track_id, position_sec FROM music_progress WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200',
    [userId]);
  return rows.map((r) => ({ trackId: r.track_id, position: r.position_sec }));
};
