/**
 * Подписки — одна настоящая таблица вместо трёх локальных копий.
 *
 * До этого модуля «подписаться» в ленте Bloom, на канале SkyVideo и в
 * общем профиль-вьюере (src/profile/viewer/social.ts) — три независимых
 * набора в localStorage браузера, которые код вручную держал
 * синхронными друг с другом. Здесь — одна таблица `follows`, и все три
 * места читают и пишут в неё через один и тот же API.
 *
 * Дружба (заявка/подтверждение) — отдельное, более узкое отношение
 * («добавить в друзья» и «подписаться» — разные действия по замыслу
 * профиль-вьюера) и сюда не входит: она вне того, о чём просили здесь.
 */
import { query } from './db.mjs';

export const isFollowing = async (followerId, targetId) => {
  if (!followerId || !targetId) return false;
  const { rows } = await query(
    'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
    [followerId, targetId],
  );
  return rows.length > 0;
};

/**
 * Переключатель, а не отдельные follow/unfollow: клиент не обязан
 * знать текущее состояние заранее, сервер сам решает, что делать —
 * ровно то же поведение, что было у локального toggleFollow.
 */
export const toggleFollow = async (followerId, targetId) => {
  if (!followerId || !targetId || followerId === targetId) return { error: 'bad_target' };
  const { rows } = await query(
    'SELECT 1 FROM profiles WHERE id = $1', [targetId],
  );
  if (!rows.length) return { error: 'not_found' };

  const del = await query(
    'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
    [followerId, targetId],
  );
  if (del.rowCount > 0) return { following: false };

  await query(
    `INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [followerId, targetId],
  );
  return { following: true };
};

export const followerIds = async (userId) => {
  const { rows } = await query(
    'SELECT follower_id FROM follows WHERE following_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows.map((r) => r.follower_id);
};

export const followingIds = async (userId) => {
  const { rows } = await query(
    'SELECT following_id FROM follows WHERE follower_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows.map((r) => r.following_id);
};

export const followerCount = async (userId) => {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM follows WHERE following_id = $1', [userId],
  );
  return rows[0].n;
};

export const followingCount = async (userId) => {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM follows WHERE follower_id = $1', [userId],
  );
  return rows[0].n;
};

/** Новые подписчики с такого-то момента — для уведомлений («новый подписчик»),
 *  не для отображения списка (там followerIds без временного среза). */
export const recentFollowers = async (userId, sinceIso) => {
  const { rows } = await query(
    `SELECT f.follower_id, f.created_at, p.name AS follower_name
       FROM follows f JOIN profiles p ON p.id = f.follower_id
      WHERE f.following_id = $1 AND f.created_at > $2
      ORDER BY f.created_at DESC LIMIT 20`,
    [userId, sinceIso],
  );
  return rows.map((r) => ({ actorId: r.follower_id, actorName: r.follower_name, createdAt: r.created_at.toISOString() }));
};

/** Кто из списка candidateIds подписан на targetId — для «общих подписок». */
export const whichFollow = async (followerIdsList, targetId) => {
  if (!followerIdsList.length) return [];
  const { rows } = await query(
    'SELECT follower_id FROM follows WHERE following_id = $1 AND follower_id = ANY($2::text[])',
    [targetId, followerIdsList],
  );
  return rows.map((r) => r.follower_id);
};
