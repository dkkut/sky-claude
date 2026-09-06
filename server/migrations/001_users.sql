-- ============================================================
--  Пользователи.
--
--  До этой миграции аккаунты были захардкожены в server/store.mjs
--  и жили только в памяти процесса.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL,
  username      TEXT NOT NULL,
  name          TEXT NOT NULL,

  -- Формат: scrypt$N$r$p$соль$хеш (см. server/security.mjs).
  -- Алгоритм и параметры хранятся вместе с хешем, чтобы их можно
  -- было менять, не ломая старые записи.
  password_hash TEXT NOT NULL,

  is_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_prime      BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Телефон и ник — точки входа при логине, поэтому уникальны.
-- Ник сравниваем без учёта регистра: Luna и luna — один и тот же занятый ник.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key
  ON users (phone);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
  ON users (lower(username));
