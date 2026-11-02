-- Пометка «признан иноагентом на территории РФ» в карточке музыканта. Ставит и снимает только администрация (право content), с причиной.
ALTER TABLE music_artist_cards ADD COLUMN IF NOT EXISTS foreign_agent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE music_artist_cards ADD COLUMN IF NOT EXISTS foreign_agent_at TIMESTAMPTZ;
ALTER TABLE music_artist_cards ADD COLUMN IF NOT EXISTS foreign_agent_by TEXT;
