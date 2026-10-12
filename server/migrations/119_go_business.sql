-- ============================================================
--  Sky GO: бизнес (организации), сотрудники, диспетчерское назначение,
--  проблемы доставки, смены исполнителей, защита уведомлений от повторов.
--  Организация строится на уже существующей регистрации исполнителя «company»
--  (114_sky_go.sql): новой авторизации и новых юридических проверок нет.
-- ============================================================

-- Организация: одна на владельца с одобренной ролью «company».
CREATE TABLE IF NOT EXISTS go_orgs (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  assign_mode TEXT NOT NULL DEFAULT 'manual' CHECK (assign_mode IN ('manual','auto','pool')),
  suspended   BOOLEAN NOT NULL DEFAULT FALSE,           -- приостановка администрацией Sky
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Сотрудники. Роль внутри организации; один человек — одна запись на организацию.
CREATE TABLE IF NOT EXISTS go_org_members (
  org_id      TEXT NOT NULL REFERENCES go_orgs(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','manager','driver','courier')),
  status      TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','declined','removed')),
  invited_by  TEXT,
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at   TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, profile_id)
);
CREATE INDEX IF NOT EXISTS go_org_members_profile_idx ON go_org_members (profile_id, status);

-- Точки отправления / обслуживания организации.
CREATE TABLE IF NOT EXISTS go_org_points (
  id        TEXT PRIMARY KEY,
  org_id    TEXT NOT NULL REFERENCES go_orgs(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  address   TEXT NOT NULL,
  lat       DOUBLE PRECISION,
  lng       DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_org_points_org_idx ON go_org_points (org_id);

-- Журнал действий в организации (сотрудники, назначения, настройки).
CREATE TABLE IF NOT EXISTS go_org_audit (
  id       BIGSERIAL PRIMARY KEY,
  org_id   TEXT NOT NULL REFERENCES go_orgs(id) ON DELETE CASCADE,
  actor_id TEXT,
  action   TEXT NOT NULL,
  subject  TEXT,
  detail   JSONB NOT NULL DEFAULT '{}'::jsonb,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_org_audit_org_idx ON go_org_audit (org_id, id DESC);

-- Заказ принадлежит организации (если создан от её имени). customer_id остаётся владельцем организации.
ALTER TABLE go_orders ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES go_orgs(id) ON DELETE SET NULL;
ALTER TABLE go_orders ADD COLUMN IF NOT EXISTS created_by TEXT;
CREATE INDEX IF NOT EXISTS go_orders_org_idx ON go_orders (org_id, created_at DESC) WHERE org_id IS NOT NULL;

-- Заметки по заказу: внутренние (для сотрудников) и сообщения диспетчера исполнителю.
CREATE TABLE IF NOT EXISTS go_order_notes (
  id         BIGSERIAL PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES go_orders(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL,
  to_executor BOOLEAN NOT NULL DEFAULT FALSE,
  body       TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_order_notes_order_idx ON go_order_notes (order_id, id);

-- Проблемы доставки: исполнитель сообщает, закрывает не он (диспетчер организации или администрация).
CREATE TABLE IF NOT EXISTS go_order_problems (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES go_orders(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL,
  kind        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  photo_mime  TEXT,
  photo       BYTEA,
  state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  resolution  TEXT NOT NULL DEFAULT '',
  resolved_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS go_order_problems_order_idx ON go_order_problems (order_id, created_at);
CREATE INDEX IF NOT EXISTS go_order_problems_open_idx ON go_order_problems (state) WHERE state = 'open';

-- Смены: выход на линию → уход с линии.
CREATE TABLE IF NOT EXISTS go_shifts (
  id         BIGSERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS go_shifts_profile_idx ON go_shifts (profile_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS go_shifts_open_idx ON go_shifts (profile_id, role) WHERE ended_at IS NULL;

-- Уведомление по одному событию — один раз (повторный запрос, повтор события, гонка двух вкладок).
CREATE TABLE IF NOT EXISTS go_notified (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
