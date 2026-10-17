-- SkyKassa Business, этап 4: платёжные партнёры бизнеса (адаптер hmac-v1), вебхуки, приостановка администрацией.
CREATE TABLE IF NOT EXISTS kb_providers (
  business_id TEXT PRIMARY KEY REFERENCES kb_businesses(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'hmac-v1',
  title       TEXT NOT NULL DEFAULT '',
  base_url    TEXT NOT NULL,
  merchant    TEXT NOT NULL,
  secret_enc  TEXT NOT NULL,                -- секрет подписи, зашифрован; наружу не отдаётся
  enabled     BOOLEAN NOT NULL DEFAULT true,
  last_ok_at  TIMESTAMPTZ,
  last_error  TEXT NOT NULL DEFAULT '',
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE kb_payments ADD COLUMN IF NOT EXISTS provider_ref TEXT;
ALTER TABLE kb_payments ADD COLUMN IF NOT EXISTS provider_url_enc TEXT;
ALTER TABLE kb_payments ADD COLUMN IF NOT EXISTS provider_checked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS kb_payments_provider_ref_idx ON kb_payments (business_id, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS kb_provider_events (
  business_id TEXT NOT NULL REFERENCES kb_businesses(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL,
  result      TEXT NOT NULL DEFAULT '',
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, event_id)
);

ALTER TABLE kb_businesses ADD COLUMN IF NOT EXISTS suspended_by TEXT;
ALTER TABLE kb_businesses ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
