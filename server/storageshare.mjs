/**
 * Sky Personal Storage: прямой доступ к файлу («Поделиться»).
 *
 * Отдельно от «Вместе» (watchgrant.mjs/together.mjs): там доступ привязан
 * к живому сеансу и исчезает вместе с ним, а здесь — явное, постоянное (до
 * отзыва или истечения) разрешение конкретному человеку, без всякой
 * комнаты. Обе системы проверяются параллельно в film.mjs/music.mjs —
 * ни одна не знает о другой и не обязана её заменять.
 *
 * Принципы, без которых файл в этом модуле не трогать:
 *
 *   1. Доступ не передаёт владение. owner_id в film_movies/music_tracks
 *      не меняется никогда — ни на запись в этом модуле, ни на одну из
 *      его функций нет и не должно быть такой возможности.
 *
 *   2. VIEW — это сам факт действующей строки; DOWNLOAD — отдельное
 *      разрешение, по умолчанию выключено. Сегодня у кино и музыки нет
 *      отдельного действия «скачать» (только потоковое воспроизведение),
 *      так что can_download пока ничего технически не открывает сверх
 *      VIEW — поле задела на будущее, когда такое действие появится, не
 *      воображаемая защита того, чего нет.
 *
 *   3. Отозванное и истёкшее — недействительно сразу, без каскадных
 *      последствий для файла: сам файл не трогается, видимость чужому
 *      человеку гаснет.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';

const newId = () => `shr-${crypto.randomUUID()}`;

const isKind = (k) => k === 'movie' || k === 'track';

/**
 * Даёт (или обновляет) доступ. Owner проверяется здесь же: поделиться
 * можно только своим private-файлом — публикацию видят все и так, а
 * чужим поделиться просто нечем, у вызывающего нет к нему owner_id.
 */
export const grantShare = async (ownerId, sharedWithId, fileKind, fileId, {
  canDownload = false, expiresAt = null,
} = {}) => {
  if (!isKind(fileKind)) return { error: 'invalid_kind' };
  if (!sharedWithId || sharedWithId === ownerId) return { error: 'invalid_recipient' };

  const table = fileKind === 'track' ? 'music_tracks' : 'film_movies';
  const { rows } = await query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND owner_id = $2 AND status = 'private'`,
    [String(fileId ?? ''), ownerId],
  );
  if (!rows[0]) return { error: 'not_found' };

  // Получатель должен существовать: иначе вставка упала бы по внешнему
  // ключу — честный отказ, а не необработанная ошибка базы на вход
  // несуществующего Sky ID.
  const { rows: who } = await query('SELECT 1 FROM profiles WHERE id = $1', [String(sharedWithId)]);
  if (!who[0]) return { error: 'recipient_not_found' };

  await query(
    `INSERT INTO storage_shares (id, owner_id, shared_with_id, file_kind, file_id, can_download, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (shared_with_id, file_kind, file_id) WHERE revoked_at IS NULL
     DO UPDATE SET can_download = EXCLUDED.can_download, expires_at = EXCLUDED.expires_at`,
    [newId(), ownerId, String(sharedWithId), fileKind, String(fileId), canDownload === true, expiresAt],
  );
  return { ok: true };
};

/** Отзыв — владельцем, по файлу и получателю. Отозванный URL бесполезен сразу. */
export const revokeShare = async (ownerId, sharedWithId, fileKind, fileId) => {
  const { rowCount } = await query(
    `UPDATE storage_shares SET revoked_at = now()
      WHERE owner_id = $1 AND shared_with_id = $2 AND file_kind = $3 AND file_id = $4
        AND revoked_at IS NULL`,
    [ownerId, String(sharedWithId ?? ''), String(fileKind ?? ''), String(fileId ?? '')],
  );
  return rowCount > 0;
};

/** Есть ли у viewerId действующий (не истёкший, не отозванный) доступ к файлу. */
export const sharedDirectly = async (fileKind, fileId, viewerId) => {
  if (!viewerId) return { view: false, download: false };
  const { rows } = await query(
    `SELECT can_download FROM storage_shares
      WHERE shared_with_id = $1 AND file_kind = $2 AND file_id = $3
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [viewerId, String(fileKind ?? ''), String(fileId ?? '')],
  );
  if (!rows[0]) return { view: false, download: false };
  return { view: true, download: rows[0].can_download === true };
};

/** «Доступ имеют» — на экране владельца, для конкретного файла. */
export const listSharesForFile = async (ownerId, fileKind, fileId) => {
  const { rows } = await query(
    `SELECT s.id, s.shared_with_id, s.can_download, s.created_at, s.expires_at,
            p.username, p.name
       FROM storage_shares s
       JOIN profiles p ON p.id = s.shared_with_id
      WHERE s.owner_id = $1 AND s.file_kind = $2 AND s.file_id = $3 AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC`,
    [ownerId, String(fileKind ?? ''), String(fileId ?? '')],
  );
  return rows.map((r) => ({
    id: r.id, userId: r.shared_with_id, username: r.username, name: r.name,
    canDownload: r.can_download, createdAt: r.created_at, expiresAt: r.expires_at,
  }));
};

/**
 * «Доступные мне» — через все файлы сразу. Два отдельных списка: кино
 * и музыка живут в разных таблицах, и общая строка для них была бы
 * либо неполной, либо требовала бы выдуманного общего вида.
 */
export const listSharedWithMe = async (viewerId) => {
  const { rows: movies } = await query(
    `SELECT m.id, m.title, s.can_download, s.created_at, s.expires_at, p.username AS owner_username
       FROM storage_shares s
       JOIN film_movies m ON m.id = s.file_id AND s.file_kind = 'movie'
       JOIN profiles p ON p.id = s.owner_id
      WHERE s.shared_with_id = $1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())
        AND m.status = 'private'
      ORDER BY s.created_at DESC`,
    [viewerId],
  );
  const { rows: tracks } = await query(
    `SELECT t.id, t.title, t.artist, s.can_download, s.created_at, s.expires_at, p.username AS owner_username
       FROM storage_shares s
       JOIN music_tracks t ON t.id = s.file_id AND s.file_kind = 'track'
       JOIN profiles p ON p.id = s.owner_id
      WHERE s.shared_with_id = $1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())
        AND t.status = 'private'
      ORDER BY s.created_at DESC`,
    [viewerId],
  );
  return { movies, tracks };
};
