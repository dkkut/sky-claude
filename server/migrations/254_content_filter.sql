-- Фильтры контента: настройки, очередь удержаний, расширение статусов.
CREATE TABLE IF NOT EXISTS content_filter_settings (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  actions      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  custom_words JSONB   NOT NULL DEFAULT '[]'::jsonb,
  allow_words  TEXT[]  NOT NULL DEFAULT '{}',
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO content_filter_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS cf_holds (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  categories  TEXT[] NOT NULL DEFAULT '{}',
  excerpt_enc TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by  TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cf_holds_pending_idx ON cf_holds (created_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS cf_holds_target_uniq ON cf_holds (kind, target_id) WHERE status = 'pending';

-- Журнал срабатываний: только категории и источник, без текста.
CREATE TABLE IF NOT EXISTS cf_events (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,
  author_id  TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_events_time_idx ON cf_events (created_at DESC);

-- Удержанное на проверку скрывается тем же механизмом, что и удалённое: deleted_at, но с отметкой held_at.
ALTER TABLE bloom_posts    ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;
ALTER TABLE bloom_comments ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;

ALTER TABLE qa_questions DROP CONSTRAINT IF EXISTS qa_questions_status_check;
ALTER TABLE qa_questions ADD CONSTRAINT qa_questions_status_check CHECK (status IN ('open','removed','held'));
ALTER TABLE qa_answers DROP CONSTRAINT IF EXISTS qa_answers_status_check;
ALTER TABLE qa_answers ADD CONSTRAINT qa_answers_status_check CHECK (status IN ('visible','removed','held'));
