-- Отдельный пароль кошелька SkyMoney (необязателен; хеш, не пароль Sky ID).
CREATE TABLE IF NOT EXISTS money_password (
  sky_id       TEXT PRIMARY KEY,
  hash         TEXT NOT NULL,
  fails        INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
