-- Ограничение регистрации новых аккаунтов (Sky ID). Вход существующих людей не затрагивается.
CREATE TABLE IF NOT EXISTS registration_settings (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,        -- false: новые аккаунты не создаются
  daily_limit  INT NOT NULL DEFAULT 0,               -- не больше стольких новых аккаунтов за последние 24 часа (0 — без предела)
  per_ip_limit INT NOT NULL DEFAULT 0,               -- не больше стольких с одного адреса за per_ip_hours (0 — без предела)
  per_ip_hours INT NOT NULL DEFAULT 24,
  message      TEXT NOT NULL DEFAULT '',             -- что увидит человек вместо стандартного текста
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ
);
INSERT INTO registration_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- Адрес регистрации — только хеш: нужен лишь для счёта «сколько с одного адреса».
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS reg_ip_hash TEXT;
CREATE INDEX IF NOT EXISTS sky_ids_created_idx ON sky_ids (created_at);
CREATE INDEX IF NOT EXISTS sky_ids_reg_ip_idx ON sky_ids (reg_ip_hash, created_at) WHERE reg_ip_hash IS NOT NULL;

-- Отказы: для статистики в админке (без адресов и без почты).
CREATE TABLE IF NOT EXISTS registration_blocked (
  id     BIGSERIAL PRIMARY KEY,
  reason TEXT NOT NULL,        -- closed | daily_limit | ip_limit
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registration_blocked_at_idx ON registration_blocked (at DESC);
