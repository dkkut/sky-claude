-- Поставки: продавец собирает пакет своих заказов, передаёт курьеру (или в пул),
-- у курьера по адресам заказов строится маршрут. Сами заказы и их передача
-- курьеру остаются прежними (logi_courier_assignments) — поставка лишь группирует.
CREATE TABLE IF NOT EXISTS logi_batches (
  id          TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','open','handed','done','cancelled')),
  courier_id  TEXT,
  origin_address TEXT NOT NULL DEFAULT '',
  origin_lat  DOUBLE PRECISION,
  origin_lng  DOUBLE PRECISION,
  price_kop   BIGINT NOT NULL DEFAULT 0,
  city_id     TEXT NOT NULL DEFAULT '',
  district    TEXT NOT NULL DEFAULT '',
  route_json  JSONB,
  route_at    TIMESTAMPTZ,
  handed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS logi_batches_seller ON logi_batches (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS logi_batches_courier ON logi_batches (courier_id) WHERE courier_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS logi_batch_items (
  batch_id  TEXT NOT NULL REFERENCES logi_batches(id) ON DELETE CASCADE,
  order_id  TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, order_id)
);
-- Заказ состоит не более чем в одной живой поставке: при отмене поставки строки удаляются.
CREATE UNIQUE INDEX IF NOT EXISTS logi_batch_items_order ON logi_batch_items (order_id);
