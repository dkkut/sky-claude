-- ============================================================
--  Способ двухэтапной проверки.
--
--  До этого второй фактор был только один — код из приложения.
--  Не у всех оно есть, поэтому добавляем второй способ: код на
--  подтверждённую почту.
--
--  SMS вторым фактором намеренно нет: вход в Sky ID и так идёт по
--  коду из SMS, и «второй» код на тот же телефон ничего не добавляет —
--  тот, кто получил первый, получит и второй.
-- ============================================================

ALTER TABLE sky_ids  ADD COLUMN IF NOT EXISTS two_factor_method TEXT NOT NULL DEFAULT 'app';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_method TEXT NOT NULL DEFAULT 'app';

-- Значения ограничены на уровне схемы: опечатка в коде не должна
-- превращаться в аккаунт без второго фактора.
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sky_ids_2fa_method_chk') THEN
    ALTER TABLE sky_ids ADD CONSTRAINT sky_ids_2fa_method_chk
      CHECK (two_factor_method IN ('app','email'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_2fa_method_chk') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_2fa_method_chk
      CHECK (two_factor_method IN ('app','email'));
  END IF;
END
$c$;
