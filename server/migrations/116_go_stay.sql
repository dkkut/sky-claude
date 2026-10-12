-- Sky GO: «Жилье и отдых» — квартиры и дома, туры, отели. Размещение — через кабинет исполнителя (роли host / tour_operator / hotel),
-- бронь — заказ вида 'stay' в go_orders, оплата — напрямую владельцу (go_order_pay), как у остальных сервисов.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint
            WHERE contype = 'c' AND conrelid IN ('go_role_tariff'::regclass, 'go_executors'::regclass)
              AND pg_get_constraintdef(oid) LIKE '%taxi_driver%' LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
  END LOOP;
  FOR r IN SELECT conrelid::regclass AS t, conname FROM pg_constraint
            WHERE contype = 'c' AND conrelid = 'go_orders'::regclass AND pg_get_constraintdef(oid) LIKE '%delivery%' AND pg_get_constraintdef(oid) LIKE '%kind%' LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname);
  END LOOP;
END $$;
ALTER TABLE go_role_tariff ADD CONSTRAINT go_role_tariff_role_check
  CHECK (role IN ('taxi_driver','courier','food_seller','company','host','tour_operator','hotel'));
ALTER TABLE go_executors ADD CONSTRAINT go_executors_role_check
  CHECK (role IN ('taxi_driver','courier','food_seller','company','host','tour_operator','hotel'));
ALTER TABLE go_orders ADD CONSTRAINT go_orders_kind_check CHECK (kind IN ('taxi','food','delivery','stay'));
INSERT INTO go_role_tariff (role, tariff_code) VALUES ('host','general'), ('tour_operator','general'), ('hotel','general')
ON CONFLICT (role) DO NOTHING;

-- Объявления. Видимость: published + одобренный кабинет + действующая подписка; hidden — снято администрацией.
CREATE TABLE IF NOT EXISTS go_listings (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('home','tour','hotel')),
  title      TEXT NOT NULL,
  descr      TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  price_rub  INT  NOT NULL DEFAULT 0 CHECK (price_rub >= 0),      -- «от»: за ночь / за человека; пересчитывается из data
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','hidden')),
  mod_note   TEXT NOT NULL DEFAULT '',
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,                    -- home: гости, комнаты, правила; hotel: номера; tour: отправления
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_listings_owner_idx ON go_listings (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS go_listings_catalog_idx ON go_listings (kind, city) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS go_listing_photos (
  id         TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES go_listings(id) ON DELETE CASCADE,
  sort       INT  NOT NULL DEFAULT 0,
  mime       TEXT NOT NULL,
  size       INT  NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_listing_photos_listing_idx ON go_listing_photos (listing_id, sort);

CREATE INDEX IF NOT EXISTS go_orders_stay_listing_idx ON go_orders ((data->>'listingId')) WHERE kind = 'stay';
