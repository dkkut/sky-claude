-- Sky GO: котировки (фиксация цены), предложения исполнителям, журнал распределения.
-- Только добавление: существующие таблицы и данные не меняются.

CREATE TABLE IF NOT EXISTS go_quotes (
  id             TEXT PRIMARY KEY,
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,                 -- хеш входных условий: если они изменились, котировка недействительна
  tariff_version TEXT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'RUB',
  offers         JSONB NOT NULL,                -- { код: { priceRub, breakdown } }
  params         JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_order_id  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_quotes_profile_idx ON go_quotes (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS go_quotes_expire_idx ON go_quotes (expires_at);

CREATE TABLE IF NOT EXISTS go_order_offers (
  id          BIGSERIAL PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES go_orders(id) ON DELETE CASCADE,
  driver_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','expired','cancelled')),
  rank        INT  NOT NULL DEFAULT 1,
  score       DOUBLE PRECISION NOT NULL DEFAULT 0,
  reasons     JSONB NOT NULL DEFAULT '{}'::jsonb,
  offered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS go_order_offers_open_idx ON go_order_offers (order_id, driver_id) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS go_order_offers_driver_idx ON go_order_offers (driver_id, status, expires_at);
CREATE INDEX IF NOT EXISTS go_order_offers_order_idx ON go_order_offers (order_id, id);

CREATE TABLE IF NOT EXISTS go_dispatch_log (
  id        BIGSERIAL PRIMARY KEY,
  order_id  TEXT NOT NULL,
  event     TEXT NOT NULL,
  actor_id  TEXT,
  detail    JSONB NOT NULL DEFAULT '{}'::jsonb,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_dispatch_log_order_idx ON go_dispatch_log (order_id, id);
CREATE INDEX IF NOT EXISTS go_dispatch_log_at_idx ON go_dispatch_log (at);

ALTER TABLE go_orders ADD COLUMN IF NOT EXISTS dispatch_state TEXT NOT NULL DEFAULT 'none';   -- none | offering | pool
ALTER TABLE go_orders ADD COLUMN IF NOT EXISTS dispatch_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE go_orders ADD COLUMN IF NOT EXISTS pricing JSONB;                                 -- снимок расчёта: версия тарифа, состав, срок
CREATE INDEX IF NOT EXISTS go_orders_dispatch_idx ON go_orders (dispatch_state, created_at) WHERE status = 'searching';
