-- ============================================================
--  Права администратора и настоящие ограничения.
--
--  Колонка is_admin в profiles была, но её не спрашивала ни одна
--  серверная ручка: панель администратора меняла записи в localStorage
--  нажавшего. Бан и мут сервер не знал вовсе — забаненный продолжал
--  писать и звонить.
--
--  Владелец задаётся ником в .env и правами не распоряжается никто:
--  снять их у него нельзя, иначе администраторы могли бы отобрать
--  сервис у его хозяина.
-- ============================================================

-- Ограничения человека. NULL — ограничения нет.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banned_until       TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS muted_until        TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS spam_blocked_until TIMESTAMPTZ;
-- Пометка модератора о человеке — видна только администраторам.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS moderation_note    TEXT NOT NULL DEFAULT '';

-- ── Журнал действий администраторов ─────────────────────────
--  Права, выданные одним администратором другому, должны быть видны:
--  без записи «кто кого назначил» разобраться потом невозможно.
CREATE TABLE IF NOT EXISTS admin_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  target_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  -- Подробность действия; составляет сервер, но там бывают имена.
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_log_time_idx ON admin_log (created_at DESC);
