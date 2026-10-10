-- Мониторинг и аналитика: реальные замеры онлайна и активных за день.
-- Раз в минуту сервер записывает, сколько человек и соединений онлайн (по WebSocket);
-- при подключении человек отмечается «активным в этот день». Данных раньше запуска нет.
CREATE TABLE IF NOT EXISTS metrics_online (
  ts       TIMESTAMPTZ PRIMARY KEY DEFAULT now(),
  users    INTEGER NOT NULL,
  sessions INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS metrics_active_users (
  day     DATE NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX IF NOT EXISTS metrics_active_day ON metrics_active_users (day);
