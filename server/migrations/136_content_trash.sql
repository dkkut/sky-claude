-- Корзина контента из админки: удаление с резервом 7 дней.
CREATE TABLE IF NOT EXISTS content_trash (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('music','movie','book')),
  item_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  owner_id    TEXT,
  prev_status TEXT NOT NULL,
  reason      TEXT NOT NULL,
  deleted_by  TEXT NOT NULL,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_at    TIMESTAMPTZ NOT NULL,
  state       TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held','restored','purged'))
);
CREATE UNIQUE INDEX IF NOT EXISTS content_trash_held ON content_trash (kind, item_id) WHERE state = 'held';
CREATE INDEX IF NOT EXISTS content_trash_due ON content_trash (purge_at) WHERE state = 'held';
