-- Sky GO «Организации»: публичная карточка бизнеса «Sky для бизнеса» (kb_businesses) в каталоге. Только добавляет.
-- Товары и заказы — прежние kb_items / kb_orders; платёж — прежняя страница оплаты kb_qr / kb_payments.
ALTER TABLE kb_items  ADD COLUMN IF NOT EXISTS kind  TEXT NOT NULL DEFAULT 'product';
ALTER TABLE kb_items  ADD COLUMN IF NOT EXISTS stock INT;
ALTER TABLE kb_orders ADD COLUMN IF NOT EXISTS buyer_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE kb_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'shop';
ALTER TABLE kb_orders ADD COLUMN IF NOT EXISTS stock_returned BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS kb_orders_buyer_idx ON kb_orders (buyer_profile_id, created_at DESC) WHERE buyer_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gop_categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT 'building',
  sort       INT  NOT NULL DEFAULT 0,
  hidden     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO gop_categories (id, name, icon, sort) VALUES
  ('baths',     'Бани и сауны', 'flame', 10),
  ('fitness',   'Спортзалы и фитнес-клубы', 'dumbbell', 20),
  ('food',      'Рестораны и кафе', 'utensils', 30),
  ('pools',     'Бассейны и аквапарки', 'waves', 40),
  ('hotels',    'Отели и гостиницы', 'bed', 50),
  ('beauty',    'Барбершопы и салоны красоты', 'scissors', 60),
  ('cinema',    'Кинотеатры и развлекательные центры', 'clapperboard', 70),
  ('bowling',   'Боулинг и бильярд', 'target', 80),
  ('shops',     'Магазины и торговые центры', 'shopping-bag', 90),
  ('medical',   'Медицинские центры', 'stethoscope', 100),
  ('auto',      'Автомойки и автосервисы', 'car', 110),
  ('vet',       'Ветеринарные клиники', 'paw-print', 120),
  ('education', 'Образовательные центры и курсы', 'graduation-cap', 130),
  ('photo',     'Фотостудии', 'camera', 140),
  ('events',    'Организаторы мероприятий', 'party-popper', 150),
  ('other',     'Другие организации и услуги', 'building', 160)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS gop_places (
  business_id  TEXT PRIMARY KEY REFERENCES kb_businesses(id) ON DELETE CASCADE,
  connected    BOOLEAN NOT NULL DEFAULT FALSE,           -- переключатель «Подключить к Sky GO»
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','rejected','hidden','blocked')),
  category_id  TEXT REFERENCES gop_categories(id),
  about        TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  hours        JSONB NOT NULL DEFAULT '{}'::jsonb,       -- { mon: [["10:00","22:00"]], … }
  tz           TEXT NOT NULL DEFAULT 'Europe/Moscow',
  phone        TEXT NOT NULL DEFAULT '',
  links        JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{ title, url }] только https
  reject_reason TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  moderated_by TEXT,
  moderated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gop_places_pub_idx ON gop_places (category_id, city) WHERE status = 'published' AND connected;
CREATE INDEX IF NOT EXISTS gop_places_status_idx ON gop_places (status, submitted_at);

CREATE TABLE IF NOT EXISTS gop_photos (
  media_id    TEXT PRIMARY KEY REFERENCES kb_media(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  sort        INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gop_photos_biz_idx ON gop_photos (business_id, sort);

CREATE TABLE IF NOT EXISTS gop_favs (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, business_id)
);

CREATE TABLE IF NOT EXISTS gop_log (
  id          BIGSERIAL PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gop_log_biz_idx ON gop_log (business_id, id DESC);

CREATE TABLE IF NOT EXISTS gop_errors (
  id     BIGSERIAL PRIMARY KEY,
  where_ TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
