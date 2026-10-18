-- Sky Ads: сведения о загруженном медиа (длительность видео), подтверждённые просмотры. Только добавляет.
CREATE TABLE IF NOT EXISTS ad_media_meta (
  media_id     TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('image','video')),
  mime         TEXT NOT NULL,
  bytes        BIGINT NOT NULL DEFAULT 0,
  duration_sec NUMERIC(8,2),                 -- NULL: длительность неизвестна (WebM)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_media_meta_owner_idx ON ad_media_meta(owner_id, created_at DESC);

ALTER TABLE ad_impressions ADD COLUMN IF NOT EXISTS watched_sec NUMERIC(8,2) NOT NULL DEFAULT 0;
ALTER TABLE ad_impressions ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ad_impressions_user_placement_idx ON ad_impressions (user_id, placement, created_at DESC);
