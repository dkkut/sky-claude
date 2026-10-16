-- Sky Storage: единый управляемый слой хранения (реестр, состояния, квоты, резервные копии,
-- подтверждение подключений). Файлы по-прежнему лежат в каталогах сервисов и зашифрованы их
-- форматами (SKE1/AES-GCM); эта миграция ТОЛЬКО добавляет таблицы — существующие не меняются.
-- Откат: DROP TABLE storage_* (в обратном порядке зависимостей) — рабочие данные сервисов не затрагиваются.
-- Ключей шифрования в базе нет: только их идентификаторы и контрольные значения.

-- Состояние хранилища: ОДНА строка, независимые поля + версия для оптимистичной блокировки.
CREATE TABLE IF NOT EXISTS storage_state (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version     BIGINT NOT NULL DEFAULT 1,
  -- аварийное отключение («Выключить хранилище»)
  emergency   JSONB NOT NULL DEFAULT '{"active":false}'::jsonb,
  -- технические работы: {active, mode:'safe'|'emergency', reason, by, at}
  maintenance JSONB NOT NULL DEFAULT '{"active":false}'::jsonb,
  -- обязательная авторизация Sky («Ограничить доступ от ключа Sky»)
  sky_auth    JSONB NOT NULL DEFAULT '{"active":false}'::jsonb,
  -- список активных ограничений безопасности: [{id, kind, critical, reason, by, at, auto}]
  restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Все ранее выданные временные пропуски с «возрастом» до этой отметки (секунды Unix) недействительны.
  ticket_epoch BIGINT NOT NULL DEFAULT 0,
  -- настраиваемые пороги и политики
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO storage_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Журнал событий хранилища (операционный и безопасности). Административные действия
-- дополнительно пишутся в общий журнал админки с цепочкой отпечатков (admin_log).
CREATE TABLE IF NOT EXISTS storage_events (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'critical')),
  kind       TEXT NOT NULL,
  actor_id   TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS storage_events_at_idx ON storage_events (at DESC);
CREATE INDEX IF NOT EXISTS storage_events_kind_idx ON storage_events (kind, at DESC);

-- Реестр объектов (метаданные). Файл остаётся в каталоге своего сервиса; id — тот же, что в таблицах сервисов.
CREATE TABLE IF NOT EXISTS storage_objects (
  service      TEXT NOT NULL,
  id           TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'media',
  owner_id     TEXT,
  mime         TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         BIGINT NOT NULL DEFAULT 0,        -- байт на диске (зашифрованный объект)
  plain_size   BIGINT,
  sha256       TEXT,                             -- отпечаток зашифрованных байт (целостность хранения)
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'orphan', 'quarantine', 'missing', 'corrupt')),
  access       TEXT NOT NULL DEFAULT 'service',  -- политика доступа решается сервисом-владельцем
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at   TIMESTAMPTZ,
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service, id)
);
CREATE INDEX IF NOT EXISTS storage_objects_owner_idx ON storage_objects (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS storage_objects_status_idx ON storage_objects (status);

-- Карантин осиротевших объектов: файл перенесён в каталог карантина, не удалён.
CREATE TABLE IF NOT EXISTS storage_quarantine (
  id          BIGSERIAL PRIMARY KEY,
  service     TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  orig_path   TEXT NOT NULL,
  quar_path   TEXT NOT NULL,
  size        BIGINT NOT NULL DEFAULT 0,
  reason      TEXT NOT NULL DEFAULT '',
  moved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_after TIMESTAMPTZ NOT NULL,
  state       TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'restored', 'purged'))
);
CREATE INDEX IF NOT EXISTS storage_quarantine_state_idx ON storage_quarantine (state, purge_after);

-- Квоты по категориям (жёсткие/мягкие пределы и параллелизм).
CREATE TABLE IF NOT EXISTS storage_quotas (
  category        TEXT PRIMARY KEY,
  hard_bytes      BIGINT,                         -- NULL — без отдельного предела
  max_file_bytes  BIGINT,
  max_files       BIGINT,
  max_concurrent  INT,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Резервные копии.
CREATE TABLE IF NOT EXISTS storage_backups (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('full', 'media', 'messenger', 'service', 'category', 'metadata', 'config')),
  scope        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed', 'verifying', 'verified', 'corrupt', 'cancelled', 'deleted')),
  target       TEXT NOT NULL,
  base_id      TEXT,                              -- родительская копия (инкрементальная цепочка)
  format       INT NOT NULL DEFAULT 1,
  key_id       TEXT NOT NULL,
  files        INT NOT NULL DEFAULT 0,
  bytes        BIGINT NOT NULL DEFAULT 0,
  manifest_sha TEXT,
  progress     INT NOT NULL DEFAULT 0,
  verify       JSONB,                             -- результат проверки целостности
  error        TEXT NOT NULL DEFAULT '',
  trigger      TEXT NOT NULL DEFAULT 'manual',   -- manual | schedule
  created_by   TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  verified_at  TIMESTAMPTZ,
  pinned       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS storage_backups_started_idx ON storage_backups (started_at DESC);

-- Расписание резервного копирования (работает на сервере, без браузера).
CREATE TABLE IF NOT EXISTS storage_schedules (
  id          TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  frequency   TEXT NOT NULL CHECK (frequency IN ('daily', 'multi', 'weekly')),
  times       JSONB NOT NULL DEFAULT '["03:00"]'::jsonb,  -- локальное время сервера HH:MM
  weekday     SMALLINT,                                    -- 0..6 для weekly
  kind        TEXT NOT NULL DEFAULT 'full',
  scope       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  last_slot   TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Восстановления (журнал).
CREATE TABLE IF NOT EXISTS storage_restores (
  id          TEXT PRIMARY KEY,
  backup_id   TEXT NOT NULL REFERENCES storage_backups(id),
  scope       JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode        TEXT NOT NULL DEFAULT 'plan' CHECK (mode IN ('plan', 'apply')),
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  result      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Одноразовые ссылки скачивания копий (в базе только хеш токена).
CREATE TABLE IF NOT EXISTS storage_downloads (
  id          TEXT PRIMARY KEY,
  backup_id   TEXT NOT NULL REFERENCES storage_backups(id),
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Запросы на подтверждение нового подключения к управлению хранилищем.
CREATE TABLE IF NOT EXISTS storage_connections (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL,
  device_hash   TEXT NOT NULL,
  session_id    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'revoked')),
  risk          INT NOT NULL DEFAULT 0,
  risk_reasons  JSONB NOT NULL DEFAULT '[]'::jsonb,
  info          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- ua/ip (сокращённо), без секретов
  token_hash    TEXT UNIQUE,                          -- хеш одноразового токена письма
  token_used_at TIMESTAMPTZ,
  mailed_at     TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  decided_at    TIMESTAMPTZ,
  decided_by    TEXT,
  decided_via   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_connections_pending_idx ON storage_connections (status, expires_at);
-- Не больше одной действующей (ожидающей или одобренной) записи на пару «человек — устройство».
CREATE UNIQUE INDEX IF NOT EXISTS storage_connections_live_uq ON storage_connections (profile_id, device_hash) WHERE status IN ('pending', 'approved');

-- Контрольные значения ключей хранилища (материала ключей здесь нет).
CREATE TABLE IF NOT EXISTS storage_keys (
  kid        TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  check_val  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ
);

-- Права: новые полномочия выдаются ролями (server/roles.mjs); отдельной таблицы не требуется.
