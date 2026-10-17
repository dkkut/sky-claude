-- SkyKassa Business, этап 2: каталог и заказы, чаевые, счета, витрина (в том числе на собственном VPS бизнеса).
-- Деньги по-прежнему идут напрямую владельцу: заказ/счёт/чаевые создают платёжную страницу (kb_qr нужного вида), а статус оплаты ставит владелец.

-- Витрина бизнеса: адрес /s/<slug>, список сайтов на собственных серверах (CORS и проверка Origin при заказе).
ALTER TABLE kb_businesses ADD COLUMN IF NOT EXISTS shop_slug TEXT;
ALTER TABLE kb_businesses ADD COLUMN IF NOT EXISTS shop_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE kb_businesses ADD COLUMN IF NOT EXISTS shop_origins TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE kb_businesses ADD COLUMN IF NOT EXISTS shop_notice TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS kb_businesses_slug_idx ON kb_businesses (shop_slug) WHERE shop_slug IS NOT NULL;

-- Настройки платёжной страницы вида tip / invoice / order (суммы чаевых, строки счёта и т. п.).
ALTER TABLE kb_qr ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Изображения (фото товаров, фото получателя чаевых): в базе, отдаются только публичным адресом и только у действующего бизнеса.
CREATE TABLE IF NOT EXISTS kb_media (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                     -- item | tip
  data         BYTEA NOT NULL,
  mime         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_media_biz_idx ON kb_media (business_id);

CREATE TABLE IF NOT EXISTS kb_items (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_rub    INT  NOT NULL CHECK (price_rub > 0),
  category     TEXT NOT NULL DEFAULT '',
  sku          TEXT NOT NULL DEFAULT '',
  variants     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, priceRub? }]
  lead_time    TEXT NOT NULL DEFAULT '',
  available    BOOLEAN NOT NULL DEFAULT true,
  media_id     TEXT REFERENCES kb_media(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'active',        -- active | archived
  sort         INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_items_biz_idx ON kb_items (business_id, status, sort, created_at);

-- Заказы: состав и цены фиксируются на сервере в момент заказа, контакты покупателя зашифрованы.
CREATE TABLE IF NOT EXISTS kb_orders (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  number       INT  NOT NULL,
  lines        JSONB NOT NULL,                        -- [{ itemId, title, variant, qty, priceRub }]
  total_rub    INT  NOT NULL CHECK (total_rub > 0),
  contact_enc  TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'new',
  qr_id        TEXT REFERENCES kb_qr(id) ON DELETE SET NULL,
  buyer_key_hash TEXT,
  ip_hash      TEXT,
  origin       TEXT NOT NULL DEFAULT '',
  owner_comment TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_orders_num_idx ON kb_orders (business_id, number);
CREATE INDEX IF NOT EXISTS kb_orders_biz_idx ON kb_orders (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kb_invoices (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  number       INT  NOT NULL,
  lines        JSONB NOT NULL,                        -- [{ title, qty, priceRub, discountRub }]
  subtotal_rub INT  NOT NULL,
  discount_rub INT  NOT NULL DEFAULT 0,
  total_rub    INT  NOT NULL CHECK (total_rub > 0),
  due_at       TIMESTAMPTZ,
  order_no     TEXT NOT NULL DEFAULT '',
  comment      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft',         -- draft | sent | cancelled (остальное — по заявкам)
  qr_id        TEXT REFERENCES kb_qr(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_invoices_num_idx ON kb_invoices (business_id, number);
