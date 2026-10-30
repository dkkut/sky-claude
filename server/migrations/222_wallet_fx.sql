-- Дополнительные валютные счета SkyMoney. Основная валюта — рубль (wallet_accounts.balance); валютные счета открываются по желанию.
-- Курсы задаёт администрация (источника рыночных курсов в Sky нет), на обмене действует спред. Деньги внутри Sky, вывод — только обратным обменом в рубли.
CREATE TABLE IF NOT EXISTS wallet_fx_accounts (
  user_id    TEXT NOT NULL,
  currency   TEXT NOT NULL,
  balance    BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),   -- в сотых долях валюты
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, currency)
);
CREATE TABLE IF NOT EXISTS wallet_fx_rates (
  currency   TEXT PRIMARY KEY,
  rate_rub   NUMERIC(18,6) NOT NULL CHECK (rate_rub > 0),      -- рублей за 1 единицу валюты (середина)
  spread_pct NUMERIC(5,2)  NOT NULL DEFAULT 1.5 CHECK (spread_pct >= 0 AND spread_pct <= 20),
  enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallet_fx_transfers (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  currency   TEXT NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('buy','sell')),   -- buy: рубли → валюта, sell: валюта → рубли
  rub        BIGINT NOT NULL,
  amount     BIGINT NOT NULL,                                      -- сотые доли валюты
  rate       NUMERIC(18,6) NOT NULL,                               -- рублей за единицу с учётом спреда
  idem_key   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idem_key)
);
CREATE INDEX IF NOT EXISTS wallet_fx_transfers_user ON wallet_fx_transfers (user_id, created_at DESC);
