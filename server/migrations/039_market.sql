-- Sky Market: обычный маркет и игровой.
--
-- До этой миграции у маркета не было в базе ни одной строки. Товары,
-- заказы и продавцы жили в localStorage браузера: продавец не видел
-- своих покупателей, покупатель — чужих товаров, а «заказ» существовал
-- ровно в той вкладке, где его оформили.
--
-- Пять решений, из которых следует вся схема.
--
-- 1. Sky не хранит деньги. Здесь нет ни баланса продавца, ни вывода,
--    ни замороженных средств, ни комиссии со сделки. Покупатель платит
--    продавцу напрямую, мимо нас. Всё, что мы записываем про деньги, —
--    это два ЗАЯВЛЕНИЯ: покупатель сказал «отправил», продавец сказал
--    «получил». Так они и называются в схеме, и ни одно из них не
--    выдаётся за подтверждённый банком платёж.
--
--    Единственные деньги, которые Sky берёт, — подписка продавца за
--    место на витрине. Она к сделкам отношения не имеет.
--
-- 2. Состояние заказа меняет только сервер. В таблице лежит текущее
--    состояние, а рядом — журнал переходов: кто, когда, из чего и во
--    что перевёл. По журналу видно всё, и он не переписывается.
--
-- 3. Чат заказа — своя таблица, а не чат мессенджера. Это не
--    украшение: у переписки Market другие правила доступа (двое плюс
--    поддержка), другая привязка (к заказу) и другая судьба (живёт,
--    пока живёт заказ). Складывать её в общие чаты значило бы отдать
--    ей и правила общих чатов.
--
-- 4. Два пути сделки в одной таблице. Обычный маркет доезжает
--    доставкой, игровой выдаётся в чате. Общего у них больше, чем
--    различий: продавец, товар, заявления об оплате, отзыв. Поэтому
--    путь различается состояниями, а не второй таблицей заказов.
--
-- 5. Трек-номер приходит от перевозчика, а не от клиента. Для этого у
--    отправления своя таблица и свой журнал вебхуков с защитой от
--    повторов.

-- ============================================================
--  Продавец
-- ============================================================

CREATE TABLE IF NOT EXISTS market_sellers (
  -- Профиль привязан к профилю Sky ID: продавец — это человек, а не
  -- отдельная учётная запись со своим входом.
  profile_id    TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  shop_name     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  has_avatar    BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_mime   TEXT,

  -- pending — заявка подана; active — торгует; suspended — закрыт
  -- администрацией. Состояние подписки отдельно: активный продавец с
  -- неоплаченной подпиской торговать не может, но и не «приостановлен».
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('pending', 'active', 'suspended')),

  -- Подписка за место на витрине. Здесь нет ни копейки из сделок:
  -- это плата Sky за инфраструктуру, и она не связана с оборотом.
  sub_status    TEXT NOT NULL DEFAULT 'inactive'
                CHECK (sub_status IN ('inactive', 'active')),
  sub_until     TIMESTAMPTZ,
  sub_started   TIMESTAMPTZ,

  -- Счётчики витрины. Считает их сервер по заказам и отзывам; продавец
  -- не может ни выставить их себе, ни прислать своё значение.
  rating        NUMERIC(3, 2),
  review_count  INTEGER NOT NULL DEFAULT 0,
  orders_total  INTEGER NOT NULL DEFAULT 0,
  orders_done   INTEGER NOT NULL DEFAULT 0,
  orders_cancel INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Платежи за подписку. Отдельной таблицей, чтобы продление было видно
-- по истории, а не только по дате в профиле.
CREATE TABLE IF NOT EXISTS market_seller_payments (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  days        INTEGER NOT NULL CHECK (days > 0),
  until       TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_seller_payments_idx
  ON market_seller_payments (profile_id, created_at DESC);

-- ============================================================
--  Игры (только для игрового маркета)
-- ============================================================

-- Игры — настоящие записи, а не список в коде страницы: их заводит
-- администрация, и лот ссылается на строку.
CREATE TABLE IF NOT EXISTS market_games (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  has_cover   BOOLEAN NOT NULL DEFAULT FALSE,
  cover_mime  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
--  Товары
-- ============================================================

CREATE TABLE IF NOT EXISTS market_products (
  id           TEXT PRIMARY KEY,
  seller_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- standard — обычный товар с доставкой; game — игровой лот, который
  -- выдают в чате. Список открыт для пополнения: третий вид не должен
  -- стоить переписывания таблицы.
  market_type  TEXT NOT NULL DEFAULT 'standard'
               CHECK (market_type IN ('standard', 'game')),

  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',

  -- Цена в копейках целым числом. Дробные рубли в деньгах — способ
  -- однажды получить 0.1 + 0.2 и долгий разговор с бухгалтерией.
  price_kop    BIGINT NOT NULL CHECK (price_kop > 0),
  old_price_kop BIGINT CHECK (old_price_kop IS NULL OR old_price_kop > 0),

  category     TEXT NOT NULL DEFAULT 'other',
  stock        INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),

  -- Игровое: к какой игре лот, какого вида и как выдаётся.
  game_id       TEXT REFERENCES market_games(id) ON DELETE SET NULL,
  game_category TEXT,
  region        TEXT,

  active       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Счётчики. sold растёт при завершении сделки, а не при создании
  -- заказа: проданным считается доехавшее.
  sold         INTEGER NOT NULL DEFAULT 0,
  views        INTEGER NOT NULL DEFAULT 0,
  rating       NUMERIC(3, 2),
  review_count INTEGER NOT NULL DEFAULT 0,

  -- Строка для поиска: название и описание, приведённые к нижнему
  -- регистру в JavaScript. Через lower() в SQL делать нельзя — для
  -- кириллицы он зависит от локали базы, и на одной машине поиск
  -- работает, а на другой нет. На этом уже обжигались в афише.
  search_text  TEXT NOT NULL DEFAULT '',

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_products_seller_idx
  ON market_products (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_products_catalog_idx
  ON market_products (market_type, active, created_at DESC);
CREATE INDEX IF NOT EXISTS market_products_game_idx
  ON market_products (game_id, active) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_products_search_idx
  ON market_products (search_text);

CREATE TABLE IF NOT EXISTS market_product_images (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_product_images_idx
  ON market_product_images (product_id, sort_order);

CREATE TABLE IF NOT EXISTS market_favorites (
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- ============================================================
--  Доставка (только обычный маркет)
-- ============================================================

-- Пункты выдачи, до которых маркет умеет довозить.
--
-- Экраны ПВЗ в приложении — отдельный модуль со своей длинной
-- регистрацией, и он пока целиком живёт в браузере. Маркету от него
-- нужно немногое: куда можно везти. Поэтому здесь список самих точек,
-- а не вся их кухня. Когда модуль ПВЗ переедет на сервер, он будет
-- наполнять эту таблицу — переделывать маркет для этого не придётся.
CREATE TABLE IF NOT EXISTS market_pickup_points (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  city       TEXT NOT NULL,
  address    TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  work_from  TEXT NOT NULL DEFAULT '09:00',
  work_to    TEXT NOT NULL DEFAULT '21:00',
  -- Сколько дней посылка ждёт получателя. Отсюда берётся срок в
  -- «заберите в течение стольких-то дней».
  hold_days  INTEGER NOT NULL DEFAULT 7 CHECK (hold_days BETWEEN 1 AND 60),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pickup_points_city_idx
  ON market_pickup_points (city, active);

-- Кто везёт.
--
-- Два рода, и разница между ними не в названии, а в том, откуда берётся
-- состояние посылки.
--
--   external — CDEK, 5Post, Почта. У них есть трек-номер и вебхуки:
--              состояние приходит от перевозчика и им же подтверждается.
--
--   inhouse  — транспортная компания внутри Sky. Трека у неё нет,
--              состояние двигает сама компания через своё приложение.
--
-- Третий способ — «отвезу сам» — не служба, и строки здесь не имеет:
-- он записан прямо в отправлении.
CREATE TABLE IF NOT EXISTS market_carriers (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('external', 'inhouse')),

  -- Для внешних — кто именно. Ограниченный список: под каждого нужен
  -- свой разбор вебхука, и «любой перевозчик по названию» означал бы
  -- принимать состояние от кого угодно.
  code        TEXT CHECK (code IS NULL OR code IN ('cdek', 'fivepost', 'russianpost')),

  title       TEXT NOT NULL,
  -- Для своих — чья компания.
  owner_id    TEXT REFERENCES profiles(id) ON DELETE CASCADE,

  city        TEXT NOT NULL DEFAULT '',
  min_price_kop   BIGINT NOT NULL DEFAULT 0 CHECK (min_price_kop >= 0),
  price_per_km_kop BIGINT NOT NULL DEFAULT 0 CHECK (price_per_km_kop >= 0),
  max_weight_g    BIGINT NOT NULL DEFAULT 30000 CHECK (max_weight_g > 0),
  eta_hours   INTEGER NOT NULL DEFAULT 48 CHECK (eta_hours > 0),
  rating      NUMERIC(3, 2),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- У внешнего перевозчика должен быть код, у своего — владелец.
  -- Строка, у которой нет ни того, ни другого, — это ничья служба.
  CHECK ((kind = 'external' AND code IS NOT NULL)
      OR (kind = 'inhouse'  AND owner_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS market_carriers_pick_idx ON market_carriers (kind, active);
CREATE INDEX IF NOT EXISTS market_carriers_owner_idx ON market_carriers (owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================
--  Заказы
-- ============================================================

CREATE TABLE IF NOT EXISTS market_orders (
  id          TEXT PRIMARY KEY,

  buyer_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES market_products(id) ON DELETE RESTRICT,

  market_type TEXT NOT NULL CHECK (market_type IN ('standard', 'game')),

  -- Снимок товара на момент заказа. Название и цена могут поменяться
  -- завтра, а в заказе должно остаться то, на что человек соглашался.
  title_snap  TEXT NOT NULL,
  price_kop   BIGINT NOT NULL CHECK (price_kop > 0),
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_kop   BIGINT NOT NULL CHECK (total_kop > 0),

  /*
   * Состояние сделки. Один список на оба пути: общее начало, разные
   * середины, общий конец.
   *
   *   created                 заказ создан, открыт чат
   *   payment_pending         продавец готов принять оплату
   *   buyer_payment_declared  покупатель СКАЗАЛ, что отправил деньги
   *   seller_payment_confirmed продавец СКАЗАЛ, что получил
   *   fulfillment             игровой: продавец выдаёт товар
   *   seller_shipped          обычный: отправлено, есть трек
   *   in_transit              обычный: едет
   *   ready_for_pickup        обычный: приехало, можно забирать
   *   buyer_received          покупатель подтвердил получение
   *   completed               сделка закрыта
   *   cancelled               отменена
   *   disputed                разбирательство
   *
   * Слова declared и confirmed выбраны намеренно: это заявления сторон,
   * а не проверка платежа со стороны Sky. Мы не видим их перевода и не
   * притворяемся, что видим.
   */
  status      TEXT NOT NULL DEFAULT 'created'
              CHECK (status IN (
                'created', 'payment_pending', 'buyer_payment_declared',
                'seller_payment_confirmed', 'fulfillment',
                'seller_shipped', 'in_transit', 'ready_for_pickup',
                'buyer_received', 'completed', 'cancelled', 'disputed')),

  -- Куда везти. Только для обычного маркета; у игрового пусто.
  -- Зашифровано: адрес человека — это персональные данные, и в дампе
  -- базы им открытыми быть незачем.
  address_enc TEXT,
  -- Какой пункт выдачи выбрал покупатель, если выбирал.
  pickup_point_id TEXT REFERENCES market_pickup_points(id) ON DELETE SET NULL,
  -- Контакт для доставки. Лежит зашифрованным: это персональные
  -- данные, и в дампе базы им открытыми быть незачем.
  contact_enc TEXT,

  -- Сборка заказа продавцом — отдельная отметка, а не состояние: она
  -- происходит внутри ожидания оплаты и ничего не запрещает.
  packing_started_at TIMESTAMPTZ,
  packed_at          TIMESTAMPTZ,

  paid_declared_at   TIMESTAMPTZ,
  paid_confirmed_at  TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT,

  -- До какого числа забрать из пункта выдачи.
  pickup_until       TIMESTAMPTZ,

  -- Номер состояния, растущий на каждый переход. Спасает от двух бед
  -- разом: переставленных сетью ответов и повторной отправки одного и
  -- того же действия.
  state_seq   BIGINT NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_orders_buyer_idx
  ON market_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_orders_seller_idx
  ON market_orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_orders_live_idx
  ON market_orders (status) WHERE status NOT IN ('completed', 'cancelled');

-- Журнал переходов. Пишется на каждое изменение состояния и не
-- переписывается: по нему видно, кто и когда что сделал, включая
-- действия поддержки.
CREATE TABLE IF NOT EXISTS market_order_events (
  id          BIGSERIAL PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  actor_id    TEXT,
  -- Кем действовал: покупатель, продавец, поддержка, сам сервер.
  actor_role  TEXT NOT NULL CHECK (actor_role IN ('buyer', 'seller', 'support', 'system')),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_order_events_idx
  ON market_order_events (order_id, created_at);

-- Идемпотентность действий. Повторно нажатая кнопка и повторно
-- доставленный запрос не должны двигать сделку дважды.
CREATE TABLE IF NOT EXISTS market_order_actions (
  order_id   TEXT NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, actor_id, action)
);

-- ============================================================
--  Отправления
-- ============================================================

CREATE TABLE IF NOT EXISTS market_shipments (
  order_id     TEXT PRIMARY KEY REFERENCES market_orders(id) ON DELETE CASCADE,

  -- Как едет: службой или продавец везёт сам.
  method       TEXT NOT NULL CHECK (method IN ('carrier', 'seller_self')),
  -- Куда едет: в пункт выдачи или прямо покупателю.
  destination  TEXT NOT NULL CHECK (destination IN ('pickup_point', 'buyer_address')),

  carrier_id      TEXT REFERENCES market_carriers(id) ON DELETE SET NULL,
  pickup_point_id TEXT REFERENCES market_pickup_points(id) ON DELETE SET NULL,

  -- Трек есть только у внешнего перевозчика. Приходит от него при
  -- создании отправления; от клиента не принимается никогда, потому что
  -- подменённый трек — это чужая посылка, выданная за свою.
  tracking     TEXT,

  status       TEXT NOT NULL DEFAULT 'created',
  status_text  TEXT NOT NULL DEFAULT '',
  location     TEXT,
  eta          TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Службой — значит есть служба. Сам везёт — значит службы нет.
  CHECK ((method = 'carrier' AND carrier_id IS NOT NULL)
      OR (method = 'seller_self' AND carrier_id IS NULL)),
  -- В пункт выдачи — значит пункт назван.
  CHECK (destination <> 'pickup_point' OR pickup_point_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS market_shipments_track_idx
  ON market_shipments (carrier_id, tracking) WHERE tracking IS NOT NULL;

-- Полученные вебхуки перевозчиков. Нужны для защиты от повторов:
-- перевозчик обязан слать событие снова, пока не получит подтверждения,
-- и одно и то же событие приходит по нескольку раз.
CREATE TABLE IF NOT EXISTS market_shipment_events (
  id          BIGSERIAL PRIMARY KEY,
  order_id    TEXT REFERENCES market_orders(id) ON DELETE CASCADE,
  carrier     TEXT NOT NULL,
  -- Идентификатор события у перевозчика. Пара «перевозчик + событие»
  -- уникальна: второй приход того же события ничего не меняет.
  event_key   TEXT NOT NULL,
  status      TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_shipment_events_key_idx
  ON market_shipment_events (carrier, event_key);

-- ============================================================
--  Чат заказа
-- ============================================================

-- Отдельная система, не мессенджер. Переписка привязана к сделке: у неё
-- свои стороны, свои права доступа и своя жизнь. Ни одна строка отсюда
-- не попадает в списки чатов Sky Messenger.
CREATE TABLE IF NOT EXISTS market_chats (
  id         TEXT PRIMARY KEY,
  -- Один чат на заказ. Не «обычно один», а ровно один: order_id
  -- уникален, и второй чат по тому же заказу база не даст завести.
  order_id   TEXT NOT NULL UNIQUE REFERENCES market_orders(id) ON DELETE CASCADE,
  buyer_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_chats_buyer_idx  ON market_chats (buyer_id);
CREATE INDEX IF NOT EXISTS market_chats_seller_idx ON market_chats (seller_id);

CREATE TABLE IF NOT EXISTS market_messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES market_chats(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Кем написано. Поддержка подписана явно, чтобы в переписке было
  -- видно, что отвечает не вторая сторона сделки.
  author_role TEXT NOT NULL CHECK (author_role IN ('buyer', 'seller', 'support', 'system')),

  -- Текст зашифрован тем же ключом, что и остальная переписка: люди
  -- пишут сюда адреса и реквизиты, и открытыми в базе им не место.
  body_enc   TEXT NOT NULL,

  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_messages_chat_idx
  ON market_messages (chat_id, created_at);

-- ============================================================
--  Отзывы
-- ============================================================

CREATE TABLE IF NOT EXISTS market_reviews (
  id         TEXT PRIMARY KEY,
  -- Один отзыв на заказ. Уникальность в ключе, а не в проверке кода:
  -- проверка в коде — это гонка, а ключ — это правило.
  order_id   TEXT NOT NULL UNIQUE REFERENCES market_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  seller_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  buyer_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body_enc   TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_reviews_product_idx ON market_reviews (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_reviews_seller_idx  ON market_reviews (seller_id, created_at DESC);

-- ============================================================
--  Уведомления
-- ============================================================

-- До сих пор уведомления жили только в браузере. ТЗ требует, чтобы
-- критические формировал сервер, — иначе «вам подтвердили оплату»
-- рисует себе сама страница, которой это выгодно.
CREATE TABLE IF NOT EXISTS market_notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id   TEXT REFERENCES market_orders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_notifications_idx
  ON market_notifications (user_id, created_at DESC);

-- ============================================================
--  Журнал безопасности
-- ============================================================

-- Что записываем: создание и изменение товара, переходы сделки,
-- действия поддержки, попытки дотянуться до чужого заказа или чата.
-- Чего не записываем: паролей, токенов, ключей, платёжных реквизитов
-- и содержимого переписки.
CREATE TABLE IF NOT EXISTS market_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  subject    TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_log_idx ON market_log (created_at DESC);
