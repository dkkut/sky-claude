-- Sky GO: персональный тариф исполнителя (цена и срок для конкретного человека и кабинета).
CREATE TABLE IF NOT EXISTS go_executor_tariffs (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  price_rub   INT  NOT NULL CHECK (price_rub >= 0 AND price_rub <= 100000),
  period_days INT  NOT NULL CHECK (period_days BETWEEN 1 AND 366),
  note        TEXT NOT NULL DEFAULT '',
  set_by      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, role)
);

-- Активность в играх: сессии с «пульсом» от открытой игры (клиент шлёт раз в 30 с, в том числе из фона).
CREATE TABLE IF NOT EXISTS game_sessions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('blox','game')),
  ref_id       TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS game_sessions_user ON game_sessions (user_id, last_seen_at DESC);

-- Показывать ли другим, во что человек играет (по умолчанию нет).
CREATE TABLE IF NOT EXISTS game_prefs (
  user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  share   BOOLEAN NOT NULL DEFAULT FALSE
);
