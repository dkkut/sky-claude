-- Журнал кошелька: валюта записи и защита от правки (аудит 2026-11). Только добавляет.
--  · currency: 'rub' — запись меняет balance, 'pts' — points. Старые записи размечаются по типу;
--    неоднозначные (admin_*, stream_donation) остаются NULL и в сверке показываются как «не разобрано».
--  · журнал только дописывается: UPDATE и DELETE закрыты триггером. Исключение — разовая разметка
--    валюты у записи, где она была NULL. Аварийная правка возможна только осознанно:
--    SET LOCAL sky.ledger_maintenance = 'on' в той же транзакции (остаётся следом в журнале базы).
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS currency TEXT;

UPDATE wallet_transactions SET currency = 'pts'
 WHERE currency IS NULL AND type IN ('points_earn','points_spend','points_refund','cashback','code_points',
   'prime_reward','prime_reward_refund','blox_purchase','blox_refund','blox_payout','blox_commission_payout',
   'blox_commission_topup','admin_points');
UPDATE wallet_transactions SET currency = 'rub'
 WHERE currency IS NULL AND type NOT IN ('admin_adjust','admin_reversal','admin_refund','stream_donation');

DO $$ BEGIN
  ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_currency_chk
    CHECK (currency IS NULL OR currency IN ('rub','pts')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION wallet_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('sky.ledger_maintenance', true) = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Каскад при удалении самого профиля (бот): строки профиля уже исчезли — журнал уходит вместе с ним.
  -- Людей не удаляют (аккаунт обезличивается), поэтому на живом профиле DELETE по-прежнему закрыт.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.currency IS NULL AND NEW.currency IS NOT NULL
     AND NEW.id = OLD.id AND NEW.user_id = OLD.user_id AND NEW.type = OLD.type
     AND NEW.amount = OLD.amount AND NEW.created_at = OLD.created_at
     AND NEW.descr IS NOT DISTINCT FROM OLD.descr AND NEW.ref IS NOT DISTINCT FROM OLD.ref THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'wallet_transactions: журнал только дописывается (% запрещён)', TG_OP USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS wallet_ledger_guard_t ON wallet_transactions;
CREATE TRIGGER wallet_ledger_guard_t BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION wallet_ledger_guard();
