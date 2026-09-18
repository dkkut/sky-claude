-- ============================================================
--  Sky Video / Studio — с нуля, на сервере
-- ============================================================
--
-- До этой миграции Studio не существовало вообще: ролики,
-- статистика, «выручка» и даже кнопка «Вывести» жили только в
-- localStorage браузера — src/library/BusinessStudio.tsx рисовал
-- график из захардкоженного массива чисел (CHART_VALS), а
-- src/video/store.ts держал сами видео как base64 в localStorage.
-- Ни один из этих экранов ни разу не обращался к серверу: закрыл
-- вкладку — ролик пропал, на другом устройстве его никогда не было,
-- а «доход» и «вывести» не значили ничего ни для кого, кроме
-- собственного браузера того, кто их видел.
--
-- Устройство таблиц то же, что у Sky Film (027_film.sql), потому что
-- задача та же: у ролика есть владелец и состояние, и решает по ним
-- сервер, а не клиент.

CREATE TABLE IF NOT EXISTS sky_videos (
  id            TEXT PRIMARY KEY,
  -- Владелец. Профиль удалён — ссылка гасится, а видео с owner_id IS
  -- NULL и не published его больше никому не показать: ровно как у
  -- фильмов, тем же приёмом.
  owner_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,

  title         TEXT NOT NULL,
  -- Описание — сочинение автора, значит зашифровано. Название и
  -- категория не шифруются: по ним идёт поиск и листинг.
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'Другое',
  -- Теги: список слов через запятую, ограничен по длине на уровне
  -- сервера при записи — не то поле, ради которого заводить отдельную
  -- таблицу и джойны на каждый листинг ленты.
  tags          TEXT NOT NULL DEFAULT '',

  duration_sec  INT    NOT NULL DEFAULT 0,
  mime          TEXT   NOT NULL,
  bytes         BIGINT NOT NULL DEFAULT 0,
  width         INT    NOT NULL DEFAULT 0,
  height        INT    NOT NULL DEFAULT 0,

  -- Обложка — либо кадр, который выбрал сервер при обработке, либо
  -- своя картинка автора. Лежит на диске рядом с роликом под тем же
  -- идентификатором, в базе — только факт наличия и mime.
  has_thumbnail BOOLEAN NOT NULL DEFAULT FALSE,
  thumbnail_mime TEXT,

  -- Приватность — то, что видит зритель, если ролик вообще
  -- опубликован. Отдельно от status: черновик не бывает «публичным»
  -- или «по ссылке», это решается только после публикации.
  privacy       TEXT NOT NULL DEFAULT 'public'
                CHECK (privacy IN ('public','unlisted','private')),

  -- Тот же принцип, что у film_movies.status: ничего не публикуется
  -- само собой.
  --   'draft'     — черновик, виден только владельцу, играть нельзя —
  --                 обработка ещё не закончена или автор не нажал
  --                 «Опубликовать»;
  --   'published' — доступен по правилу privacy;
  --   'hidden'    — автор снял с показа сам, файл и данные целы;
  --   'removed'   — снят модерацией, виден только владельцу с причиной.
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','hidden','removed')),

  removed_reason TEXT,
  removed_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  removed_at     TIMESTAMPTZ,

  views         BIGINT NOT NULL DEFAULT 0,
  likes         BIGINT NOT NULL DEFAULT 0,

  -- Монетизация — независимый статус поверх видео: ролик может быть
  -- опубликован без заявки, с заявкой на рассмотрении, с одобренной
  -- или отклонённой. 'none' — не запрашивалась ни разу.
  monetization_status TEXT NOT NULL DEFAULT 'none'
                CHECK (monetization_status IN ('none','pending','approved','rejected','suspended')),

  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sky_videos_owner_idx  ON sky_videos (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sky_videos_feed_idx   ON sky_videos (created_at DESC)
  WHERE status = 'published' AND privacy = 'public';
CREATE INDEX IF NOT EXISTS sky_videos_title_idx  ON sky_videos (lower(title));
CREATE INDEX IF NOT EXISTS sky_videos_category_idx ON sky_videos (lower(category));
CREATE INDEX IF NOT EXISTS sky_videos_monetization_idx ON sky_videos (monetization_status, created_at DESC)
  WHERE monetization_status = 'pending';

-- Лайк — то же решение, что и у film_ratings: одна строка на человека
-- и ролик, а не число, которое клиент мог бы прислать любым.
CREATE TABLE IF NOT EXISTS sky_video_likes (
  user_id    TEXT NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  video_id   TEXT NOT NULL REFERENCES sky_videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

-- Комментарии — текст зашифрован тем же порядком, что переписка и
-- описания: это чужие слова, а не то, по чему идёт поиск.
CREATE TABLE IF NOT EXISTS sky_video_comments (
  id         TEXT PRIMARY KEY,
  video_id   TEXT NOT NULL REFERENCES sky_videos(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  removed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sky_video_comments_video_idx
  ON sky_video_comments (video_id, created_at DESC);

-- Заявка на монетизацию — своя история статусов, а не одно поле в
-- видео: администратор должен видеть, кто и когда решал, и по какой
-- причине отказал, а не только текущее состояние.
CREATE TABLE IF NOT EXISTS sky_video_monetization_requests (
  id           TEXT PRIMARY KEY,
  video_id     TEXT NOT NULL REFERENCES sky_videos(id) ON DELETE CASCADE,
  owner_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  reason       TEXT,
  decided_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sky_video_monrq_video_idx  ON sky_video_monetization_requests (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sky_video_monrq_status_idx ON sky_video_monetization_requests (status, created_at ASC)
  WHERE status = 'pending';

-- Ровно один открытый запрос на видео: подать заявку второй раз, пока
-- первая на рассмотрении, нельзя (ТЗ: «повторно отправить её нельзя»).
CREATE UNIQUE INDEX IF NOT EXISTS sky_video_monrq_one_pending
  ON sky_video_monetization_requests (video_id) WHERE status = 'pending';

-- Начисления. Kопейки, а не рубли — тот же принцип, что у кошелька:
-- дробные деньги не хранят float'ом. source отличает автоматический
-- расчёт от ручной правки администратора — обе строки в одной
-- истории, но происхождение видно.
CREATE TABLE IF NOT EXISTS sky_video_revenue (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES sky_videos(id) ON DELETE CASCADE,
  owner_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  -- Копейки. Может быть отрицательным — ручная сторно-корректировка.
  amount      BIGINT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'ads' CHECK (source IN ('ads','adjustment')),
  -- Показы/просмотры рекламы, за которые начислено — только для
  -- source='ads', для наглядности в истории.
  impressions BIGINT NOT NULL DEFAULT 0,
  note        TEXT,
  created_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sky_video_revenue_video_idx ON sky_video_revenue (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sky_video_revenue_owner_idx ON sky_video_revenue (owner_id, created_at DESC);
