-- ============================================================
--  Sky Garant: сервис безопасных сделок между пользователями.
--
--  Раньше вся Sky Garant жила в localStorage одного браузера
--  (src/garant/SkyGarant.tsx): «покупатель» находился только среди
--  локальных аккаунтов этого устройства (useAuthStore.accounts), оплата
--  списывалась с кошелька покупателя через wallet.spend, но НИКУДА не
--  зачислялась — продавец не получал ничего даже при полном завершении
--  сделки. Статусы, споры и решения администратора существовали только
--  в браузере и не подтверждались сервером.
--
--  Здесь заводится реальная серверная сущность: сделка с настоящим
--  эскроу (деньги покупателя списываются в момент внесения и
--  зачисляются продавцу только при завершении сделки — через
--  server/wallet.mjs, без второго платёжного механизма), участники —
--  через тот же справочник людей, что и Sky Family/Мессенджер
--  (server/directory.mjs), и журнал действий для админки.
-- ============================================================

CREATE TABLE IF NOT EXISTS garant_deals (
  id                 TEXT PRIMARY KEY,           -- grt-<uuid>
  seller_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  buyer_id           TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  item_type          TEXT NOT NULL CHECK (item_type IN ('skin','gift','nft','currency','item','other')),
  item_name          TEXT NOT NULL,
  price              INTEGER NOT NULL CHECK (price > 0),
  pay_type           TEXT NOT NULL CHECK (pay_type IN ('rubles','points')),
  status             TEXT NOT NULL DEFAULT 'pending_seller'
                       CHECK (status IN ('pending_seller','pending_buyer','in_escrow','completed','cancelled','disputed')),
  seller_deposited   BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_deposited    BOOLEAN NOT NULL DEFAULT FALSE,
  seller_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancelled_by       TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  dispute_reason     TEXT,
  dispute_opened_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  dispute_at         TIMESTAMPTZ,
  dispute_result     TEXT CHECK (dispute_result IN ('seller_wins','buyer_wins','cancelled')),
  dispute_note       TEXT,
  dispute_resolved_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  dispute_resolved_at TIMESTAMPTZ,
  CONSTRAINT garant_deals_not_self CHECK (seller_id <> buyer_id)
);
CREATE INDEX IF NOT EXISTS garant_deals_seller_idx ON garant_deals (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS garant_deals_buyer_idx  ON garant_deals (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS garant_deals_status_idx ON garant_deals (status);

-- ── Подписка Sky Garant Pro (безлимит сделок) ──────────────────────────
-- Тот же приём продления, что у продавца Sky Market (market.mjs::
-- paySellerSubscription): от большей из "сейчас" и "уже оплачено до".
CREATE TABLE IF NOT EXISTS garant_subscriptions (
  profile_id  TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive')),
  started_at  TIMESTAMPTZ,
  until       TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Журнал действий ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS garant_audit_log (
  id         TEXT PRIMARY KEY,                -- gal-<uuid>
  deal_id    TEXT REFERENCES garant_deals(id) ON DELETE SET NULL,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garant_audit_log_deal_idx ON garant_audit_log (deal_id, created_at DESC);

-- ── Уведомления ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS garant_notifications (
  id         TEXT PRIMARY KEY,                -- gnn-<uuid>
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id    TEXT REFERENCES garant_deals(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garant_notifications_user_idx
  ON garant_notifications (user_id, created_at DESC);
