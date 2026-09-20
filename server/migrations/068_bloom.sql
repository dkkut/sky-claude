-- Bloom — социальная лента внутри Sky Ecosystem.
--
-- Личных сообщений здесь нет и не будет: «Написать» в профиле Bloom
-- ведёт в уже существующий Sky Messenger (chats.mjs/createChat), а не
-- заводит вторую систему переписки.
--
-- Подписки вынесены в отдельную общую таблицу follows: до этой миграции
-- «подписаться» на Bloom-ленте, на канал SkyVideo и на профиль в общем
-- профиль-вьюере — три независимые копии одного и того же в
-- localStorage браузера (src/profile/viewer/social.ts). Одна настоящая
-- таблица вместо трёх выдуманных копий чинит все три места разом.

CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS follows_following_idx ON follows (following_id);

CREATE TABLE IF NOT EXISTS bloom_posts (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','photo','video')),
  body         TEXT NOT NULL DEFAULT '',
  media_id     TEXT,
  media_mime   TEXT,
  media_aspect REAL,
  location     TEXT,
  is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
  poll_question TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bloom_posts_author_idx ON bloom_posts (author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bloom_posts_created_idx ON bloom_posts (created_at DESC) WHERE deleted_at IS NULL;

-- Теги — отдельной таблицей, а не полем-массивом: тренды и поиск по
-- тегу идут запросом с индексом, а не сканом каждой строки.
CREATE TABLE IF NOT EXISTS bloom_post_tags (
  post_id TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX IF NOT EXISTS bloom_post_tags_tag_idx ON bloom_post_tags (tag);

CREATE TABLE IF NOT EXISTS bloom_reactions (
  post_id    TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS bloom_reactions_post_idx ON bloom_reactions (post_id);

CREATE TABLE IF NOT EXISTS bloom_comments (
  id             TEXT PRIMARY KEY,
  post_id        TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  author_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  gift_model_key TEXT,
  gift_rarity    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bloom_comments_post_idx ON bloom_comments (post_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bloom_comment_likes (
  comment_id TEXT NOT NULL REFERENCES bloom_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS bloom_saves (
  post_id    TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS bloom_saves_user_idx ON bloom_saves (user_id);

-- Репост — тоже раз на человека, не свободный счётчик: иначе «накрутка
-- лайков/репостов» из чек-листа брифа была бы дырой прямо в схеме.
CREATE TABLE IF NOT EXISTS bloom_reposts (
  post_id    TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- Просмотры — тоже раз на зрителя: свободный счётчик, растущий на
-- каждый рендер карточки, наматывает себя же при повторном скролле, а
-- это и есть выдуманное число.
CREATE TABLE IF NOT EXISTS bloom_views (
  post_id    TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS bloom_poll_options (
  id      TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  idx     INT NOT NULL,
  label   TEXT NOT NULL,
  UNIQUE (post_id, idx)
);
CREATE INDEX IF NOT EXISTS bloom_poll_options_post_idx ON bloom_poll_options (post_id);

CREATE TABLE IF NOT EXISTS bloom_poll_votes (
  post_id    TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL REFERENCES bloom_poll_options(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS bloom_hidden (
  user_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  hidden_author_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hidden_author_id)
);

-- Подарки в комментариях Bloom — decorative, платятся баллами Prime
-- (тот же кошелёк, что и везде в Sky). Реальная запись списания живёт
-- в wallet_tx через wallet.mjs; здесь — только то, что относится к
-- самому подарку внутри Bloom.
CREATE TABLE IF NOT EXISTS bloom_gifts (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id     TEXT NOT NULL REFERENCES bloom_posts(id) ON DELETE CASCADE,
  comment_id  TEXT REFERENCES bloom_comments(id) ON DELETE SET NULL,
  model_key   TEXT NOT NULL,
  rarity      TEXT NOT NULL,
  cost_points INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bloom_gifts_to_idx ON bloom_gifts (to_id, created_at DESC);
