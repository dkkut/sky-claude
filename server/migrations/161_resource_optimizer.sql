-- Sky Resource Optimizer: настройки (одна строка) и журнал режимов/событий. Только добавляет таблицы; откат — DROP TABLE обеих.
CREATE TABLE IF NOT EXISTS resource_settings (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO resource_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS resource_events (
  id      BIGSERIAL PRIMARY KEY,
  ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind    TEXT NOT NULL,                 -- mode | warning | action | settings | deferred
  mode    TEXT NOT NULL DEFAULT '',
  detail  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS resource_events_ts_idx ON resource_events (ts DESC);
