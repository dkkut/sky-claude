-- ============================================================
--  Поддержка: обращения и переписка по ним.
--
--  Обратная связь и жалобы до сих пор записывались в localStorage того,
--  кто жаловался: их не видел никто и никогда.
--
--  Обращение — не чат из мессенджера, а тикет: у него есть состояние,
--  один ответственный и история передач. Поэтому отдельные таблицы, а
--  не переиспользование чатов.
--
--  Важное: обращения работают по HTTP, а не через хаб мессенджера.
--  Забаненного в хаб не пускают, а обжаловать блокировку он должен
--  иметь возможность.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Тема — пользовательский текст, поэтому хранится зашифрованной.
  subject     TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'question'
              CHECK (kind IN ('question', 'bug', 'idea', 'report', 'appeal')),
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'waiting', 'closed')),
  -- Ответственный: ровно один, но его можно передать другому.
  assignee_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS support_tickets_author_idx ON support_tickets (author_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_queue_idx  ON support_tickets (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  -- Со стороны поддержки или от обратившегося: по этому рисуется, кто
  -- где, и не нужно на каждое сообщение спрашивать права автора.
  from_staff BOOLEAN NOT NULL DEFAULT FALSE,
  body       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages (ticket_id, created_at);

-- ── История тикета ──────────────────────────────────────────
--  Кто взял, кто передал, кто закрыл. Без этого разобраться, почему
--  обращение висит неделю, невозможно.
CREATE TABLE IF NOT EXISTS support_events (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_events_ticket_idx ON support_events (ticket_id, created_at);
