-- Sky Blox: каталог игр, плейсы, кабинет разработчика, магазин за Prime
-- Points, вознаграждения и заявки на выплату.
--
-- Принципы схемы.
--  · Валюта одна — Prime Points из wallet_accounts.points. Второй валюты и
--    курса обмена здесь нет; списание идёт через wallet в той же
--    транзакции, что и запись о покупке.
--  · Игровые серверы разработчиков внешние. Ничего из их кода на сервере
--    Sky не выполняется, доступа к базе у них нет: они ходят только в
--    подписанный API (ключ + секрет, секрет хранится зашифрованным).
--  · Журналы (события, начисления, события выплат) только дописываются.
--  · Деньги не двигаются автоматически: выплата — это заявка, а факт
--    выплаты вносит сотрудник вручную.

CREATE TABLE IF NOT EXISTS blox_developers (
  profile_id    TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  trust_level   INTEGER NOT NULL DEFAULT 0 CHECK (trust_level BETWEEN 0 AND 2),
  terms_version TEXT NOT NULL,
  terms_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspend_reason TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blox_games (
  id            TEXT PRIMARY KEY,
  developer_id  TEXT NOT NULL REFERENCES blox_developers(profile_id) ON DELETE CASCADE,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other',
  tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  hosting_type  TEXT NOT NULL DEFAULT 'webhost'
                CHECK (hosting_type IN ('vps','dedicated','own_server','pc','external','webhost')),
  client_url    TEXT NOT NULL DEFAULT '',
  server_url    TEXT NOT NULL DEFAULT '',
  key_id        TEXT NOT NULL UNIQUE,
  secret_enc    TEXT NOT NULL,
  secret_rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  conn_status   TEXT NOT NULL DEFAULT 'unconfigured'
                CHECK (conn_status IN ('unconfigured','checking','ok','failed')),
  conn_checked_at TIMESTAMPTZ,
  conn_error    TEXT NOT NULL DEFAULT '',
  conn_details  JSONB NOT NULL DEFAULT '{}'::jsonb,
  version       TEXT NOT NULL DEFAULT '1.0.0',
  moderation_status TEXT NOT NULL DEFAULT 'draft'
                CHECK (moderation_status IN ('draft','pending','needs_changes','approved','published','hidden','blocked','archived')),
  moderation_reason TEXT NOT NULL DEFAULT '',
  moderated_by  TEXT,
  moderated_at  TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  auto_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_text   TEXT NOT NULL DEFAULT '',
  rating_avg    NUMERIC(3,2),
  rating_count  INTEGER NOT NULL DEFAULT 0,
  launches      INTEGER NOT NULL DEFAULT 0,
  visitors      INTEGER NOT NULL DEFAULT 0,
  favorites     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blox_games_dev ON blox_games (developer_id);
CREATE INDEX IF NOT EXISTS blox_games_catalog ON blox_games (moderation_status, published_at DESC);
CREATE INDEX IF NOT EXISTS blox_games_queue ON blox_games (moderation_status, submitted_at);

CREATE TABLE IF NOT EXISTS blox_places (
  id            TEXT PRIMARY KEY,
  game_id       TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other',
  entry_path    TEXT NOT NULL DEFAULT '/',
  max_players   INTEGER NOT NULL DEFAULT 1 CHECK (max_players BETWEEN 1 AND 1000),
  min_age       INTEGER NOT NULL DEFAULT 0 CHECK (min_age BETWEEN 0 AND 21),
  is_main       BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_status TEXT NOT NULL DEFAULT 'draft'
                CHECK (moderation_status IN ('draft','pending','needs_changes','approved','published','hidden','blocked','archived')),
  moderation_reason TEXT NOT NULL DEFAULT '',
  moderated_by  TEXT,
  moderated_at  TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  auto_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  launches      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blox_places_game ON blox_places (game_id, moderation_status);
CREATE INDEX IF NOT EXISTS blox_places_queue ON blox_places (moderation_status, submitted_at);

CREATE TABLE IF NOT EXISTS blox_images (
  id         TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('game','place')),
  owner_id   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('cover','shot')),
  mime       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blox_images_owner ON blox_images (owner_type, owner_id);

CREATE TABLE IF NOT EXISTS blox_versions (
  id         BIGSERIAL PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blox_mod_events (
  id           BIGSERIAL PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('game','place')),
  subject_id   TEXT NOT NULL,
  actor_id     TEXT,
  actor_role   TEXT NOT NULL DEFAULT 'developer',
  action       TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blox_mod_events_subject ON blox_mod_events (subject_type, subject_id, id DESC);

/* ─── Игроки: запуски, избранное, отзывы ─────────────────────────── */

CREATE TABLE IF NOT EXISTS blox_launches (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  place_id   TEXT REFERENCES blox_places(id) ON DELETE SET NULL,
  jti        TEXT NOT NULL UNIQUE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS blox_launches_user ON blox_launches (user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS blox_launches_game ON blox_launches (game_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS blox_favorites (
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS blox_reviews (
  id         TEXT PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);

/* ─── Жалобы и апелляции ─────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS blox_reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('game','place','developer','review')),
  target_id   TEXT NOT NULL,
  game_id     TEXT,
  developer_id TEXT,
  reason      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  priority    INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 3),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','upheld','dismissed')),
  resolution  TEXT NOT NULL DEFAULT '',
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blox_reports_one_open
  ON blox_reports (reporter_id, target_type, target_id) WHERE status IN ('open','in_review');
CREATE INDEX IF NOT EXISTS blox_reports_queue ON blox_reports (status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS blox_report_events (
  id         BIGSERIAL PRIMARY KEY,
  report_id  TEXT NOT NULL REFERENCES blox_reports(id) ON DELETE CASCADE,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blox_appeals (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('game','place','developer')),
  subject_id   TEXT NOT NULL,
  text         TEXT NOT NULL,
  -- Кто принял обжалуемое решение: повторно его смотрит другой сотрудник.
  original_decider TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  decision     TEXT NOT NULL DEFAULT '',
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blox_appeals_one_open
  ON blox_appeals (author_id, subject_type, subject_id) WHERE status = 'open';

/* ─── Магазин игры и покупки ─────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS blox_products (
  id           TEXT PRIMARY KEY,
  game_id      TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_points INTEGER NOT NULL CHECK (price_points BETWEEN 1 AND 1000000),
  kind         TEXT NOT NULL DEFAULT 'consumable' CHECK (kind IN ('consumable','durable')),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, sku)
);

CREATE TABLE IF NOT EXISTS blox_purchases (
  id            TEXT PRIMARY KEY,
  game_id       TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES blox_products(id),
  user_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Цена и доли фиксируются в момент оплаты и больше не пересчитываются.
  price_points  INTEGER,
  commission_pct NUMERIC(5,2),
  dev_points    INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','paid','fulfilled','refunded','expired','failed')),
  idem_key      TEXT NOT NULL,
  intent_expires_at TIMESTAMPTZ NOT NULL,
  wallet_ref    TEXT,
  paid_at       TIMESTAMPTZ,
  fulfilled_at  TIMESTAMPTZ,
  refunded_at   TIMESTAMPTZ,
  refund_reason TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, idem_key)
);
CREATE INDEX IF NOT EXISTS blox_purchases_user ON blox_purchases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blox_purchases_game ON blox_purchases (game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blox_entitlements (
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES blox_products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

/* ─── Вознаграждения: только дописываемый журнал ─────────────────── */

CREATE TABLE IF NOT EXISTS blox_earnings (
  id            BIGSERIAL PRIMARY KEY,
  developer_id  TEXT NOT NULL REFERENCES blox_developers(profile_id) ON DELETE CASCADE,
  game_id       TEXT,
  purchase_id   TEXT REFERENCES blox_purchases(id),
  kind          TEXT NOT NULL CHECK (kind IN ('purchase','reversal','adjustment')),
  gross_points  INTEGER NOT NULL DEFAULT 0,
  commission_points INTEGER NOT NULL DEFAULT 0,
  -- Доля разработчика со знаком: покупка +, возврат −, корректировка ±.
  amount_points INTEGER NOT NULL,
  -- С какого момента сумма считается доступной к выплате.
  available_at  TIMESTAMPTZ NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  actor_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Одно начисление и один возврат на покупку: повтор не удвоит заработок.
CREATE UNIQUE INDEX IF NOT EXISTS blox_earnings_once
  ON blox_earnings (purchase_id, kind) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS blox_earnings_dev ON blox_earnings (developer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blox_payouts (
  id            TEXT PRIMARY KEY,
  developer_id  TEXT NOT NULL REFERENCES blox_developers(profile_id) ON DELETE CASCADE,
  amount_points INTEGER NOT NULL CHECK (amount_points > 0),
  requisites_enc TEXT,
  requisites_tail TEXT NOT NULL DEFAULT '',
  terms_version TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','review','needs_info','approved','processing','paid','rejected','cancelled')),
  idem_key      TEXT,
  admin_comment TEXT NOT NULL DEFAULT '',
  reject_reason TEXT NOT NULL DEFAULT '',
  reviewer_id   TEXT,
  paid_by       TEXT,
  paid_at       TIMESTAMPTZ,
  paid_ref      TEXT NOT NULL DEFAULT '',
  paid_note     TEXT NOT NULL DEFAULT '',
  submitted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blox_payouts_idem ON blox_payouts (developer_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS blox_payouts_queue ON blox_payouts (status, submitted_at);

CREATE TABLE IF NOT EXISTS blox_payout_events (
  id         BIGSERIAL PRIMARY KEY,
  payout_id  TEXT NOT NULL REFERENCES blox_payouts(id) ON DELETE CASCADE,
  actor_id   TEXT,
  actor_role TEXT NOT NULL DEFAULT 'developer',
  action     TEXT NOT NULL,
  from_status TEXT,
  to_status  TEXT,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ─── Служебное ──────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS blox_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одноразовые метки подписанных запросов игровых серверов (защита от повтора).
CREATE TABLE IF NOT EXISTS blox_api_nonces (
  key_id TEXT NOT NULL,
  nonce  TEXT NOT NULL,
  at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, nonce)
);
CREATE INDEX IF NOT EXISTS blox_api_nonces_at ON blox_api_nonces (at);

CREATE TABLE IF NOT EXISTS blox_probe_log (
  id       BIGSERIAL PRIMARY KEY,
  game_id  TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  ok       BOOLEAN NOT NULL,
  detail   TEXT NOT NULL DEFAULT '',
  ms       INTEGER,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blox_probe_log_game ON blox_probe_log (game_id, at DESC);

-- Псевдоним игрока в конкретной игре: сервер игры видит его, а не профиль Sky.
CREATE TABLE IF NOT EXISTS blox_players (
  game_id     TEXT NOT NULL REFERENCES blox_games(id) ON DELETE CASCADE,
  player_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, user_id)
);
