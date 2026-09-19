-- Sky Gifts NFT: настоящий маркет поверх уже существующей процедурной
-- витрины (src/gifts/nftStore.ts). Сама витрина (84 подарка, 12
-- коллекций) не трогается — здесь только правда о выставленных на
-- продажу лотах и их судьбе, вместо локального localStorage-стора,
-- который не помнил ничего за пределами одного браузера и позволял
-- «купить» без единой проверки баланса.
CREATE TABLE IF NOT EXISTS nft_listings (
  id            TEXT PRIMARY KEY,     -- lst-<uuid>
  nft_id        TEXT NOT NULL,
  seller_id     TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('fixed', 'auction', 'instant', 'reserve')),
  price         INTEGER NOT NULL CHECK (price > 0),
  reserve_price INTEGER,
  decay_pct     INTEGER NOT NULL DEFAULT 0,
  duration_h    INTEGER NOT NULL DEFAULT 72,
  current_bid   INTEGER,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
  sold_price    INTEGER,
  sold_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS nft_listings_nft_idx ON nft_listings (nft_id);
CREATE INDEX IF NOT EXISTS nft_listings_seller_idx ON nft_listings (seller_id);
-- Один активный лот на подарок одновременно — второй createListing на
-- тот же nft_id упадёт по этому индексу, а не создаст дублирующий лот.
CREATE UNIQUE INDEX IF NOT EXISTS nft_listings_active_one_idx ON nft_listings (nft_id) WHERE status = 'active';

-- Продажа через маркет — такая же настоящая передача, как и прямой
-- подарок другу (server/nft.mjs::transferNft), только с ценой и типом
-- 'sale' в истории вместо 'transfer'.
ALTER TABLE nft_provenance ADD COLUMN IF NOT EXISTS price INTEGER;
ALTER TABLE nft_provenance DROP CONSTRAINT IF EXISTS nft_provenance_type_check;
ALTER TABLE nft_provenance ADD CONSTRAINT nft_provenance_type_check CHECK (type IN ('genesis', 'transfer', 'sale'));
