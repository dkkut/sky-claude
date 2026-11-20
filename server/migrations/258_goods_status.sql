-- Статус товара: где он сейчас и примерное время доставки.
-- Указывает продавец или назначенный им сотрудник; если есть трек-номер,
-- место берётся и у службы доставки (server/tracking.mjs).
CREATE TABLE IF NOT EXISTS market_goods_status (
  order_id   TEXT PRIMARY KEY REFERENCES market_orders(id) ON DELETE CASCADE,
  place      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  eta        TIMESTAMPTZ,
  eta_to     TIMESTAMPTZ,
  set_by     TEXT NOT NULL,
  set_role   TEXT NOT NULL CHECK (set_role IN ('seller', 'staff')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_goods_status_log (
  id         BIGSERIAL PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  place      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  eta        TIMESTAMPTZ,
  eta_to     TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_goods_status_log_order_idx ON market_goods_status_log (order_id, id);

-- Люди, которым продавец поручил обновлять статус товаров.
CREATE TABLE IF NOT EXISTS market_seller_staff (
  seller_id  TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  added_by   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, profile_id)
);
CREATE INDEX IF NOT EXISTS market_seller_staff_profile_idx ON market_seller_staff (profile_id);
