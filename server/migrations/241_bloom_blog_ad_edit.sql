-- Bloom: блоги (заголовок + длинный текст), пометка «реклама» и правка постов.
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS title     TEXT;
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS is_blog   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS is_ad     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS ad_note   TEXT;
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
