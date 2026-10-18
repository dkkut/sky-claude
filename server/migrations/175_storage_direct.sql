-- Sky Storage: прямой доступ к хранилищу через S3-шлюз Sky после подтверждения владельцем (как вход по SSH). Только добавляет.
CREATE TABLE IF NOT EXISTS storage_direct_requests (
  id            TEXT PRIMARY KEY,
  requester_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('read','readwrite')),
  minutes       INT  NOT NULL CHECK (minutes BETWEEN 5 AND 60),
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired','revoked')),
  token_hash    TEXT,
  token_used_at TIMESTAMPTZ,
  mailed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,                 -- до какого времени ждём решения
  approved_at   TIMESTAMPTZ,
  decided_via   TEXT,
  access_until  TIMESTAMPTZ,                          -- до какого времени действуют выданные ключи
  access_key_id TEXT UNIQUE,
  secret_enc    TEXT,                                 -- секрет ключа, зашифрован (encryptSecret); после срока стирается
  secret_shown_at TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT,
  info          JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_direct_one_open ON storage_direct_requests (requester_id) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS storage_direct_token_idx ON storage_direct_requests (token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS storage_direct_log (
  id         BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  op         TEXT NOT NULL,
  key        TEXT NOT NULL DEFAULT '',
  status     INT NOT NULL DEFAULT 0,
  bytes      BIGINT NOT NULL DEFAULT 0,
  net        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS storage_direct_log_idx ON storage_direct_log (request_id, id DESC);
