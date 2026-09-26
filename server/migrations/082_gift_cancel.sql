-- Sky Gifts: отмена отправки в течение 3 часов + реальный архив для
-- обычных и Prime-подарков.
--
-- NFT-подарки (nft_ownership/nft_provenance) эта миграция не трогает
-- вообще: у них уже есть свой клиентский архив (src/gifts/nftStore.ts,
-- чисто localStorage) — он и остаётся, а не переезжает сюда.
--
-- sent_at отдельным полем не заводим: gift_instances.created_at и
-- prime_gift_instances.created_at и так пишутся ровно в момент
-- доставки (см. sendGiftLocked/sendPrimeGiftLocked) и никогда не
-- правятся клиентом — это и есть server-authoritative sent_at из
-- задачи.
--
-- Архив — по каждой стороне отдельно (отправитель и получатель видят
-- одну и ту же доставку в разных списках, и должны уметь убрать её из
-- своего списка независимо друг от друга), а не одним общим флагом.

ALTER TABLE gift_instances
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'delivered'
    CHECK (status IN ('delivered', 'cancelled')),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by_sender_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by_recipient_at TIMESTAMPTZ;

ALTER TABLE prime_gift_instances
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by_sender_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by_recipient_at TIMESTAMPTZ;
