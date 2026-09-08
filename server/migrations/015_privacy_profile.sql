-- ============================================================
--  Настройки приватности профиля целиком на сервере.
--
--  До этой миграции вкладка «Конфиденциальность» жила в localStorage
--  браузера: «кто может писать», «кто может звонить» и «кто видит в
--  сети» не доходили до сервера вовсе, а под ними было написано, что
--  настройки сохраняются в аккаунте. Ни то, ни другое не было правдой.
--
--  Настройка, которая защищает человека от других, обязана решаться на
--  сервере: свой клиент можно переписать, чужой нет.
-- ============================================================

DO $priv$
BEGIN
  -- Кто вправе начать со мной переписку.
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS who_can_write TEXT NOT NULL DEFAULT 'all';
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_who_can_write_check;
  ALTER TABLE profiles ADD CONSTRAINT profiles_who_can_write_check
    CHECK (who_can_write IN ('all', 'contacts', 'nobody'));

  -- Кто вправе мне звонить.
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS who_can_call TEXT NOT NULL DEFAULT 'all';
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_who_can_call_check;
  ALTER TABLE profiles ADD CONSTRAINT profiles_who_can_call_check
    CHECK (who_can_call IN ('all', 'contacts', 'nobody'));

  -- Кто видит, что я в сети.
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS who_sees_online TEXT NOT NULL DEFAULT 'all';
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_who_sees_online_check;
  ALTER TABLE profiles ADD CONSTRAINT profiles_who_sees_online_check
    CHECK (who_sees_online IN ('all', 'contacts', 'nobody'));
END
$priv$;

-- ── Один переключатель присутствия вместо двух ──────────────
--  «Скрыть был(а) в сети» и «Кто видит в сети» управляли одним и тем
--  же с разных экранов и рано или поздно противоречили бы друг другу.
--  Прежнее значение переносим и колонку убираем, чтобы источник был
--  один.
DO $merge$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'profiles' AND column_name = 'hide_last_seen') THEN
    UPDATE profiles SET who_sees_online = 'nobody' WHERE hide_last_seen;
    ALTER TABLE profiles DROP COLUMN hide_last_seen;
  END IF;
END
$merge$;

-- ── Видимость разделов профиля ──────────────────────────────
--  Телефон, игры, музыка, фотографии и прочее сервер сейчас никому не
--  отдаёт — о чужом человеке он сообщает только имя и ник. Настройки
--  всё равно хранятся здесь: так они переживают смену устройства и уже
--  готовы к тому дню, когда эти разделы переедут на сервер.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_visibility JSONB NOT NULL DEFAULT '{}'::jsonb;
