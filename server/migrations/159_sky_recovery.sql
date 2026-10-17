-- Sky Recovery: резервная почта, запросы восстановления, токены администраторов, секрет владельца, заявки в поддержку, история.

-- Резервная почта (одна на Sky ID; один адрес — не у двух аккаунтов).
CREATE TABLE IF NOT EXISTS sky_backup_emails (
  sky_id          TEXT PRIMARY KEY,
  email           TEXT,                       -- подтверждённый адрес
  verified_at     TIMESTAMPTZ,
  usable_after    TIMESTAMPTZ,                -- после смены адрес сутки не годится для восстановления
  pending_email   TEXT,                       -- ждёт подтверждения ссылкой
  pending_hash    TEXT,                       -- хеш одноразовой ссылки
  pending_expires TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sky_backup_emails_email_idx ON sky_backup_emails (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sky_backup_emails_pending_idx ON sky_backup_emails (pending_hash) WHERE pending_hash IS NOT NULL;

-- Запрос восстановления (публичный сценарий). sky_id пуст, если такого аккаунта нет: ответы одинаковы.
CREATE TABLE IF NOT EXISTS recovery_requests (
  id           TEXT PRIMARY KEY,
  secret_hash  TEXT NOT NULL,                 -- знание id недостаточно: нужен ещё секрет запроса
  sky_id       TEXT,
  kind         TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user','admin','owner')),
  factors      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- доказанные факторы: email, totp, backup_code, admin_token, owner_secret
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','ready','done','cancelled','expired','blocked')),
  ready_at     TIMESTAMPTZ,                   -- если нужно ожидание
  finish_hash  TEXT,                          -- ссылка «завершить» (после ожидания)
  cancel_hash  TEXT,                          -- ссылка «это не я»
  ip_hash      TEXT NOT NULL DEFAULT '',
  device       TEXT NOT NULL DEFAULT '',
  risk         INT NOT NULL DEFAULT 0,
  fails        INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recovery_requests_sky_idx ON recovery_requests (sky_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_requests_finish_idx ON recovery_requests (finish_hash) WHERE finish_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recovery_requests_cancel_idx ON recovery_requests (cancel_hash) WHERE cancel_hash IS NOT NULL;

-- Токены восстановления администраторов: в базе только хеш; открытое значение один раз показывается самому администратору.
CREATE TABLE IF NOT EXISTS recovery_admin_tokens (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL,
  sky_id        TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  sealed        TEXT,                         -- открытое значение, зашифрованное до первого показа; после показа стирается
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT,
  revoke_reason TEXT NOT NULL DEFAULT '',
  last_used_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_admin_tokens_hash_idx ON recovery_admin_tokens (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_admin_tokens_active_idx ON recovery_admin_tokens (profile_id) WHERE revoked_at IS NULL;

-- Отдельный секрет владельца: хеш (scrypt), задаётся самим владельцем, не показывается и не хранится открытым.
CREATE TABLE IF NOT EXISTS recovery_owner_secrets (
  profile_id  TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  fails       INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

-- Заявки на восстановление через поддержку (бланк). Переписка — в обычном тикете поддержки.
CREATE TABLE IF NOT EXISTS recovery_cases (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,         -- SR-10482
  sky_id        TEXT,
  profile_id    TEXT,                         -- кого касается (если установлен)
  account_kind  TEXT NOT NULL DEFAULT 'user' CHECK (account_kind IN ('user','admin','owner')),
  reason        TEXT NOT NULL,
  form_enc      TEXT NOT NULL,                -- содержимое бланка (зашифровано)
  contact_email TEXT,                         -- подтверждённая почта для уведомлений о новых сообщениях
  contact_ok    BOOLEAN NOT NULL DEFAULT FALSE,
  contact_hash  TEXT,                         -- ссылка подтверждения контактной почты
  ticket_id     TEXT,
  access_hash   TEXT NOT NULL,                -- секрет доступа к чату заявки (ограниченная сессия)
  idem_key      TEXT UNIQUE,                  -- защита от двойной отправки формы
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','review','waiting_user','security_check','allowed','resolved','rejected','closed')),
  assignee_id   TEXT,
  unread_user   INT NOT NULL DEFAULT 0,
  unread_staff  INT NOT NULL DEFAULT 0,
  ip_hash       TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recovery_cases_sky_idx ON recovery_cases (sky_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS recovery_cases_status_idx ON recovery_cases (status, updated_at DESC);
CREATE SEQUENCE IF NOT EXISTS recovery_case_seq START 10001;

CREATE TABLE IF NOT EXISTS recovery_case_log (
  id         BIGSERIAL PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  actor_id   TEXT,
  event      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recovery_case_log_idx ON recovery_case_log (case_id, id);

-- Уведомления по заявке: одно событие — одно письмо; ошибка доставки не теряет сообщение, письмо можно повторить.
CREATE TABLE IF NOT EXISTS recovery_case_mail (
  event_key  TEXT PRIMARY KEY,                -- <case>:<event>:<id> — защита от дублей
  case_id    TEXT NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts   INT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recovery_case_mail_pending_idx ON recovery_case_mail (status, created_at) WHERE status <> 'sent';

-- История восстановления доступа: видна самому человеку (без секретов) и сотрудникам.
CREATE TABLE IF NOT EXISTS recovery_history (
  id         BIGSERIAL PRIMARY KEY,
  sky_id     TEXT,
  request_id TEXT,
  kind       TEXT NOT NULL DEFAULT 'user',
  event      TEXT NOT NULL,
  factor     TEXT NOT NULL DEFAULT '',
  result     TEXT NOT NULL DEFAULT 'ok',
  ip_hash    TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recovery_history_sky_idx ON recovery_history (sky_id, id DESC);
CREATE INDEX IF NOT EXISTS recovery_history_req_idx ON recovery_history (request_id);

-- Восстановление без обходных путей: действующий предел попыток по аккаунту и устройству.
CREATE TABLE IF NOT EXISTS recovery_attempts (
  key        TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recovery_attempts_idx ON recovery_attempts (key, at DESC);

-- Передача готового восстановления из сайта recovery в основное приложение: одноразовый код на 5 минут (сессия создаётся уже на домене приложения, где и стоит кука).
CREATE TABLE IF NOT EXISTS recovery_handoffs (
  code_hash  TEXT PRIMARY KEY,
  sky_id     TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'user',
  request_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
