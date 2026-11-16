-- Sky Marketplace: биржа специалистов. Денег здесь нет: условия и сумма — договорённость сторон, оплата идёт вне модуля (см. docs).
CREATE TABLE IF NOT EXISTS specialist_profiles (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  headline      TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  specializations TEXT[] NOT NULL DEFAULT '{}',
  services      JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{title, workType, priceFrom, note}]
  work_types    TEXT[] NOT NULL DEFAULT '{}',              -- one_time | long_term
  availability  TEXT NOT NULL DEFAULT 'open',              -- open | busy | closed
  availability_note TEXT NOT NULL DEFAULT '',
  photo         BYTEA,
  photo_type    TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',             -- draft | pending | published | rejected | suspended
  status_reason TEXT NOT NULL DEFAULT '',
  submitted_by  TEXT,
  reviewed_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialist_profiles_pub_idx ON specialist_profiles (status, category);
CREATE TABLE IF NOT EXISTS specialist_portfolio (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES specialist_profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  image       BYTEA,
  image_type  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialist_portfolio_idx ON specialist_portfolio (profile_id);
CREATE TABLE IF NOT EXISTS specialist_offers (
  id            TEXT PRIMARY KEY,
  specialist_id TEXT NOT NULL REFERENCES specialist_profiles(id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                             -- one_time | long_term
  title         TEXT NOT NULL,
  brief_enc     TEXT NOT NULL,
  budget_rub    INTEGER,                                   -- предложенная сумма, справочно: Sky её не принимает и не удерживает
  deadline      DATE,
  status        TEXT NOT NULL DEFAULT 'sent',              -- sent | negotiating | accepted | declined | withdrawn | in_progress | completed | cancelled | disputed
  status_reason TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialist_offers_client_idx ON specialist_offers (client_id, status);
CREATE INDEX IF NOT EXISTS specialist_offers_spec_idx ON specialist_offers (specialist_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS specialist_offers_active_pair ON specialist_offers (specialist_id, client_id) WHERE status IN ('sent','negotiating','accepted','in_progress','disputed');
CREATE TABLE IF NOT EXISTS specialist_messages (
  id         BIGSERIAL PRIMARY KEY,
  offer_id   TEXT NOT NULL REFERENCES specialist_offers(id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL,
  text_enc   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialist_messages_idx ON specialist_messages (offer_id, id);
CREATE TABLE IF NOT EXISTS specialist_reports (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,                               -- profile | offer
  target_id   TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  details_enc TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',                -- open | resolved | dismissed
  resolved_by TEXT,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS specialist_reports_open ON specialist_reports (reporter_id, target_type, target_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS specialist_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id   TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS specialist_log_idx ON specialist_log (target_id, id DESC);
