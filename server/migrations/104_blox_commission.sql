-- Sky Blox: выплата разработчикам баллами Prime внутри экосистемы с удержанием
-- и общий баланс комиссий платформы. Только добавления — прежние данные не трогаются.
ALTER TABLE blox_payouts ADD COLUMN IF NOT EXISTS fee_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE blox_payouts ADD COLUMN IF NOT EXISTS net_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE blox_payouts ADD COLUMN IF NOT EXISTS fee_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE blox_payouts ADD COLUMN IF NOT EXISTS instant BOOLEAN NOT NULL DEFAULT false;

-- Журнал баланса комиссий. Баланс = комиссия с покупок (blox_earnings.commission_points)
-- + сумма этого журнала. Положительные строки — поступления, отрицательные — расходы.
CREATE TABLE IF NOT EXISTS blox_commission_ledger (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('payout_fee', 'topup', 'payout_to_user')),
  amount_points INTEGER NOT NULL CHECK (amount_points <> 0),
  ref           TEXT,
  user_id       TEXT,
  actor_id      TEXT,
  reason        TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blox_commission_ledger_ref ON blox_commission_ledger (kind, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS blox_commission_ledger_at ON blox_commission_ledger (created_at DESC);
