-- Sky Games: инфраструктура игровых серверов (Minecraft, GTA). Серверы запускает агент на ОТДЕЛЬНОМ хосте; на основном сервере Sky — только после подтверждения владельцем.
CREATE TABLE IF NOT EXISTS gi_hosts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,                    -- dedicated | main (основной сервер Sky)
  main_confirmed_by TEXT,                           -- владелец, подтвердивший запуск игр на основном сервере
  main_confirmed_at TIMESTAMPTZ,
  agent_last_seen TIMESTAMPTZ,
  agent_version   TEXT NOT NULL DEFAULT '',
  metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gi_servers (
  id          TEXT PRIMARY KEY,
  serial      BIGSERIAL,                            -- из него считается отдельный системный пользователь (uid)
  kind        TEXT NOT NULL,                        -- minecraft | gta
  name        TEXT NOT NULL,
  host_id     TEXT REFERENCES gi_hosts(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'stopped',      -- stopped | starting | running | stopping | error
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  limits      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {cpu, ramMb, diskMb, players}
  port        INTEGER,
  last_error  TEXT NOT NULL DEFAULT '',
  last_started_at TIMESTAMPTZ,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gi_servers_port_uq ON gi_servers (host_id, port) WHERE host_id IS NOT NULL AND port IS NOT NULL;
CREATE TABLE IF NOT EXISTS gi_commands (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL REFERENCES gi_servers(id) ON DELETE CASCADE,
  host_id     TEXT NOT NULL,
  action      TEXT NOT NULL,                        -- start | stop | restart | backup | logs | remove
  state       TEXT NOT NULL DEFAULT 'queued',       -- queued | running | done | failed | cancelled
  requested_by TEXT NOT NULL,
  output      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS gi_commands_one_active ON gi_commands (server_id) WHERE state IN ('queued','running');
CREATE TABLE IF NOT EXISTS gi_access (
  server_id  TEXT NOT NULL REFERENCES gi_servers(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  level      TEXT NOT NULL,                         -- view | operate
  granted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, profile_id)
);
CREATE TABLE IF NOT EXISTS gi_log (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id  TEXT NOT NULL,
  server_id TEXT NOT NULL DEFAULT '',
  action    TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS gi_log_idx ON gi_log (server_id, id DESC);
CREATE TABLE IF NOT EXISTS gi_logs (
  id        BIGSERIAL PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES gi_servers(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  line      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gi_logs_idx ON gi_logs (server_id, id DESC);
CREATE TABLE IF NOT EXISTS gi_backups (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES gi_servers(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  bytes      BIGINT NOT NULL DEFAULT 0,
  sha256     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gi_samples (
  id        BIGSERIAL PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES gi_servers(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  cpu_pct   REAL, mem_mb REAL, disk_mb REAL, players INTEGER
);
CREATE INDEX IF NOT EXISTS gi_samples_idx ON gi_samples (server_id, id DESC);
