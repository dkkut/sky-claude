-- ============================================================
--  Второй способ входа: почта → пароль
-- ============================================================
--
-- Существующий вход — код на почту или SMS — не меняется этой
-- миграцией и ничего в ней не трогает. Пароль это параллельная,
-- необязательная привязка к уже существующему Sky ID: колонка пустая
-- у всех, пока человек сам не решит его завести, и вход остаётся
-- закрытым, пока пароль не задан.
--
-- Хеш и только хеш: sky_ids.password_hash хранит строку вида
-- scrypt$N$r$p$соль$хеш (server/security.mjs), исходный пароль нигде
-- не лежит и не логируется.
--
-- Счётчик неудачных попыток и время блокировки — это защита не от
-- одного запроса, а от медленного перебора растянутого по часам:
-- обычный предел частоты на IP такое не ловит, потому что подбор идёт
-- с разных адресов, а не с одного.
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS password_fail_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS password_locked_until TIMESTAMPTZ;

COMMENT ON COLUMN sky_ids.password_hash IS
  'scrypt$N$r$p$соль$хеш — NULL, пока человек не задал пароль. Вход по паролю закрыт, пока это поле пусто.';
