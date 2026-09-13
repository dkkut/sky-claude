-- ============================================================
--  Sky Market: услуги
-- ============================================================
--
-- Услуга — это тот же товар, только третьего типа. Так и сделано:
-- market_type = 'service' рядом со 'standard' и 'game'.
--
-- Почему не отдельной системой. У услуги тот же продавец с той же
-- подпиской, те же реквизиты для прямой оплаты, та же машина состояний
-- сделки, тот же чат заказа, те же отзывы и уведомления. Вторая
-- параллельная система означала бы второй набор правил доступа — и
-- однажды они разойдутся, а расходятся такие вещи всегда в сторону
-- «здесь проверку забыли».
--
-- Отличие у услуги ровно одно: пакеты. Базовый, стандарт, премиум —
-- разная цена, срок и состав. Под них и заведена единственная новая
-- таблица.
--
-- Доставки у услуги нет, как и у игрового лота: передавать нечего,
-- исполнитель сдаёт работу, заказчик принимает.

-- Третий тип товара и заказа.
ALTER TABLE market_products DROP CONSTRAINT IF EXISTS market_products_market_type_check;
ALTER TABLE market_products
  ADD CONSTRAINT market_products_market_type_check
  CHECK (market_type IN ('standard', 'game', 'service'));

ALTER TABLE market_orders DROP CONSTRAINT IF EXISTS market_orders_market_type_check;
ALTER TABLE market_orders
  ADD CONSTRAINT market_orders_market_type_check
  CHECK (market_type IN ('standard', 'game', 'service'));

-- Вид услуги: дизайн, разработка, музыка и так далее. Отдельной
-- колонкой, а не поверх category: у товара свои категории, и общий
-- список «дизайн или продукты питания» не значил бы ничего.
ALTER TABLE market_products
  ADD COLUMN IF NOT EXISTS service_category TEXT;

-- Метки услуги — для поиска. Список строк, потому что читаются и
-- пишутся они всегда целиком.
ALTER TABLE market_products
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
--  Пакеты услуги
-- ============================================================

CREATE TABLE IF NOT EXISTS market_service_packages (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,

  -- Три уровня, и ровно по одному каждого на услугу: два «стандарта»
  -- с разной ценой — это два ответа на вопрос «сколько стоит».
  level       TEXT NOT NULL CHECK (level IN ('basic', 'standard', 'premium')),

  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_kop   BIGINT NOT NULL CHECK (price_kop > 0),
  delivery_days INTEGER NOT NULL DEFAULT 1 CHECK (delivery_days > 0),
  -- -1 означает «без ограничения»: так это и было на экране.
  revisions   INTEGER NOT NULL DEFAULT 0 CHECK (revisions >= -1),
  includes    JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (product_id, level)
);

CREATE INDEX IF NOT EXISTS market_service_packages_idx
  ON market_service_packages (product_id, price_kop);

-- ============================================================
--  Какой пакет заказан
-- ============================================================

-- Снимок пакета в заказе. Цена и срок уже лежат в самом заказе, здесь
-- остаётся уровень и обещанный срок — чтобы через месяц было видно, о
-- чём именно договаривались.
ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS package_level TEXT
  CHECK (package_level IS NULL OR package_level IN ('basic', 'standard', 'premium'));

ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS package_title TEXT;

ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS delivery_days INTEGER
  CHECK (delivery_days IS NULL OR delivery_days > 0);

-- Что заказчик написал в требованиях. Зашифровано: там бывает всё, от
-- домена и доступов до описания внутренней кухни заказчика.
ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS requirements_enc TEXT;

-- Срок сдачи, посчитанный сервером от даты подтверждения оплаты.
ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
