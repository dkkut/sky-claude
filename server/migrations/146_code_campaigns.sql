-- Кампании Sky Codes (модуль 11): группа серий с общим окном действия, лимитом на человека и бюджетом.
-- Остальное (коды, награды, активации, купоны, журнал) — прежние таблицы Sky Codes; второй системы промокодов нет.
CREATE TABLE IF NOT EXISTS sky_code_campaigns (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  per_user_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit BETWEEN 1 AND 1000),
  budget_balance BIGINT CHECK (budget_balance IS NULL OR budget_balance >= 0),   -- ₽, NULL — без предела
  budget_points  BIGINT CHECK (budget_points  IS NULL OR budget_points  >= 0),
  spent_balance  BIGINT NOT NULL DEFAULT 0,
  spent_points   BIGINT NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sky_code_batches ADD COLUMN IF NOT EXISTS campaign_id TEXT REFERENCES sky_code_campaigns(id) ON DELETE SET NULL;
ALTER TABLE sky_code_batches ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE sky_code_redemptions ADD COLUMN IF NOT EXISTS campaign_id TEXT;
CREATE INDEX IF NOT EXISTS sky_code_batches_campaign_idx ON sky_code_batches (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sky_code_redemptions_campaign_idx ON sky_code_redemptions (campaign_id, profile_id) WHERE campaign_id IS NOT NULL;
