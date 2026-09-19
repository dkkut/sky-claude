-- Sky Gifts: реальный каталог обычных подарков, версии их медиа, заказы
-- (обычный подарок и подарок Prime), доставленные экземпляры, владение и
-- история существующих NFT-подарков, уведомления.
--
-- НИЧЕГО из существующей витрины NFT (генерация карточек, редкость,
-- фон, коллекции) сюда не переезжает: она остаётся детерминированной и
-- процедурной на клиенте (src/gifts/nftStore.ts), как и была. Эти
-- таблицы добавляют только то, чего у неё не было — подлинное серверное
-- владение, передачу и историю.

-- Каталог обычных подарков (замена GIFT_CATALOG, зашитого в клиенте).
CREATE TABLE IF NOT EXISTS gift_catalog (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  emoji         TEXT NOT NULL DEFAULT '🎁',
  price_points  INTEGER NOT NULL CHECK (price_points > 0),
  gradient      TEXT NOT NULL DEFAULT '',
  media_id      TEXT,               -- текущая версия медиа (см. gift_media)
  thumb_media_id TEXT,
  rarity        TEXT NOT NULL DEFAULT 'common',
  seasonal      BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT
);

-- Медиа подарков (обычный каталог и карточка Prime) с настоящим
-- версионированием: замена не перезаписывает файл, а заводит новую
-- строку с новым id. Уже выданные экземпляры хранят id той версии,
-- что видели в момент отправки, — админ может сколько угодно менять
-- обложку, старые подарки не перекрасятся задним числом.
CREATE TABLE IF NOT EXISTS gift_media (
  id          TEXT PRIMARY KEY,       -- gfm-<uuid>
  owner_type  TEXT NOT NULL CHECK (owner_type IN ('gift_catalog', 'prime_card')),
  owner_id    TEXT,                   -- id записи каталога, для prime_card — NULL (тема, не сущность)
  role        TEXT NOT NULL CHECK (role IN ('main', 'thumbnail')),
  kind        TEXT NOT NULL CHECK (kind IN ('image', 'video', 'animation')),
  mime        TEXT NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);
CREATE INDEX IF NOT EXISTS gift_media_owner_idx ON gift_media (owner_type, owner_id, created_at DESC);

-- Заказ — общий для обычного подарка и подарка Prime. Держит хол-пэй-
-- ишью идемпотентным: повтор с тем же ключом не создаёт второй заказ.
CREATE TABLE IF NOT EXISTS gift_orders (
  id            TEXT PRIMARY KEY,     -- go-<uuid>
  idem_key      TEXT NOT NULL,
  buyer_id      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('gift', 'prime')),
  gift_catalog_id TEXT REFERENCES gift_catalog(id),
  recipient_id  TEXT NOT NULL,
  target        TEXT NOT NULL DEFAULT 'chat' CHECK (target IN ('chat', 'profile')),
  chat_id       TEXT,
  message       TEXT NOT NULL DEFAULT '',
  price         INTEGER NOT NULL CHECK (price > 0),
  currency      TEXT NOT NULL CHECK (currency IN ('points', 'money')),
  prime_days    INTEGER,
  prime_theme   TEXT,
  status        TEXT NOT NULL DEFAULT 'awaiting_payment'
                  CHECK (status IN ('awaiting_payment', 'paid', 'failed', 'refunded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ,
  UNIQUE (buyer_id, idem_key)
);
CREATE INDEX IF NOT EXISTS gift_orders_recipient_idx ON gift_orders (recipient_id);

-- Доставленный обычный подарок. Ссылается на ФИКСИРОВАННУЮ версию
-- медиа, взятую из каталога в момент оплаты заказа.
CREATE TABLE IF NOT EXISTS gift_instances (
  id              TEXT PRIMARY KEY,   -- gi-<uuid>
  order_id        TEXT NOT NULL UNIQUE REFERENCES gift_orders(id),
  gift_catalog_id TEXT NOT NULL REFERENCES gift_catalog(id),
  media_id        TEXT,
  thumb_media_id  TEXT,
  sender_id       TEXT NOT NULL,
  recipient_id    TEXT NOT NULL,
  chat_id         TEXT,
  message_id      TEXT,
  caption         TEXT NOT NULL DEFAULT '',
  saved_to_profile BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_instances_recipient_idx ON gift_instances (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_instances_sender_idx ON gift_instances (sender_id, created_at DESC);

-- Доставленный подарок Prime — карточка в мессенджере с тремя
-- состояниями: new (можно получить), activated (получена), unavailable
-- (отменена/недоступна — например, возврат заказа).
CREATE TABLE IF NOT EXISTS prime_gift_instances (
  id            TEXT PRIMARY KEY,     -- pgi-<uuid>
  order_id      TEXT NOT NULL UNIQUE REFERENCES gift_orders(id),
  sender_id     TEXT NOT NULL,
  recipient_id  TEXT NOT NULL,
  days          INTEGER NOT NULL CHECK (days > 0),
  theme         TEXT NOT NULL DEFAULT 'aurora',
  media_id      TEXT,       -- медиа темы на момент отправки (если админ его загружал), версия зафиксирована
  thumb_media_id TEXT,
  message       TEXT NOT NULL DEFAULT '',
  chat_id       TEXT,
  message_id    TEXT,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'activated', 'unavailable')),
  unavailable_reason TEXT,
  activated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prime_gift_instances_recipient_idx ON prime_gift_instances (recipient_id, created_at DESC);

-- Владение существующими NFT-подарками (src/gifts/nftStore.ts). Строка
-- появляется здесь только после первой реальной передачи — до этого
-- «истинный» владелец вычисляется тем же детерминированным алгоритмом,
-- что и на клиенте (см. server/nftgenesis.mjs), и в этой таблице его нет.
CREATE TABLE IF NOT EXISTS nft_ownership (
  nft_id      TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  owner_name  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Провенанс NFT — постоянная история, ничего отсюда не удаляется и не
-- правится (только INSERT из кода приложения).
CREATE TABLE IF NOT EXISTS nft_provenance (
  id            TEXT PRIMARY KEY,     -- nprov-<uuid>
  nft_id        TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('genesis', 'transfer')),
  from_id       TEXT,
  from_name     TEXT,
  to_id         TEXT NOT NULL,
  to_name       TEXT NOT NULL,
  operation_id  TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'gift',
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nft_provenance_nft_idx ON nft_provenance (nft_id, at);
-- Один и тот же operation_id не должен породить вторую запись истории:
-- это и есть защита от повторной обработки одной и той же передачи.
CREATE UNIQUE INDEX IF NOT EXISTS nft_provenance_op_idx ON nft_provenance (operation_id);

-- Уведомления о подарках/Prime/передаче NFT — по образцу
-- market_notifications (server/marketorders.mjs), отдельная таблица,
-- потому что общей нет нигде в проекте.
CREATE TABLE IF NOT EXISTS gift_notifications (
  id          TEXT PRIMARY KEY,       -- gnf-<uuid>
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  ref_id      TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gift_notifications_user_idx ON gift_notifications (user_id, created_at DESC);
