-- Лейблы, альбомы и подтверждение прав правообладателя (Sky Music). Только добавляет.
CREATE TABLE IF NOT EXISTS music_labels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  description TEXT,                                  -- зашифровано
  owner_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  rights_verified_at TIMESTAMPTZ,
  rights_verified_by TEXT,
  rights_holder TEXT,                                -- кто подтверждён правообладателем (как указано в заявке)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_labels_live_name ON music_labels (name_norm) WHERE NOT hidden;
CREATE INDEX IF NOT EXISTS music_labels_owner ON music_labels (owner_id);

CREATE TABLE IF NOT EXISTS music_albums (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  year        INT,
  description TEXT,                                  -- зашифровано
  card_id     TEXT REFERENCES music_artist_cards(id) ON DELETE SET NULL,
  label_id    TEXT REFERENCES music_labels(id) ON DELETE SET NULL,
  owner_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,   -- кто создал
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_albums_card ON music_albums (card_id);
CREATE INDEX IF NOT EXISTS music_albums_label ON music_albums (label_id);
CREATE INDEX IF NOT EXISTS music_albums_owner ON music_albums (owner_id);
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS album_id TEXT REFERENCES music_albums(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS music_tracks_album_idx ON music_tracks (album_id) WHERE album_id IS NOT NULL;

ALTER TABLE music_artist_cards ADD COLUMN IF NOT EXISTS rights_verified_at TIMESTAMPTZ;
ALTER TABLE music_artist_cards ADD COLUMN IF NOT EXISTS rights_verified_by TEXT;
ALTER TABLE music_artist_cards ADD COLUMN IF NOT EXISTS rights_holder TEXT;

-- Заявки на подтверждение прав правообладателя (для карточки музыканта или лейбла).
CREATE TABLE IF NOT EXISTS music_rights_claims (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('card','label')),
  subject_id  TEXT NOT NULL,
  claimant_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  holder      TEXT NOT NULL,                         -- правообладатель (имя/организация)
  note        TEXT,                                  -- зашифровано
  links       TEXT,                                  -- зашифровано, JSON https-ссылок на подтверждающие документы
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','withdrawn','revoked')),
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  reason      TEXT,                                  -- зашифровано
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_rights_pending_uq ON music_rights_claims (kind, subject_id, claimant_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS music_rights_status ON music_rights_claims (status, created_at);
