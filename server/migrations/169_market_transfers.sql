-- Передача магазина или ПВЗ другому аккаунту: владелец предлагает → получатель принимает → администрация Market одобряет.
CREATE TABLE IF NOT EXISTS market_transfers (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('shop','pvz')),
  subject_id    TEXT NOT NULL,                    -- магазин: id профиля владельца; ПВЗ: market_pickup_points.id
  subject_title TEXT NOT NULL DEFAULT '',
  from_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'offered'
                CHECK (status IN ('offered','accepted','approved','rejected','declined','cancelled','expired','failed')),
  message       TEXT NOT NULL DEFAULT '',
  admin_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  admin_comment TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  decided_at    TIMESTAMPTZ
);
-- Одна незавершённая передача на объект.
CREATE UNIQUE INDEX IF NOT EXISTS market_transfers_one_open
  ON market_transfers (kind, subject_id) WHERE status IN ('offered','accepted');
CREATE INDEX IF NOT EXISTS market_transfers_from_idx ON market_transfers (from_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_transfers_to_idx   ON market_transfers (to_id, created_at DESC);
