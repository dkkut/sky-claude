-- Sky Music Studio: версии аудио трека, журнал студии. Только добавляет.
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS audio_file TEXT;      -- NULL → файл лежит под id самого трека

CREATE TABLE IF NOT EXISTS music_track_versions (
  file_id    TEXT PRIMARY KEY,                    -- идентификатор файла в musicstore (для v1 — id трека)
  track_id   TEXT NOT NULL,
  version    INT NOT NULL,
  bytes      BIGINT NOT NULL DEFAULT 0,
  mime       TEXT NOT NULL DEFAULT 'audio/mpeg',
  note       TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current BOOLEAN NOT NULL DEFAULT false,
  status_when_replaced TEXT,                      -- статус трека на момент, когда эту версию заменили
  UNIQUE (track_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS music_track_versions_current ON music_track_versions(track_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS music_studio_events (
  id       BIGSERIAL PRIMARY KEY,
  card_id  TEXT,
  track_id TEXT,
  actor_id TEXT,
  action   TEXT NOT NULL,
  detail   JSONB NOT NULL DEFAULT '{}'::jsonb,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_studio_events_track_idx ON music_studio_events(track_id, id DESC);
