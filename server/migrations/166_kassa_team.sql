-- SkyKassa Business, этап 3: сотрудники, промокоды, отзывы, касса.
CREATE TABLE IF NOT EXISTS kb_staff (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,                      -- admin | manager | cashier
  status      TEXT NOT NULL DEFAULT 'invited',    -- invited | active | removed
  invited_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Человек состоит не более чем в одном бизнесе одновременно (приглашение или работа).
CREATE UNIQUE INDEX IF NOT EXISTS kb_staff_person_idx ON kb_staff (profile_id) WHERE status IN ('invited','active');
CREATE INDEX IF NOT EXISTS kb_staff_biz_idx ON kb_staff (business_id, status);

CREATE TABLE IF NOT EXISTS kb_promos (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  kind          TEXT NOT NULL,                    -- percent | fixed
  value         INT  NOT NULL CHECK (value > 0),
  min_order_rub INT  NOT NULL DEFAULT 0,
  max_uses      INT,
  used          INT  NOT NULL DEFAULT 0,
  starts_at     TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | paused
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_promos_code_idx ON kb_promos (business_id, code);

ALTER TABLE kb_orders ADD COLUMN IF NOT EXISTS promo_code TEXT NOT NULL DEFAULT '';
ALTER TABLE kb_orders ADD COLUMN IF NOT EXISTS discount_rub INT NOT NULL DEFAULT 0;
ALTER TABLE kb_orders ADD COLUMN IF NOT EXISTS subtotal_rub INT;

CREATE TABLE IF NOT EXISTS kb_reviews (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  order_id    TEXT NOT NULL UNIQUE REFERENCES kb_orders(id) ON DELETE CASCADE,
  rating      INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'published',  -- published | hidden
  owner_reply TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_reviews_biz_idx ON kb_reviews (business_id, status, created_at DESC);
