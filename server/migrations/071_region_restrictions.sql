-- Региональные ограничения контента (Bloom, SkyVideo).
--
-- Пустой массив — доступен во всех регионах (значение по умолчанию,
-- ничего не меняется для существующих постов/роликов). Непустой —
-- список кодов регионов (см. server/regions.mjs), в которых контент
-- недоступен. Проверяется на backend при каждой выдаче — см.
-- selectPosts() в bloom.mjs и visibleVideo()/listFeed() в skyvideo.mjs.
ALTER TABLE bloom_posts ADD COLUMN IF NOT EXISTS blocked_regions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE sky_videos   ADD COLUMN IF NOT EXISTS blocked_regions TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS bloom_posts_blocked_regions_idx ON bloom_posts USING gin (blocked_regions);
CREATE INDEX IF NOT EXISTS sky_videos_blocked_regions_idx  ON sky_videos  USING gin (blocked_regions);
