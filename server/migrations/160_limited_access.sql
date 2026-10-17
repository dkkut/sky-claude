-- Ограниченный доступ на неподтверждённом устройстве: настройка Sky ID и запросы подтверждения входа.
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS limit_untrusted BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS device_approvals (
  id           TEXT PRIMARY KEY,
  sky_id       TEXT NOT NULL,
  sid          TEXT NOT NULL,                 -- ограниченная сессия, которую подтверждают
  device_hash  TEXT,                          -- хеш идентификатора устройства (пусто, если клиент его не прислал)
  label        TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired')),
  decided_via  TEXT,                          -- device | backup_email | denied
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  decided_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS device_approvals_sky_idx ON device_approvals (sky_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS device_approvals_sid_idx ON device_approvals (sid);
