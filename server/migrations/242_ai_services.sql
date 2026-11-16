-- Sky AI: помощники по сервисам. Один общий поставщик и ключ, но у каждого сервиса свои переключатель, модель, потолок ответа, суточный лимит токенов и дополнение к инструкции.
CREATE TABLE IF NOT EXISTS ai_service_settings (
  service          TEXT PRIMARY KEY,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  model            TEXT NOT NULL DEFAULT '',        -- пусто — общая модель (AI_MODEL)
  max_tokens       INTEGER NOT NULL DEFAULT 0,      -- 0 — без потолка сверх заданного кодом
  daily_tokens     BIGINT  NOT NULL DEFAULT 0,      -- 0 — без лимита (учитываются токены сервиса за сутки UTC)
  instructions     TEXT NOT NULL DEFAULT '',        -- дополнение к системной инструкции (до 600 знаков)
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ai_service_usage_daily (
  day           DATE NOT NULL,
  service       TEXT NOT NULL,
  model         TEXT NOT NULL DEFAULT '',
  requests      INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  input_tokens  BIGINT NOT NULL DEFAULT 0,          -- по данным поставщика
  output_tokens BIGINT NOT NULL DEFAULT 0,
  est_tokens    BIGINT NOT NULL DEFAULT 0,          -- наша оценка (знаков / 4), где поставщик не прислал usage
  PRIMARY KEY (day, service, model)
);
