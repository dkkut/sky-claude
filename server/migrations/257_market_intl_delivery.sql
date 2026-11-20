-- Зарубежная доставка: способ intl, список стран и цены по странам; страна получателя в заказе.
ALTER TABLE market_delivery_options DROP CONSTRAINT IF EXISTS market_delivery_options_method_check;
ALTER TABLE market_delivery_options ADD CONSTRAINT market_delivery_options_method_check
  CHECK (method IN ('store_pickup','courier','pvz','post','intl'));
ALTER TABLE market_delivery_options
  ADD COLUMN IF NOT EXISTS countries TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS country_prices JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS delivery_country TEXT;
