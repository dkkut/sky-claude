-- Удаление чата у обоих с восстановлением в течение 30 дней.
-- Чат остаётся в базе целиком (участники, сообщения, вложения), но скрыт
-- у всех; по истечении срока его окончательно убирает уборка в signal.mjs.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS trashed_by TEXT;
CREATE INDEX IF NOT EXISTS chats_trashed_idx ON chats (trashed_at) WHERE trashed_at IS NOT NULL;
