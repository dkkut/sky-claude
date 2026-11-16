-- Sky Account: заморозка аккаунтов (по Sky ID) и каналов/групп (по чату) администрацией, апелляции, журнал. НЕ путать с «заморозкой новых входов» самим человеком (121_account_freeze.sql).
-- Данные человека при заморозке не удаляются, деньги не возвращаются и не списываются автоматически.
CREATE TABLE IF NOT EXISTS acct_freezes (
  id              TEXT PRIMARY KEY,                       -- afz-<uuid>
  target_type     TEXT NOT NULL,                          -- account | channel
  target_id       TEXT NOT NULL,                          -- Sky ID или id чата
  reason          TEXT NOT NULL,                          -- внутренняя причина (видна сотрудникам)
  public_reason   TEXT NOT NULL DEFAULT '',               -- что можно показать человеку; пусто — причина не раскрывается
  show_reason     BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'active',         -- active | lifted | expired
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  allowed_chat_ids TEXT[] NOT NULL DEFAULT '{}',          -- для аккаунта: чаты, доступные при заморозке
  created_by      TEXT NOT NULL,
  lifted_by       TEXT,
  lifted_at       TIMESTAMPTZ,
  lift_note       TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS acct_freezes_active_uq ON acct_freezes (target_type, target_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS acct_freezes_status_idx ON acct_freezes (status, started_at DESC);
CREATE TABLE IF NOT EXISTS acct_freeze_appeals (
  id          TEXT PRIMARY KEY,                           -- afa-<uuid>
  freeze_id   TEXT NOT NULL REFERENCES acct_freezes(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL,
  text_enc    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',               -- open | accepted | rejected
  decided_by  TEXT,
  decision    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS acct_freeze_appeals_open ON acct_freeze_appeals (freeze_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS acct_freeze_log (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id  TEXT NOT NULL,
  freeze_id TEXT NOT NULL,
  action    TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS acct_freeze_log_idx ON acct_freeze_log (freeze_id, id);
