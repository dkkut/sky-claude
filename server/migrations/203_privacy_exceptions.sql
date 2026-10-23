-- Исключения из приватности по людям, скрытие отдельных NFT-подарков в профиле, музыка в профиле.
CREATE TABLE IF NOT EXISTS privacy_exceptions (
  owner_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  other_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL CHECK (scope IN ('write','call','online','gifts','music')),
  mode       TEXT NOT NULL CHECK (mode IN ('allow','deny')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, other_id, scope)
);
CREATE INDEX IF NOT EXISTS privacy_exceptions_other ON privacy_exceptions (other_id, scope);

ALTER TABLE nft_ownership ADD COLUMN IF NOT EXISTS hidden_in_profile BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS profile_music (
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('track','playlist')),
  item_id  TEXT NOT NULL,
  position INT  NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, kind, item_id)
);
