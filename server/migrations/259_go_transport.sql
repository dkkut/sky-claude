-- Sky GO → «Организации» → «Для транспорта»: группа категорий, топливо, услуги/удобства, акции, заказ-наряды (ход работ) и оплата через SkyKassa Business.
ALTER TABLE gop_categories ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE gop_places ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO gop_categories (id, name, icon, sort, group_id) VALUES
  ('fuel',        'Заправки и АЗС',      'fuel',       111, 'transport'),
  ('carwash',     'Автомойки',           'droplets',   112, 'transport'),
  ('autoservice', 'Автосервисы',         'wrench',     113, 'transport'),
  ('detailing',   'Детейлинг',           'sparkles',   114, 'transport'),
  ('autoparts',   'Автозапчасти',        'cog',        115, 'transport'),
  ('carparks',    'Автостоянки',         'parking-square', 116, 'transport'),
  ('parkings',    'Парковки',            'circle-parking', 117, 'transport'),
  ('towing',      'Эвакуаторы',          'truck',      118, 'transport'),
  ('dealers',     'Автосалоны',          'car-front',  119, 'transport'),
  ('rental',      'Прокат автомобилей',  'key-round',  120, 'transport')
ON CONFLICT (id) DO UPDATE SET group_id = EXCLUDED.group_id;
UPDATE gop_categories SET group_id = 'transport' WHERE id = 'auto';

-- Цены на топливо вносит сама организация; Sky цен не знает и не выдумывает. Видна дата обновления.
CREATE TABLE IF NOT EXISTS gop_fuel_prices (
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  fuel        TEXT NOT NULL,
  price_kop   INT  NOT NULL CHECK (price_kop > 0 AND price_kop <= 100000),
  available   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  PRIMARY KEY (business_id, fuel)
);

CREATE TABLE IF NOT EXISTS gop_promos (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  starts_on   DATE,
  ends_on     DATE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gop_promos_biz_idx ON gop_promos (business_id, active);

-- Заказ-наряд: ход работ по автомобилю клиента (автосервис, мойка, детейлинг, шиномонтаж…).
CREATE TABLE IF NOT EXISTS gop_work_orders (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  buyer_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  booking_id  TEXT,
  title       TEXT NOT NULL,
  vehicle_enc TEXT,
  status      TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','diagnostics','awaiting_approval','in_work','ready','issued','cancelled')),
  price_rub   INT,
  paid_rub    INT NOT NULL DEFAULT 0,
  pay_status  TEXT NOT NULL DEFAULT 'none' CHECK (pay_status IN ('none','requested','prepaid','paid','refunded')),
  qr_id       TEXT,
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gop_work_biz_idx ON gop_work_orders (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS gop_work_buyer_idx ON gop_work_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gop_work_qr_idx ON gop_work_orders (qr_id) WHERE qr_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gop_work_events (
  id        BIGSERIAL PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES gop_work_orders(id) ON DELETE CASCADE,
  status    TEXT NOT NULL,
  comment   TEXT NOT NULL DEFAULT '',
  actor     TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gop_work_events_idx ON gop_work_events (order_id, id);
