-- Метки контента (модуль 9): Explicit «E», «Старая версия», сведения об источнике. Музыка, кино, книги.
-- explicit            — отметка загрузившего/автора (уже есть у кино и книг; для музыки добавляется);
-- mod_explicit        — решение модератора: TRUE/FALSE перекрывает отметку автора, NULL — решения нет;
-- legacy_label        — «Старая версия — до вступления в силу законодательства о цензуре»: ставит ТОЛЬКО модератор по подтверждённым данным;
-- source_note/rightsholder — откуда материал и кто правообладатель (владелец указывает о своём, модератор может уточнить).
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS explicit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS mod_explicit BOOLEAN;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS legacy_label BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS source_note TEXT;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS rightsholder TEXT;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS labeled_by TEXT;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS labeled_at TIMESTAMPTZ;

ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS mod_explicit BOOLEAN;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS legacy_label BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS source_note TEXT;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS rightsholder TEXT;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS labeled_by TEXT;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS labeled_at TIMESTAMPTZ;

ALTER TABLE books ADD COLUMN IF NOT EXISTS mod_explicit BOOLEAN;
ALTER TABLE books ADD COLUMN IF NOT EXISTS legacy_label BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE books ADD COLUMN IF NOT EXISTS source_note TEXT;
ALTER TABLE books ADD COLUMN IF NOT EXISTS rightsholder TEXT;
ALTER TABLE books ADD COLUMN IF NOT EXISTS labeled_by TEXT;
ALTER TABLE books ADD COLUMN IF NOT EXISTS labeled_at TIMESTAMPTZ;

-- Журнал изменений меток: кто, что, было → стало, причина (зашифрована).
CREATE TABLE IF NOT EXISTS content_label_log (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('track','movie','book')),
  content_id TEXT NOT NULL,
  actor_id   TEXT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('owner','moderator')),
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  reason     TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_label_log_idx ON content_label_log (kind, content_id, id);

-- Настройки текстов меток (правит администрация).
CREATE TABLE IF NOT EXISTS content_label_settings (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  legacy_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  legacy_text  TEXT NOT NULL DEFAULT 'Старая версия — до вступления в силу законодательства о цензуре',
  explicit_text TEXT NOT NULL DEFAULT 'Содержит ненормативную лексику или материалы 18+',
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO content_label_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
