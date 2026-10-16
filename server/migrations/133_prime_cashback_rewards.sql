-- Модули 3–4: кэшбэк Prime Points за завершённые заказы Sky Market и каталог наград за баллы на сервере.
-- Баланс один — wallet_accounts.points; курса «баллы → рубли» нет. Все начисления/списания — через wallet.*In в одной транзакции.
CREATE TABLE IF NOT EXISTS prime_settings (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  cashback     JSONB NOT NULL DEFAULT '{}'::jsonb,    -- правила кэшбэка (см. server/primecashback.mjs, DEFAULTS)
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ
);
INSERT INTO prime_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS prime_cashback (
  id               TEXT PRIMARY KEY,                    -- cbk-<uuid>
  order_id         TEXT NOT NULL,                       -- один заказ — один кэшбэк (UNIQUE ниже)
  profile_id       TEXT NOT NULL,                       -- покупатель
  seller_id        TEXT NOT NULL,
  total_kop        BIGINT NOT NULL,
  percent          NUMERIC(5,2) NOT NULL,
  points           INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',     -- pending | paid | cancelled
  reason           TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  release_at       TIMESTAMPTZ NOT NULL,                -- до этого момента баллы «в ожидании» (защита от сговора и возвратов)
  decided_at       TIMESTAMPTZ,
  decided_by       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS prime_cashback_order_idx ON prime_cashback (order_id);
CREATE INDEX IF NOT EXISTS prime_cashback_profile_idx ON prime_cashback (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prime_cashback_due_idx ON prime_cashback (release_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS prime_rewards (
  id             TEXT PRIMARY KEY,                      -- rwd-<uuid>
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  cost_points    INTEGER NOT NULL CHECK (cost_points > 0),
  kind           TEXT NOT NULL,                         -- prime_days (выдаётся сразу) | manual (выдаёт сотрудник)
  value_days     INTEGER,                               -- для prime_days
  stock          INTEGER,                               -- NULL — без ограничения
  per_user_limit INTEGER,                               -- NULL — без ограничения
  min_tier       TEXT,                                  -- silver|gold|platinum|diamond или NULL
  active         BOOLEAN NOT NULL DEFAULT FALSE,
  sort           INTEGER NOT NULL DEFAULT 100,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prime_redemptions (
  id           TEXT PRIMARY KEY,                        -- rdm-<uuid>
  reward_id    TEXT NOT NULL,
  profile_id   TEXT NOT NULL,
  cost_points  INTEGER NOT NULL,
  title        TEXT NOT NULL,                           -- снимок названия на момент обмена
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,                           -- done | pending_manual | rejected_refunded | failed_refunded
  idem_key     TEXT NOT NULL,                           -- повтор того же запроса не списывает второй раз
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ,
  decided_by   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS prime_redemptions_idem_idx ON prime_redemptions (profile_id, idem_key);
CREATE INDEX IF NOT EXISTS prime_redemptions_profile_idx ON prime_redemptions (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prime_redemptions_status_idx ON prime_redemptions (status, created_at);
