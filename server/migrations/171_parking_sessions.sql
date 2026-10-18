-- Sky Parking, этап B: автомобили, парковочные сессии, платежи, возвраты, жалобы. Только добавляет.
CREATE TABLE IF NOT EXISTS parking_vehicles (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plate_enc  TEXT NOT NULL,
  plate_hash TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, plate_hash)
);

CREATE TABLE IF NOT EXISTS parking_sessions (
  id          TEXT PRIMARY KEY,
  lot_id      TEXT NOT NULL REFERENCES parking_lots(id) ON DELETE RESTRICT,
  org_id      TEXT NOT NULL,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vehicle_id  TEXT REFERENCES parking_vehicles(id) ON DELETE SET NULL,
  plate_enc   TEXT NOT NULL,                       -- снимок номера на момент оплаты
  tariff_snap JSONB NOT NULL,                      -- снимок тарифа: правка тарифа не меняет оплаченное
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  paid_rub    INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  soon_notified BOOLEAN NOT NULL DEFAULT false,
  end_notified  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parking_sessions_profile_idx ON parking_sessions(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS parking_sessions_lot_idx ON parking_sessions(lot_id, status, ends_at);
-- на одном автомобиле одновременно не может быть двух действующих сессий
CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_vehicle_active ON parking_sessions(vehicle_id) WHERE status = 'active' AND vehicle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS parking_payments (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES parking_sessions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('start','extend')),
  minutes    INT NOT NULL,
  amount_rub INT NOT NULL CHECK (amount_rub >= 0),
  status     TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','refunded')),
  idem_key   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, idem_key)
);
CREATE INDEX IF NOT EXISTS parking_payments_session_idx ON parking_payments(session_id);

CREATE TABLE IF NOT EXISTS parking_refunds (
  id          TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL UNIQUE REFERENCES parking_payments(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  lot_id      TEXT NOT NULL,
  org_id      TEXT NOT NULL,
  profile_id  TEXT NOT NULL,
  amount_rub  INT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected')),
  decided_by  TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS parking_refunds_org_idx ON parking_refunds(org_id, status);

CREATE TABLE IF NOT EXISTS parking_reports (
  id         TEXT PRIMARY KEY,
  lot_id     TEXT NOT NULL REFERENCES parking_lots(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('wrong_info','closed','unsafe','price','other')),
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by TEXT,
  resolution TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, profile_id)
);
CREATE INDEX IF NOT EXISTS parking_reports_status_idx ON parking_reports(status, created_at);
