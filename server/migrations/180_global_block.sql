-- Глобальная блокировка: по Sky ID, устройству, адресу, почте и номеру; затрагивает все связанные Sky ID.
-- Идентификаторы хранятся только как HMAC (устройство, адрес, почта, номер), для админки — маска в label.
CREATE TABLE IF NOT EXISTS global_blocks (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL,                       -- одна операция блокировки = одна группа
  kind          TEXT NOT NULL CHECK (kind IN ('skyid','device','ip','email','phone')),
  value_hash    TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT '',
  origin_sky_id TEXT,                                -- с какого Sky ID начали
  reason        TEXT NOT NULL,                       -- для администрации
  public_reason TEXT NOT NULL DEFAULT '',            -- видно человеку на экране блокировки
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,                         -- NULL — бессрочно
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT,
  revoke_reason TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS global_blocks_active_uq ON global_blocks (kind, value_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS global_blocks_group_idx ON global_blocks (group_id);

-- Какие устройства и адреса видел каждый Sky ID (при успешном входе). Только хеши.
CREATE TABLE IF NOT EXISTS sky_seen_ids (
  sky_id     TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('device','ip')),
  value_hash TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sky_id, kind, value_hash)
);
CREATE INDEX IF NOT EXISTS sky_seen_ids_value_idx ON sky_seen_ids (kind, value_hash);

-- Sky ID, которых блокировка по общему признаку не касается (принятая апелляция).
CREATE TABLE IF NOT EXISTS global_block_exempt (
  sky_id     TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  appeal_id  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sky_id, group_id)
);

CREATE TABLE IF NOT EXISTS global_block_appeals (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL,
  sky_id      TEXT NOT NULL,
  message     TEXT NOT NULL,
  contact     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decided_by  TEXT,
  decision    TEXT NOT NULL DEFAULT '',            -- ответ человеку
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS global_block_appeals_open_uq ON global_block_appeals (sky_id) WHERE status = 'pending';
