-- Email-коммуникации: шаблоны, рассылки, очередь отправки, отписки, настройки. Надстройка над notify.sendEmail (своего почтальона нет).
CREATE TABLE IF NOT EXISTS email_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_templates (
  key        TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('newsletter', 'prime', 'money')),
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  preheader  TEXT NOT NULL DEFAULT '',
  content    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- title, subtitle, body, cards[], cta{label,url}, imageUrl
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  auto       BOOLEAN NOT NULL DEFAULT TRUE,        -- автоматическая отправка (Prime, SkyMoney)
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  is_template  BOOLEAN NOT NULL DEFAULT FALSE,     -- сохранённый шаблон рассылки
  subject      TEXT NOT NULL DEFAULT '',
  preheader    TEXT NOT NULL DEFAULT '',
  content      JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience     JSONB NOT NULL DEFAULT '{}'::jsonb, -- {mode: all|prime|nonprime|list, ids: [...], marketing: true}
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  scheduled_at TIMESTAMPTZ,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  total        INT NOT NULL DEFAULT 0,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON email_campaigns (status, scheduled_at);

CREATE TABLE IF NOT EXISTS email_outbox (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL UNIQUE,               -- уникальный идентификатор письма (виден в теме журнала и заголовке)
  kind            TEXT NOT NULL CHECK (kind IN ('newsletter', 'prime', 'money')),
  template_key    TEXT NOT NULL,
  campaign_id     TEXT,
  profile_id      TEXT,
  sky_id          TEXT,
  email_mask      TEXT NOT NULL DEFAULT '',           -- адрес в журнале только маской; при отправке берётся актуальный из Sky ID
  subject         TEXT NOT NULL DEFAULT '',
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb, -- данные для подстановки (ссылки на платёж/подписку, без HTML)
  dedupe_key      TEXT UNIQUE,                        -- защита от повтора одного и того же уведомления
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT NOT NULL DEFAULT '',
  manual          BOOLEAN NOT NULL DEFAULT FALSE,     -- адресная отправка администратором
  is_test         BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_outbox_due_idx ON email_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS email_outbox_campaign_idx ON email_outbox (campaign_id);
CREATE INDEX IF NOT EXISTS email_outbox_profile_idx ON email_outbox (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_outbox_kind_idx ON email_outbox (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS email_unsubscribes (   -- отказ только от РЕКЛАМНЫХ рассылок; сервисные и финансовые письма он не отключает
  sky_id     TEXT PRIMARY KEY,
  source     TEXT NOT NULL DEFAULT 'link',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
