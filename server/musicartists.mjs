/**
 * Артист и подписки на него.
 *
 * Правила те же, что и во всей музыке: решает сервер.
 *   • свой профиль артиста человек заводит и правит сам, чужой — нет;
 *   • подписка — это связь двух настоящих людей, а не отметка в
 *     браузере: её видят обе стороны и любое устройство;
 *   • в ленте «новое у ваших артистов» показываются только
 *     опубликованные треки тех, на кого человек подписан.
 */
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';

const MAX_NAME = 120;
const MAX_BIO = 1000;
const MAX_GENRES = 200;

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/** Что уходит клиенту. Идентификатор — профиля, он же адрес страницы. */
const toArtist = (row) => ({
  id: row.profile_id,
  name: row.name,
  bio: row.bio ? (decryptContent(row.bio) ?? '') : '',
  genres: row.genres ? row.genres.split(',').filter(Boolean) : [],
  username: row.username ?? undefined,
  followers: Number(row.followers ?? 0),
  tracks: Number(row.track_count ?? 0),
  plays: Number(row.plays ?? 0),
  /** Подписан ли тот, кто спрашивает. */
  following: row.following === true || undefined,
  own: row.own === true || undefined,
});

const SELECT_ARTIST = `
  SELECT a.*, p.username,
         (SELECT count(*) FROM music_artist_followers f WHERE f.artist_id = a.profile_id) AS followers,
         (SELECT count(*) FROM music_tracks t
           WHERE t.owner_id = a.profile_id AND t.status = 'published') AS track_count,
         (SELECT coalesce(sum(t.plays), 0) FROM music_tracks t
           WHERE t.owner_id = a.profile_id AND t.status = 'published') AS plays,
         EXISTS (SELECT 1 FROM music_artist_followers f
                  WHERE f.artist_id = a.profile_id AND f.follower_id = $1) AS following,
         a.profile_id = $1 AS own
    FROM music_artists a
    LEFT JOIN profiles p ON p.id = a.profile_id
`;

/** Профиль артиста по идентификатору профиля. */
export const readArtist = async (artistId, viewerId) => {
  // Первым всегда идёт тот, кто спрашивает: от него зависят поля
  // «подписан» и «своё».
  const { rows } = await query(`${SELECT_ARTIST} WHERE a.profile_id = $2`,
    [viewerId ?? '', String(artistId ?? '')]);
  return rows[0] ? toArtist(rows[0]) : null;
};

/**
 * Профиль по псевдониму: страница артиста открывается из строки трека,
 * а там есть только имя.
 */
export const readArtistByName = async (name, viewerId) => {
  const { rows } = await query(`${SELECT_ARTIST} WHERE lower(a.name) = lower($2)`,
    [viewerId ?? '', text(name, MAX_NAME)]);
  return rows[0] ? toArtist(rows[0]) : null;
};

/** Свой профиль артиста: заводится и правится только самим человеком. */
export const saveArtist = async (profileId, { name, bio, genres }) => {
  // Псевдоним должен быть строкой: объект от переписанного клиента
  // иначе превратился бы в «[object Object]» и так и записался.
  if (typeof name !== 'string') return { error: 'invalid_name' };
  const clean = text(name, MAX_NAME);
  if (clean.length < 2) return { error: 'invalid_name' };

  // Псевдоним уникален: иначе на странице артиста непонятно, кому
  // подписываться и чьи это треки.
  const { rows: taken } = await query(
    'SELECT profile_id FROM music_artists WHERE lower(name) = lower($1) AND profile_id <> $2',
    [clean, profileId],
  );
  if (taken[0]) return { error: 'name_taken' };

  const bioText = typeof bio === 'string' ? text(bio, MAX_BIO) : '';
  const genreText = Array.isArray(genres)
    ? text(genres.filter((g) => typeof g === 'string').join(','), MAX_GENRES)
    : (typeof genres === 'string' ? text(genres, MAX_GENRES) : '');

  try {
    await query(
      `INSERT INTO music_artists (profile_id, name, bio, genres)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (profile_id) DO UPDATE
         SET name = EXCLUDED.name, bio = EXCLUDED.bio,
             genres = EXCLUDED.genres, updated_at = now()`,
      [profileId, clean, bioText ? encryptContent(bioText) : null, genreText],
    );
  } catch (err) {
    // Проверка выше и запись — два разных мгновения: если между ними
    // тот же псевдоним занял кто-то другой, уникальный индекс не даст
    // записать. Это не поломка сервера, а тот же занятый псевдоним.
    if (err?.code === '23505') return { error: 'name_taken' };
    throw err;
  }
  return { ok: true };
};

/** Подписка. На себя подписаться нельзя — это ничего не значит. */
export const followArtist = async (artistId, followerId, on) => {
  const id = String(artistId ?? '');
  if (!id || id === followerId) return { error: 'not_allowed' };
  const { rows } = await query('SELECT 1 FROM music_artists WHERE profile_id = $1', [id]);
  if (!rows[0]) return { error: 'not_found' };

  if (on) {
    await query(
      `INSERT INTO music_artist_followers (artist_id, follower_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, followerId],
    );
  } else {
    await query(
      'DELETE FROM music_artist_followers WHERE artist_id = $1 AND follower_id = $2',
      [id, followerId],
    );
  }
  return { ok: true, artist: await readArtist(id, followerId) };
};

/** На кого подписан этот человек. */
export const listFollowing = async (followerId) => {
  const { rows } = await query(
    `${SELECT_ARTIST}
      WHERE a.profile_id IN (SELECT artist_id FROM music_artist_followers WHERE follower_id = $1)
      ORDER BY a.name ASC`,
    [followerId ?? ''],
  );
  return rows.map(toArtist);
};

/** Артисты с опубликованными треками — список для витрины. */
export const listArtists = async (viewerId, { limit } = {}) => {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const { rows } = await query(
    `${SELECT_ARTIST}
      WHERE EXISTS (SELECT 1 FROM music_tracks t
                     WHERE t.owner_id = a.profile_id AND t.status = 'published')
      ORDER BY a.name ASC
      LIMIT $2`,
    [viewerId ?? '', lim],
  );
  return rows.map(toArtist);
};

/**
 * Новое у тех, на кого подписан: только опубликованные треки и только
 * от этих артистов. Чужое закрытое сюда не попадёт по определению.
 */
export const newFromFollowed = async (followerId, { limit } = {}) => {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  const { rows } = await query(
    `SELECT t.*, a.name AS artist_name
       FROM music_tracks t
       JOIN music_artist_followers f ON f.artist_id = t.owner_id
       JOIN music_artists a ON a.profile_id = t.owner_id
      WHERE f.follower_id = $1 AND t.status = 'published'
      ORDER BY t.created_at DESC
      LIMIT $2`,
    [followerId, lim],
  );
  return rows;
};
