-- Sky Market «На месте»: продажи в городе, области, стране с осмотром на месте. Деньги Sky не принимает — расчёт при встрече между людьми.
CREATE TABLE IF NOT EXISTS onsite_listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  title TEXT NOT NULL,
  descr TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT 'used' CHECK (condition IN ('new','like_new','used','for_parts')),
  price_rub INTEGER NOT NULL DEFAULT 0 CHECK (price_rub >= 0 AND price_rub <= 100000000),
  negotiable BOOLEAN NOT NULL DEFAULT false,
  country TEXT NOT NULL DEFAULT 'RU',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  region_key TEXT NOT NULL DEFAULT '',
  city_key TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'city' CHECK (scope IN ('city','region','country')),
  area TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','reserved','sold','closed','removed')),
  mod_note TEXT NOT NULL DEFAULT '',
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS onsite_listings_seller_idx ON onsite_listings (seller_id, status);
CREATE INDEX IF NOT EXISTS onsite_listings_pub_idx ON onsite_listings (status, country, region_key, city_key, published_at DESC);

CREATE TABLE IF NOT EXISTS onsite_photos (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES onsite_listings(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onsite_photos_listing_idx ON onsite_photos (listing_id, sort);

CREATE TABLE IF NOT EXISTS onsite_deals (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES onsite_listings(id) ON DELETE CASCADE,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','accepted','met','completed','failed','declined','cancelled','expired')),
  note TEXT NOT NULL DEFAULT '',
  meet_at TIMESTAMPTZ,
  meet_place TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL DEFAULT '',
  code_enc TEXT NOT NULL DEFAULT '',
  code_attempts INTEGER NOT NULL DEFAULT 0,
  buyer_done BOOLEAN NOT NULL DEFAULT false,
  seller_done BOOLEAN NOT NULL DEFAULT false,
  outcome_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  met_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS onsite_deals_listing_idx ON onsite_deals (listing_id, status);
CREATE INDEX IF NOT EXISTS onsite_deals_buyer_idx ON onsite_deals (buyer_id, status);
CREATE INDEX IF NOT EXISTS onsite_deals_seller_idx ON onsite_deals (seller_id, status);
-- Один человек — одна живая заявка на объявление.
CREATE UNIQUE INDEX IF NOT EXISTS onsite_deals_live_uq ON onsite_deals (listing_id, buyer_id) WHERE status IN ('requested','accepted','met');

CREATE TABLE IF NOT EXISTS onsite_messages (
  id BIGSERIAL PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES onsite_deals(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  text TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onsite_messages_deal_idx ON onsite_messages (deal_id, id);

CREATE TABLE IF NOT EXISTS onsite_reports (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES onsite_listings(id) ON DELETE CASCADE,
  deal_id TEXT,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','removed','dismissed')),
  decided_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS onsite_reports_status_idx ON onsite_reports (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS onsite_reports_one_uq ON onsite_reports (listing_id, reporter_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS onsite_reviews (
  deal_id TEXT NOT NULL REFERENCES onsite_deals(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  about_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, author_id)
);
CREATE INDEX IF NOT EXISTS onsite_reviews_about_idx ON onsite_reviews (about_id);
