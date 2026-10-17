-- SkyKassa Business (этап 1): бизнес, реквизиты, подписка, QR-коды, заявки на оплату, журнал.
-- Sky деньги покупателей не принимает: прямые переводы идут владельцу по его реквизитам, здесь только учёт заявок.
-- Таблицы с префиксом kb_ (не путать с skykassa_* — это пополнение кошелька).

CREATE TABLE IF NOT EXISTS kb_businesses (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL DEFAULT 'RU',
  mode          TEXT NOT NULL DEFAULT 'both',        -- online | point | both: «онлайн-платформа» и/или «реальная точка»
  legal_type    TEXT NOT NULL DEFAULT 'person',      -- person | selfemployed | ip | company | other (со слов владельца, не проверено)
  contacts      TEXT NOT NULL DEFAULT '',
  website       TEXT NOT NULL DEFAULT '',
  logo          BYTEA,
  logo_type     TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',       -- draft | active | suspended (последнее — решение администрации)
  suspended_reason TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_businesses_owner_idx ON kb_businesses (owner_id);

-- Реквизиты для прямых переводов — зашифрованным JSON. Менять может только владелец (и сотрудник с правом — этап 3).
CREATE TABLE IF NOT EXISTS kb_requisites (
  business_id   TEXT PRIMARY KEY REFERENCES kb_businesses(id) ON DELETE CASCADE,
  data_enc      TEXT NOT NULL,
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Подписка: период с подтверждённого списания с кошелька Sky, без автосписаний. Повтор ключа не продлевает дважды.
CREATE TABLE IF NOT EXISTS kb_subscriptions (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  price_rub     INT  NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  payment_ref   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_subscriptions_ref_idx ON kb_subscriptions (business_id, payment_ref);
CREATE INDEX IF NOT EXISTS kb_subscriptions_biz_idx ON kb_subscriptions (business_id, expires_at DESC);

-- QR-коды и платёжные страницы. public_id — случайный непоследовательный адрес /p/<public_id>.
CREATE TABLE IF NOT EXISTS kb_qr (
  id            TEXT PRIMARY KEY,
  public_id     TEXT NOT NULL UNIQUE,
  business_id   TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'pay',         -- pay | permanent (постоянный бизнеса, сумма вводится покупателем)
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  amount_rub    INT,                                 -- NULL — покупатель вводит сумму сам
  currency      TEXT NOT NULL DEFAULT 'RUB',
  order_no      TEXT NOT NULL DEFAULT '',
  instruction   TEXT NOT NULL DEFAULT '',
  expires_at    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'active',      -- active | disabled | archived
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_qr_biz_idx ON kb_qr (business_id, created_at DESC);
-- У бизнеса один постоянный QR.
CREATE UNIQUE INDEX IF NOT EXISTS kb_qr_permanent_idx ON kb_qr (business_id) WHERE kind = 'permanent' AND status <> 'archived';

-- Открытия страницы: одна строка на (QR, день, хеш адреса) — накрутить счётчик одним клиентом нельзя.
CREATE TABLE IF NOT EXISTS kb_qr_opens (
  qr_id         TEXT NOT NULL REFERENCES kb_qr(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  ip_hash       TEXT NOT NULL,
  PRIMARY KEY (qr_id, day, ip_hash)
);

-- Заявки на оплату. Статус «оплачено» ставит только владелец (или доверенная интеграция — этап 4); покупатель сообщает лишь о своём переводе.
CREATE TABLE IF NOT EXISTS kb_payments (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  qr_id         TEXT REFERENCES kb_qr(id) ON DELETE SET NULL,
  amount_rub    INT  NOT NULL CHECK (amount_rub > 0),
  currency      TEXT NOT NULL DEFAULT 'RUB',
  order_no      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'created',
  source        TEXT NOT NULL DEFAULT 'direct',      -- direct (по реквизитам) | provider (этап 4)
  buyer_note    TEXT NOT NULL DEFAULT '',
  buyer_key_hash TEXT,                               -- чтобы покупатель мог посмотреть статус своей заявки без регистрации
  ip_hash       TEXT,
  owner_comment TEXT NOT NULL DEFAULT '',
  confirmed_by  TEXT,
  reported_at   TIMESTAMPTZ,
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_payments_biz_idx ON kb_payments (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kb_payments_qr_idx ON kb_payments (qr_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kb_payments_status_idx ON kb_payments (business_id, status);

CREATE TABLE IF NOT EXISTS kb_payment_log (
  id            BIGSERIAL PRIMARY KEY,
  payment_id    TEXT NOT NULL REFERENCES kb_payments(id) ON DELETE CASCADE,
  actor         TEXT NOT NULL,                       -- 'buyer' | 'system' | profile id
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_payment_log_idx ON kb_payment_log (payment_id, id);

-- Журнал аудита бизнеса: реквизиты, QR, подписка, статусы. Без секретов и без самих реквизитов (только «что изменено»).
CREATE TABLE IF NOT EXISTS kb_audit (
  id            BIGSERIAL PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_audit_idx ON kb_audit (business_id, id DESC);

-- Сканирование QR в SkyMoney: учёт для кэшбэка (один бизнес — не чаще раза в сутки на человека).
CREATE TABLE IF NOT EXISTS kb_scans (
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_id   TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  scans         INT NOT NULL DEFAULT 1,
  PRIMARY KEY (profile_id, business_id, day)
);

-- Новый повод кэшбэка: сканирование QR SkyKassa в SkyMoney (только Prime). Расширяем допустимый список — существующие правила не затрагиваются.
ALTER TABLE cashback_rules DROP CONSTRAINT IF EXISTS cashback_rules_trigger_check;
ALTER TABLE cashback_rules ADD CONSTRAINT cashback_rules_trigger_check
  CHECK (trigger IN ('go_taxi','go_delivery','go_food','go_stay','prime_purchase','wallet_topup','market_order','tab_visit','kassa_scan'));
