-- ============================================================
--  Sky Market / Логистика: курьеры, склады, поставки, пропуска,
--  транспортные компании
-- ============================================================
--
-- До сих пор всё это жило в браузере: курьеры, склады, пропуска и
-- транспортные компании лежали в памяти вкладки и в localStorage.
-- Значит, ничего из этого не существовало для второго человека, а
-- «права доступа» сводились к тому, что экран не рисовал кнопку.
--
-- Здесь те же сущности, но на сервере. Интерфейс не меняется — меняется
-- то, где живёт правда.
--
-- Общие правила этого файла:
--
--   · Деньги — целыми копейками. Складывать рубли с плавающей точкой
--     нельзя: 19.99 + 0.01 однажды даст не 20.
--   · Вес — в граммах, объём — в миллилитрах, расстояние — в метрах.
--     Дробные килограммы и кубометры считаются так же скверно.
--   · Личные данные (адрес, телефон, почта, переписка) — зашифрованы:
--     это данные живых людей, и в дампе базы им открытыми не место.
--   · Ни баланса, ни вывода средств здесь нет, как и в остальном
--     маркете. Sky не хранитель денег: за доставку платят напрямую, а
--     журнал выполненного — это журнал, а не касса.

-- ============================================================
--  Курьеры
-- ============================================================

CREATE TABLE IF NOT EXISTS logi_couriers (
  id            TEXT PRIMARY KEY,
  -- Один курьерский профиль на человека: иначе один и тот же человек
  -- набирает рейтинг несколькими карточками.
  profile_id    TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  phone_enc     TEXT,
  city_id       TEXT NOT NULL DEFAULT '',
  district      TEXT NOT NULL DEFAULT '',
  vehicle       TEXT NOT NULL DEFAULT 'foot'
                CHECK (vehicle IN ('foot', 'bike', 'scooter', 'car', 'van')),

  price_kop     BIGINT NOT NULL DEFAULT 0 CHECK (price_kop >= 0),
  work_from     TEXT NOT NULL DEFAULT '09:00',
  work_to       TEXT NOT NULL DEFAULT '21:00',
  bio           TEXT NOT NULL DEFAULT '',

  online        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Точка на карте. Ставит её только сам курьер и только про себя:
  -- чужую геопозицию не двигает никто.
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,

  rating        NUMERIC(3, 2),
  review_count  INTEGER NOT NULL DEFAULT 0,
  deliveries    INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_couriers_city_idx ON logi_couriers (city_id, online);

-- Отзыв о курьере. Один от продавца на курьера: иначе рейтинг
-- накручивается повторами с одного аккаунта.
CREATE TABLE IF NOT EXISTS logi_courier_reviews (
  id         TEXT PRIMARY KEY,
  courier_id TEXT NOT NULL REFERENCES logi_couriers(id) ON DELETE CASCADE,
  seller_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body_enc   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (courier_id, seller_id)
);

CREATE TABLE IF NOT EXISTS logi_courier_favorites (
  seller_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  courier_id TEXT NOT NULL REFERENCES logi_couriers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, courier_id)
);

-- Договор о сотрудничестве продавца и курьера.
CREATE TABLE IF NOT EXISTS logi_collabs (
  id           TEXT PRIMARY KEY,
  courier_id   TEXT NOT NULL REFERENCES logi_couriers(id) ON DELETE CASCADE,
  seller_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_enc  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'declined', 'ended')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

-- Одна живая заявка на пару «курьер + продавец». Закрытые не мешают:
-- после отказа можно попросить снова.
CREATE UNIQUE INDEX IF NOT EXISTS logi_collabs_live_idx
  ON logi_collabs (courier_id, seller_id)
  WHERE status IN ('pending', 'accepted');

-- Переписка продавца с курьером. Отдельная от мессенджера и от чата
-- сделки — по той же причине, что и там: у неё свои стороны и свои
-- права.
CREATE TABLE IF NOT EXISTS logi_courier_messages (
  id          TEXT PRIMARY KEY,
  courier_id  TEXT NOT NULL REFERENCES logi_couriers(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('seller', 'courier')),
  body_enc    TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_courier_messages_idx
  ON logi_courier_messages (courier_id, seller_id, created_at);

-- Поручение курьеру по конкретному заказу маркета.
CREATE TABLE IF NOT EXISTS logi_courier_assignments (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL UNIQUE REFERENCES market_orders(id) ON DELETE CASCADE,
  courier_id  TEXT NOT NULL REFERENCES logi_couriers(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'assigned'
              CHECK (status IN ('assigned', 'picked_up', 'delivered', 'cancelled')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_assign_courier_idx ON logi_courier_assignments (courier_id, status);

CREATE TABLE IF NOT EXISTS logi_courier_notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  courier_id TEXT REFERENCES logi_couriers(id) ON DELETE CASCADE,
  order_id   TEXT,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_courier_notes_idx
  ON logi_courier_notifications (user_id, created_at DESC);

-- ============================================================
--  Склады
-- ============================================================

CREATE TABLE IF NOT EXISTS logi_warehouses (
  id          TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address_enc TEXT,
  city_id     TEXT NOT NULL DEFAULT '',
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  capacity    INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  -- 'sorting_center' виден в выборе при создании поставки.
  role        TEXT NOT NULL DEFAULT 'own' CHECK (role IN ('own', 'sorting_center')),
  -- Расписание: семь дней одной строкой. Отдельной таблицей оно было бы
  -- семью строками, которые всегда читаются и пишутся вместе.
  schedule    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_warehouses_seller_idx ON logi_warehouses (seller_id);
CREATE INDEX IF NOT EXISTS logi_warehouses_role_idx ON logi_warehouses (role);

-- Фотографии склада. На диске, как и картинки товаров: раньше они
-- лежали data-url'ами прямо в состоянии вкладки и весили столько же,
-- сколько сам файл, только на треть больше.
CREATE TABLE IF NOT EXISTS logi_warehouse_photos (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  mime         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_warehouse_photos_idx ON logi_warehouse_photos (warehouse_id, sort_order);

CREATE TABLE IF NOT EXISTS logi_stock (
  id            TEXT PRIMARY KEY,
  warehouse_id  TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  product_title TEXT NOT NULL DEFAULT '',
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Одна строка на товар в складе. Две строки про один товар — это два
  -- разных ответа на вопрос «сколько его лежит».
  UNIQUE (warehouse_id, product_id)
);

CREATE TABLE IF NOT EXISTS logi_transfers (
  id            TEXT PRIMARY KEY,
  from_wh_id    TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  to_wh_id      TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  product_title TEXT NOT NULL DEFAULT '',
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_transit', 'done', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  CHECK (from_wh_id <> to_wh_id)
);

CREATE INDEX IF NOT EXISTS logi_transfers_idx ON logi_transfers (from_wh_id, status);
CREATE INDEX IF NOT EXISTS logi_transfers_to_idx ON logi_transfers (to_wh_id, status);

CREATE TABLE IF NOT EXISTS logi_warehouse_staff (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('manager', 'worker')),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, profile_id)
);

CREATE INDEX IF NOT EXISTS logi_staff_profile_idx ON logi_warehouse_staff (profile_id);

-- Журнал склада. Пишется сервером и не переписывается.
CREATE TABLE IF NOT EXISTS logi_warehouse_log (
  id           BIGSERIAL PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  actor_id     TEXT,
  type         TEXT NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_warehouse_log_idx ON logi_warehouse_log (warehouse_id, created_at DESC);

-- ============================================================
--  Поставки (разметка и наклейки)
-- ============================================================

CREATE TABLE IF NOT EXISTS logi_supplies (
  id            TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Читаемый номер для человека и короткий код для наклейки.
  -- Код уникален: по нему поставку находят сканером.
  number        TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,

  name          TEXT NOT NULL DEFAULT '',
  sender_name   TEXT NOT NULL DEFAULT '',
  sender_addr_enc    TEXT,
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_addr_enc TEXT,

  places        INTEGER NOT NULL DEFAULT 1 CHECK (places > 0),
  weight_g      BIGINT CHECK (weight_g IS NULL OR weight_g >= 0),
  volume_ml     BIGINT CHECK (volume_ml IS NULL OR volume_ml >= 0),

  sorting_center_id   TEXT REFERENCES logi_warehouses(id) ON DELETE SET NULL,
  -- Снимок названия на момент печати наклейки: наклейка уже уехала, а
  -- склад могли переименовать.
  sorting_center_name TEXT,

  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'preparing', 'in_transit',
                                  'at_sorting_center', 'delivered', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_supplies_seller_idx ON logi_supplies (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS logi_supply_log (
  id         BIGSERIAL PRIMARY KEY,
  supply_id  TEXT NOT NULL REFERENCES logi_supplies(id) ON DELETE CASCADE,
  actor_id   TEXT,
  type       TEXT NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_supply_log_idx ON logi_supply_log (supply_id, created_at);

-- ============================================================
--  Пропуска на склад
-- ============================================================

CREATE TABLE IF NOT EXISTS logi_passes (
  id            TEXT PRIMARY KEY,
  warehouse_id  TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  seller_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  holder_name   TEXT NOT NULL,
  holder_contact_enc TEXT,

  access_level  TEXT NOT NULL DEFAULT 'guest'
                CHECK (access_level IN ('guest', 'employee', 'manager', 'owner')),
  type          TEXT NOT NULL DEFAULT 'temporary' CHECK (type IN ('temporary', 'permanent')),

  -- Код пропуска. В базе лежит отпечаток, по нему и ищут при сканировании:
  -- утёкший дамп не должен превращаться в связку ключей от всех складов.
  -- Сам код отдаётся один раз владельцу пропуска и хранится
  -- зашифрованным, чтобы его можно было переслать повторно.
  code_hash     TEXT NOT NULL UNIQUE,
  code_enc      TEXT NOT NULL,

  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Временный пропуск без срока — это постоянный, только назван иначе.
  CHECK (type = 'permanent' OR valid_until IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS logi_passes_wh_idx ON logi_passes (warehouse_id, active);

CREATE TABLE IF NOT EXISTS logi_pass_visits (
  id           BIGSERIAL PRIMARY KEY,
  pass_id      TEXT NOT NULL REFERENCES logi_passes(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN ('entry', 'exit')),
  confirmed_by TEXT NOT NULL DEFAULT 'qr_scan' CHECK (confirmed_by IN ('qr_scan', 'manual')),
  actor_id     TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_pass_visits_idx ON logi_pass_visits (pass_id, at DESC);
CREATE INDEX IF NOT EXISTS logi_pass_visits_wh_idx ON logi_pass_visits (warehouse_id, at DESC);

CREATE TABLE IF NOT EXISTS logi_pass_sends (
  id         BIGSERIAL PRIMARY KEY,
  pass_id    TEXT NOT NULL REFERENCES logi_passes(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'chat')),
  target_enc TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_pass_sends_idx ON logi_pass_sends (pass_id, sent_at DESC);

-- ============================================================
--  Транспортные компании
-- ============================================================

CREATE TABLE IF NOT EXISTS logi_tc (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  logo_hue        INTEGER NOT NULL DEFAULT 210,
  description     TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  regions         JSONB NOT NULL DEFAULT '[]'::jsonb,

  contact_phone_enc TEXT,
  contact_email_enc TEXT,

  work_days       JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_from       TEXT NOT NULL DEFAULT '09:00',
  work_to         TEXT NOT NULL DEFAULT '18:00',
  weekend_delivery BOOLEAN NOT NULL DEFAULT FALSE,

  transport_kinds JSONB NOT NULL DEFAULT '[]'::jsonb,
  zones           JSONB NOT NULL DEFAULT '[]'::jsonb,

  min_price_kop   BIGINT NOT NULL DEFAULT 0 CHECK (min_price_kop >= 0),
  price_per_km_kop BIGINT NOT NULL DEFAULT 0 CHECK (price_per_km_kop >= 0),
  max_weight_g    BIGINT NOT NULL DEFAULT 0 CHECK (max_weight_g >= 0),
  max_volume_ml   BIGINT NOT NULL DEFAULT 0 CHECK (max_volume_ml >= 0),
  delivery_hours  INTEGER NOT NULL DEFAULT 24 CHECK (delivery_hours > 0),

  -- Отметку «проверена» ставит администрация, а не сама компания.
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  rating          NUMERIC(3, 2),
  completed       INTEGER NOT NULL DEFAULT 0,
  success_pct     INTEGER NOT NULL DEFAULT 100 CHECK (success_pct BETWEEN 0 AND 100),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_tc_city_idx ON logi_tc (city);

CREATE TABLE IF NOT EXISTS logi_tc_vehicles (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES logi_tc(id) ON DELETE CASCADE,
  photo_hue    INTEGER NOT NULL DEFAULT 210,
  brand        TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  plate_number TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'car'
               CHECK (kind IN ('courier', 'car', 'truck', 'van', 'special', 'moto')),
  capacity_g   BIGINT NOT NULL DEFAULT 0 CHECK (capacity_g >= 0),
  volume_ml    BIGINT NOT NULL DEFAULT 0 CHECK (volume_ml >= 0),
  status       TEXT NOT NULL DEFAULT 'available'
               CHECK (status IN ('available', 'busy', 'maintenance', 'disabled')),
  driver_id    TEXT,
  load_g       BIGINT NOT NULL DEFAULT 0 CHECK (load_g >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_tc_vehicles_idx ON logi_tc_vehicles (company_id, status);

CREATE TABLE IF NOT EXISTS logi_tc_team (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES logi_tc(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone_enc  TEXT,
  role       TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('driver', 'courier', 'dispatcher')),
  vehicle_id TEXT REFERENCES logi_tc_vehicles(id) ON DELETE SET NULL,
  rating     NUMERIC(3, 2),
  completed  INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_tc_team_idx ON logi_tc_team (company_id, active);

-- Заказ на доставку: продавец отдаёт, компания везёт.
CREATE TABLE IF NOT EXISTS logi_tc_orders (
  id            TEXT PRIMARY KEY,
  -- Пусто — заказ лежит на бирже и его может взять любая компания.
  company_id    TEXT REFERENCES logi_tc(id) ON DELETE SET NULL,
  seller_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  product_name  TEXT NOT NULL DEFAULT '',
  qty           INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  weight_g      BIGINT NOT NULL DEFAULT 0 CHECK (weight_g >= 0),
  from_addr_enc TEXT,
  to_addr_enc   TEXT,
  distance_m    BIGINT NOT NULL DEFAULT 0 CHECK (distance_m >= 0),
  price_kop     BIGINT NOT NULL DEFAULT 0 CHECK (price_kop >= 0),

  driver_id     TEXT REFERENCES logi_tc_team(id) ON DELETE SET NULL,
  vehicle_id    TEXT REFERENCES logi_tc_vehicles(id) ON DELETE SET NULL,

  status        TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'assigned', 'in_progress',
                                  'completed', 'cancelled', 'problem')),
  is_exchange   BOOLEAN NOT NULL DEFAULT FALSE,
  eta_hours     INTEGER NOT NULL DEFAULT 24 CHECK (eta_hours > 0),

  -- Встречное предложение цены: какая компания предложила и сколько.
  -- Решает продавец, поэтому предложение хранится рядом с заказом.
  offer_company_id TEXT REFERENCES logi_tc(id) ON DELETE SET NULL,
  offer_price_kop  BIGINT CHECK (offer_price_kop IS NULL OR offer_price_kop >= 0),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_tc_orders_company_idx ON logi_tc_orders (company_id, status);
CREATE INDEX IF NOT EXISTS logi_tc_orders_seller_idx ON logi_tc_orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS logi_tc_orders_exchange_idx
  ON logi_tc_orders (is_exchange) WHERE company_id IS NULL;

CREATE TABLE IF NOT EXISTS logi_tc_tariffs (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES logi_tc(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  max_weight_g BIGINT NOT NULL DEFAULT 0 CHECK (max_weight_g >= 0),
  base_kop     BIGINT NOT NULL DEFAULT 0 CHECK (base_kop >= 0),
  description  TEXT NOT NULL DEFAULT '',
  express      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_tc_tariffs_idx ON logi_tc_tariffs (company_id);

-- Журнал выполненного. Именно журнал: это записи о завершённых
-- доставках и сумме, о которой договорились стороны. Ни баланса, ни
-- вывода здесь нет — деньги за доставку идут мимо Sky, как и деньги
-- сделки.
CREATE TABLE IF NOT EXISTS logi_tc_finance (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES logi_tc(id) ON DELETE CASCADE,
  order_id   TEXT NOT NULL REFERENCES logi_tc_orders(id) ON DELETE CASCADE,
  amount_kop BIGINT NOT NULL CHECK (amount_kop >= 0),
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS logi_tc_finance_idx ON logi_tc_finance (company_id, at DESC);

CREATE TABLE IF NOT EXISTS logi_tc_warehouses (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES logi_tc(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  address_enc  TEXT,
  own          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_tc_warehouses_idx ON logi_tc_warehouses (company_id);

-- ============================================================
--  Журнал безопасности логистики
-- ============================================================

CREATE TABLE IF NOT EXISTS logi_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  subject    TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_log_idx ON logi_log (created_at DESC);
