-- Sky GO «Организации», этап 2: бронирование по расписанию, отзывы, жалобы. Только добавляет.
ALTER TABLE kb_items ADD COLUMN IF NOT EXISTS duration_min INT;
ALTER TABLE kb_items ADD COLUMN IF NOT EXISTS capacity INT NOT NULL DEFAULT 1;
ALTER TABLE gop_places ADD COLUMN IF NOT EXISTS book_enabled      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE gop_places ADD COLUMN IF NOT EXISTS book_step_min     INT NOT NULL DEFAULT 30;
ALTER TABLE gop_places ADD COLUMN IF NOT EXISTS book_horizon_days INT NOT NULL DEFAULT 30;
ALTER TABLE gop_places ADD COLUMN IF NOT EXISTS book_lead_min     INT NOT NULL DEFAULT 60;
ALTER TABLE gop_places ADD COLUMN IF NOT EXISTS book_auto_confirm BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS gop_days_off (
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (business_id, day)
);

CREATE TABLE IF NOT EXISTS gop_bookings (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL,
  item_title    TEXT NOT NULL DEFAULT '',
  price_rub     INT  NOT NULL DEFAULT 0,
  buyer_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'requested',   -- requested|confirmed|rejected|cancelled|done|no_show
  contact_enc   TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  owner_comment TEXT NOT NULL DEFAULT '',
  idem_key      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gop_bookings_idem_uq ON gop_bookings (buyer_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS gop_bookings_item_idx  ON gop_bookings (item_id, starts_at) WHERE status IN ('requested','confirmed');
CREATE INDEX IF NOT EXISTS gop_bookings_biz_idx   ON gop_bookings (business_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS gop_bookings_buyer_idx ON gop_bookings (buyer_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS gop_reviews (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating      INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT NOT NULL DEFAULT '',
  reply       TEXT NOT NULL DEFAULT '',
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_by   TEXT,
  hidden_reason TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, profile_id)
);
CREATE INDEX IF NOT EXISTS gop_reviews_biz_idx ON gop_reviews (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gop_reports (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',            -- open|resolved|dismissed
  resolved_by TEXT,
  resolution  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS gop_reports_open_uq ON gop_reports (business_id, profile_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS gop_reports_status_idx ON gop_reports (status, created_at DESC);
