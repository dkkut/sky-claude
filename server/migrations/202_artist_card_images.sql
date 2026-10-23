-- Фото и баннер карточки музыканта (хранятся в БД, отдаются только вошедшим людям; PNG/JPEG/WebP с проверкой сигнатуры).
CREATE TABLE IF NOT EXISTS music_card_images (
  card_id    TEXT NOT NULL REFERENCES music_artist_cards(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('photo','banner')),
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, kind)
);
