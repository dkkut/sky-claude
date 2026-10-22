-- Sky Sandbox: проверка сборок до публикации. Только добавляет таблицы.
CREATE TABLE IF NOT EXISTS sandbox_builds (
  id              TEXT PRIMARY KEY,
  sha             TEXT NOT NULL,
  ref             TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  profile         TEXT NOT NULL DEFAULT 'full',        -- full | quick
  mode            TEXT,                                 -- isolated | local (сообщает раннер)
  status          TEXT NOT NULL DEFAULT 'queued',       -- queued | running | passed | warnings | failed | error | cancelled
  requested_by    TEXT NOT NULL,
  rerun_of        TEXT,
  runner          TEXT,
  report          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- checks[], files[], notes
  counts          JSONB NOT NULL DEFAULT '{}'::jsonb,
  has_migrations  BOOLEAN NOT NULL DEFAULT FALSE,
  destructive     BOOLEAN NOT NULL DEFAULT FALSE,       -- в новых миграциях есть DROP/TRUNCATE/RENAME и т. п.
  critical        BOOLEAN NOT NULL DEFAULT FALSE,
  critical_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sandbox_builds_created_idx ON sandbox_builds (created_at DESC);
CREATE INDEX IF NOT EXISTS sandbox_builds_status_idx ON sandbox_builds (status);

CREATE TABLE IF NOT EXISTS sandbox_publications (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'deploy',       -- deploy | rollback
  build_id        TEXT,
  sha             TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'approved',     -- approved | running | deployed | failed | rolled_back | cancelled
  approved_by     TEXT NOT NULL,
  owner_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  accept_warnings BOOLEAN NOT NULL DEFAULT FALSE,
  critical        BOOLEAN NOT NULL DEFAULT FALSE,
  has_migrations  BOOLEAN NOT NULL DEFAULT FALSE,
  destructive     BOOLEAN NOT NULL DEFAULT FALSE,
  note            TEXT NOT NULL DEFAULT '',
  prev_sha        TEXT,
  backup_ref      TEXT,
  steps           JSONB NOT NULL DEFAULT '[]'::jsonb,
  health          JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_note    TEXT,
  of_publication  TEXT,
  runner          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sandbox_pub_created_idx ON sandbox_publications (created_at DESC);
-- одновременно живёт не больше одной публикации
CREATE UNIQUE INDEX IF NOT EXISTS sandbox_pub_one_active ON sandbox_publications ((1)) WHERE status IN ('approved','running');
