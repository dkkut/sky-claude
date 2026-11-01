-- Детский аккаунт: обычный профиль внутри Sky ID, помеченный как детский.
-- Ограничения проверяет сервер по этой таблице (server/childaccount.mjs); сам профиль ничего не решает.
CREATE TABLE IF NOT EXISTS child_accounts (
  profile_id   TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  sky_id       TEXT NOT NULL,
  guardian_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  pin_hash     TEXT NOT NULL,                       -- PIN опекуна (нужен, чтобы выйти из детского профиля)
  birth_year   INTEGER,
  settings     JSONB NOT NULL DEFAULT '{}',          -- { modules: [закрытые ключи], money: bool, hideAdult: bool }
  pin_fails    INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS child_accounts_sky_idx ON child_accounts (sky_id);
