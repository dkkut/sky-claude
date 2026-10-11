-- ============================================================
--  Sky GO: такси, еда, доставка, авиабилеты, заправки.
--  Деньги — целые рубли (как в кошельке). Заказы такси/еды/доставки
--  оплачиваются НАПРЯМУЮ исполнителю по реквизитам: Sky деньги клиентов
--  не принимает; через кошелёк идёт только недельная активация кабинета.
-- ============================================================

-- Настройки (города, коэффициенты) — одна строка на ключ, правит администрация.
CREATE TABLE IF NOT EXISTS go_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Тарифы недельной активации. Стоимость нигде не зашита в код — только здесь.
CREATE TABLE IF NOT EXISTS go_tariffs (
  code        TEXT PRIMARY KEY,                -- general | taxi | courier
  title       TEXT NOT NULL,
  price_rub   INT  NOT NULL CHECK (price_rub >= 0),
  period_days INT  NOT NULL DEFAULT 7 CHECK (period_days BETWEEN 1 AND 366),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);
INSERT INTO go_tariffs (code, title, price_rub, period_days) VALUES
  ('general', 'Общая активация исполнителя', 139, 7),
  ('taxi',    'Водитель такси',               69, 7),
  ('courier', 'Курьер Sky GO',                49, 7)
ON CONFLICT (code) DO NOTHING;

-- Какой тариф у какого кабинета. Один кабинет — ровно один тариф: общая и специальная не складываются.
CREATE TABLE IF NOT EXISTS go_role_tariff (
  role        TEXT PRIMARY KEY CHECK (role IN ('taxi_driver','courier','food_seller','company')),
  tariff_code TEXT NOT NULL REFERENCES go_tariffs(code)
);
INSERT INTO go_role_tariff (role, tariff_code) VALUES
  ('taxi_driver','taxi'), ('courier','courier'), ('food_seller','general'), ('company','general')
ON CONFLICT (role) DO NOTHING;

-- Исполнители: один профиль может иметь несколько ролей (по одной записи на роль).
CREATE TABLE IF NOT EXISTS go_executors (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('taxi_driver','courier','food_seller','company')),
  legal_form  TEXT NOT NULL CHECK (legal_form IN ('npd','ip','ooo')),
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','submitted','in_review','needs_info','approved','rejected','suspended','blocked')),
  -- Сведения анкеты и данные автомобиля — зашифрованный JSON. Наружу — только владельцу и проверяющему.
  data_enc    TEXT NOT NULL DEFAULT '',
  inn_last4   TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, role)
);
CREATE INDEX IF NOT EXISTS go_executors_status_idx ON go_executors (status, submitted_at);

-- Документы исполнителя: зашифрованные байты, отдаёт только проверяющий с правом go (каждый просмотр — в журнал).
CREATE TABLE IF NOT EXISTS go_executor_docs (
  id          TEXT PRIMARY KEY,
  executor_id TEXT NOT NULL REFERENCES go_executors(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INT  NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_executor_docs_exec_idx ON go_executor_docs (executor_id);

-- Реквизиты для прямой оплаты (зашифрованный JSON). Видны только плательщику по его заказу.
CREATE TABLE IF NOT EXISTS go_pay_details (
  profile_id  TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  data_enc    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Подписки: период с подтверждённой оплаты с кошелька. Продление — от текущей даты окончания.
CREATE TABLE IF NOT EXISTS go_subscriptions (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  tariff_code TEXT NOT NULL,
  price_rub   INT  NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  payment_ref TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_subscriptions_profile_idx ON go_subscriptions (profile_id, role, expires_at DESC);
-- Повтор того же запроса оплаты (двойной клик, сетевой повтор) не продлевает дважды.
CREATE UNIQUE INDEX IF NOT EXISTS go_subscriptions_idem_idx ON go_subscriptions (profile_id, role, payment_ref) WHERE payment_ref IS NOT NULL;

-- Автомобиль водителя / присутствие на линии.
CREATE TABLE IF NOT EXISTS go_presence (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('taxi_driver','courier')),
  online      BOOLEAN NOT NULL DEFAULT FALSE,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  city        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, role)
);

-- Заказы всех трёх видов. kind-специфичное — в data; статусы проверяет сервер.
CREATE TABLE IF NOT EXISTS go_orders (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('taxi','food','delivery')),
  parent_id   TEXT REFERENCES go_orders(id) ON DELETE SET NULL,   -- доставка еды привязана к заказу еды
  customer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  executor_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,    -- водитель / курьер / продавец
  status      TEXT NOT NULL,
  price_rub   INT  NOT NULL CHECK (price_rub >= 0),
  city        TEXT NOT NULL DEFAULT '',
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  idem_key    TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  cancelled_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS go_orders_idem_idx ON go_orders (customer_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS go_orders_customer_idx ON go_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS go_orders_executor_idx ON go_orders (executor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS go_orders_open_idx ON go_orders (kind, status, city) WHERE status IN ('searching','pending');

CREATE TABLE IF NOT EXISTS go_order_events (
  id        BIGSERIAL PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES go_orders(id) ON DELETE CASCADE,
  actor_id  TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_order_events_order_idx ON go_order_events (order_id, id);

-- Одноразовые коды (вручение): хранится только хеш, срок и попытки ограничены.
CREATE TABLE IF NOT EXISTS go_order_codes (
  order_id   TEXT NOT NULL REFERENCES go_orders(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  code_enc   TEXT NOT NULL,           -- сам код (шифр): показывается заказчику, пока не использован
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  used_at    TIMESTAMPTZ,
  PRIMARY KEY (order_id, purpose)
);

-- Прямая оплата: кто платит, кому, сколько, на какие реквизиты (снимок на момент оплаты).
CREATE TABLE IF NOT EXISTS go_order_pay (
  order_id     TEXT PRIMARY KEY REFERENCES go_orders(id) ON DELETE CASCADE,
  payer_id     TEXT NOT NULL,
  payee_id     TEXT NOT NULL,
  amount_rub   INT  NOT NULL,
  details_enc  TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT 'awaiting' CHECK (state IN ('awaiting','reported','confirmed')),
  reported_at  TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Заведения и меню Sky Еда.
CREATE TABLE IF NOT EXISTS go_places (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  descr       TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  category    TEXT NOT NULL DEFAULT '',
  hours       TEXT NOT NULL DEFAULT '',
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  accepting   BOOLEAN NOT NULL DEFAULT TRUE,
  has_photo   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_places_city_idx ON go_places (city, published);

CREATE TABLE IF NOT EXISTS go_menu_items (
  id         TEXT PRIMARY KEY,
  place_id   TEXT NOT NULL REFERENCES go_places(id) ON DELETE CASCADE,
  category   TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  descr      TEXT NOT NULL DEFAULT '',
  price_rub  INT  NOT NULL CHECK (price_rub >= 0),
  available  BOOLEAN NOT NULL DEFAULT TRUE,
  has_photo  BOOLEAN NOT NULL DEFAULT FALSE,
  sort       INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_menu_items_place_idx ON go_menu_items (place_id, sort);

-- Авиабилеты: заказ у внешнего поставщика. Без подключённого поставщика заказов нет.
CREATE TABLE IF NOT EXISTS go_flight_orders (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  offer       JSONB NOT NULL,
  passengers_enc TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'created'
              CHECK (status IN ('created','redirected','booked','ticketed','cancelled','failed')),
  external_id TEXT,
  external_status TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_flight_orders_profile_idx ON go_flight_orders (profile_id, created_at DESC);

-- Заправки: кэш станций поставщика и пользовательские сообщения о загруженности.
CREATE TABLE IF NOT EXISTS go_fuel_stations (
  key        TEXT PRIMARY KEY,                -- provider:extId
  provider   TEXT NOT NULL,
  name       TEXT NOT NULL,
  brand      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  info       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- часы, виды топлива, услуги — только то, что дал поставщик
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_fuel_stations_geo_idx ON go_fuel_stations (lat, lng);

CREATE TABLE IF NOT EXISTS go_fuel_reports (
  id         TEXT PRIMARY KEY,
  station_key TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  level      TEXT NOT NULL CHECK (level IN ('low','medium','high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_fuel_reports_station_idx ON go_fuel_reports (station_key, created_at DESC);
CREATE INDEX IF NOT EXISTS go_fuel_reports_user_idx ON go_fuel_reports (profile_id, created_at DESC);

-- Журнал действий GO: решения по заявкам, тарифы, просмотр документов.
CREATE TABLE IF NOT EXISTS go_log (
  id        BIGSERIAL PRIMARY KEY,
  actor_id  TEXT,
  action    TEXT NOT NULL,
  subject   TEXT,
  detail    JSONB NOT NULL DEFAULT '{}'::jsonb,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO go_settings (key, value) VALUES
  ('cities', '["Москва","Санкт-Петербург","Новосибирск","Екатеринбург","Казань","Нижний Новгород","Самара","Тула","Новомосковск"]'::jsonb),
  ('taxi_tariffs', '{"economy":{"title":"Эконом","base":99,"perKm":18,"perMin":4,"min":149},"comfort":{"title":"Комфорт","base":149,"perKm":24,"perMin":5,"min":219},"business":{"title":"Бизнес","base":249,"perKm":36,"perMin":7,"min":399}}'::jsonb),
  ('delivery_tariff', '{"base":149,"perKm":22,"minRub":199,"foodBase":99,"foodPerKm":15,"foodMin":129,"sizeSurcharge":{"s":0,"m":50,"l":150}}'::jsonb),
  ('payment_terms', '{"taxi":"after_ride","food":"after_delivery","delivery":"after_delivery"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
