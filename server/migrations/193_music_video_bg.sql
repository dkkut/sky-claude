-- Видеофон трека для полноэкранного плеера: загружает владелец трека.
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS has_video BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS video_mime TEXT;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS video_bytes BIGINT NOT NULL DEFAULT 0;
