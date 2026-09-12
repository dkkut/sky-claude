-- Sky Podcasts на сервере.
--
-- До этого подкасты были показом без вещества: четыре передачи и восемь
-- выпусков записаны прямо в коде экрана, а «воспроизведение» —
-- setInterval, раз в секунду прибавлявший число к счётчику. Элемента
-- <audio> в модуле не существовало вовсе; полоса двигалась, звука не
-- было. Подписки, отметки и позиция жили в состоянии компонента и
-- пропадали при уходе с экрана.
--
-- Разделение здесь такое же, как в кино: подкаст и выпуск — открытые
-- вещи, файл — закрытая. Путь к файлу в базе не хранится: он собирается
-- сервером из идентификатора, поэтому через него нельзя выйти из
-- каталога.

CREATE TABLE IF NOT EXISTS podcasts (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  -- Описание — сочинение автора, поэтому лежит зашифрованным. Название
  -- и категория не шифруются: по ним идёт поиск.
  description  TEXT,
  category     TEXT NOT NULL DEFAULT 'Другое',
  language     TEXT NOT NULL DEFAULT 'ru',
  -- Цвет и знак нужны, пока нет обложки: пустая серая карточка выглядит
  -- поломкой, а не «обложка ещё не загружена».
  accent       TEXT NOT NULL DEFAULT '#a855f7',
  has_cover    BOOLEAN NOT NULL DEFAULT FALSE,
  cover_mime   TEXT,
  -- 'private' — только автору, 'pending' ждёт проверки,
  -- 'published' виден всем, 'rejected' отклонён.
  status       TEXT NOT NULL DEFAULT 'private'
               CHECK (status IN ('private','pending','published','rejected')),
  explicit     BOOLEAN NOT NULL DEFAULT FALSE,
  reject_reason TEXT,
  submitted_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS podcasts_owner_idx  ON podcasts (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS podcasts_status_idx ON podcasts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS podcasts_title_idx  ON podcasts (lower(title));

-- Ведущие. Отдельной таблицей, потому что у передачи их бывает
-- несколько, и это обычное дело, а не редкость.
CREATE TABLE IF NOT EXISTS podcast_hosts (
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  -- Имя хранится строкой: ведущий может не быть человеком с профилем в
  -- Sky, и требовать этого незачем.
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'Ведущий',
  position   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (podcast_id, name)
);
CREATE INDEX IF NOT EXISTS podcast_hosts_idx ON podcast_hosts (podcast_id, position);

CREATE TABLE IF NOT EXISTS podcast_episodes (
  id           TEXT PRIMARY KEY,
  podcast_id   TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  number       INT,
  title        TEXT NOT NULL,
  description  TEXT,
  duration_sec INT  NOT NULL DEFAULT 0,

  -- Выпуск бывает только звуковой, только видео или тем и другим сразу.
  -- Поэтому два набора полей, а не один: наличие файла — это и есть
  -- ответ на вопрос, что человеку предложить.
  audio_mime   TEXT,
  audio_bytes  BIGINT NOT NULL DEFAULT 0,
  video_mime   TEXT,
  video_bytes  BIGINT NOT NULL DEFAULT 0,
  video_width  INT NOT NULL DEFAULT 0,
  video_height INT NOT NULL DEFAULT 0,

  has_cover    BOOLEAN NOT NULL DEFAULT FALSE,
  cover_mime   TEXT,
  explicit     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Выпуск наследует состояние передачи, но может быть придержан
  -- отдельно: черновик в опубликованной передаче — обычное дело.
  published    BOOLEAN NOT NULL DEFAULT FALSE,
  plays        BIGINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS podcast_episodes_show_idx ON podcast_episodes (podcast_id, created_at DESC);
CREATE INDEX IF NOT EXISTS podcast_episodes_title_idx ON podcast_episodes (lower(title));

-- Главы выпуска. Заполняются автором или разбором транскрипта;
-- выдумывать их нельзя.
CREATE TABLE IF NOT EXISTS podcast_chapters (
  episode_id TEXT NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
  starts_sec INT  NOT NULL,
  title      TEXT NOT NULL,
  PRIMARY KEY (episode_id, starts_sec)
);

-- Транскрипт: строка на реплику. Хранить его целым куском текста
-- нельзя — тогда ни подсветить текущую фразу, ни перейти по нажатию.
CREATE TABLE IF NOT EXISTS podcast_cues (
  episode_id TEXT NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
  idx        INT  NOT NULL,
  starts_sec NUMERIC(10,3) NOT NULL,
  ends_sec   NUMERIC(10,3) NOT NULL,
  -- Речь людей — содержимое, и лежит зашифрованной, как переписка.
  text_enc   TEXT NOT NULL,
  speaker    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (episode_id, idx)
);
CREATE INDEX IF NOT EXISTS podcast_cues_time_idx ON podcast_cues (episode_id, starts_sec);

-- На чём человек остановился. Одна строка на выпуск: продолжают с
-- последнего места, а не со всех сразу. Она же даёт синхронизацию
-- устройств — телефон и компьютер читают одну и ту же позицию.
CREATE TABLE IF NOT EXISTS podcast_progress (
  user_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id   TEXT NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
  position_sec INT  NOT NULL DEFAULT 0,
  duration_sec INT  NOT NULL DEFAULT 0,
  completed    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id)
);
CREATE INDEX IF NOT EXISTS podcast_progress_user_idx ON podcast_progress (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS podcast_subscriptions (
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, podcast_id)
);
CREATE INDEX IF NOT EXISTS podcast_subs_user_idx ON podcast_subscriptions (user_id, created_at DESC);

-- Избранное отдельно от подписки: подписка — «следить за новым»,
-- избранное — «вернуться к этому». Смешивать их значит терять одно.
CREATE TABLE IF NOT EXISTS podcast_favorites (
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  podcast_id TEXT REFERENCES podcasts(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES podcast_episodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ровно одно из двух: либо передача, либо выпуск.
  CHECK ((podcast_id IS NULL) <> (episode_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS podcast_fav_show_idx
  ON podcast_favorites (user_id, podcast_id) WHERE podcast_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS podcast_fav_ep_idx
  ON podcast_favorites (user_id, episode_id) WHERE episode_id IS NOT NULL;

/*
 * Пересказ, сделанный ИИ.
 *
 * Лежит в базе и переиспользуется: пересказ одного и того же выпуска не
 * меняется, а каждое обращение к языковой модели стоит денег и времени.
 * Без этой таблицы открытие выпуска десятью людьми означало бы десять
 * одинаковых обращений.
 *
 * Привязан к выпуску, а не к человеку: содержание выпуска одинаково для
 * всех, и делать «свой пересказ каждому» — значит платить за одно и то
 * же много раз.
 */
CREATE TABLE IF NOT EXISTS podcast_summaries (
  episode_id  TEXT PRIMARY KEY REFERENCES podcast_episodes(id) ON DELETE CASCADE,
  -- Разобранный пересказ по разделам. Шифруется: это производная от
  -- содержимого выпуска, и хранить её открытой незачем.
  body_enc    TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '',
  -- По какому транскрипту сделан: если транскрипт заменили, пересказ
  -- устарел и его надо делать заново.
  cue_count   INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- История прослушивания. Отдельно от прогресса: прогресс отвечает «где
-- я остановился», история — «что я слушал». Держим последние двести.
CREATE TABLE IF NOT EXISTS podcast_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS podcast_history_user_idx ON podcast_history (user_id, played_at DESC);
