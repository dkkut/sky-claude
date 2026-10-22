-- Бонус за первое пополнение баланса через SkyKassa: один раз на человека (PRIMARY KEY), в той же транзакции, что и зачисление.
CREATE TABLE IF NOT EXISTS skykassa_first_bonus (
  user_id    TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  topup_rub  NUMERIC(14,2) NOT NULL,
  bonus_rub  NUMERIC(14,2) NOT NULL,
  percent    INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
