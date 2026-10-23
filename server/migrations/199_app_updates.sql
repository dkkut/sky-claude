-- «Обновления» в настройках приложения: файлы приложений, отдельные от скачивания на лендинге (site_downloads).
-- Одна строка на платформу — текущая версия; файл лежит на диске в SITE_DIR/updates.
CREATE TABLE IF NOT EXISTS app_updates (
  platform    TEXT PRIMARY KEY,
  version     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  file_id     TEXT,
  file_name   TEXT,
  file_mime   TEXT,
  file_size   BIGINT,
  file_sha256 TEXT,
  file_at     TIMESTAMPTZ,
  downloads   BIGINT NOT NULL DEFAULT 0,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_updates (platform) VALUES ('android'), ('windows'), ('ios'), ('macos'), ('linux') ON CONFLICT DO NOTHING;
