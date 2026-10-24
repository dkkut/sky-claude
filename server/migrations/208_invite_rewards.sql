-- Награды за приглашения (Prime-дни и баллы по порогам). Один порог — один раз на профиль.
CREATE TABLE IF NOT EXISTS invite_rewards (
  profile_id TEXT NOT NULL,
  milestone  INT  NOT NULL,
  prime_days INT  NOT NULL DEFAULT 0,
  points     INT  NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, milestone)
);
