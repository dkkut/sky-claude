ALTER TABLE launcher_builds ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE launcher_builds ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE launcher_builds ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE launcher_builds ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE launcher_builds ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '';
ALTER TABLE launcher_orders ADD COLUMN IF NOT EXISTS refund_reason TEXT NOT NULL DEFAULT '';
-- Передача владения игрой: отдельное предложение, которое должен принять получатель.
CREATE TABLE IF NOT EXISTS launcher_game_transfers (
  id         TEXT PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES launcher_games(id) ON DELETE CASCADE,
  from_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS launcher_transfer_one_pending ON launcher_game_transfers (game_id) WHERE status = 'pending';
