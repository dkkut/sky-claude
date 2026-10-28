-- Блокировка отдельных вкладок (модулей) для отдельных людей и заявки на вывод остатка баланса у заблокированных.
CREATE TABLE IF NOT EXISTS user_module_blocks (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module      TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  show_reason BOOLEAN NOT NULL DEFAULT false,
  blocked_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, module)
);

CREATE TABLE IF NOT EXISTS withdraw_requests (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount_rub  INTEGER NOT NULL CHECK (amount_rub > 0),
  details_enc TEXT NOT NULL,                       -- куда перевести (шифр)
  status      TEXT NOT NULL DEFAULT 'pending',     -- pending | paid | rejected | cancelled
  reason      TEXT NOT NULL DEFAULT '',
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT withdraw_status_chk CHECK (status IN ('pending','paid','rejected','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS withdraw_one_open ON withdraw_requests (profile_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS withdraw_status_idx ON withdraw_requests (status, created_at);
