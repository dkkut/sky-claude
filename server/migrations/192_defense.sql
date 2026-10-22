-- Обнаружение утечек и самозащита сервера. Только добавляет.
CREATE TABLE IF NOT EXISTS defense_settings (
  id    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO defense_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS defense_level (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  level      INT NOT NULL DEFAULT 0,
  until      TIMESTAMPTZ,
  reason     TEXT NOT NULL DEFAULT '',
  lockdown_by_us BOOLEAN NOT NULL DEFAULT FALSE,   -- панель закрыта нами (снимем сами); чужое закрытие не трогаем
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO defense_level (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS defense_incidents (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  severity   TEXT NOT NULL,                       -- low|medium|high|critical
  status     TEXT NOT NULL DEFAULT 'active',      -- active|contained|cancelled
  mode       TEXT NOT NULL DEFAULT 'auto',        -- auto|notify|drill
  subject    TEXT NOT NULL DEFAULT '',            -- ключ слияния: profile:<id> / ip:<fp> / system
  summary    TEXT NOT NULL DEFAULT '',
  last_mail_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS defense_incidents_idx ON defense_incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS defense_incidents_subject_idx ON defense_incidents (subject, created_at DESC);

CREATE TABLE IF NOT EXISTS leak_events (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,                       -- mass_export|canary|secret_in_request|admin_anomaly|integrity|guard|probing
  severity   TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  ip_mask    TEXT NOT NULL DEFAULT '',
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb, -- без секретов и содержимого
  status     TEXT NOT NULL DEFAULT 'open',        -- open|acknowledged|false_positive
  incident_id TEXT REFERENCES defense_incidents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leak_events_idx ON leak_events (created_at DESC);
CREATE INDEX IF NOT EXISTS leak_events_kind_idx ON leak_events (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS defense_actions (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES defense_incidents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '',
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'pending',    -- pending|done|simulated|undone|failed|skipped
  reversible  BOOLEAN NOT NULL DEFAULT TRUE,
  undo_state  JSONB NOT NULL DEFAULT '{}'::jsonb,
  error       TEXT NOT NULL DEFAULT '',
  executed_at TIMESTAMPTZ,
  undone_at   TIMESTAMPTZ,
  undone_via  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS defense_actions_inc_idx ON defense_actions (incident_id);

CREATE TABLE IF NOT EXISTS defense_undo_links (
  token_hash  TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES defense_incidents(id) ON DELETE CASCADE,
  attempts    INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defense_ip_blocks (
  ip_fp      TEXT PRIMARY KEY,
  ip_mask    TEXT NOT NULL DEFAULT '',
  reason     TEXT NOT NULL DEFAULT '',
  incident_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defense_canaries (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  hint       TEXT NOT NULL DEFAULT '',            -- последние 4 знака
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  hits       INT NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defense_host_cmds (
  id          TEXT PRIMARY KEY,
  incident_id TEXT,
  action_id   TEXT,
  kind        TEXT NOT NULL,                      -- restore_code|recreate_containers|rotate_jwt|restore_jwt
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'pending',    -- pending|running|done|failed|cancelled
  result      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS defense_host_cmds_idx ON defense_host_cmds (status, created_at);

CREATE TABLE IF NOT EXISTS defense_guard (
  id        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_seen TIMESTAMPTZ,
  info      JSONB NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO defense_guard (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS defense_integrity (
  build_id  TEXT PRIMARY KEY,
  manifest  JSONB NOT NULL,
  taken_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defense_admin_seen (
  profile_id TEXT NOT NULL,
  ip_fp      TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, ip_fp)
);
