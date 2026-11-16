-- Sky Gifts: пользовательские подарки (фото или видео, название, описание, оформление) с проверкой и модерацией до появления в каталоге.
CREATE TABLE IF NOT EXISTS custom_gifts (
  id            TEXT PRIMARY KEY,                         -- cgf-<uuid>
  author_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  style         TEXT NOT NULL DEFAULT 'classic',
  media_id      TEXT,                                     -- cgm-<uuid>, файл лежит зашифрованным (customgiftstore.mjs)
  media_kind    TEXT,                                     -- image | animation | video
  media_mime    TEXT,
  media_bytes   INTEGER NOT NULL DEFAULT 0,
  media_sha     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft',            -- draft | pending | extra_review | approved | rejected | withdrawn | removed
  reason        TEXT NOT NULL DEFAULT '',
  submitted_at  TIMESTAMPTZ,
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  escalated_by  TEXT,
  escalation_note TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_gifts_status_idx ON custom_gifts (status, submitted_at);
CREATE INDEX IF NOT EXISTS custom_gifts_author_idx ON custom_gifts (author_id, created_at DESC);
CREATE TABLE IF NOT EXISTS custom_gift_sends (
  id            TEXT PRIMARY KEY,                         -- cgs-<uuid>
  gift_id       TEXT NOT NULL REFERENCES custom_gifts(id) ON DELETE CASCADE,
  sender_id     TEXT NOT NULL,
  recipient_id  TEXT NOT NULL,
  message       TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_gift_sends_rcpt_idx ON custom_gift_sends (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS custom_gift_sends_snd_idx ON custom_gift_sends (sender_id, created_at DESC);
CREATE TABLE IF NOT EXISTS custom_gift_log (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id  TEXT NOT NULL,
  gift_id   TEXT NOT NULL,
  action    TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS custom_gift_log_idx ON custom_gift_log (gift_id, id DESC);
