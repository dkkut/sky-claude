-- Sky Tickets на сервере.
--
-- До этой миграции «Билеты» были показом без вещества: семь мероприятий
-- записаны прямо в коде экрана, а «покупка» добавляла объект в состояние
-- компонента React. Билет исчезал при переходе на другую вкладку, число
-- свободных мест не уменьшалось никогда, а QR содержал открытый JSON —
-- то есть подделывался переписыванием строки. Организаторов не было
-- вовсе.
--
-- Главные решения этой миграции:
--
-- 1. Билет — отдельная строка на каждое место, а не поле «количество» в
--    заказе. Купил три — получил три билета с тремя кодами. Иначе
--    контроль на входе не работает: по одной записи нельзя отметить
--    «двое прошли, третий ещё нет».
--
-- 2. Цена в заказе своя, а не ссылка на цену типа билета. Организатор
--    вправе поднять цену завтра, но вчерашний заказ от этого дорожать
--    не должен.
--
-- 3. Проданное считается в самой строке типа билета и меняется только
--    условным UPDATE. Пересчёт «посчитали, потом записали» позволяет
--    двум одновременным покупкам взять один и тот же последний билет.

-- ============================================================
--  Подписка организатора
--
--  Кабинет организатора платный. Право открыть его определяется
--  ЗДЕСЬ и только здесь: ни клиент, ни его запросы на это не влияют.
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_organizers (
  profile_id   TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- inactive        — никогда не платил или подписка снята;
  -- payment_pending — оплата начата, но не подтверждена;
  -- active          — работает;
  -- expired         — срок вышел;
  -- cancelled       — отменена вручную.
  status       TEXT NOT NULL DEFAULT 'inactive',

  -- До какого момента подписка действует. Решение «активна ли она»
  -- принимается по этому полю и текущему времени, а не по слову
  -- status: рассинхрон между ними иначе давал бы месяц бесплатно.
  active_until TIMESTAMPTZ,

  -- Публичное имя организатора в афише. Пусто — берётся имя профиля.
  display_name TEXT,

  started_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ticket_organizers_status_chk
    CHECK (status IN ('inactive', 'payment_pending', 'active', 'expired', 'cancelled'))
);

-- ============================================================
--  Платежи за подписку
--
--  Отдельная таблица, а не поле в подписке: нужен и журнал (кто когда
--  и сколько заплатил), и защита от повторной обработки одного и того
--  же платежа. Ключ идемпотентности уникален — второй такой же запрос
--  не создаст вторую строку и не продлит подписку дважды.
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_organizer_payments (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Ключ идемпотентности: приходит от клиента, но повторить им можно
  -- только свою же операцию — он уникален вместе с профилем.
  idem_key     TEXT NOT NULL,

  amount       INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'RUB',
  -- Сколько дней добавил этот платёж.
  days         INTEGER NOT NULL,
  -- 'wallet' — списание с кошелька Sky.
  method       TEXT NOT NULL DEFAULT 'wallet',
  status       TEXT NOT NULL DEFAULT 'paid',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ticket_org_pay_status_chk CHECK (status IN ('paid', 'failed', 'refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ticket_org_pay_idem_key
  ON ticket_organizer_payments (profile_id, idem_key);
CREATE INDEX IF NOT EXISTS ticket_org_pay_profile_idx
  ON ticket_organizer_payments (profile_id, created_at DESC);

-- ============================================================
--  Мероприятие
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_events (
  id            TEXT PRIMARY KEY,

  -- Владелец. Единственный источник права на правку — сравнение с ним.
  organizer_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  title         TEXT NOT NULL,
  -- Описание — сочинение автора, поэтому лежит зашифрованным. Название,
  -- город и площадка не шифруются: по ним идёт поиск.
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'Другое',
  age_limit     INTEGER NOT NULL DEFAULT 0,

  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ,
  timezone      TEXT NOT NULL DEFAULT 'Europe/Moscow',

  city          TEXT NOT NULL DEFAULT '',
  venue         TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  venue_note    TEXT NOT NULL DEFAULT '',

  -- draft     — черновик, виден только автору;
  -- pending   — отправлен на проверку;
  -- published — в афише;
  -- paused    — продажи приостановлены, карточка видна;
  -- completed — прошло;
  -- cancelled — отменено.
  status        TEXT NOT NULL DEFAULT 'draft',
  reject_reason TEXT,

  -- Цвет карточки, пока нет афиши: пустая серая плитка выглядит
  -- поломкой, а не «картинку ещё не загрузили».
  accent        TEXT NOT NULL DEFAULT '#4e8cf7',
  has_cover     BOOLEAN NOT NULL DEFAULT FALSE,
  cover_mime    TEXT,

  -- Счётчик просмотров ведёт сервер: присланное клиентом число — это
  -- не статистика, а то, что клиент захотел показать.
  views         BIGINT NOT NULL DEFAULT 0,

  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ticket_events_status_chk
    CHECK (status IN ('draft', 'pending', 'published', 'paused', 'completed', 'cancelled')),
  CONSTRAINT ticket_events_age_chk CHECK (age_limit >= 0 AND age_limit <= 21)
);

CREATE INDEX IF NOT EXISTS ticket_events_org_idx
  ON ticket_events (organizer_id, created_at DESC);
-- Афиша: только опубликованные и ещё не прошедшие, по времени начала.
CREATE INDEX IF NOT EXISTS ticket_events_public_idx
  ON ticket_events (starts_at)
  WHERE status IN ('published', 'paused');
CREATE INDEX IF NOT EXISTS ticket_events_city_idx ON ticket_events (city);
CREATE INDEX IF NOT EXISTS ticket_events_category_idx ON ticket_events (category);

-- ============================================================
--  Дополнительные изображения афиши
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_event_images (
  event_id   TEXT NOT NULL REFERENCES ticket_events(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  mime       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, idx)
);

-- ============================================================
--  Тип билета
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_types (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES ticket_events(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',

  -- Цена в рублях, целым числом. Копейки этой системе не нужны, а
  -- дробное число в деньгах — источник ошибок округления.
  price         INTEGER NOT NULL,

  -- Сколько выпущено и сколько уже занято. Занятое увеличивается
  -- только условным UPDATE (sold + N <= quantity) — см. ticketorders.mjs.
  quantity      INTEGER NOT NULL,
  sold          INTEGER NOT NULL DEFAULT 0,

  sale_from     TIMESTAMPTZ,
  sale_to       TIMESTAMPTZ,
  -- Сколько мест один человек может взять на это мероприятие этого типа.
  per_user_max  INTEGER NOT NULL DEFAULT 8,

  -- active — продаётся, hidden — скрыт, closed — продажи закрыты.
  status        TEXT NOT NULL DEFAULT 'active',
  ordering      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ticket_types_status_chk CHECK (status IN ('active', 'hidden', 'closed')),
  CONSTRAINT ticket_types_price_chk CHECK (price >= 0 AND price <= 10000000),
  CONSTRAINT ticket_types_qty_chk CHECK (quantity >= 0 AND quantity <= 1000000),
  -- Продано не может превысить выпущенное. Последняя преграда против
  -- перепродажи: даже если проверка в коде однажды разойдётся с
  -- действительностью, база не даст записать лишнее.
  CONSTRAINT ticket_types_sold_chk CHECK (sold >= 0 AND sold <= quantity)
);

CREATE INDEX IF NOT EXISTS ticket_types_event_idx ON ticket_types (event_id, ordering);

-- ============================================================
--  Заказ
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_orders (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL REFERENCES ticket_events(id) ON DELETE CASCADE,
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,

  quantity       INTEGER NOT NULL,

  -- Цена на момент покупки. Сохраняется в заказ, а не берётся из типа
  -- билета: поднятая завтра цена не должна менять вчерашний заказ.
  unit_price     INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'RUB',

  -- pending          — создан;
  -- awaiting_payment — места удержаны, ждём оплату;
  -- paid             — оплачен, билеты выпущены;
  -- cancelled        — отменён;
  -- expired          — удержание истекло;
  -- refunded         — возвращён.
  status         TEXT NOT NULL DEFAULT 'pending',

  -- Ключ идемпотентности: повторное нажатие «Купить» не создаст второй
  -- заказ и не спишет деньги дважды.
  idem_key       TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  refunded_at    TIMESTAMPTZ,

  CONSTRAINT ticket_orders_status_chk
    CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'cancelled', 'expired', 'refunded')),
  CONSTRAINT ticket_orders_qty_chk CHECK (quantity > 0 AND quantity <= 100)
);

CREATE INDEX IF NOT EXISTS ticket_orders_user_idx ON ticket_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_orders_event_idx ON ticket_orders (event_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_orders_idem_key
  ON ticket_orders (user_id, idem_key) WHERE idem_key IS NOT NULL;

-- ============================================================
--  Билет
--
--  Одна строка на одно место. Купил три — три строки с тремя кодами.
--  Иначе контроль на входе не работает: по одной записи нельзя
--  отметить, что двое прошли, а третий ещё нет.
-- ============================================================

CREATE TABLE IF NOT EXISTS tickets (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES ticket_orders(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL REFERENCES ticket_events(id) ON DELETE CASCADE,
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Короткий код для глаз и рук: его называют голосом и вбивают на
  -- контроле, когда QR не читается. Уникален по всей системе.
  code           TEXT NOT NULL,

  -- Длинный случайный ключ внутри QR. Знать код мало: без этого ключа
  -- по QR не пройти, а подобрать его нельзя — он случайный, а не
  -- выведенный из номера билета.
  qr_secret      TEXT NOT NULL,

  -- valid    — действителен;
  -- used     — по нему уже прошли;
  -- expired  — организатор пометил просроченным;
  -- cancelled — мероприятие отменено;
  -- refunded — возвращён.
  status         TEXT NOT NULL DEFAULT 'valid',

  -- Кто и когда отметил. Нужно и для спора, и чтобы показать покупателю
  -- честное «прошли в 19:42».
  used_at        TIMESTAMPTZ,
  used_by        TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  -- Порядковый номер места внутри заказа: «2 из 3».
  seat_no        INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tickets_status_chk
    CHECK (status IN ('valid', 'used', 'expired', 'cancelled', 'refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_code_key ON tickets (code);
CREATE INDEX IF NOT EXISTS tickets_user_idx ON tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_event_idx ON tickets (event_id, status);
CREATE INDEX IF NOT EXISTS tickets_order_idx ON tickets (order_id);

-- ============================================================
--  Избранное
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_favorites (
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES ticket_events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- ============================================================
--  Журнал действий организатора
--
--  Кто что сделал с мероприятием и с билетами: публикация, снятие,
--  отметка на входе. Нужен для разбора споров — «мой билет пометили
--  просроченным, а я не проходил».
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_log (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT REFERENCES ticket_events(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_log_event_idx ON ticket_log (event_id, id DESC);
