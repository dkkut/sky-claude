-- Артист и подписки на него — на сервере.
--
-- До этого «профиль артиста» и подписчики лежали в localStorage
-- браузера: человек видел ровно тех артистов, которых завели на этом
-- же устройстве, а подписка не доходила ни до артиста, ни до кого-либо
-- ещё. Теперь и профиль, и подписки общие.

CREATE TABLE IF NOT EXISTS music_artists (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- Псевдоним хранится как есть: он публичный по смыслу (его видят все
  -- в каталоге) и по нему же ищется страница артиста. Шифровать то,
  -- что и так показано каждому, — только мешать поиску.
  name       TEXT NOT NULL,
  -- А вот «о себе» человек пишет свободным текстом, и он шифруется,
  -- как остальной пользовательский текст.
  bio        TEXT,
  -- Жанры — из готового списка, через запятую.
  genres     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один псевдоним — один артист: иначе на странице артиста нельзя
-- понять, кому именно подписываться.
CREATE UNIQUE INDEX IF NOT EXISTS music_artists_name_idx ON music_artists (lower(name));

CREATE TABLE IF NOT EXISTS music_artist_followers (
  artist_id   TEXT NOT NULL REFERENCES music_artists(profile_id) ON DELETE CASCADE,
  follower_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_id, follower_id)
);

CREATE INDEX IF NOT EXISTS music_artist_followers_by_follower
  ON music_artist_followers (follower_id, created_at DESC);
