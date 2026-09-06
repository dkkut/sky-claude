-- ============================================================
--  Sky ID: аккаунт над профилями.
--
--  До этой миграции «пользователь» и «профиль» были одним и тем же:
--  таблица users хранила и телефон (способ входа), и имя с аватаром
--  (содержимое профиля). Sky ID разделяет их:
--
--      sky_ids  — как входят (телефон, почта, двухэтапная защита)
--        └── profiles — кем пользуются (имя, ник, аватар, Prime)
--
--  Существующая таблица users ПЕРЕИМЕНОВЫВАЕТСЯ в profiles, а не
--  создаётся заново: так сохраняются все внешние ключи — кошелёк,
--  участники чатов, авторы сообщений уже ссылаются на эти строки,
--  и ссылаться они должны именно на профиль.
-- ============================================================

-- Переименование выполняем только если таблица ещё под старым именем:
-- повторный прогон миграции (восстановленный дамп, ручной запуск) не
-- должен обрываться на первой же строке.
DO $rename$
BEGIN
  IF to_regclass('public.users') IS NOT NULL AND to_regclass('public.profiles') IS NULL THEN
    ALTER TABLE users RENAME TO profiles;
  END IF;
END
$rename$;

-- Индексы, созданные под старым именем, переименовываем следом,
-- чтобы имена в схеме не расходились со смыслом.
ALTER INDEX IF EXISTS users_phone_key          RENAME TO profiles_phone_key;
ALTER INDEX IF EXISTS users_username_lower_key RENAME TO profiles_username_lower_key;

-- ── Sky ID ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sky_ids (
  id                  TEXT PRIMARY KEY,

  -- Телефон — основной способ входа, поэтому уникален и обязателен.
  phone               TEXT NOT NULL,

  -- Почта необязательна: её привязывают отдельным шагом.
  email               TEXT,
  email_verified      BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Секрет двухэтапной защиты всего Sky ID. Хранится в зашифрованном
  -- виде (см. server/crypto.mjs) — в открытом виде его знать нельзя
  -- даже при доступе к дампу базы.
  two_factor_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
  two_factor_secret   TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sky_ids_phone_key ON sky_ids (phone);
-- Почта уникальна только среди подтверждённых: неподтверждённую заявку
-- на чужой адрес не должно быть достаточно, чтобы его занять.
CREATE UNIQUE INDEX IF NOT EXISTS sky_ids_email_key
  ON sky_ids (lower(email)) WHERE email IS NOT NULL AND email_verified;

-- ── Профили принадлежат Sky ID ──────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sky_id TEXT REFERENCES sky_ids(id) ON DELETE CASCADE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_secret  TEXT;

-- ── Перенос существующих пользователей ──────────────────────
--  Каждый существующий пользователь становится Sky ID со своим
--  телефоном и одним профилем внутри. Ничего не удаляется.
--  Переносить есть что, только пока телефон лежит в профиле: после
--  первого прогона колонки уже нет, и блок пропускается целиком.
DO $backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'profiles' AND column_name = 'phone') THEN
    INSERT INTO sky_ids (id, phone, created_at)
    SELECT 'sky-' || p.id, p.phone, p.created_at
      FROM profiles p
     WHERE p.sky_id IS NULL
       AND p.phone IS NOT NULL
    ON CONFLICT (phone) DO NOTHING;

    UPDATE profiles p
       SET sky_id = s.id
      FROM sky_ids s
     WHERE p.sky_id IS NULL
       AND s.phone = p.phone;
  END IF;
END
$backfill$;

-- Телефон теперь живёт только в sky_ids: два профиля одного Sky ID
-- обязаны показывать один и тот же номер, а не хранить копии.
ALTER TABLE profiles DROP COLUMN IF EXISTS phone;
DROP INDEX IF EXISTS profiles_phone_key;

CREATE INDEX IF NOT EXISTS profiles_sky_id_idx ON profiles (sky_id);

-- ── Не больше двух профилей на Sky ID ───────────────────────
--  Проверка стоит в базе, а не только в коде: два одновременных
--  запроса на создание не смогут оба пройти проверку и записать
--  третий профиль.
CREATE OR REPLACE FUNCTION profiles_limit_per_sky_id() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM profiles WHERE sky_id = NEW.sky_id) >= 2 THEN
    RAISE EXCEPTION 'profile_limit_reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_limit_trigger ON profiles;
CREATE TRIGGER profiles_limit_trigger
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_limit_per_sky_id();

-- ── Prime принадлежит профилю, а не Sky ID ──────────────────
CREATE TABLE IF NOT EXISTS prime_subscriptions (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('active','expired','cancelled')),
  plan       TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS prime_profile_idx ON prime_subscriptions (profile_id, status);

-- Переносим существующий флаг is_prime в подписку конкретного профиля.
INSERT INTO prime_subscriptions (id, profile_id, status, plan, started_at, expires_at)
SELECT 'prime-' || p.id, p.id, 'active', 'legacy', p.created_at, NULL
  FROM profiles p
 WHERE p.is_prime
   AND NOT EXISTS (SELECT 1 FROM prime_subscriptions s WHERE s.profile_id = p.id);

-- ── Коды подтверждения (телефон, почта) ─────────────────────
--  Хранится только хеш кода: из дампа базы восстановить сам код нельзя.
CREATE TABLE IF NOT EXISTS verification_codes (
  id          TEXT PRIMARY KEY,
  -- 'phone' или 'email'
  channel     TEXT NOT NULL CHECK (channel IN ('phone','email')),
  -- Номер или адрес, к которому относится код.
  destination TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  attempts    INT  NOT NULL DEFAULT 0,
  consumed    BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_codes_lookup_idx
  ON verification_codes (channel, destination, purpose, created_at DESC);
