-- Sky Ops: задания для сервера из админки (выполняет агент на хосте) и сведения о самом агенте.
CREATE TABLE IF NOT EXISTS ops_jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed | cancelled
  mutating      BOOLEAN NOT NULL DEFAULT FALSE,
  requested_by  TEXT NOT NULL,
  output        TEXT NOT NULL DEFAULT '',
  chunks        INT NOT NULL DEFAULT 0,
  exit_code     INT,
  note          TEXT NOT NULL DEFAULT '',
  runner        TEXT,
  cancel        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  heartbeat_at  TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
-- Одновременно живёт одно задание, которое что-то меняет (деплой, починка, перезапуск, сборка).
CREATE UNIQUE INDEX IF NOT EXISTS ops_jobs_one_mutating ON ops_jobs ((TRUE)) WHERE mutating AND status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS ops_jobs_created ON ops_jobs (created_at DESC);
CREATE TABLE IF NOT EXISTS ops_agent (
  id        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  runner    TEXT,
  version   TEXT,
  seen_at   TIMESTAMPTZ
);
