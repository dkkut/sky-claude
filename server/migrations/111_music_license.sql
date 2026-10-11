-- Лицензия трека. 'own' — трек загружен самим правообладателем (по умолчанию);
-- остальные — открытые лицензии. Площадка лишь предоставляет доступ к сервису:
-- за права на загруженное отвечает загрузивший (см. правила Sky Music).
ALTER TABLE music_tracks
  ADD COLUMN IF NOT EXISTS license        TEXT NOT NULL DEFAULT 'own',
  ADD COLUMN IF NOT EXISTS license_source TEXT NOT NULL DEFAULT '';
