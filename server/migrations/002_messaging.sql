-- ============================================================
--  Чаты и сообщения.
--
--  До этой миграции WebSocket-хаб держал их в Map внутри процесса:
--  перезапуск контейнера стирал всю переписку.
-- ============================================================

CREATE TABLE IF NOT EXISTS chats (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('direct','group','channel')),
  name        TEXT NOT NULL DEFAULT '',
  username    TEXT NOT NULL DEFAULT '',
  avatar      TEXT NOT NULL DEFAULT '',
  description TEXT,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Участники. Отдельной таблицей, а не массивом в chats: так работает
-- индекс «все чаты пользователя» и не нужно переписывать строку чата
-- при каждом входе-выходе участника.
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id   TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'text',
  text       TEXT NOT NULL DEFAULT '',

  -- Остальные поля сообщения (вложения, ответы, опросы) кладём как есть:
  -- их набор задаётся фронтендом и меняется чаще, чем схема БД.
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,

  edited_at  TIMESTAMPTZ,
  deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Основной запрос — «последние N сообщений чата», отсюда порядок колонок.
CREATE INDEX IF NOT EXISTS messages_chat_created_idx
  ON messages (chat_id, created_at DESC);

-- Кто какое сообщение прочитал. Отсюда считаются непрочитанные.
CREATE TABLE IF NOT EXISTS message_reads (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
