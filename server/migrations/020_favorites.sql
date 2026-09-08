-- ============================================================
--  Избранные сообщения.
--
--  Звёздочка ставилась в памяти браузера, а снимок с сервера при каждом
--  подключении заменял сообщения целиком — вместе с ней. То есть
--  «Избранное» терялось не только на другом устройстве, а просто после
--  перезагрузки страницы.
--
--  Избранное своё у каждого: это выбор человека, а не свойство
--  сообщения.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_favorites (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_favorites_user_idx ON message_favorites (user_id, created_at DESC);
