-- Система ELO в Sky Games: история изменений, пик рейтинга, защита от накрутки (повторные матчи с теми же соперниками).
CREATE TABLE IF NOT EXISTS game_rating_history (
  id         BIGSERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL,
  match_id   TEXT,
  elo_before INT NOT NULL,
  elo_after  INT NOT NULL,
  delta      INT NOT NULL,
  won        BOOLEAN NOT NULL,
  k          INT NOT NULL,
  rated      BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE: матч сыгран, но рейтинг не менялся (лимит повторных матчей)
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_rating_history_player ON game_rating_history (profile_id, game_id, id DESC);
ALTER TABLE game_ratings ADD COLUMN IF NOT EXISTS peak_elo INT NOT NULL DEFAULT 1000;
CREATE INDEX IF NOT EXISTS game_ratings_board ON game_ratings (game_id, elo DESC);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pair_key TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rated BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS matches_pair_idx ON matches (game_id, pair_key, resolved_at) WHERE status = 'completed';
