-- Sky Prime: правила кэшбэка, которые задаёт администрация: за что (заказ такси, вкладка, покупка Prime…), сколько и в каких пределах.
CREATE TABLE IF NOT EXISTS cashback_rules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('go_taxi','go_delivery','go_food','go_stay','prime_purchase','wallet_topup','market_order','tab_visit')),
  tab TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  percent NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  fixed_points INTEGER NOT NULL DEFAULT 0 CHECK (fixed_points >= 0 AND fixed_points <= 100000),
  min_amount_rub INTEGER NOT NULL DEFAULT 0 CHECK (min_amount_rub >= 0),
  max_points_event INTEGER NOT NULL DEFAULT 500 CHECK (max_points_event >= 1),
  per_user_day_events INTEGER NOT NULL DEFAULT 0 CHECK (per_user_day_events >= 0),   -- сколько раз в сутки (0 — без предела)
  per_user_month_points INTEGER NOT NULL DEFAULT 5000 CHECK (per_user_month_points >= 1),
  prime_only BOOLEAN NOT NULL DEFAULT false,
  hold_days INTEGER NOT NULL DEFAULT 0 CHECK (hold_days >= 0 AND hold_days <= 60),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  budget_points INTEGER CHECK (budget_points IS NULL OR budget_points >= 1),
  spent_points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused','ended')),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cashback_rules_trigger_idx ON cashback_rules (trigger, status);

CREATE TABLE IF NOT EXISTS cashback_grants (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES cashback_rules(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  ref TEXT NOT NULL,
  amount_rub INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL CHECK (points > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','cancelled')),
  release_at TIMESTAMPTZ,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  UNIQUE (rule_id, ref)
);
CREATE INDEX IF NOT EXISTS cashback_grants_profile_idx ON cashback_grants (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cashback_grants_due_idx ON cashback_grants (release_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS cashback_grants_ref_idx ON cashback_grants (ref) WHERE status = 'pending';
