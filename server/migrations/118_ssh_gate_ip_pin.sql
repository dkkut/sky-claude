-- Подтверждение входа по SSH владельцем (ссылка на почту + код аутентификатора) —
-- та же система, что и вход в панель администратора (112_admin_gate.sql).
CREATE TABLE IF NOT EXISTS ssh_gate_requests (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  poll_hash   TEXT NOT NULL,
  ssh_user    TEXT NOT NULL DEFAULT '',
  ssh_host    TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  device      TEXT NOT NULL DEFAULT '',
  attempts    INT  NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | denied | exhausted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  decided_at  TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  outcome     TEXT
);
CREATE INDEX IF NOT EXISTS ssh_gate_requests_created_idx ON ssh_gate_requests (created_at DESC);

-- PIN-код при смене IP: по желанию человека, задаётся в настройках Sky ID.
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS ip_pin_enabled      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS ip_pin_hash         TEXT;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS ip_pin_fails        INT NOT NULL DEFAULT 0;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS ip_pin_locked_until TIMESTAMPTZ;

-- Сброс PIN: код на почту + код аутентификатора.
CREATE TABLE IF NOT EXISTS ip_pin_resets (
  id              TEXT PRIMARY KEY,
  sky_id          TEXT NOT NULL,
  code_hash       TEXT NOT NULL,
  attempts        INT  NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ip_pin_resets_sky_idx ON ip_pin_resets (sky_id, created_at DESC);
