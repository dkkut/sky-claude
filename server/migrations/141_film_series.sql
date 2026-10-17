-- Сериалы Sky Film: сериал → сезоны → серии. Серия — обычная запись film_movies (тот же файл, плеер,
-- прогресс, оценки, модерация), у которой заполнены series_id / season_id / ep_no. Второй системы
-- хранения видео нет.

CREATE TABLE IF NOT EXISTS film_series (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,                       -- зашифровано, как у фильма
  category      TEXT NOT NULL DEFAULT 'Сериалы',
  genre         TEXT NOT NULL DEFAULT '',
  year          INT,
  country       TEXT NOT NULL DEFAULT '',
  age_rating    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'private'
                CHECK (status IN ('private','pending','published','rejected')),
  reject_reason TEXT,
  submitted_at  TIMESTAMPTZ,
  moderated_at  TIMESTAMPTZ,
  moderated_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS film_series_owner_idx  ON film_series (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS film_series_status_idx ON film_series (status, created_at DESC);

CREATE TABLE IF NOT EXISTS film_seasons (
  id         TEXT PRIMARY KEY,
  series_id  TEXT NOT NULL REFERENCES film_series(id) ON DELETE CASCADE,
  number     INT  NOT NULL CHECK (number BETWEEN 0 AND 99),
  title      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (series_id, number)
);

ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS series_id TEXT REFERENCES film_series(id) ON DELETE CASCADE;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS season_id TEXT REFERENCES film_seasons(id) ON DELETE CASCADE;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS ep_no INT;
-- Заставка: с какой по какую секунду показывать «Пропустить заставку» (задаёт владелец серии).
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS intro_start_sec INT;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS intro_end_sec INT;
CREATE UNIQUE INDEX IF NOT EXISTS film_movies_episode_uq ON film_movies (season_id, ep_no) WHERE season_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS film_movies_series_idx ON film_movies (series_id) WHERE series_id IS NOT NULL;

-- Субтитры (WebVTT, до 300 КБ на дорожку): язык, подпись, текст. Принадлежат серии/фильму и умирают с ним.
CREATE TABLE IF NOT EXISTS film_subtitles (
  movie_id   TEXT NOT NULL REFERENCES film_movies(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  label      TEXT NOT NULL,
  vtt        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (movie_id, lang)
);
