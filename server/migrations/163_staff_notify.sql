-- Настройки уведомлений сотрудников о новых заявках и очередях (server/staffnotify.mjs). Только добавляет.
CREATE TABLE IF NOT EXISTS staff_notify_prefs (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  in_app     BOOLEAN NOT NULL DEFAULT TRUE,
  push       BOOLEAN NOT NULL DEFAULT TRUE,
  muted      JSONB   NOT NULL DEFAULT '[]'::jsonb,   -- ключи категорий, которые человек отключил
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Дедупликация «одно событие — одно уведомление на человека» идёт по gift_notifications (kind = 'staff_queue', ref_id = ключ).
CREATE INDEX IF NOT EXISTS gift_notifications_staff_dedupe_idx
  ON gift_notifications (user_id, ref_id) WHERE kind = 'staff_queue';
