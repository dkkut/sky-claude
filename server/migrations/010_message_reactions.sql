-- ============================================================
--  Реакции на сообщения.
--
--  До этой миграции реакция существовала только в браузере: она
--  рассылалась по сокету и терялась при перезагрузке страницы, а
--  второе устройство того же человека её вообще не видело.
--
--  Ключ — тройка «сообщение, человек, эмодзи»: одну и ту же реакцию
--  нельзя поставить дважды, а разные эмодзи от одного человека
--  живут независимо.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Основной запрос — «все реакции сообщений чата», отсюда индекс.
CREATE INDEX IF NOT EXISTS message_reactions_message_idx
  ON message_reactions (message_id);
