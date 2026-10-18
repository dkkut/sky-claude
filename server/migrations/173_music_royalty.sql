-- Роялти экосистемы: переключатели (по артисту и глобальный) + журнал. Начислений здесь нет.
ALTER TABLE music_artist_cards ADD COLUMN IF NOT EXISTS royalty_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS music_royalty_settings (
  id         INT PRIMARY KEY CHECK (id = 1),
  mode       TEXT NOT NULL DEFAULT 'per_artist' CHECK (mode IN ('per_artist','all_on','all_off')),
  reason     TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO music_royalty_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS music_royalty_log (
  id       BIGSERIAL PRIMARY KEY,
  scope    TEXT NOT NULL CHECK (scope IN ('global','card')),
  card_id  TEXT,
  actor_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason   TEXT NOT NULL DEFAULT '',
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_royalty_log_idx ON music_royalty_log(id DESC);
