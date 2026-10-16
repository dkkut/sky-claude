-- Общий счёт семьи: один баланс на семью, виден всем участникам.
CREATE TABLE IF NOT EXISTS family_wallet (
  family_id  TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  balance    BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  turnover   BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS family_wallet_tx (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  profile_id  TEXT,
  member_name TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL CHECK (kind IN ('topup','withdraw','goal_contribute','spend')),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  descr       TEXT NOT NULL DEFAULT '',
  idem_key    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_wallet_tx_idx ON family_wallet_tx (family_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS family_wallet_tx_idem ON family_wallet_tx (family_id, profile_id, idem_key) WHERE idem_key IS NOT NULL;
