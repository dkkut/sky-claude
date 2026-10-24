-- Запросы уполномоченных органов: реестр обращений и журнал выгрузок.
-- Сами данные человека здесь НЕ хранятся — только реквизиты запроса и контрольная сумма выданного файла.
CREATE TABLE IF NOT EXISTS law_requests (
  id            TEXT PRIMARY KEY,
  case_no       TEXT NOT NULL,                      -- номер дела / исходящий номер запроса
  authority     TEXT NOT NULL,                      -- орган, приславший запрос
  legal_basis   TEXT NOT NULL,                      -- правовое основание (норма, реквизиты документа)
  subject_sky_id TEXT NOT NULL,
  subject_profile_id TEXT,
  period_from   TIMESTAMPTZ,
  period_to     TIMESTAMPTZ,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','exported','closed','rejected')),
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  closed_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS law_requests_subject_idx ON law_requests (subject_sky_id, created_at DESC);
CREATE TABLE IF NOT EXISTS law_exports (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES law_requests(id),
  actor_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sha256      TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  sections    JSONB NOT NULL DEFAULT '{}'::jsonb      -- сколько записей в каждом разделе (без содержимого)
);
CREATE INDEX IF NOT EXISTS law_exports_req_idx ON law_exports (request_id, created_at DESC);
