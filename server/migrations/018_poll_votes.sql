-- ============================================================
--  Голоса в опросах.
--
--  Опросы рисовались, но не работали: голос никуда не уходил и
--  существовал только в памяти той вкладки, где нажали. Другие
--  участники его не видели, и после перерисовки он пропадал у самого
--  голосовавшего.
--
--  Голос — это выбор человека в конкретном сообщении. Один и тот же
--  вариант дважды не засчитывается: за это отвечает первичный ключ.
-- ============================================================

CREATE TABLE IF NOT EXISTS poll_votes (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, option_id)
);

CREATE INDEX IF NOT EXISTS poll_votes_message_idx ON poll_votes (message_id);
