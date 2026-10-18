-- Sky Parking, этап A: организации, парковки, тарифы, модерация. Только добавляет.
CREATE TABLE IF NOT EXISTS parking_orgs (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  suspend_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parking_orgs_owner_idx ON parking_orgs(owner_id);

CREATE TABLE IF NOT EXISTS parking_staff (
  org_id     TEXT NOT NULL REFERENCES parking_orgs(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin','moderator')),
  added_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, profile_id)
);
CREATE INDEX IF NOT EXISTS parking_staff_profile_idx ON parking_staff(profile_id);

CREATE TABLE IF NOT EXISTS parking_lots (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES parking_orgs(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  city         TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  spaces_total INT NOT NULL DEFAULT 0 CHECK (spaces_total >= 0 AND spaces_total <= 10000),
  description  TEXT NOT NULL DEFAULT '',
  hours        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','rejected','suspended','archived')),
  reject_reason TEXT NOT NULL DEFAULT '',
  submitted_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  version      INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS parking_lots_org_idx ON parking_lots(org_id);
CREATE INDEX IF NOT EXISTS parking_lots_status_idx ON parking_lots(status, city);

CREATE TABLE IF NOT EXISTS parking_tariffs (
  id          TEXT PRIMARY KEY,
  lot_id      TEXT NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('hourly','daily','flat')),
  price_rub   INT NOT NULL CHECK (price_rub >= 1 AND price_rub <= 100000),
  free_minutes INT NOT NULL DEFAULT 0 CHECK (free_minutes >= 0 AND free_minutes <= 240),
  min_minutes INT NOT NULL DEFAULT 15 CHECK (min_minutes >= 5),
  max_minutes INT NOT NULL DEFAULT 1440 CHECK (max_minutes <= 43200),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parking_tariffs_lot_idx ON parking_tariffs(lot_id);

CREATE TABLE IF NOT EXISTS parking_events (
  id       BIGSERIAL PRIMARY KEY,
  org_id   TEXT,
  lot_id   TEXT,
  actor_id TEXT,
  action   TEXT NOT NULL,
  detail   JSONB NOT NULL DEFAULT '{}'::jsonb,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parking_events_lot_idx ON parking_events(lot_id, id DESC);
CREATE INDEX IF NOT EXISTS parking_events_org_idx ON parking_events(org_id, id DESC);
