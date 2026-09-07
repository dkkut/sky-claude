-- ============================================================
--  Почта становится основным входом, телефон — дополнительным.
--
--  Раньше Sky ID был обязан иметь номер: он и был учётной записью.
--  Оказалось, что отправка SMS упирается в деньги и в железо (шлюзу
--  нужна симка), а письма ничего не стоят. Поэтому:
--
--    • войти можно и по почте, и по телефону — что привязано;
--    • хотя бы один способ обязателен, иначе в аккаунт не попасть;
--    • телефон подтверждается отдельно и работает вторым каналом
--      проверки — теперь это настоящий второй фактор, а не второй
--      код на тот же номер.
--
--  Существующие записи не трогаем: у них есть номер, и вход по нему
--  продолжает работать.
-- ============================================================

-- Номер больше не обязателен: аккаунт можно завести на одну почту.
ALTER TABLE sky_ids ALTER COLUMN phone DROP NOT NULL;

-- Подтверждение номера отдельным признаком: привязанный, но не
-- подтверждённый номер вторым фактором быть не может.
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- У всех, кто заведён до этой миграции, номер и был способом входа —
-- значит он уже подтверждён кодом.
UPDATE sky_ids SET phone_verified = TRUE WHERE phone IS NOT NULL AND NOT phone_verified;

-- Прежний уникальный индекс не допускал двух записей без номера:
-- в NULL он не заглядывает, но был создан как обычный UNIQUE.
DROP INDEX IF EXISTS sky_ids_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS sky_ids_phone_key
  ON sky_ids (phone) WHERE phone IS NOT NULL;

-- Аккаунт без единого способа входа — потерянный аккаунт.
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sky_ids_login_present_chk') THEN
    ALTER TABLE sky_ids ADD CONSTRAINT sky_ids_login_present_chk
      CHECK (phone IS NOT NULL OR email IS NOT NULL);
  END IF;
END
$chk$;

-- Способы второго фактора: к приложению и почте добавился телефон.
-- Вход по почте сделал SMS полноценным вторым каналом.
ALTER TABLE sky_ids  DROP CONSTRAINT IF EXISTS sky_ids_2fa_method_chk;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_2fa_method_chk;
ALTER TABLE sky_ids  ADD CONSTRAINT sky_ids_2fa_method_chk
  CHECK (two_factor_method IN ('app','email','sms'));
ALTER TABLE profiles ADD CONSTRAINT profiles_2fa_method_chk
  CHECK (two_factor_method IN ('app','email','sms'));
