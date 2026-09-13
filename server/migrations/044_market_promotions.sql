-- ============================================================
--  Sky Market: продвижение товара
-- ============================================================
--
-- Раньше «Реклама» в кабинете продавца была экраном без последствий:
-- он показывал тарифы, рисовал «кампания запущена», добавлял строчку в
-- память вкладки — и всё. Денег никто не брал, охвата никто не давал,
-- и при перезагрузке кампания исчезала.
--
-- Здесь продвижение настоящее: оплачивается из кошелька Sky, живёт
-- заданный срок и действительно поднимает товар в каталоге.
--
-- Про деньги, чтобы не было путаницы. Это плата Sky за своё же место
-- на витрине — как и подписка продавца. К сделке она отношения не
-- имеет: деньги покупателя по-прежнему идут продавцу напрямую, мимо
-- нас, и ни баланса, ни вывода у продавца нет.

CREATE TABLE IF NOT EXISTS market_promotions (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Тариф. Закрытый список: цену и срок задаёт сервер, а не запрос.
  plan        TEXT NOT NULL CHECK (plan IN ('basic', 'pro', 'premium')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  days        INTEGER NOT NULL CHECK (days > 0),

  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_promotions_seller_idx
  ON market_promotions (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_promotions_product_idx
  ON market_promotions (product_id, ends_at DESC);

-- До какого числа товар продвигается. Колонкой на самом товаре, чтобы
-- каталог сортировался одним запросом, а не подзапросом на каждую
-- строку.
ALTER TABLE market_products
  ADD COLUMN IF NOT EXISTS promoted_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS market_products_promoted_idx
  ON market_products (promoted_until DESC) WHERE promoted_until IS NOT NULL;
