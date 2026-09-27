-- Sky Stories — истории (24 часа). Раньше жили только в браузере
-- (localStorage + BroadcastChannel, см. src/stories/StoriesModule.tsx):
-- видно было только вкладкам одного и того же браузера, у другого
-- человека на другом устройстве историй не было вовсе — ни своих, ни
-- чужих, ни настоящих лайков/просмотров/ответов на опрос.
--
-- Модель — по образцу 068_bloom.sql: опрос и вопрос-ответы отдельными
-- таблицами, а не JSON-полем, просмотр/лайк — по одной строке на
-- человека (а не свободный счётчик, который наматывает себя при
-- каждом повторном открытии).

CREATE TABLE IF NOT EXISTS stories (
  id             TEXT PRIMARY KEY,
  author_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','photo','video')),
  media_id       TEXT,
  media_mime     TEXT,
  body           TEXT,
  bg             TEXT NOT NULL DEFAULT '',
  duration_sec   INT NOT NULL DEFAULT 7,
  visibility     TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','closeFriends')),
  location       TEXT,
  music_track_id TEXT,
  poll_question     TEXT,
  question_prompt   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS stories_author_idx ON stories (author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS stories_expires_idx ON stories (expires_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS story_mentions (
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, user_id)
);

-- Просмотр — раз на зрителя: свободный счётчик считал бы заново каждое
-- повторное открытие тем же человеком.
CREATE TABLE IF NOT EXISTS story_views (
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS story_views_story_idx ON story_views (story_id);

CREATE TABLE IF NOT EXISTS story_likes (
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

CREATE TABLE IF NOT EXISTS story_poll_options (
  id       TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  idx      INT NOT NULL,
  label    TEXT NOT NULL,
  UNIQUE (story_id, idx)
);

CREATE TABLE IF NOT EXISTS story_poll_votes (
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL REFERENCES story_poll_options(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

CREATE TABLE IF NOT EXISTS story_question_answers (
  id         TEXT PRIMARY KEY,
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS story_question_answers_story_idx ON story_question_answers (story_id);

-- «Близкие друзья» для видимости историй. У этого фильтра раньше не
-- было вообще никакого способа кого-то в него добавить (ключ в
-- localStorage, который никто не писал) — «Близкие друзья» в форме
-- публикации не срабатывала ни разу ни для одного человека. Список
-- составляется только из реальных подтверждённых друзей (friendships,
-- см. server/friends.mjs) — не из произвольных ID.
CREATE TABLE IF NOT EXISTS story_close_friends (
  author_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (author_id, friend_id)
);
