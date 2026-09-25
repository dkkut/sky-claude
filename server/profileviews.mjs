/**
 * Счётчик просмотров профиля.
 *
 * Раньше просмотр записывался в localStorage того, кто СМОТРИТ
 * (views[targetId]++ в браузере смотрящего, см. историю
 * src/profile/viewer/social.ts) — владелец профиля эту цифру никогда не
 * видел ни на одном своём устройстве, она жила только у случайных
 * гостей. Здесь запись идёт на сервер под id того, чей профиль
 * посмотрели, — источник один, виден отовсюду.
 *
 * PRIMARY KEY(target_id, viewer_id) — тот же приём, что у bloom_views:
 * один и тот же смотрящий увеличивает счётчик один раз, а не при
 * каждом повторном заходе.
 */
import { query } from './db.mjs';

export const recordProfileView = async (targetId, viewerId) => {
  if (!targetId || !viewerId || targetId === viewerId) return;
  await query(
    `INSERT INTO profile_views (target_id, viewer_id) VALUES ($1,$2)
     ON CONFLICT (target_id, viewer_id) DO UPDATE SET viewed_at = now()`,
    [targetId, viewerId],
  );
};

export const profileViewCount = async (targetId) => {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM profile_views WHERE target_id = $1',
    [targetId],
  );
  return rows[0].n;
};
