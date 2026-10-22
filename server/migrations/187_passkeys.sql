-- Ключи доступа (WebAuthn / Face ID): один ключ на устройство, общий для входа в Sky ID. Только добавляет.
CREATE TABLE IF NOT EXISTS sky_passkeys (
  id           TEXT PRIMARY KEY,
  sky_id       TEXT NOT NULL REFERENCES sky_ids(id) ON DELETE CASCADE,
  cred_id      TEXT NOT NULL UNIQUE,
  public_jwk   JSONB NOT NULL,
  alg          INT  NOT NULL,
  sign_count   BIGINT NOT NULL DEFAULT 0,
  name         TEXT NOT NULL DEFAULT 'Ключ доступа',
  icon         TEXT NOT NULL DEFAULT 'key',
  transports   TEXT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sky_passkeys_sky_idx ON sky_passkeys (sky_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id         TEXT PRIMARY KEY,
  sky_id     TEXT,
  purpose    TEXT NOT NULL,
  challenge  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS passkey_challenges_exp_idx ON passkey_challenges (expires_at);
