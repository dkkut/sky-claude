-- Официальный бот Sky: сообщения с кодами живут недолго, их убирает уборка.
CREATE TABLE IF NOT EXISTS skybot_ephemeral (
  message_id TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  delete_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS skybot_ephemeral_due ON skybot_ephemeral (delete_at);

-- Счётчик отправленного ботом по видам (для админки/диагностики; текстов не хранит).
CREATE TABLE IF NOT EXISTS skybot_stats (
  day  DATE NOT NULL,
  kind TEXT NOT NULL,
  sent INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
