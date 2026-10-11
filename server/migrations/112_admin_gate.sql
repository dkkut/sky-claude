-- Двухэтапный вход в панель администратора: ссылка на почту + код аутентификатора.
-- Запрос привязан к сессии, из которой его сделали; открывается на ограниченное время.
CREATE TABLE IF NOT EXISTS admin_gate_requests (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL,
  sid         TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  device      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  attempts    INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  outcome     TEXT
);
CREATE INDEX IF NOT EXISTS admin_gate_requests_profile_idx ON admin_gate_requests (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_gate_open (
  sid         TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL,
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_gate_open_profile_idx ON admin_gate_open (profile_id);
