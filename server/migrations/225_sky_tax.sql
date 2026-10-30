-- Sky Tax: налоговый учёт Sky и предпринимателей. У каждого субъекта (Sky; бизнес SkyKassa Business; продавец Market; исполнитель Sky GO) — свой учёт, свои настройки и интеграция.
CREATE TABLE IF NOT EXISTS tax_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tax_subjects (
  id            TEXT PRIMARY KEY,
  scope         TEXT NOT NULL UNIQUE,                 -- sky | kb:<id бизнеса> | seller:<id профиля> | go:<id профиля>
  kind          TEXT NOT NULL CHECK (kind IN ('sky', 'business', 'seller', 'executor')),
  owner_profile_id TEXT,
  display_name  TEXT NOT NULL DEFAULT '',
  tax_status    TEXT CHECK (tax_status IN ('npd', 'ip', 'ooo')),
  regime        TEXT NOT NULL DEFAULT '',             -- npd | usn_income | usn_income_expense | osno | psn
  vat           TEXT NOT NULL DEFAULT 'none',         -- none | 0 | 5 | 7 | 10 | 20 | 22
  inn_enc       TEXT,
  inn_last4     TEXT NOT NULL DEFAULT '',
  mode          TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,       -- учёт включён (операции до enabled_at не подбираются)
  enabled_at    TIMESTAMPTZ,
  live          BOOLEAN NOT NULL DEFAULT FALSE,       -- разрешена реальная передача для этого субъекта (вместе с глобальным переключателем)
  manual_escalate_hours INT NOT NULL DEFAULT 12 CHECK (manual_escalate_hours BETWEEN 1 AND 720),
  manual_auto_hours     INT NOT NULL DEFAULT 0  CHECK (manual_auto_hours BETWEEN 0 AND 720),   -- 0 — не отправлять само; иначе операция уходит автоматически, чтобы не нарушить срок
  receipt_email BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_subjects_owner_idx ON tax_subjects (owner_profile_id);

CREATE TABLE IF NOT EXISTS tax_integrations (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL UNIQUE REFERENCES tax_subjects(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,                         -- manual_entry | hmac_gateway
  title       TEXT NOT NULL DEFAULT '',
  config_enc  TEXT NOT NULL DEFAULT '',              -- адрес и идентификатор (зашифровано)
  secret_enc  TEXT,                                  -- ключ подписи (зашифровано, наружу не отдаётся)
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  last_ok_at  TIMESTAMPTZ,
  last_error  TEXT NOT NULL DEFAULT '',
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tax_ops (
  id            TEXT PRIMARY KEY,
  subject_id    TEXT NOT NULL REFERENCES tax_subjects(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,                       -- wallet:prime | wallet:go_sub | kb_payment | market_order | go_order | skykassa_topup | manual …
  source_ref    TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale', 'refund')),
  classification TEXT NOT NULL CHECK (classification IN ('income', 'not_income', 'transit', 'review')),
  class_reason  TEXT NOT NULL DEFAULT '',
  doc_kind      TEXT NOT NULL DEFAULT 'none' CHECK (doc_kind IN ('fiscal_receipt', 'npd_receipt', 'confirmation', 'internal_receipt', 'none')),
  amount_rub    NUMERIC(14, 2) NOT NULL CHECK (amount_rub >= 0),
  currency      TEXT NOT NULL DEFAULT 'RUB',
  descr         TEXT NOT NULL DEFAULT '',
  items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  payer_profile_id TEXT,
  buyer_email_enc  TEXT,
  status        TEXT NOT NULL CHECK (status IN ('pending_confirm', 'queued', 'sending', 'awaiting_provider', 'awaiting_manual', 'issued', 'failed', 'rejected', 'not_required')),
  wait_reason   TEXT NOT NULL DEFAULT '',            -- почему стоит в очереди: live_disabled | no_integration | subject_not_ready …
  attempts      INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error    TEXT NOT NULL DEFAULT '',
  external_id   TEXT,
  due_by        TIMESTAMPTZ,
  escalated_at  TIMESTAMPTZ,
  refund_of     TEXT REFERENCES tax_ops(id) ON DELETE SET NULL,
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- момент получения денег (по нему считаются сроки)
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  reject_reason TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL DEFAULT 'system',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_id, source, source_ref)
);
CREATE INDEX IF NOT EXISTS tax_ops_subject_idx ON tax_ops (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tax_ops_due_idx ON tax_ops (status, next_attempt_at) WHERE status IN ('queued', 'awaiting_provider');
CREATE INDEX IF NOT EXISTS tax_ops_status_idx ON tax_ops (subject_id, status);

CREATE TABLE IF NOT EXISTS tax_docs (
  id          TEXT PRIMARY KEY,
  op_id       TEXT NOT NULL UNIQUE REFERENCES tax_ops(id) ON DELETE CASCADE,   -- на одну операцию — не больше одного документа
  subject_id  TEXT NOT NULL REFERENCES tax_subjects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('fiscal_receipt', 'npd_receipt', 'confirmation', 'internal_receipt')),
  op_kind     TEXT NOT NULL DEFAULT 'sale' CHECK (op_kind IN ('sale', 'refund')),
  number      TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  url         TEXT NOT NULL DEFAULT '',
  fiscal_sign TEXT NOT NULL DEFAULT '',
  provenance  TEXT NOT NULL CHECK (provenance IN ('provider', 'manual', 'internal')),   -- provider — подтверждено интеграцией; manual — номер внёс человек, Sky не проверял
  amount_rub  NUMERIC(14, 2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  email_status TEXT NOT NULL DEFAULT 'none' CHECK (email_status IN ('none', 'pending', 'sent', 'failed', 'no_address')),
  email_attempts INT NOT NULL DEFAULT 0,
  email_next_at TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_docs_subject_idx ON tax_docs (subject_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS tax_docs_email_idx ON tax_docs (email_status, email_next_at) WHERE email_status = 'pending';

CREATE TABLE IF NOT EXISTS tax_log (
  id         BIGSERIAL PRIMARY KEY,
  subject_id TEXT,
  op_id      TEXT,
  doc_id     TEXT,
  actor      TEXT NOT NULL,                          -- id профиля | system
  action     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ok',
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_log_subject_idx ON tax_log (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tax_log_op_idx ON tax_log (op_id);
