-- Короткое кино.
--
-- Признак is_short в таблице уже был, но проставить его было некому:
-- загрузка о нём не спрашивала, и в вертикальную ленту попадало только
-- то, что случайно оказалось помечено. Чтобы признак имел смысл, нужно
-- знать, какой у фильма кадр: короткометражка — это вертикальное и
-- недлинное видео, а не просто «короткое».

ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS width  INT NOT NULL DEFAULT 0;
ALTER TABLE film_movies ADD COLUMN IF NOT EXISTS height INT NOT NULL DEFAULT 0;

-- Лента короткого кино — отдельная выборка, и она открывается чаще
-- каталога: там листают, а не выбирают. Частичный индекс покрывает
-- ровно её и не растёт на всём остальном кино.
CREATE INDEX IF NOT EXISTS film_movies_shorts_idx
  ON film_movies (created_at DESC)
  WHERE is_short AND status = 'published';
