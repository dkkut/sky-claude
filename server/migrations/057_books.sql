-- Sky Books на сервере.
--
-- До этого книги были восемью карточками, зашитыми прямо в экран:
-- выдуманные рейтинги, выдуманные цены, «плеер» с неподвижной
-- полосой на четверть и тегом <audio> без единого src. Кнопка
-- «Купить» не имела обработчика вовсе.
--
-- Здесь книга — это автор (профиль), метаданные и главы. У каждой
-- главы бывает текст для чтения и/или отдельная озвучка для
-- прослушивания — то и другое не обязано совпадать по наличию, но
-- совпадает по номеру главы, и это то, что единый плеер использует
-- для переключения «читать» / «слушать» на одном и том же месте.
--
-- Файл озвучки на диске, как и everywhere в проекте: путь в базе не
-- хранится, он собирается сервером из идентификатора главы.

CREATE TABLE IF NOT EXISTS books (
  id            TEXT PRIMARY KEY,
  author_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'Другое',
  genre         TEXT,
  language      TEXT NOT NULL DEFAULT 'ru',
  accent        TEXT NOT NULL DEFAULT '#f59e0b',
  has_cover     BOOLEAN NOT NULL DEFAULT FALSE,
  cover_mime    TEXT,
  -- 'private' — только автору, 'pending' ждёт проверки,
  -- 'published' виден всем, 'rejected' отклонён.
  status        TEXT NOT NULL DEFAULT 'private'
                CHECK (status IN ('private','pending','published','rejected')),
  explicit      BOOLEAN NOT NULL DEFAULT FALSE,
  reject_reason TEXT,
  submitted_at  TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  chapters_count INT NOT NULL DEFAULT 0,
  words_count    INT NOT NULL DEFAULT 0,
  audio_seconds  INT NOT NULL DEFAULT 0,
  reads_count    INT NOT NULL DEFAULT 0,
  listens_count  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS books_author_idx ON books (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS books_status_idx ON books (status, created_at DESC);
CREATE INDEX IF NOT EXISTS books_title_idx  ON books (lower(title));

-- Главы. Текст лежит прямо в строке (шифрованный слоем данных, как
-- описание подкаста) — книга не весит как видео, отдельное хранилище
-- под текст было бы лишней сущностью. Озвучка — наоборот, файл: та же
-- причина, что у любого аудио в проекте.
CREATE TABLE IF NOT EXISTS book_chapters (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  number        INT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  content       TEXT,
  word_count    INT NOT NULL DEFAULT 0,
  has_audio     BOOLEAN NOT NULL DEFAULT FALSE,
  audio_seconds INT NOT NULL DEFAULT 0,
  audio_mime    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, number)
);
CREATE INDEX IF NOT EXISTS book_chapters_book_idx ON book_chapters (book_id, number);

-- Позиция — своя строка на пару (книга, человек). Единый плеер хранит
-- в ней оба вида прогресса разом: где остановилось чтение и где
-- остановилось прослушивание, плюс то, каким видом человек занимался
-- последним — экран открывает именно его.
CREATE TABLE IF NOT EXISTS book_progress (
  book_id        TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_mode      TEXT NOT NULL DEFAULT 'text' CHECK (last_mode IN ('text','audio')),
  text_chapter   INT NOT NULL DEFAULT 1,
  text_offset    INT NOT NULL DEFAULT 0,
  audio_chapter  INT NOT NULL DEFAULT 1,
  audio_position NUMERIC NOT NULL DEFAULT 0,
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS book_progress_user_idx ON book_progress (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS book_shelf (
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS book_shelf_user_idx ON book_shelf (user_id, created_at DESC);
