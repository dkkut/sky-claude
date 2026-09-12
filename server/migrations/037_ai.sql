-- Sky AI на сервере.
--
-- До этой миграции у Sky AI не было ни одной строки в базе, и это не
-- случайность: разговор с моделью шёл прямо из браузера на
-- api.anthropic.com, а история диалога жила в состоянии React и
-- пропадала при переходе на другую вкладку. Серверу нечего было
-- хранить, потому что сервер в этом разговоре не участвовал.
--
-- Три решения, из которых следует остальное.
--
-- 1. Чат принадлежит профилю, а не учётной записи Sky ID. У одного
--    человека несколько профилей, и переписка с моделью у них разная —
--    как и переписка с людьми.
--
-- 2. Текст сообщений лежит зашифрованным. Человек рассказывает модели
--    то же, что рассказал бы в личном сообщении, и хранить это открытым
--    в базе неправильно. Ключ — тот же, что у остальной переписки.
--
-- 3. Расход считается по дням и отдельно по видам работы. Бесплатный
--    чат и тяжёлые Prime-инструменты стоят сильно разного, и общий
--    счётчик не даёт ни ограничить одно, ни не ограничить другое.

-- ============================================================
--  Диалог
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_chats (
  id          TEXT PRIMARY KEY,

  -- Владелец. Единственный источник права на чтение и правку —
  -- сравнение с ним. Идентификатор приходит из токена, не из запроса.
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Название. Первое сообщение даёт его само, потом можно переименовать.
  title       TEXT NOT NULL DEFAULT 'Новый диалог',

  -- Сколько сообщений в диалоге: чтобы не считать их при каждом показе
  -- списка.
  message_count INTEGER NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chats_owner_idx
  ON ai_chats (profile_id, updated_at DESC);

-- ============================================================
--  Сообщение
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,

  -- Владелец продублирован здесь намеренно. Запрос на выборку
  -- сообщений тогда содержит условие по владельцу прямо в себе, и
  -- чужой chat_id не выбирает ничего даже при ошибке в вызывающем коде.
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- 'user' — человек, 'assistant' — модель.
  role       TEXT NOT NULL,

  -- Зашифрованный текст. Открытым в базе не лежит.
  body       TEXT NOT NULL,

  -- Каким инструментом получено: 'chat' — обычный разговор,
  -- остальное — Prime-инструменты. Нужно, чтобы показать в истории,
  -- откуда взялся ответ, и чтобы считать расход по видам.
  tool       TEXT NOT NULL DEFAULT 'chat',

  -- Приблизительный размер в знаках: для счётчиков и для обрезки
  -- контекста. Точные токены поставщика мы не знаем и знать не обязаны.
  chars      INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ai_messages_role_chk CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS ai_messages_chat_idx
  ON ai_messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS ai_messages_owner_idx
  ON ai_messages (profile_id, created_at DESC);

-- ============================================================
--  Файл, отданный на разбор
--
--  Строка появляется до записи файла на диск и живёт дольше него:
--  файл удаляется сразу после обработки, а запись остаётся, чтобы
--  показать в истории, что именно разбирали.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_files (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chat_id    TEXT REFERENCES ai_chats(id) ON DELETE SET NULL,

  -- Имя, которое показал человек. Хранится только для показа — в пути
  -- к файлу оно не участвует никогда: путь собирается из id.
  shown_name TEXT NOT NULL DEFAULT '',

  -- Тип, определённый сервером по первым байтам, а не присланный.
  mime       TEXT NOT NULL,
  bytes      BIGINT NOT NULL DEFAULT 0,

  -- Лежит ли файл ещё на диске. После разбора он удаляется, и держать
  -- его дальше незачем: разбор уже в истории.
  stored     BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_files_owner_idx ON ai_files (profile_id, created_at DESC);
-- Для уборки: что ещё лежит на диске и когда положено.
CREATE INDEX IF NOT EXISTS ai_files_stored_idx ON ai_files (created_at) WHERE stored;

-- ============================================================
--  Расход
--
--  Счётчик на человека, на день и на вид работы. Лежит в базе, а не в
--  памяти процесса: перезапуск сервера не должен обнулять дневной
--  предел, иначе предела нет.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Сутки по UTC. Отдельной колонкой, а не вычислением из времени:
  -- по ней идёт первичный ключ.
  day        DATE NOT NULL,
  -- 'chat' | 'summary' | 'file' | 'image' | 'transcribe'
  kind       TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (profile_id, day, kind)
);
