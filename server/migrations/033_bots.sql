-- Sky Bots на сервере.
--
-- До этой миграции у ботов не было ни одной строки в базе и ни одной
-- серверной ручки. «Мои боты» лежали в localStorage того браузера, где
-- их создали, «Все боты» были пятью записями прямо в коде экрана, а код
-- бота выполнялся в Web Worker в браузере самого автора. Бот не мог ни
-- ответить кому-то ещё, ни пережить очистку хранилища.
--
-- Главное решение этой миграции: Sky не выполняет код бота. Здесь
-- хранится описание бота, его права и учётные данные внешней программы
-- (runtime), которую владелец поднимает на СВОЁМ сервере. Дальше Sky
-- только складывает для неё события и принимает от неё действия.
-- Процессор и память под бота тратит сервер владельца.

-- ============================================================
--  Профиль-бот
--
--  Бот пишет в чаты, значит он должен быть участником чата. Городить
--  для этого вторую систему авторства нельзя: тогда каждая проверка
--  прав в мессенджере имела бы вторую, отдельную ветку, и однажды
--  кто-нибудь забыл бы её написать. Поэтому у бота обычный профиль,
--  просто помеченный признаком. Все проверки участия, блокировок и
--  правил чата работают для него сами собой.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
--  Бот
-- ============================================================

CREATE TABLE IF NOT EXISTS bots (
  id            TEXT PRIMARY KEY,

  -- Владелец. Он и только он управляет ботом. Проверка «это мой бот»
  -- идёт по этому полю на сервере, а не по тому, что прислал клиент.
  owner_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Профиль, от чьего имени бот пишет в чаты. Создаётся вместе с ботом
  -- и удаляется вместе с ним.
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  username      TEXT NOT NULL,

  -- Короткая и полная строки для карточки в каталоге.
  short_desc    TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'Другое',

  -- Значок и цвет карточки: пока нет аватара, пустая серая плитка
  -- выглядит поломкой, а не «картинку ещё не загрузили».
  icon          TEXT NOT NULL DEFAULT 'bot',
  accent        TEXT NOT NULL DEFAULT '#4e8cf7',

  -- 'private'   — виден только владельцу;
  -- 'pending'   — отправлен на проверку;
  -- 'published' — в каталоге «Все боты»;
  -- 'rejected'  — отклонён, причина в reject_reason.
  status        TEXT NOT NULL DEFAULT 'private',
  reject_reason TEXT,
  verified      BOOLEAN NOT NULL DEFAULT FALSE,

  -- Исходник бота. Sky его НЕ ЗАПУСКАЕТ — хранит как черновик, чтобы
  -- владельцу было откуда скопировать его на свой сервер. Лежит
  -- зашифрованным: это сочинение автора, и в дампе базы ему не место.
  code          TEXT,
  code_lang     TEXT NOT NULL DEFAULT 'js',

  -- Inline-режим: вызов через # прямо в поле ввода чата.
  inline_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  inline_trigger     TEXT,
  inline_placeholder TEXT NOT NULL DEFAULT '',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bots_status_chk
    CHECK (status IN ('private', 'pending', 'published', 'rejected')),
  CONSTRAINT bots_code_lang_chk
    CHECK (code_lang IN ('js', 'ts', 'py', 'go', 'other'))
);

-- Ник бота — точка входа: по нему его ищут и по нему на него ссылаются.
CREATE UNIQUE INDEX IF NOT EXISTS bots_username_lower_key
  ON bots (lower(username));
CREATE INDEX IF NOT EXISTS bots_owner_idx  ON bots (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bots_status_idx ON bots (status) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS bots_profile_key ON bots (profile_id);

-- Триггер inline уникален среди опубликованных: «#погода» должна
-- означать одного бота, а не «того, кто первым нашёлся».
CREATE UNIQUE INDEX IF NOT EXISTS bots_inline_trigger_key
  ON bots (lower(inline_trigger))
  WHERE inline_enabled AND inline_trigger IS NOT NULL AND status = 'published';

-- ============================================================
--  Команды бота — то, что показывается в подсказке чата.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_commands (
  bot_id      TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  cmd         TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ordering    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, cmd)
);

-- ============================================================
--  Внешний runtime — программа на сервере владельца
--
--  Привязка НЕ по адресу. Адрес меняется при переезде, при перезапуске
--  в облаке, при выходе через другого провайдера; а совпавший адрес не
--  доказывает, что это тот же сервер — за одним адресом сидит сколько
--  угодно чужих машин. Поэтому у runtime собственный секрет, выданный
--  один раз при привязке, и опознаётся он по нему.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_runtimes (
  id              TEXT PRIMARY KEY,
  bot_id          TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,

  -- Секрет хранится хешем (scrypt, как пароли). В базе его нет в
  -- открытом виде, показать его повторно нельзя — только перепривязать.
  secret_hash     TEXT NOT NULL,

  -- Как эта программа получает события:
  -- 'poll'    — сама приходит за ними (работает за NAT, порт не нужен);
  -- 'webhook' — Sky стучится к ней сам, по HTTPS с подписью.
  delivery        TEXT NOT NULL DEFAULT 'poll',
  webhook_url     TEXT,
  -- Ключ подписи вебхука. Показывается программе один раз при привязке.
  webhook_secret  TEXT,

  label           TEXT NOT NULL DEFAULT '',
  runtime_version TEXT,
  sdk             TEXT,

  -- Живость. Статус на экране считается отсюда, а не из поля «активен»,
  -- которое кто-то выставил руками.
  connected_at    TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ,
  last_error      TEXT,
  last_error_at   TIMESTAMPTZ,
  events_sent     BIGINT NOT NULL DEFAULT 0,
  actions_done    BIGINT NOT NULL DEFAULT 0,

  -- Отвязанный runtime остаётся строкой ради журнала, но его секрет
  -- перестаёт подходить в ту же секунду.
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bot_runtimes_delivery_chk CHECK (delivery IN ('poll', 'webhook'))
);

CREATE INDEX IF NOT EXISTS bot_runtimes_bot_idx ON bot_runtimes (bot_id)
  WHERE revoked_at IS NULL;

-- ============================================================
--  Код привязки
--
--  Одноразовый, короткоживущий, привязан к одному боту. В базе лежит
--  хешем: утёкший дамп не должен давать возможности привязать чужой
--  сервер к чужому боту.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_pairings (
  code_hash   TEXT PRIMARY KEY,
  bot_id      TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- Владелец на момент выпуска кода. Если бота успели передать другому,
  -- старый код не сработает.
  owner_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  runtime_id  TEXT REFERENCES bot_runtimes(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_pairings_bot_idx ON bot_pairings (bot_id, created_at DESC);

-- ============================================================
--  Очередь событий для runtime
--
--  Событие складывается сюда и живёт до подтверждения. Программа
--  владельца может быть выключена час — события дождутся её. Потолок
--  очереди и срок хранения не дают ей расти бесконечно.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_events (
  id           BIGSERIAL PRIMARY KEY,
  bot_id       TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  chat_id      TEXT,
  -- Тело события: текст сообщения, имя отправителя. Содержимое
  -- переписки, поэтому зашифровано, как и сами сообщения.
  payload      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Взято на доставку (выдано программе), но ещё не подтверждено.
  taken_at     TIMESTAMPTZ,
  taken_by     TEXT,
  acked_at     TIMESTAMPTZ,
  attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS bot_events_queue_idx
  ON bot_events (bot_id, id) WHERE acked_at IS NULL;
CREATE INDEX IF NOT EXISTS bot_events_age_idx ON bot_events (created_at);

-- ============================================================
--  Журнал бота
--
--  То, что владелец видит на вкладке «Логи»: подключения, отключения,
--  отказы API, доставка вебхуков, подозрительные попытки. Секретов
--  здесь нет и быть не может — см. server/bots.mjs.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_log (
  id         BIGSERIAL PRIMARY KEY,
  bot_id     TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  level      TEXT NOT NULL DEFAULT 'info',
  event      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bot_log_level_chk CHECK (level IN ('info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS bot_log_bot_idx ON bot_log (bot_id, id DESC);

-- ============================================================
--  Inline: заготовка сообщения, ждущая подтверждения
--
--  Смысл в том, что бот НЕ пишет за человека. Он только предлагает
--  текст; строка живёт минуту и превращается в сообщение лишь после
--  того, как человек нажал «Отправить» в своём же сеансе.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_inline_pending (
  id         TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  -- Кому предложено. Подтвердить может только он: чужую заготовку
  -- отправить нельзя.
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- И только в тот чат, где её запросили.
  chat_id    TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bot_inline_pending_user_idx
  ON bot_inline_pending (user_id, created_at DESC);

-- ============================================================
--  Кто начал разговор с ботом — для счётчика в каталоге.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_users (
  bot_id     TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, user_id)
);
