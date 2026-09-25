-- Просмотры Sky Video считались голым UPDATE ... SET views = views + 1
-- на каждый вызов POST /api/skyvideo/video/:id/view — ничего не мешало
-- одному и тому же человеку накрутить счётчик повторными вызовами.
-- У лайков (sky_video_likes, миграция 055) для этого уже есть
-- PRIMARY KEY(user_id, video_id) — тот же приём применяем и здесь.
CREATE TABLE IF NOT EXISTS sky_video_views (
  user_id    TEXT NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  video_id   TEXT NOT NULL REFERENCES sky_videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);
