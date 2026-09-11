-- Sky TV на сервере.
--
-- До этого телевидение жило целиком в браузере: двенадцать каналов
-- были записаны прямо в коде экрана, а «просмотр» означал вставленный
-- в страницу чужой проигрыватель с чужого сайта. Ни выбрать источник,
-- ни закрыть канал, ни узнать, работает ли он, было нельзя — сервер о
-- телевидении не знал вообще ничего.
--
-- Ключевое разделение здесь — канал и источник.
--
--   Канал — то, что видит человек: название, логотип, раздел. Это
--   открытые сведения, они уходят клиенту.
--
--   Источник — то, откуда берётся эфир: адрес, заголовки, ключи,
--   условия доступа. Это никогда не уходит клиенту. Ни одного поля из
--   tv_sources нет в том, что отдают ручки каталога.
--
-- Источник заводит владелец сервиса, и только он. Клиент не может
-- прислать адрес потока ни в каком виде: такого параметра нет ни в
-- одной ручке. Именно поэтому подставить сюда чужой или внутренний
-- адрес нельзя — не потому, что мы это отфильтровываем, а потому, что
-- принимать такое неоткуда.

CREATE TABLE IF NOT EXISTS tv_channels (
  id            TEXT PRIMARY KEY,
  -- Короткое имя для команд на сервере: «1tv», «россия-1». По нему
  -- владелец подключает источник, не выискивая длинный идентификатор.
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'Разное',
  country       TEXT NOT NULL DEFAULT 'RU',
  region        TEXT NOT NULL DEFAULT '',
  -- Цвет и буквенный знак нужны, пока нет настоящего логотипа: пустая
  -- серая карточка выглядит поломкой, а не «логотип ещё не загружен».
  accent        TEXT NOT NULL DEFAULT '#4f6ef7',
  mark          TEXT NOT NULL DEFAULT '',
  has_logo      BOOLEAN NOT NULL DEFAULT FALSE,
  logo_mime     TEXT,
  -- Возрастное ограничение канала, если оно объявлено вещателем.
  age_rating    TEXT NOT NULL DEFAULT '',
  -- Порядок в каталоге: у телевидения он привычно свой, а не по алфавиту.
  position      INT  NOT NULL DEFAULT 1000,
  -- Канал заведён, но показывать его в каталоге пока не надо.
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tv_channels_order_idx ON tv_channels (position, name);
CREATE INDEX IF NOT EXISTS tv_channels_cat_idx   ON tv_channels (category, position);

-- Источник эфира.
--
-- Отдельная таблица, а не колонки в канале, по двум причинам. Во-первых,
-- у канала со временем бывает несколько источников — запасной, другой
-- формат, другой регион. Во-вторых, права на чтение у них разные:
-- каналы читает кто угодно вошедший, источники — никто, кроме самого
-- сервера.
CREATE TABLE IF NOT EXISTS tv_sources (
  id            TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
  -- 'hls' — привычный для эфира формат; 'dash' — второй распространённый.
  kind          TEXT NOT NULL DEFAULT 'hls' CHECK (kind IN ('hls','dash')),
  -- Адрес манифеста. Шифруется: это то самое, что не должно утечь ни
  -- в ответе, ни в резервной копии базы, попавшей не туда.
  url_enc       TEXT NOT NULL,
  -- Заголовки, которые требует источник (ключ доступа, подпись,
  -- «откуда пришёл запрос»). Тоже шифруются и тоже никогда не уходят
  -- клиенту — их подставляет сервер, когда сам идёт за манифестом.
  headers_enc   TEXT,
  -- Как отдавать куски эфира зрителю:
  --   'redirect' — перенаправить браузер прямо на сеть доставки
  --                источника. Байты идут мимо нас: ни память, ни канал
  --                сервера на них не тратятся. Годится, когда адреса
  --                кусков сами по себе не секрет;
  --   'proxy'    — вести куски через себя потоком, не собирая в память.
  --                Нужно, когда источник отвечает только нам — по
  --                ключу или по адресу.
  delivery      TEXT NOT NULL DEFAULT 'redirect' CHECK (delivery IN ('redirect','proxy')),
  -- Официальное происхождение: чьё это вещание и на каком основании мы
  -- его показываем. Заполняет владелец. Поле обязательное по смыслу:
  -- источник без ответа на этот вопрос подключать нельзя.
  licence       TEXT NOT NULL DEFAULT '',
  -- Действует ли. Неисправный источник гасится проверкой здоровья, а
  -- не удаляется: чинить проще, чем заводить заново.
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  priority      INT  NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tv_sources_channel_idx ON tv_sources (channel_id, active, priority);

-- Что показала последняя проверка источника. Отдельно от самого
-- источника: это меняется каждые несколько минут, а источник — раз в
-- год, и мешать их в одной строке значит переписывать её без нужды.
CREATE TABLE IF NOT EXISTS tv_source_health (
  source_id     TEXT PRIMARY KEY REFERENCES tv_sources(id) ON DELETE CASCADE,
  ok            BOOLEAN NOT NULL DEFAULT FALSE,
  status_code   INT,
  -- Короткий разбор для владельца: «истёк ключ», «отвечает не тем».
  -- Наружу не уходит никогда.
  detail        TEXT,
  latency_ms    INT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  failures      INT NOT NULL DEFAULT 0
);

-- Избранные каналы. Строго свои: ключ включает профиль, и он берётся
-- из сессии, а не из запроса.
CREATE TABLE IF NOT EXISTS tv_favorites (
  user_id    TEXT NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS tv_favorites_user_idx ON tv_favorites (user_id, created_at DESC);

-- «Недавно смотрели». Одна строка на канал: нужен последний раз, а не
-- журнал всех включений. Лишнего здесь нет намеренно — ни устройства,
-- ни адреса, ни длительности: для «вернуться к тому, что смотрел» они
-- не нужны, а храниться будут вечно.
CREATE TABLE IF NOT EXISTS tv_recent (
  user_id    TEXT NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS tv_recent_user_idx ON tv_recent (user_id, watched_at DESC);

-- Телепрограмма. Заполняется только из источника, который её отдаёт;
-- выдумывать передачи нельзя — расписание, которого не было, хуже
-- пустого экрана.
CREATE TABLE IF NOT EXISTS tv_epg (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT '',
  age_rating  TEXT NOT NULL DEFAULT '',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Одна передача на канал и время начала: повторная загрузка расписания
-- должна обновлять, а не удваивать.
CREATE UNIQUE INDEX IF NOT EXISTS tv_epg_slot_idx ON tv_epg (channel_id, starts_at);
CREATE INDEX IF NOT EXISTS tv_epg_window_idx ON tv_epg (channel_id, starts_at, ends_at);

-- Откуда брать телепрограмму. Отдельно от источника эфира: расписание
-- часто отдаёт не тот, кто вещает.
CREATE TABLE IF NOT EXISTS tv_epg_sources (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES tv_channels(id) ON DELETE CASCADE,
  url_enc     TEXT NOT NULL,
  headers_enc TEXT,
  -- 'xmltv' — общепринятый формат выгрузки расписания;
  -- 'json'  — собственный формат вещателя, разбирается по настройке.
  format      TEXT NOT NULL DEFAULT 'xmltv' CHECK (format IN ('xmltv','json')),
  licence     TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  fetched_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tv_epg_sources_channel_idx ON tv_epg_sources (channel_id, active);
