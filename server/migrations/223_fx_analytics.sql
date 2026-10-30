-- Валютные курсы: источник (вручную / ЦБ РФ автоматически) и история курсов для аналитики.
ALTER TABLE wallet_fx_rates ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cbr'));
CREATE TABLE IF NOT EXISTS wallet_fx_rate_history (
  id       BIGSERIAL PRIMARY KEY,
  currency TEXT NOT NULL,
  rate_rub NUMERIC(18,6) NOT NULL,
  source   TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_fx_rate_history_cur ON wallet_fx_rate_history (currency, at DESC);
