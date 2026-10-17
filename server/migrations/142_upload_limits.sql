-- Раздельные лимиты: личная загрузка (закрытая коллекция) и публикация (общий каталог), отдельно для кино и музыки.
-- Пустое значение (NULL) = «как по умолчанию» (значения, зашитые в коде / окружении). Правит администрация (право upload_limits).
-- Строка kind='all', scope='personal' хранит общий объём личного хранилища (кино и музыка вместе — как и раньше считалась квота).
CREATE TABLE IF NOT EXISTS upload_limits (
  scope             TEXT NOT NULL CHECK (scope IN ('personal','public')),
  kind              TEXT NOT NULL CHECK (kind IN ('film','music','all')),
  max_file_bytes    BIGINT CHECK (max_file_bytes IS NULL OR max_file_bytes > 0),
  max_files         INT    CHECK (max_files IS NULL OR max_files >= 0),          -- 0 = без ограничения
  total_bytes       BIGINT CHECK (total_bytes IS NULL OR total_bytes >= 0),      -- обычный пользователь
  total_bytes_prime BIGINT CHECK (total_bytes_prime IS NULL OR total_bytes_prime >= 0),
  formats           TEXT,                                                        -- через запятую: mp4,webm,... ; NULL = все разрешённые системой
  max_duration_sec  INT    CHECK (max_duration_sec IS NULL OR max_duration_sec >= 0), -- 0 = без ограничения
  max_concurrent    INT    CHECK (max_concurrent IS NULL OR max_concurrent >= 1),
  speed_kbps        INT    CHECK (speed_kbps IS NULL OR speed_kbps >= 0),       -- 0 = без ограничения
  updated_by        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, kind)
);
