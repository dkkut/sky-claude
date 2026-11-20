-- Sky GO → «Билеты на проезд»: пассажирский транспорт как организация (категория transit), продукты-билеты, купленные билеты с QR, проверка (валидация) на борту.
INSERT INTO gop_categories (id, name, icon, sort, group_id) VALUES ('transit', 'Пассажирский транспорт', 'bus', 110, 'transport') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS gt_products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('single','multi','period')),   -- разовая поездка | пакет поездок | безлимит на срок
  rides INT,                                   -- для multi
  valid_days INT NOT NULL DEFAULT 1 CHECK (valid_days BETWEEN 1 AND 366),
  price_rub INT NOT NULL CHECK (price_rub BETWEEN 1 AND 100000),
  active BOOLEAN NOT NULL DEFAULT TRUE, sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gt_products_biz_idx ON gt_products (business_id, active);

CREATE TABLE IF NOT EXISTS gt_tickets (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES gt_products(id),
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  buyer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT NOT NULL, rides_total INT, rides_left INT, valid_days INT NOT NULL, price_rub INT NOT NULL,   -- снимок продукта на момент покупки
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','active','used','expired','cancelled','refund_requested','refunded')),
  qr_id TEXT, idem_key TEXT,
  valid_from TIMESTAMPTZ, valid_until TIMESTAMPTZ, last_validated_at TIMESTAMPTZ, note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gt_tickets_buyer_idx ON gt_tickets (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gt_tickets_biz_idx ON gt_tickets (business_id, status);
CREATE INDEX IF NOT EXISTS gt_tickets_qr_idx ON gt_tickets (qr_id) WHERE qr_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gt_tickets_idem_uq ON gt_tickets (buyer_id, idem_key) WHERE idem_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS gt_validations (
  id BIGSERIAL PRIMARY KEY, ticket_id TEXT, business_id TEXT NOT NULL, by_profile TEXT, result TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gt_val_biz_idx ON gt_validations (business_id, at DESC);
