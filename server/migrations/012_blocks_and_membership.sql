-- ============================================================
--  Блокировки и выход из чата.
--
--  «Заблокировать» до этой миграции работало только в браузере: сервер
--  о запрете не знал и сообщения доставлял по-прежнему. Выйти из чата
--  было нельзя вовсе — начатую кем-то переписку нельзя было закрыть.
-- ============================================================

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  -- Заблокировать себя бессмысленно и ломает выборки.
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);

-- Кто создал чат, тот им и владеет: нужно, чтобы отличать «выйти» от
-- «распустить». Колонка уже есть в chats (owner_id), отдельного поля
-- не заводим.

-- Роль участника: пока различаем только владельца и обычного, но
-- колонка нужна сразу — добавлять её к живой таблице участников позже
-- дороже, чем завести сейчас.
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_members_role_check') THEN
    ALTER TABLE chat_members ADD CONSTRAINT chat_members_role_check
      CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
END
$roles$;

-- Создателю чата — роль владельца.
UPDATE chat_members m SET role = 'owner'
  FROM chats c
 WHERE c.id = m.chat_id AND c.owner_id = m.user_id AND m.role <> 'owner';
