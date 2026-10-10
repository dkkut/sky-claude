-- Sky Gifts: у подарков больше нет демонстрационных владельцев — всё, что ещё никто не
-- купил по-настоящему, принадлежит Sky Mint и продаётся по цене каталога.
-- Настоящих владельцев (профили acc-<uuid>) и их историю не трогаем.
UPDATE nft_ownership
   SET owner_id = 'sky-mint', owner_name = 'Sky Mint', updated_at = now()
 WHERE owner_id IN ('acc-luna','acc-neo','acc-kutuzov','col-mira','col-arkin','col-zima','col-orel','col-vesna');

UPDATE nft_provenance
   SET to_id = 'sky-mint', to_name = 'Sky Mint'
 WHERE type = 'genesis'
   AND to_id IN ('acc-luna','acc-neo','acc-kutuzov','col-mira','col-arkin','col-zima','col-orel','col-vesna');

-- Лоты демонстрационных продавцов (если были) снимаем: продавать им нечего.
UPDATE nft_listings SET status = 'cancelled'
 WHERE status = 'active'
   AND seller_id IN ('acc-luna','acc-neo','acc-kutuzov','col-mira','col-arkin','col-zima','col-orel','col-vesna');
