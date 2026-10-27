-- Sky Media Home (настраиваемый главный экран) и SkyWave (персональные подборки).
-- Раскладка хранится отдельно от данных: в варианте экрана лежат только типы виджетов, размеры и настройки.
CREATE TABLE IF NOT EXISTS media_home_layouts (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  layout     JSONB NOT NULL DEFAULT '{}'::jsonb,
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_home_layouts_profile_idx ON media_home_layouts (profile_id, updated_at DESC);
-- Не больше одного активного варианта на человека.
CREATE UNIQUE INDEX IF NOT EXISTS media_home_layouts_one_active ON media_home_layouts (profile_id) WHERE active;

-- Обратная связь по рекомендациям: «больше / меньше / не интересно / не рекомендовать автора».
CREATE TABLE IF NOT EXISTS wave_feedback (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('music','film','video','podcast','book')),
  item_id    TEXT NOT NULL,
  signal     TEXT NOT NULL CHECK (signal IN ('more','less','hide','mute_author')),
  author_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, kind, item_id, signal)
);
CREATE INDEX IF NOT EXISTS wave_feedback_profile_idx ON wave_feedback (profile_id, created_at DESC);

-- Настройки подборок человека: скрытые, порядок, пауза персонализации.
CREATE TABLE IF NOT EXISTS wave_prefs (
  profile_id     TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  hidden_shelves TEXT[] NOT NULL DEFAULT '{}',
  shelf_order    TEXT[] NOT NULL DEFAULT '{}',
  personalize    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Настройки платформы: доступность подборок и редакционные подборки (правит администрация).
CREATE TABLE IF NOT EXISTS wave_admin (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Диагностика без личных данных: агрегат по подборкам за день.
CREATE TABLE IF NOT EXISTS wave_stats (
  day        DATE NOT NULL,
  shelf      TEXT NOT NULL,
  built      INT  NOT NULL DEFAULT 0,
  empty      INT  NOT NULL DEFAULT 0,
  errors     INT  NOT NULL DEFAULT 0,
  total_ms   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, shelf)
);
