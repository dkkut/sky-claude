-- ============================================================
--  Закрепление, архив и звук — на сервере, а не в браузере.
--
--  Эти пометки хранились в localStorage каждого устройства. Пока меню
--  чата было спрятано под правой кнопкой, расхождение мало кто замечал.
--  Теперь «Архив» — отдельный сегмент списка, и чат, убранный в архив с
--  телефона, оставался на месте на компьютере.
--
--  Пометки принадлежат участнику, а не чату: у каждого свои.
-- ============================================================

ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS pinned   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS muted    BOOLEAN NOT NULL DEFAULT FALSE;
