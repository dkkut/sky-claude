-- Sky Market: проверка продавцов, правила допуска, происхождение товара,
-- модерация карточек, жалобы и заявки на ПВЗ.
--
-- Миграция только РАСШИРЯЕТ существующие таблицы и добавляет новые. Ни
-- одна строка заказов, платежей, продавцов и товаров не удаляется и не
-- переписывается, кроме явной разметки старых записей:
--   · существующие магазины получают verification_status = 'legacy' —
--     они продолжают торговать, как торговали, но администрация может
--     вернуть любой из них на повторную проверку;
--   · существующие товары получают moderation_status по своему active:
--     показанные остаются опубликованными, снятые — архивными.

-- ============================================================
--  Продавец: подтверждённый статус и состояние проверки
-- ============================================================

ALTER TABLE market_sellers
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS tax_kind TEXT,
  ADD COLUMN IF NOT EXISTS activities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seller_country TEXT,
  ADD COLUMN IF NOT EXISTS suspend_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

ALTER TABLE market_sellers DROP CONSTRAINT IF EXISTS market_sellers_verification_check;
ALTER TABLE market_sellers ADD CONSTRAINT market_sellers_verification_check
  CHECK (verification_status IN ('none','draft','submitted','in_review','needs_changes',
                                 'approved','rejected','suspended','reverify','legacy'));
ALTER TABLE market_sellers DROP CONSTRAINT IF EXISTS market_sellers_tax_kind_check;
ALTER TABLE market_sellers ADD CONSTRAINT market_sellers_tax_kind_check
  CHECK (tax_kind IS NULL OR tax_kind IN ('individual','npd','ip','legal'));

-- Уже существующие магазины не ломаем.
UPDATE market_sellers SET verification_status = 'legacy'
 WHERE verification_status = 'none';

-- ============================================================
--  Заявки продавцов (первичные и на смену статуса)
-- ============================================================

CREATE TABLE IF NOT EXISTS market_seller_applications (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('individual','npd','ip','legal')),
  request_type  TEXT NOT NULL DEFAULT 'initial' CHECK (request_type IN ('initial','change')),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted','in_review','needs_changes','approved','rejected')),
  activities    TEXT[] NOT NULL DEFAULT '{}',
  categories    TEXT[] NOT NULL DEFAULT '{}',
  activity_description TEXT NOT NULL DEFAULT '',
  -- ИНН, ОГРН, ФИО, данные представителя и т. п. — зашифрованным JSON.
  -- Открытыми остаются только последние цифры ИНН для списков.
  data_enc      TEXT,
  inn_tail      TEXT NOT NULL DEFAULT '',
  seller_country TEXT NOT NULL DEFAULT 'RU',
  -- Что именно администратор просит дополнить / исправить.
  missing       JSONB NOT NULL DEFAULT '[]'::jsonb,
  admin_comment TEXT NOT NULL DEFAULT '',
  reject_reason TEXT NOT NULL DEFAULT '',
  -- Действующая заявка: по ней сейчас определяются права магазина.
  is_current    BOOLEAN NOT NULL DEFAULT FALSE,
  superseded_at TIMESTAMPTZ,
  revision      INTEGER NOT NULL DEFAULT 1,
  submitted_at  TIMESTAMPTZ,
  reviewer_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одна открытая заявка на человека: повторная отправка не плодит дубли.
CREATE UNIQUE INDEX IF NOT EXISTS market_seller_apps_one_open
  ON market_seller_applications (profile_id)
  WHERE status IN ('draft','submitted','in_review','needs_changes');
CREATE UNIQUE INDEX IF NOT EXISTS market_seller_apps_one_current
  ON market_seller_applications (profile_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS market_seller_apps_queue
  ON market_seller_applications (status, submitted_at);

-- История решений. Только добавляется, не переписывается и не удаляется.
CREATE TABLE IF NOT EXISTS market_seller_events (
  id          BIGSERIAL PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  app_id      TEXT REFERENCES market_seller_applications(id) ON DELETE SET NULL,
  actor_id    TEXT,
  actor_role  TEXT NOT NULL DEFAULT 'seller',
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_seller_events_profile
  ON market_seller_events (profile_id, created_at DESC);

-- ============================================================
--  Документы (заявки, товары, ПВЗ) — файлы лежат зашифрованными
-- ============================================================

CREATE TABLE IF NOT EXISTS market_docs (
  id             TEXT PRIMARY KEY,
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope          TEXT NOT NULL CHECK (scope IN ('application','product','pvz')),
  ref_id         TEXT NOT NULL,
  doc_type       TEXT NOT NULL,
  label          TEXT NOT NULL DEFAULT '',
  file_id        TEXT NOT NULL UNIQUE,
  mime           TEXT NOT NULL,
  bytes          BIGINT NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','rejected')),
  review_comment TEXT NOT NULL DEFAULT '',
  reviewer_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  removed_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_docs_ref ON market_docs (scope, ref_id) WHERE removed_at IS NULL;

-- ============================================================
--  Правила допуска, настраиваемые администрацией
-- ============================================================
-- Жёсткий нижний предел (кто и что вообще может продавать) зашит в
-- коде и этой таблицей не отключается: здесь можно только СУЖАТЬ
-- допуск и добавлять требования.

CREATE TABLE IF NOT EXISTS market_trade_rules (
  rule_key       TEXT PRIMARY KEY,      -- 'category:clothing', 'type:service'
  allowed_kinds  TEXT[],                -- NULL — без дополнительных ограничений
  required_docs  TEXT[] NOT NULL DEFAULT '{}',
  manual_review  BOOLEAN NOT NULL DEFAULT FALSE,
  marking_possible BOOLEAN NOT NULL DEFAULT FALSE,
  disabled       BOOLEAN NOT NULL DEFAULT FALSE,
  note           TEXT NOT NULL DEFAULT '',
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
--  Товары: происхождение, доставка, модерация
-- ============================================================

ALTER TABLE market_products
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS moderated_by TEXT,
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS item_condition TEXT,
  ADD COLUMN IF NOT EXISTS item_source TEXT,
  ADD COLUMN IF NOT EXISTS origin_country TEXT,
  ADD COLUMN IF NOT EXISTS ship_from_country TEXT,
  ADD COLUMN IF NOT EXISTS item_location_country TEXT,
  ADD COLUMN IF NOT EXISTS intl_shipping BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_days_min INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_days_max INTEGER,
  ADD COLUMN IF NOT EXISTS import_info TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS marking_declared TEXT;

ALTER TABLE market_products DROP CONSTRAINT IF EXISTS market_products_moderation_check;
ALTER TABLE market_products ADD CONSTRAINT market_products_moderation_check
  CHECK (moderation_status IN ('draft','pending','needs_changes','approved',
                               'published','hidden','blocked','archived'));
ALTER TABLE market_products DROP CONSTRAINT IF EXISTS market_products_condition_check;
ALTER TABLE market_products ADD CONSTRAINT market_products_condition_check
  CHECK (item_condition IS NULL OR item_condition IN ('new','used'));
ALTER TABLE market_products DROP CONSTRAINT IF EXISTS market_products_source_check;
ALTER TABLE market_products ADD CONSTRAINT market_products_source_check
  CHECK (item_source IS NULL OR item_source IN ('personal','own_production','resale'));
ALTER TABLE market_products DROP CONSTRAINT IF EXISTS market_products_marking_check;
ALTER TABLE market_products ADD CONSTRAINT market_products_marking_check
  CHECK (marking_declared IS NULL OR marking_declared IN ('not_required','required','unsure'));

-- Разметка существующих товаров по их текущему состоянию.
UPDATE market_products
   SET moderation_status = CASE WHEN active THEN 'published' ELSE 'archived' END
 WHERE moderation_status = 'draft';

CREATE INDEX IF NOT EXISTS market_products_moderation_idx
  ON market_products (moderation_status, submitted_at);
CREATE INDEX IF NOT EXISTS market_products_ship_idx
  ON market_products (ship_from_country, intl_shipping) WHERE active;

CREATE TABLE IF NOT EXISTS market_product_events (
  id          BIGSERIAL PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES market_products(id) ON DELETE CASCADE,
  actor_id    TEXT,
  actor_role  TEXT NOT NULL DEFAULT 'seller',
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_product_events_idx ON market_product_events (product_id, created_at DESC);

-- ============================================================
--  Жалобы и апелляции
-- ============================================================

CREATE TABLE IF NOT EXISTS market_reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('product','shop')),
  target_id   TEXT NOT NULL,
  seller_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','upheld','dismissed')),
  resolution  TEXT NOT NULL DEFAULT '',
  resolved_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_reports_one_open
  ON market_reports (reporter_id, target_type, target_id) WHERE status IN ('open','in_review');
CREATE INDEX IF NOT EXISTS market_reports_queue ON market_reports (status, created_at);

CREATE TABLE IF NOT EXISTS market_report_events (
  id         BIGSERIAL PRIMARY KEY,
  report_id  TEXT NOT NULL REFERENCES market_reports(id) ON DELETE CASCADE,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_appeals (
  id           TEXT PRIMARY KEY,
  seller_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('product','application','shop')),
  subject_id   TEXT NOT NULL,
  text         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  decision     TEXT NOT NULL DEFAULT '',
  decided_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_appeals_one_open
  ON market_appeals (seller_id, subject_type, subject_id) WHERE status = 'open';

-- ============================================================
--  Заявки на ПВЗ (только ИП и юридические лица)
-- ============================================================

CREATE TABLE IF NOT EXISTS market_pvz_applications (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','submitted','in_review','needs_changes','approved','rejected')),
  title         TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  contact_name  TEXT NOT NULL DEFAULT '',
  premises      JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes         TEXT NOT NULL DEFAULT '',
  missing       JSONB NOT NULL DEFAULT '[]'::jsonb,
  admin_comment TEXT NOT NULL DEFAULT '',
  reject_reason TEXT NOT NULL DEFAULT '',
  -- Какая подтверждённая заявка продавца-ИП/ООО стоит за этой.
  seller_app_id TEXT REFERENCES market_seller_applications(id) ON DELETE SET NULL,
  -- ПВЗ, который завели по одобренной заявке. Одна заявка — одна точка.
  pvz_id        TEXT,
  submitted_at  TIMESTAMPTZ,
  reviewer_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_pvz_apps_one_open
  ON market_pvz_applications (profile_id)
  WHERE status IN ('draft','submitted','in_review','needs_changes');

CREATE TABLE IF NOT EXISTS market_pvz_app_events (
  id         BIGSERIAL PRIMARY KEY,
  app_id     TEXT NOT NULL REFERENCES market_pvz_applications(id) ON DELETE CASCADE,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  from_status TEXT,
  to_status  TEXT,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
