-- Личный токен администратора/владельца: дополнительный фактор для входа в панель, подтверждений и настроек. В базе только HMAC.
CREATE TABLE IF NOT EXISTS admin_tokens (
  profile_id    TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  last4         TEXT NOT NULL,
  fails         INT  NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
-- «Настройки открыты»: сессия ввела токен, действует ограниченное время (изменения в админке и настройки администратора).
CREATE TABLE IF NOT EXISTS admin_token_unlock (
  sid        TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
