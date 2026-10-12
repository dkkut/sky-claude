/**
 * Реальная активность по Sky Media: сколько человек сегодня и за
 * неделю слушал музыку, подкасты и смотрел видео — на главной вкладке
 * (src/extras/ExtrasModule.tsx::MediaHomeTab).
 *
 * Ничего не придумывается и не считается на клиенте: числа берутся из
 * уже существующих, уже наполняемых таблиц —
 *   music_history(played_at)    + music_tracks.duration_sec,
 *   podcast_history(played_at)  + podcast_episodes.duration_sec,
 *   film_progress(updated_at, position_sec, duration_sec).
 * У фильма нет журнала «сколько раз включали», только текущая позиция
 * на строку (user_id, movie_id) — поэтому минуты видео это
 * LEAST(позиция, длительность) по фильмам, тронутым за период: лучшее
 * приближение к «сколько реально посмотрел», какое даёт эта таблица,
 * без выдумывания отдельного лога событий ради вкладки на главной.
 */
import { query } from './db.mjs';
import { gameSeconds, nowPlaying } from './gameactivity.mjs';

const sec = (rows) => Number(rows[0]?.sec ?? 0);

const musicSeconds = async (userId, since) => sec((await query(
  `SELECT COALESCE(SUM(t.duration_sec), 0)::int AS sec
     FROM music_history h JOIN music_tracks t ON t.id = h.track_id
    WHERE h.user_id = $1 AND h.played_at >= $2`,
  [userId, since])).rows);

const podcastSeconds = async (userId, since) => sec((await query(
  `SELECT COALESCE(SUM(e.duration_sec), 0)::int AS sec
     FROM podcast_history h JOIN podcast_episodes e ON e.id = h.episode_id
    WHERE h.user_id = $1 AND h.played_at >= $2`,
  [userId, since])).rows);

const videoSeconds = async (userId, since) => sec((await query(
  `SELECT COALESCE(SUM(LEAST(position_sec, duration_sec)), 0)::int AS sec
     FROM film_progress
    WHERE user_id = $1 AND updated_at >= $2`,
  [userId, since])).rows);

/** Активность за сегодня и за 7 дней — три реальных источника разом. */
export const myMediaActivity = async (userId) => {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 86400000);

  const [musicDay, podcastDay, videoDay, musicWeek, podcastWeek, videoWeek, gamesDay, gamesWeek, playing] = await Promise.all([
    musicSeconds(userId, dayStart), podcastSeconds(userId, dayStart), videoSeconds(userId, dayStart),
    musicSeconds(userId, weekStart), podcastSeconds(userId, weekStart), videoSeconds(userId, weekStart),
    gameSeconds(userId, dayStart), gameSeconds(userId, weekStart), nowPlaying(userId),
  ]);

  return {
    today: { music: musicDay, video: videoDay, podcasts: podcastDay, games: gamesDay },
    week: { music: musicWeek, video: videoWeek, podcasts: podcastWeek, games: gamesWeek },
    playing,
  };
};
