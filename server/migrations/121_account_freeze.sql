-- Временная заморозка новых входов в Sky ID и очистка недавних сессий.
-- Заморозка снимается сама по сроку либо вручную: ссылка из письма + баннер «Разморозка аккаунта» в «Устройствах».
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS login_frozen_until   TIMESTAMPTZ;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS freeze_token_hash    TEXT;          -- хеш ссылки из письма, одноразовая
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS freeze_link_ok_until TIMESTAMPTZ;   -- ссылка открыта: разморозить можно до этого времени

CREATE TABLE IF NOT EXISTS account_freeze_log (
  id         BIGSERIAL PRIMARY KEY,
  sky_id     TEXT NOT NULL,
  kind       TEXT NOT NULL,        -- freeze | cleanup | link_opened | unfreeze | blocked_login
  ip         TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT '',
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_freeze_log_idx ON account_freeze_log (sky_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sky_ids_freeze_token_idx ON sky_ids (freeze_token_hash) WHERE freeze_token_hash IS NOT NULL;
