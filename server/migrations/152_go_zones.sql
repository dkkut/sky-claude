-- Sky GO: зоны внутри города (круг: центр + радиус). Доплата за подачу/назначение в зоне либо закрытая зона.
CREATE TABLE IF NOT EXISTS go_zones (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  name TEXT NOT NULL,
  services TEXT[] NOT NULL DEFAULT ARRAY['taxi','delivery'],
  kind TEXT NOT NULL CHECK (kind IN ('surcharge','closed')),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_km REAL NOT NULL CHECK (radius_km > 0 AND radius_km <= 100),
  surcharge_rub INTEGER NOT NULL DEFAULT 0 CHECK (surcharge_rub >= 0 AND surcharge_rub <= 5000),
  note TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_zones_city_idx ON go_zones (city) WHERE active;
