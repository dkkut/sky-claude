-- Sky Film на сервере.
--
-- До этого кино жило целиком в браузере: список фильмов лежал в
-- localStorage, а сам файл — во временной ссылке blob:, которая
-- перестаёт существовать при перезагрузке страницы. Загруженный фильм
-- исчезал вместе с вкладкой, на другом устройстве его не было никогда,
-- и разделить своё и общее было нечем: и «Моё», и «Опубликовать»
-- писали в один и тот же список.
--
-- Здесь появляется то, без чего личная коллекция невозможна: у каждого
-- фильма есть владелец и состояние, и решает по ним сервер.

CREATE TABLE IF NOT EXISTS film_movies (
  id            TEXT PRIMARY KEY,
  -- Владелец. Если профиль удалён, ссылка обнуляется: опубликованное
  -- кино остаётся в каталоге, а личное — с owner_id IS NULL и статусом
  -- 'private' — перестаёт совпадать с кем бы то ни было и становится
  -- невидимым для всех. Такие строки вместе с файлами убирает уборка
  -- (sweepOrphanFilms), чтобы они не занимали диск вечно.
  owner_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,

  title         TEXT NOT NULL,
  -- Описание — сочинение владельца, поэтому лежит зашифрованным.
  -- Название и категория не шифруются: по ним идёт поиск.
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'Другое',
  genre         TEXT NOT NULL DEFAULT '',
  year          INT,
  country       TEXT NOT NULL DEFAULT '',
  director      TEXT NOT NULL DEFAULT '',
  age_rating    TEXT NOT NULL DEFAULT '',

  duration_sec  INT    NOT NULL DEFAULT 0,
  mime          TEXT   NOT NULL,
  bytes         BIGINT NOT NULL DEFAULT 0,

  -- Постер лежит на диске рядом с фильмом, под своим идентификатором.
  -- Ни имени от загрузившего, ни пути в базе нет: путь собирает сервер.
  has_poster    BOOLEAN NOT NULL DEFAULT FALSE,
  poster_mime   TEXT,

  -- Главное поле модуля.
  --   'private'   — личная коллекция: видит только владелец;
  --   'pending'   — владелец попросил проверку перед публикацией;
  --   'published' — общий каталог, видят все;
  --   'rejected'  — проверка отказала, фильм снова только у владельца.
  -- Новый фильм всегда заводится как 'private': публикации «само собой»
  -- не бывает, её каждый раз просит владелец и подтверждает проверка.
  status        TEXT NOT NULL DEFAULT 'private'
                CHECK (status IN ('private','pending','published','rejected')),

  -- Только для общего каталога: под какой лицензией выложено и какие
  -- пометки поставил загрузивший.
  license          TEXT CHECK (license IN ('open','personal')),
  explicit         BOOLEAN NOT NULL DEFAULT FALSE,
  age_restricted18 BOOLEAN NOT NULL DEFAULT FALSE,
  is_short         BOOLEAN NOT NULL DEFAULT FALSE,

  views         BIGINT NOT NULL DEFAULT 0,

  submitted_at  TIMESTAMPTZ,
  moderated_at  TIMESTAMPTZ,
  moderated_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reject_reason TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Личная коллекция человека — это выборка по владельцу, и она должна
-- быть быстрой: её открывают чаще каталога.
CREATE INDEX IF NOT EXISTS film_movies_owner_idx    ON film_movies (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS film_movies_status_idx   ON film_movies (status, created_at DESC);
CREATE INDEX IF NOT EXISTS film_movies_title_idx    ON film_movies (lower(title));
CREATE INDEX IF NOT EXISTS film_movies_category_idx ON film_movies (lower(category));

-- Закладки. Раньше они жили в useState и пропадали при закрытии
-- вкладки; теперь это своя строка на человека и фильм.
CREATE TABLE IF NOT EXISTS film_saved (
  user_id    TEXT NOT NULL REFERENCES profiles(id)    ON DELETE CASCADE,
  movie_id   TEXT NOT NULL REFERENCES film_movies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
CREATE INDEX IF NOT EXISTS film_saved_user_idx ON film_saved (user_id, created_at DESC);

-- На чём человек остановился. Одна строка на фильм: продолжают с
-- последнего места. Она же даёт синхронизацию устройств — телефон и
-- телевизор читают одну и ту же позицию с сервера.
CREATE TABLE IF NOT EXISTS film_progress (
  user_id      TEXT NOT NULL REFERENCES profiles(id)    ON DELETE CASCADE,
  movie_id     TEXT NOT NULL REFERENCES film_movies(id) ON DELETE CASCADE,
  position_sec INT  NOT NULL DEFAULT 0,
  -- Длительность нужна, чтобы показать «досмотрено» и полосу прогресса
  -- в списке, не открывая сам файл.
  duration_sec INT  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
CREATE INDEX IF NOT EXISTS film_progress_user_idx ON film_progress (user_id, updated_at DESC);

-- Оценка зрителя. Звёздочка на постере раньше была выдуманным числом
-- из образца данных; теперь это среднее по настоящим оценкам живых
-- людей, и одна оценка на человека — повторная заменяет прежнюю.
CREATE TABLE IF NOT EXISTS film_ratings (
  user_id    TEXT NOT NULL REFERENCES profiles(id)    ON DELETE CASCADE,
  movie_id   TEXT NOT NULL REFERENCES film_movies(id) ON DELETE CASCADE,
  score      INT  NOT NULL CHECK (score BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);
CREATE INDEX IF NOT EXISTS film_ratings_movie_idx ON film_ratings (movie_id);
