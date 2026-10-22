-- Sky Parking: закрытие парковки владельцем, «взятие» заявки модератором, минимальная стоимость тарифа,
-- ограничение сотрудников организации (парковки и действия), напоминание за 5 минут, журнал ошибок. Только добавляет.
ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS closed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS closed_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS closed_by TEXT;
ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE parking_lots ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE parking_tariffs ADD COLUMN IF NOT EXISTS min_cost_rub INT NOT NULL DEFAULT 0 CHECK (min_cost_rub >= 0 AND min_cost_rub <= 100000);
ALTER TABLE parking_staff ADD COLUMN IF NOT EXISTS lot_ids TEXT[];                                  -- NULL — все парковки организации
ALTER TABLE parking_staff ADD COLUMN IF NOT EXISTS perms TEXT[] NOT NULL DEFAULT ARRAY['edit','submit'];
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS soon5_notified BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS parking_errors (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope    TEXT NOT NULL,
  code     TEXT NOT NULL DEFAULT '',
  message  TEXT NOT NULL DEFAULT '',
  actor_id TEXT,
  org_id   TEXT,
  lot_id   TEXT
);
CREATE INDEX IF NOT EXISTS parking_errors_at_idx ON parking_errors (at DESC);
CREATE INDEX IF NOT EXISTS parking_errors_org_idx ON parking_errors (org_id, at DESC);
CREATE INDEX IF NOT EXISTS parking_lots_review_idx ON parking_lots (status, updated_at);
CREATE INDEX IF NOT EXISTS parking_payments_created_idx ON parking_payments (created_at DESC);
