-- Sky Time: капсулы времени, цифровое благополучие (Sky Balance), «В этот день».
CREATE TABLE IF NOT EXISTS time_capsules (
  id            TEXT PRIMARY KEY,
  author_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,   -- сам автор или друг
  title_enc     TEXT,
  text_enc      TEXT NOT NULL,
  open_at       TIMESTAMPTZ NOT NULL,
  locked        BOOLEAN NOT NULL DEFAULT FALSE,                            -- запечатана намертво: отменить нельзя
  status        TEXT NOT NULL DEFAULT 'sealed' CHECK (status IN ('sealed','opened','cancelled')),
  opened_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (open_at > created_at)
);
CREATE INDEX IF NOT EXISTS time_capsules_recipient_idx ON time_capsules (recipient_id, status, open_at);
CREATE INDEX IF NOT EXISTS time_capsules_author_idx ON time_capsules (author_id, status);
CREATE INDEX IF NOT EXISTS time_capsules_due_idx ON time_capsules (open_at) WHERE status = 'sealed';

-- Время в Sky по дням и разделам (то, что сообщает сам клиент владельца, секунды активного использования).
CREATE TABLE IF NOT EXISTS time_usage (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  module     TEXT NOT NULL,
  seconds    INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  PRIMARY KEY (profile_id, day, module)
);
CREATE TABLE IF NOT EXISTS time_balance (
  profile_id   TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  tracking     BOOLEAN NOT NULL DEFAULT FALSE,           -- учёт времени включает сам человек
  daily_total  INTEGER,                                  -- общий лимит, минут в день (NULL — нет)
  limits       JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {раздел: минут в день}
  quiet_from   SMALLINT,                                 -- тихие часы, минуты от полуночи (местное время человека)
  quiet_to     SMALLINT,
  tz_offset    SMALLINT NOT NULL DEFAULT 0,              -- смещение браузера, минут к UTC
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
