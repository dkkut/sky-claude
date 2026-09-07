-- ============================================================
--  Разделение групп и каналов.
--
--  До этой миграции группа и канал отличались только словом в колонке
--  type: писать могли все, права никто не проверял, а настройки группы
--  (антифлуд, приветствие, заявки на вступление) жили в браузере и на
--  сервере не значили ничего.
--
--  Теперь:
--    • группа — общий разговор с ролями и правами;
--    • канал  — вещание: пишут только владелец и админы, остальные
--      читают, и у записей считаются просмотры.
-- ============================================================

-- ── Роли ────────────────────────────────────────────────────
--  Набор тот же, что показывает интерфейс. Права выводятся из роли на
--  сервере — в браузере они только рисуются.
DO $roles$
BEGIN
  ALTER TABLE chat_members DROP CONSTRAINT IF EXISTS chat_members_role_check;
  ALTER TABLE chat_members ADD CONSTRAINT chat_members_role_check
    CHECK (role IN ('owner', 'admin', 'moderator', 'helper', 'member'));
END
$roles$;

-- ── Настройки чата ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id            TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,

  -- Кто вправе писать. У канала всегда 'admins' — это и делает его
  -- каналом; у группы выбирает владелец.
  who_can_post       TEXT    NOT NULL DEFAULT 'all' CHECK (who_can_post IN ('all', 'admins')),

  welcome_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Текст приветствия — часть переписки, поэтому хранится зашифрованным.
  welcome_message    TEXT    NOT NULL DEFAULT '',

  -- Вступление по заявке вместо мгновенного входа по ссылке.
  require_approval   BOOLEAN NOT NULL DEFAULT FALSE,
  join_question      TEXT    NOT NULL DEFAULT '',

  -- Антифлуд: сколько сообщений в минуту разрешено обычному участнику.
  anti_flood         BOOLEAN NOT NULL DEFAULT TRUE,
  anti_flood_per_min INT     NOT NULL DEFAULT 20 CHECK (anti_flood_per_min BETWEEN 1 AND 240),

  -- Ссылки от тех, у кого нет роли, не пропускаются.
  anti_spam_links    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Медленный режим: пауза между сообщениями одного участника, секунды.
  slow_mode_sec      INT     NOT NULL DEFAULT 0 CHECK (slow_mode_sec BETWEEN 0 AND 3600),

  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Ссылки-приглашения ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_invites (
  code       TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id)    ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  max_uses   INT,
  uses       INT  NOT NULL DEFAULT 0,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_invites_chat_idx ON chat_invites (chat_id, created_at DESC);

-- ── Заявки на вступление ────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_join_requests (
  chat_id    TEXT NOT NULL REFERENCES chats(id)    ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Ответ на вопрос при вступлении — тоже пользовательский текст.
  answer     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_join_pending_idx
  ON chat_join_requests (chat_id) WHERE status = 'pending';

-- ── Исключённые ─────────────────────────────────────────────
--  Выгнанный может вернуться по ссылке, забаненный — нет.
CREATE TABLE IF NOT EXISTS chat_bans (
  chat_id    TEXT NOT NULL REFERENCES chats(id)    ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  by_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  -- NULL значит «навсегда».
  until      TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- ── Ограничение права писать (мут) ──────────────────────────
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- ── Журнал действий ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_log (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id)    ON DELETE CASCADE,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  target_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  -- Подробность действия; составляется сервером, но может содержать
  -- имена и названия, поэтому хранится зашифрованной.
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_log_chat_idx ON chat_log (chat_id, created_at DESC);

-- ── Просмотры записей канала ────────────────────────────────
--  Считаем уникальных читателей, а не открытия: иначе счётчик накручивается
--  простым обновлением страницы.
CREATE TABLE IF NOT EXISTS message_views (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- ── Закрепление сообщений ───────────────────────────────────
--  Закреплённое видно всем участникам, поэтому это свойство сообщения
--  на сервере, а не пометка в браузере закрепившего.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_by TEXT REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_pinned_idx
  ON messages (chat_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;

-- ── Настройки для уже существующих чатов ────────────────────
INSERT INTO chat_settings (chat_id, who_can_post)
SELECT c.id, CASE WHEN c.type = 'channel' THEN 'admins' ELSE 'all' END
  FROM chats c
 WHERE c.type <> 'direct'
   AND NOT EXISTS (SELECT 1 FROM chat_settings s WHERE s.chat_id = c.id);
