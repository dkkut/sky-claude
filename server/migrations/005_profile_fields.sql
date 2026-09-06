-- ============================================================
--  Поля профиля, которых не было в исходной таблице users.
--
--  Аватар и биография жили только в браузере (localStorage), поэтому
--  в базе для них места не оказалось. Sky ID делает профиль серверной
--  сущностью — значит и эти поля должны храниться на сервере.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio    TEXT;

-- Первичный ключ достался от прежнего имени таблицы — приводим в порядок,
-- чтобы имена ограничений не вводили в заблуждение при отладке.
DO $pkey$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_pkey'
               AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE profiles RENAME CONSTRAINT users_pkey TO profiles_pkey;
  END IF;
END
$pkey$;

-- Пароль больше не способ входа: вход идёт по телефону и коду.
-- Колонку не удаляем (в ней данные существующих пользователей), но
-- снимаем NOT NULL, чтобы новый профиль можно было создать без него.
ALTER TABLE profiles ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN password_hash SET DEFAULT NULL;
