-- Проверка треков перед публикацией.
--
-- До этого любой человек публиковал что угодно в общий каталог сам:
-- нажал «Опубликовать» — и запись видна всем. За то, что лежит в
-- каталоге, отвечает владелец сервиса, поэтому публикация теперь идёт
-- через проверку: владелец отправляет трек, администратор принимает
-- или отклоняет с причиной.
--
-- Сами состояния ('pending', 'rejected') в таблице были с самого
-- начала — не хватало отметок о том, кто и когда решал.

ALTER TABLE music_tracks
  ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  -- Причина отказа — текст человека, поэтому хранится зашифрованной,
  -- как и остальной пользовательский текст.
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- Очередь разбирается по возрасту заявки, а не по дате загрузки.
CREATE INDEX IF NOT EXISTS music_tracks_pending_idx
  ON music_tracks (submitted_at)
  WHERE status = 'pending';
