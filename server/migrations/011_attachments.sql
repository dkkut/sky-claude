-- ============================================================
--  Вложения.
--
--  До этой миграции фотографии и голосовые существовали только в
--  браузере отправителя: ссылка вида blob: действительна ровно в той
--  вкладке, где файл выбрали. Получатель не видел ничего, и на другом
--  устройстве отправителя тоже ничего не было.
--
--  Байты лежат прямо в базе, а не в каталоге на диске. Так у файла нет
--  имени в файловой системе, а значит нет и способа выйти за пределы
--  каталога через имя; права проверяются тем же запросом, что и на
--  переписку; резервная копия базы содержит всё целиком. Если объёмы
--  вырастут, это место — первое, что стоит вынести в отдельное
--  хранилище.
-- ============================================================

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id)    ON DELETE CASCADE,
  owner_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Сообщение проставляется, когда файл к нему приложили. Пока пусто —
  -- файл загружен, но не отправлен: такие удаляет уборка.
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,

  -- Тип определяется по самим байтам, а не по тому, что назвал клиент.
  mime       TEXT NOT NULL,
  size       INT  NOT NULL CHECK (size > 0),
  -- Имя показывается получателю; для хранения оно не используется.
  file_name  TEXT NOT NULL DEFAULT '',

  -- Зашифровано тем же ключом, что и переписка (см. server/crypto.mjs).
  data       BYTEA NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachments_owner_idx   ON attachments (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id);
-- Незавершённые загрузки ищем по этому условию.
CREATE INDEX IF NOT EXISTS attachments_orphan_idx  ON attachments (created_at) WHERE message_id IS NULL;
