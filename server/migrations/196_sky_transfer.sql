-- Sky Transfer: передача файлов между своими устройствами (через сервер, во временном зашифрованном хранилище).
CREATE TABLE IF NOT EXISTS transfer_devices (
  id          TEXT PRIMARY KEY,
  sky_id      TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'web',            -- phone | desktop | web | tv | car | other
  can_receive BOOLEAN NOT NULL DEFAULT TRUE,
  status      TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | revoked
  approved_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sky_id, device_hash)
);
CREATE INDEX IF NOT EXISTS transfer_devices_sky_idx ON transfer_devices (sky_id);

CREATE TABLE IF NOT EXISTS transfer_prefs (
  sky_id       TEXT PRIMARY KEY,
  accept       TEXT NOT NULL DEFAULT 'own',          -- own | off
  confirm      BOOLEAN NOT NULL DEFAULT FALSE,       -- спрашивать перед получением
  keep_hours   INT NOT NULL DEFAULT 0,               -- 0: удалять файлы сразу после получения
  history_days INT NOT NULL DEFAULT 30,              -- 0: историю не хранить
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfers (
  id          TEXT PRIMARY KEY,
  sky_id      TEXT NOT NULL,
  from_device TEXT NOT NULL REFERENCES transfer_devices(id) ON DELETE CASCADE,
  to_device   TEXT NOT NULL REFERENCES transfer_devices(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  size        BIGINT NOT NULL,
  mime        TEXT NOT NULL DEFAULT '',
  chunk_size  INT NOT NULL,
  chunks      INT NOT NULL,
  hashes      JSONB NOT NULL,                        -- SHA-256 каждого куска (hex), объявлены отправителем и проверены сервером
  digest      TEXT NOT NULL,                         -- SHA-256 от склеенных хешей кусков
  status      TEXT NOT NULL DEFAULT 'uploading',     -- uploading | ready | awaiting_accept | downloading | delivered | cancelled | rejected | failed | expired
  error       TEXT,
  bytes_up    BIGINT NOT NULL DEFAULT 0,
  bytes_down  BIGINT NOT NULL DEFAULT 0,
  files_gone  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS transfers_sky_idx ON transfers (sky_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers (status, expires_at);

CREATE TABLE IF NOT EXISTS transfer_chunks (
  transfer_id TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  idx         INT NOT NULL,
  bytes       INT NOT NULL,
  PRIMARY KEY (transfer_id, idx)
);
