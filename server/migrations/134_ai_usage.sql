-- Модуль 6: учёт расхода AI (токены, запросы, ошибки) по поставщику и модели, бюджет и журнал событий.
-- Баланс денег у поставщика НЕ хранится и не выдумывается: токены модели и деньги — разные показатели.
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  day           DATE NOT NULL,
  provider      TEXT NOT NULL,                 -- хост поставщика (из AI_BASE_URL / STT_BASE_URL)
  model         TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- chat | stt
  requests      INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  input_tokens  BIGINT  NOT NULL DEFAULT 0,    -- по данным поставщика
  output_tokens BIGINT  NOT NULL DEFAULT 0,
  est_requests  INTEGER NOT NULL DEFAULT 0,    -- запросы, где поставщик не прислал usage: токены ниже — НАША оценка (знаков / 4)
  est_input     BIGINT  NOT NULL DEFAULT 0,
  est_output    BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider, model, kind)
);

CREATE TABLE IF NOT EXISTS ai_events (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider  TEXT NOT NULL DEFAULT '',
  model     TEXT NOT NULL DEFAULT '',
  kind      TEXT NOT NULL,                     -- error | rate_limit | budget | alert | settings
  code      TEXT NOT NULL DEFAULT '',
  detail    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ai_events_at_idx ON ai_events (at DESC);

CREATE TABLE IF NOT EXISTS ai_settings (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ
);
INSERT INTO ai_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_alerts_sent (
  period  TEXT NOT NULL,                       -- 'd:2026-10-16' | 'm:2026-10'
  level   TEXT NOT NULL,                       -- warn | critical | exhausted
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period, level)
);
