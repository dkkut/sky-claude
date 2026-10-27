-- Sky Launcher: серверы GTA V / Minecraft, профили, библиотека и каталог игр, сборки, заказы размещения.
CREATE TABLE IF NOT EXISTS launcher_servers (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('gta','minecraft')),
  platform      TEXT NOT NULL CHECK (platform IN ('fivem','ragemp','vanilla','paper','fabric','forge')),
  name          TEXT NOT NULL,
  descr         TEXT NOT NULL DEFAULT '',
  host          TEXT NOT NULL,
  port          INT  NOT NULL CHECK (port BETWEEN 1 AND 65535),
  version       TEXT NOT NULL DEFAULT '',
  mode          TEXT NOT NULL DEFAULT '',
  region        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden')),
  status_source TEXT NOT NULL DEFAULT 'none' CHECK (status_source IN ('ping','none')),
  params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  online        BOOLEAN,
  players       INT,
  max_players   INT,
  motd          TEXT NOT NULL DEFAULT '',
  checked_at    TIMESTAMPTZ,
  last_error    TEXT NOT NULL DEFAULT '',
  created_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS launcher_servers_addr ON launcher_servers (kind, lower(host), port);
CREATE INDEX IF NOT EXISTS launcher_servers_list ON launcher_servers (kind, status);

CREATE TABLE IF NOT EXISTS launcher_server_favs (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  server_id  TEXT NOT NULL REFERENCES launcher_servers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, server_id)
);
CREATE TABLE IF NOT EXISTS launcher_server_history (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  server_id  TEXT NOT NULL REFERENCES launcher_servers(id) ON DELETE CASCADE,
  last_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  count      INT NOT NULL DEFAULT 1,
  PRIMARY KEY (profile_id, server_id)
);
CREATE INDEX IF NOT EXISTS launcher_server_history_idx ON launcher_server_history (profile_id, last_at DESC);

-- Журнал изменений карточек серверов: по нему возможен откат.
CREATE TABLE IF NOT EXISTS launcher_server_log (
  id         BIGSERIAL PRIMARY KEY,
  server_id  TEXT NOT NULL,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  before     JSONB,
  after      JSONB,
  batch      TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launcher_server_log_idx ON launcher_server_log (server_id, id DESC);
CREATE INDEX IF NOT EXISTS launcher_server_log_batch ON launcher_server_log (batch) WHERE batch IS NOT NULL;

CREATE TABLE IF NOT EXISTS launcher_profiles (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('gta','minecraft')),
  name       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launcher_profiles_idx ON launcher_profiles (profile_id, kind);

-- ───── Sky Game Launcher ─────
CREATE TABLE IF NOT EXISTS launcher_games (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  short_descr        TEXT NOT NULL DEFAULT '',
  descr              TEXT NOT NULL DEFAULT '',
  genres             TEXT[] NOT NULL DEFAULT '{}',
  developer          TEXT NOT NULL DEFAULT '',
  publisher          TEXT NOT NULL DEFAULT '',
  requirements       JSONB NOT NULL DEFAULT '{}'::jsonb,
  os                 TEXT[] NOT NULL DEFAULT '{}',
  links              JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_payment','pending_review','needs_changes','published','rejected','unpublished','blocked')),
  published_build_id TEXT,
  status_note        TEXT NOT NULL DEFAULT '',
  featured           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by         TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS launcher_games_status ON launcher_games (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS launcher_game_members (
  game_id    TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','developer','publisher','analyst')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, profile_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS launcher_game_one_owner ON launcher_game_members (game_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS launcher_game_members_profile ON launcher_game_members (profile_id);

CREATE TABLE IF NOT EXISTS launcher_game_media (
  id         TEXT PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('cover','screenshot')),
  mime       TEXT NOT NULL,
  bytes      INT  NOT NULL,
  data       BYTEA NOT NULL,
  position   INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launcher_game_media_idx ON launcher_game_media (game_id, kind, position);

CREATE TABLE IF NOT EXISTS launcher_builds (
  id          TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'release' CHECK (channel IN ('release','test')),
  status      TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','uploaded','failed','submitted','approved','rejected','published','superseded')),
  launch_exe  TEXT NOT NULL DEFAULT '',
  launch_args TEXT[] NOT NULL DEFAULT '{}',
  notes       TEXT NOT NULL DEFAULT '',
  total_bytes BIGINT NOT NULL DEFAULT 0,
  file_count  INT NOT NULL DEFAULT 0,
  scan_status TEXT NOT NULL DEFAULT 'none' CHECK (scan_status IN ('none','not_run','clean','infected','error')),
  scan_detail TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, version, channel)
);
CREATE INDEX IF NOT EXISTS launcher_builds_game ON launcher_builds (game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS launcher_build_files (
  build_id TEXT NOT NULL REFERENCES launcher_builds(id) ON DELETE CASCADE,
  path     TEXT NOT NULL,
  sha256   TEXT NOT NULL,
  size     BIGINT NOT NULL,
  PRIMARY KEY (build_id, path)
);
CREATE INDEX IF NOT EXISTS launcher_build_files_sha ON launcher_build_files (sha256);

CREATE TABLE IF NOT EXISTS launcher_orders (
  id          TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount_rub  INT  NOT NULL,
  status      TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','refunded','failed')),
  idem_key    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at     TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  UNIQUE (profile_id, idem_key)
);
-- Один оплаченный (не возвращённый) заказ на игру: повторно за ту же заявку не списывается.
CREATE UNIQUE INDEX IF NOT EXISTS launcher_orders_one_paid ON launcher_orders (game_id) WHERE status = 'paid';

CREATE TABLE IF NOT EXISTS launcher_library (
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id        TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  source         TEXT NOT NULL DEFAULT 'free' CHECK (source IN ('free','gift','owner','test')),
  favorite       BOOLEAN NOT NULL DEFAULT FALSE,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at TIMESTAMPTZ,
  play_count     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, game_id)
);
CREATE INDEX IF NOT EXISTS launcher_library_recent ON launcher_library (profile_id, last_played_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS launcher_news (
  id         TEXT PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launcher_news_game ON launcher_news (game_id, created_at DESC);

-- Агрегированные события (без личных данных): установки, обновления, запуски, ошибки.
CREATE TABLE IF NOT EXISTS launcher_events (
  day     DATE NOT NULL,
  game_id TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  n       INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game_id, kind)
);

CREATE TABLE IF NOT EXISTS launcher_mod_log (
  id       BIGSERIAL PRIMARY KEY,
  game_id  TEXT NOT NULL,
  actor_id TEXT,
  action   TEXT NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launcher_mod_log_game ON launcher_mod_log (game_id, id DESC);

CREATE TABLE IF NOT EXISTS launcher_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
