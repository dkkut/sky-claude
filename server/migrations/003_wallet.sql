-- ============================================================
--  Кошелёк: балансы, баллы и журнал операций.
--
--  До этого баланс лежал в localStorage браузера — его можно было
--  просто переписать. Теперь единственный источник истины здесь,
--  а изменения идут только через операции сервера.
-- ============================================================

CREATE TABLE IF NOT EXISTS wallet_accounts (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Целые рубли и целые баллы: приложение нигде не оперирует копейками,
  -- а BIGINT избавляет от ошибок округления, неизбежных для float.
  -- Отрицательный баланс запрещён на уровне схемы: даже если операция
  -- где-то посчитает неверно, БД не даст уйти в минус.
  balance    BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  points     BIGINT NOT NULL DEFAULT 0 CHECK (points  >= 0),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,

  -- Знак значит направление: больше нуля — приход, меньше — расход.
  amount     BIGINT NOT NULL,
  descr      TEXT   NOT NULL DEFAULT '',

  -- Идентификатор заказа, подписки или трека — к чему относится операция.
  ref        TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Основной запрос — история операций пользователя, свежие сверху.
CREATE INDEX IF NOT EXISTS wallet_tx_user_created_idx
  ON wallet_transactions (user_id, created_at DESC);
