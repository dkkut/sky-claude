-- Sky GO: «Моё авто» — машина человека (марка, модель, номер, топливо) и автомойки рядом (тот же поставщик, что и АЗС).
ALTER TABLE go_fuel_stations ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'fuel';
CREATE INDEX IF NOT EXISTS go_fuel_stations_kind_idx ON go_fuel_stations (kind, lat, lng);

CREATE TABLE IF NOT EXISTS go_cars (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  data_enc   TEXT NOT NULL,                      -- марка, модель, номер, топливо — зашифровано
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
