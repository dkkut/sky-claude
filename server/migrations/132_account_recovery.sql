-- Модули 15–16: резервные коды второго фактора, сброс аутентификатора с ожиданием, защита смены почты/номера.
CREATE TABLE IF NOT EXISTS sky_backup_codes (
  id         BIGSERIAL PRIMARY KEY,
  sky_id     TEXT NOT NULL,
  code_hash  TEXT NOT NULL,                 -- HMAC, открытый код хранить нельзя
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sky_backup_codes_hash_idx ON sky_backup_codes (code_hash);
CREATE INDEX IF NOT EXISTS sky_backup_codes_sky_idx ON sky_backup_codes (sky_id);

CREATE TABLE IF NOT EXISTS two_factor_resets (
  id           TEXT PRIMARY KEY,
  sky_id       TEXT NOT NULL,
  finish_hash  TEXT NOT NULL,               -- ссылка «завершить» (работает только после ready_at)
  cancel_hash  TEXT NOT NULL,               -- ссылка «это не я, отменить» (работает всегда, пока запрос открыт)
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | done | cancelled | expired
  ip           TEXT NOT NULL DEFAULT '',
  ua           TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at     TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  decided_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS two_factor_resets_open_idx ON two_factor_resets (sky_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS two_factor_resets_finish_idx ON two_factor_resets (finish_hash);
CREATE UNIQUE INDEX IF NOT EXISTS two_factor_resets_cancel_idx ON two_factor_resets (cancel_hash);

CREATE TABLE IF NOT EXISTS contact_change_log (
  id         BIGSERIAL PRIMARY KEY,
  sky_id     TEXT NOT NULL,
  kind       TEXT NOT NULL,                 -- email | phone
  old_masked TEXT NOT NULL DEFAULT '',
  new_masked TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_change_log_idx ON contact_change_log (sky_id, created_at DESC);
