-- Рассылки из админ-панели поверх уже существующей системы уведомлений
-- (src/notifications: useNotifStore, NotifBridge). Сам показ уведомления
-- в интерфейсе не меняется — это по-прежнему тот же store, то же окно
-- тоста. Здесь только то, чего не было вовсе: кто и когда должен
-- получить рассылку, и что сервер реально её отправил.
--
-- notify_broadcasts       — определение рассылки: текст, аудитория, расписание;
-- notify_broadcast_runs   — каждый фактический запуск (один для разовой,
--                            несколько для повторяющейся — раз в сутки/неделю);
-- notify_deliveries       — кому конкретно ушла рассылка в рамках запуска;
--                            тот же список, что отдаёт /api/notify/events —
--                            опрос по образцу /api/bloom/events.

CREATE TABLE IF NOT EXISTS notify_broadcasts (
  id                TEXT PRIMARY KEY,
  created_by        TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  link              TEXT,
  audience_type     TEXT NOT NULL CHECK (audience_type IN ('all','users','region')),
  audience_user_ids TEXT[] NOT NULL DEFAULT '{}',
  audience_region   TEXT,
  schedule_kind     TEXT NOT NULL DEFAULT 'once' CHECK (schedule_kind IN ('once','daily','weekly')),
  scheduled_at      TIMESTAMPTZ,
  timezone_label    TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','scheduled','processing','sent','cancelled','failed')),
  reason            TEXT,
  cancelled_by      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  cancelled_at      TIMESTAMPTZ,
  last_error        TEXT,
  last_sent_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notify_broadcasts_due_idx
  ON notify_broadcasts (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS notify_broadcasts_created_idx ON notify_broadcasts (created_at DESC);

-- Идемпотентность запуска: один и тот же (кампания, целевой момент) —
-- только одна строка. Если два worker'а или рестарт посреди обработки
-- попробуют захватить один и тот же запуск, второй наткнётся на
-- уникальный индекс и не отправит рассылку дважды.
CREATE TABLE IF NOT EXISTS notify_broadcast_runs (
  id                 TEXT PRIMARY KEY,
  broadcast_id       TEXT NOT NULL REFERENCES notify_broadcasts(id) ON DELETE CASCADE,
  scheduled_for      TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','sent','failed')),
  recipients_total   INT NOT NULL DEFAULT 0,
  recipients_sent    INT NOT NULL DEFAULT 0,
  recipients_failed  INT NOT NULL DEFAULT 0,
  error              TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  UNIQUE (broadcast_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS notify_broadcast_runs_broadcast_idx ON notify_broadcast_runs (broadcast_id, started_at DESC);
-- Зависшие в processing дольше окна — считаем упавшими при следующей уборке.
CREATE INDEX IF NOT EXISTS notify_broadcast_runs_stale_idx
  ON notify_broadcast_runs (started_at) WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS notify_deliveries (
  id           BIGSERIAL PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES notify_broadcast_runs(id) ON DELETE CASCADE,
  broadcast_id TEXT NOT NULL REFERENCES notify_broadcasts(id) ON DELETE CASCADE,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, profile_id)
);
CREATE INDEX IF NOT EXISTS notify_deliveries_profile_idx ON notify_deliveries (profile_id, created_at);
