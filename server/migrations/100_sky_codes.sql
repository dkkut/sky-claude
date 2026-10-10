-- Sky Codes: коды пополнения и активации.
--
-- Сам код в базе не хранится: только HMAC-отпечаток (проверить введённое
-- можно, вспомнить исходное — нет) и последние четыре знака для
-- подсказки в админке. Показать код можно один раз — при создании серии.
--
-- Награда живёт в серии (sky_code_batches), а не в коде и тем более не
-- приходит от клиента: активация читает её только отсюда.

CREATE TABLE IF NOT EXISTS sky_code_batches (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  note             TEXT NOT NULL DEFAULT '',

  -- Что получает человек. Для каждого вида свои поля, остальные нули.
  reward_type      TEXT NOT NULL
    CHECK (reward_type IN ('balance', 'points', 'prime', 'item', 'discount')),
  reward_amount    BIGINT NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),   -- рубли или баллы
  reward_days      INTEGER NOT NULL DEFAULT 0 CHECK (reward_days >= 0),    -- дни Prime / срок скидки
  reward_item      TEXT,                                                   -- предмет кастомизации
  reward_percent   INTEGER NOT NULL DEFAULT 0 CHECK (reward_percent BETWEEN 0 AND 90),

  -- Сколько раз сработает КАЖДЫЙ код серии (1 — одноразовый).
  max_uses         INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000000),
  expires_at       TIMESTAMPTZ,
  -- Код только для одного профиля. Чужому такой код отвечает так же,
  -- как несуществующий.
  bound_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,

  code_count       INTEGER NOT NULL CHECK (code_count BETWEEN 1 AND 5000),
  created_by       TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Каждому виду награды — своё обязательное поле.
  CHECK (reward_type <> 'balance'  OR reward_amount > 0),
  CHECK (reward_type <> 'points'   OR reward_amount > 0),
  CHECK (reward_type <> 'prime'    OR reward_days   > 0),
  CHECK (reward_type <> 'item'     OR reward_item IS NOT NULL),
  CHECK (reward_type <> 'discount' OR (reward_percent BETWEEN 1 AND 90 AND reward_days > 0))
);

CREATE INDEX IF NOT EXISTS sky_code_batches_created_idx ON sky_code_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS sky_codes (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES sky_code_batches(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL UNIQUE,
  hint          TEXT NOT NULL,                      -- последние 4 знака
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  uses          INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at    TIMESTAMPTZ,
  revoked_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  revoke_reason TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sky_codes_batch_idx ON sky_codes (batch_id, status);

-- Активации. Уникальность (код, профиль) — это и есть защита от
-- повторного начисления: второй такой же запрос упрётся в неё, даже
-- если придёт одновременно с первым.
CREATE TABLE IF NOT EXISTS sky_code_redemptions (
  id             TEXT PRIMARY KEY,
  code_id        TEXT NOT NULL REFERENCES sky_codes(id) ON DELETE CASCADE,
  batch_id       TEXT NOT NULL REFERENCES sky_code_batches(id) ON DELETE CASCADE,
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reward_type    TEXT NOT NULL,
  reward_amount  BIGINT NOT NULL DEFAULT 0,
  reward_days    INTEGER NOT NULL DEFAULT 0,
  reward_item    TEXT,
  reward_percent INTEGER NOT NULL DEFAULT 0,
  redeemed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code_id, profile_id)
);

CREATE INDEX IF NOT EXISTS sky_code_redemptions_profile_idx ON sky_code_redemptions (profile_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS sky_code_redemptions_batch_idx ON sky_code_redemptions (batch_id, redeemed_at DESC);

-- Скидки: код превращается в купон, который сработает при покупке
-- Sky Prime для себя. Купон гасится один раз, атомарным UPDATE.
CREATE TABLE IF NOT EXISTS sky_code_coupons (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  redemption_id TEXT NOT NULL REFERENCES sky_code_redemptions(id) ON DELETE CASCADE,
  percent       INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 90),
  applies_to    TEXT NOT NULL DEFAULT 'prime' CHECK (applies_to IN ('prime')),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  consumed_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sky_code_coupons_profile_idx
  ON sky_code_coupons (profile_id) WHERE consumed_at IS NULL;

-- Неудачные попытки — для блокировки подбора. По профилю и по отпечатку
-- адреса: и тот, и другой счёт нужен, потому что подбирают то с одного
-- аккаунта, то с одного адреса, перебирая аккаунты.
CREATE TABLE IF NOT EXISTS sky_code_failures (
  id         BIGSERIAL PRIMARY KEY,
  profile_id TEXT,
  ip_hash    TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sky_code_failures_profile_idx ON sky_code_failures (profile_id, at DESC);
CREATE INDEX IF NOT EXISTS sky_code_failures_ip_idx ON sky_code_failures (ip_hash, at DESC);

-- Предмет кастомизации теперь можно получить и по коду.
ALTER TABLE customization_inventory DROP CONSTRAINT IF EXISTS customization_inventory_acquired_via_check;
ALTER TABLE customization_inventory
  ADD CONSTRAINT customization_inventory_acquired_via_check
  CHECK (acquired_via IN ('purchase', 'admin_grant', 'code'));
