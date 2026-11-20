-- Способы получения заказа в Sky Market: самовывоз из магазина, доставка продавцом, пункт выдачи, почта/перевозчик.
CREATE TABLE IF NOT EXISTS market_delivery_options (
  seller_id     TEXT NOT NULL REFERENCES market_sellers(profile_id) ON DELETE CASCADE,
  method        TEXT NOT NULL CHECK (method IN ('store_pickup','courier','pvz','post')),
  enabled       BOOLEAN NOT NULL DEFAULT true,
  price_kop     BIGINT  NOT NULL DEFAULT 0 CHECK (price_kop >= 0 AND price_kop <= 100000000),
  free_from_kop BIGINT  CHECK (free_from_kop IS NULL OR free_from_kop > 0),
  min_days      INTEGER CHECK (min_days IS NULL OR (min_days >= 0 AND min_days <= 60)),
  max_days      INTEGER CHECK (max_days IS NULL OR (max_days >= 0 AND max_days <= 60)),
  city          TEXT,
  address       TEXT,   -- адрес магазина для самовывоза (публичный: его продавец сам опубликовал)
  hours         TEXT,
  note          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, method)
);
ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS delivery_method TEXT,
  ADD COLUMN IF NOT EXISTS delivery_fee_kop BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_snap JSONB;
