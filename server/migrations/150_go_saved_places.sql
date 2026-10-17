-- Sky GO: сохранённые места пассажира (дом, работа, другие). Историю адресов даёт история заказов — отдельной таблицы нет.
CREATE TABLE IF NOT EXISTS go_saved_places (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('home','work','other')),
  label      TEXT NOT NULL,
  address    TEXT NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_saved_places_profile_idx ON go_saved_places (profile_id, kind);
-- «Дом» и «Работа» у человека по одному.
CREATE UNIQUE INDEX IF NOT EXISTS go_saved_places_single_idx ON go_saved_places (profile_id, kind) WHERE kind IN ('home','work');
