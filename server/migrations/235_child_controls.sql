-- Детский аккаунт: чаты, закрытые из-за запрещённых слов (слова задаёт опекун в child_accounts.settings.words).
CREATE TABLE IF NOT EXISTS child_blocked_peers (
  child_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  peer_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  word       TEXT NOT NULL DEFAULT '',        -- сработавшее слово из списка опекуна (текст сообщения не хранится)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, peer_id)
);
