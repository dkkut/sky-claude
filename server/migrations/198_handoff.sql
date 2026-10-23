-- «Продолжить на другом устройстве»: тонкий слой поверх существующих прогрессов (music_progress, film_progress, podcast_progress, book_progress)
-- и реестра устройств Sky Transfer. Только добавляет.
ALTER TABLE transfer_devices ADD COLUMN IF NOT EXISTS last_profile TEXT;      -- профиль, активный на устройстве при последнем сигнале

CREATE TABLE IF NOT EXISTS sky_video_progress (
  user_id      TEXT NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  video_id     TEXT NOT NULL REFERENCES sky_videos(id) ON DELETE CASCADE,
  position_sec INT  NOT NULL DEFAULT 0,
  duration_sec INT  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS sky_video_progress_user_idx ON sky_video_progress (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS handoffs (
  id           TEXT PRIMARY KEY,
  sky_id       TEXT NOT NULL,
  profile_id   TEXT NOT NULL,
  from_device  TEXT NOT NULL,
  to_device    TEXT NOT NULL,
  kind         TEXT NOT NULL,                       -- music | film | video | podcast | book
  item_id      TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  position_sec NUMERIC NOT NULL DEFAULT 0,
  duration_sec NUMERIC NOT NULL DEFAULT 0,
  extra        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- книги: вид, глава, смещение
  keep_playing BOOLEAN NOT NULL DEFAULT FALSE,
  state        TEXT NOT NULL DEFAULT 'pending',     -- pending | accepted | declined | expired | cancelled | superseded | failed
  reason       TEXT,
  idem_key     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  resolved_at  TIMESTAMPTZ,
  UNIQUE (sky_id, idem_key)
);
CREATE INDEX IF NOT EXISTS handoffs_to_idx ON handoffs (to_device, state, expires_at);
CREATE INDEX IF NOT EXISTS handoffs_profile_idx ON handoffs (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS handoff_prefs (
  sky_id       TEXT PRIMARY KEY,
  accept       TEXT NOT NULL DEFAULT 'ask',        -- ask | off
  history_days INT  NOT NULL DEFAULT 30,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
