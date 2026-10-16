-- SkyKassa: платёжная система внутри Sky. Баланс один — кошелёк Sky
-- (wallet_accounts / wallet_transactions); здесь только заявки на пополнение,
-- способы оплаты, реквизиты, данные отправителя, проверка и журналы.
--
-- Номера карт, телефоны, счета и данные отправителя лежат ЗАШИФРОВАННЫМИ
-- (encryptContent), в открытом виде остаётся лишь хвост для подсказки.
-- CVV/PIN/пароли/SMS-коды не хранятся и не запрашиваются нигде.

-- Настройки платформы (один ключ — одна строка).
CREATE TABLE IF NOT EXISTS skykassa_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Способы прямой оплаты. Новый способ добавляется записью, без правки клиента:
-- название, подсказка, поля данных отправителя и границы сумм приходят отсюда.
CREATE TABLE IF NOT EXISTS skykassa_methods (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('account', 'transfer', 'custom')),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  instruction   TEXT NOT NULL DEFAULT '',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  sort          INTEGER NOT NULL DEFAULT 100,
  min_amount    BIGINT NOT NULL DEFAULT 100 CHECK (min_amount > 0),
  max_amount    BIGINT NOT NULL DEFAULT 100000 CHECK (max_amount >= min_amount),
  -- ['balance','code'] — куда можно зачислять этим способом.
  destinations  JSONB NOT NULL DEFAULT '["balance","code"]'::jsonb,
  -- Приложения, где способ показывается; пусто — везде.
  apps          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Дополнительные поля данных отправителя: [{key,label,type,required,options,maxLen}].
  sender_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Допустимые типы идентификатора отправителя.
  sender_kinds  JSONB NOT NULL DEFAULT '["card","phone","account","other"]'::jsonb,
  deleted_at    TIMESTAMPTZ,
  created_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Реквизиты получателя. На способ их может быть несколько; платёж берёт
-- основной (или первый по приоритету) и ЗАМОРАЖИВАЕТ снимок в самом платеже.
CREATE TABLE IF NOT EXISTS skykassa_requisites (
  id               TEXT PRIMARY KEY,
  method_id        TEXT NOT NULL REFERENCES skykassa_methods(id) ON DELETE CASCADE,
  label            TEXT NOT NULL DEFAULT '',
  recipient_name   TEXT NOT NULL,
  bank             TEXT NOT NULL DEFAULT '',
  identifier_kind  TEXT NOT NULL CHECK (identifier_kind IN ('card', 'phone', 'account', 'other')),
  identifier_sealed TEXT NOT NULL,
  identifier_tail  TEXT NOT NULL DEFAULT '',
  currency         TEXT NOT NULL DEFAULT 'RUB',
  purpose_template TEXT NOT NULL DEFAULT 'Пополнение Sky, заявка {number}',
  instruction      TEXT NOT NULL DEFAULT '',
  is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
  priority         INTEGER NOT NULL DEFAULT 100,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  destinations     JSONB,       -- NULL — для любого назначения
  deleted_at       TIMESTAMPTZ,
  created_by       TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_requisites_method_idx ON skykassa_requisites (method_id, enabled, priority);
-- Основной реквизит на способ — не больше одного.
CREATE UNIQUE INDEX IF NOT EXISTS skykassa_requisites_primary_uq
  ON skykassa_requisites (method_id) WHERE is_primary AND deleted_at IS NULL;

-- История изменений реквизитов: кто, когда, что (значения — хвосты, не полные номера).
CREATE TABLE IF NOT EXISTS skykassa_requisite_history (
  id           TEXT PRIMARY KEY,
  requisite_id TEXT NOT NULL,
  actor_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_requisite_history_idx ON skykassa_requisite_history (requisite_id, created_at DESC);

-- Платёжные партнёры. Секреты здесь НЕ хранятся: только в окружении сервера
-- (SKYKASSA_PARTNER_<ID>_SECRET / _MERCHANT).
CREATE TABLE IF NOT EXISTS skykassa_partners (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  logo_url     TEXT NOT NULL DEFAULT '',
  adapter      TEXT NOT NULL DEFAULT 'hmac-v1',
  base_url     TEXT NOT NULL DEFAULT '',
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  sort         INTEGER NOT NULL DEFAULT 100,
  currencies   JSONB NOT NULL DEFAULT '["RUB"]'::jsonb,
  methods      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ['card','sbp',…] — подписи для человека
  min_amount   BIGINT NOT NULL DEFAULT 100 CHECK (min_amount > 0),
  max_amount   BIGINT NOT NULL DEFAULT 100000 CHECK (max_amount >= min_amount),
  fee_percent  NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent <= 30),
  fee_fixed    BIGINT NOT NULL DEFAULT 0 CHECK (fee_fixed >= 0),
  destinations JSONB NOT NULL DEFAULT '["balance"]'::jsonb,
  apps         JSONB NOT NULL DEFAULT '[]'::jsonb,
  note         TEXT NOT NULL DEFAULT '',
  last_check_at TIMESTAMPTZ,
  last_check_ok BOOLEAN,
  last_check_msg TEXT NOT NULL DEFAULT '',
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Платежи.
CREATE TABLE IF NOT EXISTS skykassa_payments (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,                         -- SK-XXXXXXXX, видно человеку
  user_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  app           TEXT NOT NULL DEFAULT 'web',
  kind          TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'partner')),
  status        TEXT NOT NULL DEFAULT 'created',
  amount        BIGINT NOT NULL CHECK (amount > 0),           -- рубли, целые
  currency      TEXT NOT NULL DEFAULT 'RUB',
  fee           BIGINT NOT NULL DEFAULT 0 CHECK (fee >= 0),
  total         BIGINT NOT NULL CHECK (total > 0),            -- сколько платит человек
  destination   TEXT NOT NULL DEFAULT 'balance' CHECK (destination IN ('balance', 'code')),
  method_id     TEXT REFERENCES skykassa_methods(id) ON DELETE SET NULL,
  requisite_id  TEXT REFERENCES skykassa_requisites(id) ON DELETE SET NULL,
  requisite_sealed TEXT,                                      -- снимок реквизитов «как показано»
  method_title  TEXT NOT NULL DEFAULT '',
  partner_id    TEXT REFERENCES skykassa_partners(id) ON DELETE SET NULL,
  partner_title TEXT NOT NULL DEFAULT '',
  partner_ref   TEXT,                                         -- номер платежа у партнёра
  partner_url_sealed TEXT,                                    -- адрес оплаты партнёра
  idem_key      TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  reported_at   TIMESTAMPTZ,
  reviewer_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  review_note   TEXT NOT NULL DEFAULT '',
  reject_reason TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  owner_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  confirmed_at  TIMESTAMPTZ,
  credited_at   TIMESTAMPTZ,
  balance_after BIGINT,
  code_id       TEXT,
  code_sealed   TEXT,                                         -- код пополнения, виден владельцу платежа
  code_expires_at TIMESTAMPTZ,
  ticket_id     TEXT,
  error_text    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_payments_user_idx ON skykassa_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS skykassa_payments_status_idx ON skykassa_payments (status, created_at);
CREATE INDEX IF NOT EXISTS skykassa_payments_expiry_idx ON skykassa_payments (expires_at)
  WHERE status IN ('created', 'awaiting_payment');
CREATE UNIQUE INDEX IF NOT EXISTS skykassa_payments_idem_uq ON skykassa_payments (user_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skykassa_payments_partner_uq ON skykassa_payments (partner_id, partner_ref) WHERE partner_ref IS NOT NULL;

-- Журнал переходов статусов.
CREATE TABLE IF NOT EXISTS skykassa_status_log (
  id          TEXT PRIMARY KEY,
  seq         BIGSERIAL,                      -- порядок переходов внутри одной транзакции
  payment_id  TEXT NOT NULL REFERENCES skykassa_payments(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  actor_kind  TEXT NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('user', 'staff', 'owner', 'system', 'partner')),
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_status_log_idx ON skykassa_status_log (payment_id, created_at);

-- Данные отправителя (зашифрованы). Это сведения для сверки, не доказательство оплаты.
CREATE TABLE IF NOT EXISTS skykassa_sender (
  payment_id   TEXT PRIMARY KEY REFERENCES skykassa_payments(id) ON DELETE CASCADE,
  data_sealed  TEXT NOT NULL,
  id_kind      TEXT NOT NULL,
  id_tail      TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ,
  submitted_sealed TEXT,                      -- то, что было на момент отправки (первичная версия)
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skykassa_sender_changes (
  id          TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL REFERENCES skykassa_payments(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  before_sealed TEXT NOT NULL,
  after_sealed  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_sender_changes_idx ON skykassa_sender_changes (payment_id, created_at);

-- Решения сотрудников и переписка «запросить сведения».
CREATE TABLE IF NOT EXISTS skykassa_reviews (
  id          TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL REFERENCES skykassa_payments(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decision    TEXT NOT NULL,       -- take | request_info | forward | reject | owner_confirm | owner_reject | owner_return | note
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_reviews_idx ON skykassa_reviews (payment_id, created_at);

CREATE TABLE IF NOT EXISTS skykassa_messages (
  id          TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL REFERENCES skykassa_payments(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  from_staff  BOOLEAN NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_messages_idx ON skykassa_messages (payment_id, created_at);

-- Зачисления. Первичный ключ payment_id — второе зачисление по платежу невозможно физически.
CREATE TABLE IF NOT EXISTS skykassa_credits (
  payment_id   TEXT PRIMARY KEY REFERENCES skykassa_payments(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  amount       BIGINT NOT NULL CHECK (amount > 0),
  destination  TEXT NOT NULL,
  wallet_ref   TEXT NOT NULL,
  balance_after BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Возвраты: отдельные связанные операции.
CREATE TABLE IF NOT EXISTS skykassa_refunds (
  id           TEXT PRIMARY KEY,
  payment_id   TEXT NOT NULL REFERENCES skykassa_payments(id) ON DELETE CASCADE,
  amount       BIGINT NOT NULL CHECK (amount > 0),
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'done', 'declined')),
  reason       TEXT NOT NULL DEFAULT '',
  requested_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  processed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  wallet_ref   TEXT,
  decline_reason TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skykassa_refunds_idx ON skykassa_refunds (payment_id, created_at);
-- Не больше одного незавершённого возврата на платёж.
CREATE UNIQUE INDEX IF NOT EXISTS skykassa_refunds_open_uq ON skykassa_refunds (payment_id) WHERE status IN ('requested', 'processing');

-- События партнёров: (партнёр, событие) уникально — повтор не обрабатывается дважды.
CREATE TABLE IF NOT EXISTS skykassa_webhooks (
  partner_id  TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  payment_id  TEXT,
  result      TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, event_id)
);

-- Первичные способы оплаты: заготовки БЕЗ реквизитов и выключенные — реквизиты
-- вносит администрация. Ничего не выдумываем.
INSERT INTO skykassa_methods (id, kind, title, description, instruction, enabled, sort, sender_fields)
VALUES
  ('skm-account', 'account', 'Расчётный счёт', 'Перевод на расчётный счёт получателя по реквизитам.',
   'Переведите точную сумму по указанным реквизитам и обязательно укажите назначение платежа.', FALSE, 10, '[]'::jsonb),
  ('skm-transfer', 'transfer', 'Перевод', 'Перевод на карту или по номеру телефона получателя.',
   'Переведите точную сумму получателю и укажите в сообщении номер заявки, если банк это позволяет.', FALSE, 20, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;
