-- Архив удалённых материалов: 20 дней на возврат. Материал не стирается —
-- у него снимается владелец и ставится скрытый статус (ни один каталог его
-- не видит), а здесь запоминается, чей он был и каким. Только добавляет.
CREATE TABLE IF NOT EXISTS content_archive (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('track','movie','book','video')),
  item_id     TEXT NOT NULL,
  owner_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  prev_status TEXT NOT NULL,
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_at    TIMESTAMPTZ NOT NULL,
  warned_at   TIMESTAMPTZ,
  state       TEXT NOT NULL DEFAULT 'archived' CHECK (state IN ('archived','restored','purged'))
);
CREATE UNIQUE INDEX IF NOT EXISTS content_archive_item_idx ON content_archive (kind, item_id) WHERE state = 'archived';
CREATE INDEX IF NOT EXISTS content_archive_owner_idx ON content_archive (owner_id, archived_at DESC) WHERE state = 'archived';
CREATE INDEX IF NOT EXISTS content_archive_purge_idx ON content_archive (purge_at) WHERE state = 'archived';
