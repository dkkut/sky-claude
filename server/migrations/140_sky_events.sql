-- Единый журнал событий Sky: пользователи, администрация, серверы, клиенты, безопасность.
CREATE TABLE IF NOT EXISTS sky_events (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL UNIQUE,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  category   TEXT NOT NULL CHECK (category IN ('user', 'admin', 'server', 'client', 'security')),
  level      TEXT NOT NULL DEFAULT 'INFO' CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL')),
  type       TEXT NOT NULL,
  service    TEXT NOT NULL DEFAULT '',
  actor_id   TEXT,
  target_id  TEXT,
  result     TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok', 'denied', 'error')),
  reason     TEXT NOT NULL DEFAULT '',
  device     TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Цепочка хешей — только у аудиторских категорий (admin, security): правка задним числом ломает цепочку.
  chain_seq  BIGINT,
  prev_hash  TEXT,
  hash       TEXT
);
CREATE INDEX IF NOT EXISTS sky_events_at_idx       ON sky_events (at DESC);
CREATE INDEX IF NOT EXISTS sky_events_cat_at_idx   ON sky_events (category, at DESC);
CREATE INDEX IF NOT EXISTS sky_events_type_idx     ON sky_events (type, at DESC);
CREATE INDEX IF NOT EXISTS sky_events_actor_idx    ON sky_events (actor_id, at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sky_events_level_idx    ON sky_events (level, at DESC) WHERE level IN ('ERROR', 'CRITICAL');
CREATE UNIQUE INDEX IF NOT EXISTS sky_events_chain_uq ON sky_events (chain_seq) WHERE chain_seq IS NOT NULL;

-- Сроки хранения по категориям и ограниченный по времени режим DEBUG.
CREATE TABLE IF NOT EXISTS sky_log_settings (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  retention_days JSONB NOT NULL DEFAULT '{"user":180,"admin":730,"server":60,"client":30,"security":365}'::jsonb,
  debug_until    TIMESTAMPTZ,                 -- пока не истёк — DEBUG записывается; потом выключается сам
  telemetry      BOOLEAN NOT NULL DEFAULT TRUE,   -- принимать клиентскую телеметрию (ошибки приложений)
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ
);
INSERT INTO sky_log_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
