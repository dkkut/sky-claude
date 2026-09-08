-- Музыка на сервере.
--
-- До этого Sky Music жил целиком в браузере: треки, плейлисты,
-- избранное и история лежали в localStorage, а сами файлы — в
-- IndexedDB устройства. Ничего из этого нельзя ни защитить, ни
-- разделить между устройствами, потому что сервер об этом не знал.

CREATE TABLE IF NOT EXISTS music_tracks (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  artist       TEXT NOT NULL,
  album        TEXT NOT NULL DEFAULT '',
  genre        TEXT NOT NULL DEFAULT '',
  year         INT,
  duration_sec INT  NOT NULL DEFAULT 0,
  mime         TEXT NOT NULL,
  bytes        BIGINT NOT NULL,
  -- Файл лежит на диске под своим идентификатором. В базе нет ни имени
  -- от загрузившего, ни пути: путь собирается сервером из id, поэтому
  -- через него нельзя выйти из каталога.
  has_cover    BOOLEAN NOT NULL DEFAULT FALSE,
  cover_mime   TEXT,
  -- 'published' виден всем, 'private' — только владельцу,
  -- 'pending' ждёт проверки, 'rejected' отклонён.
  status       TEXT NOT NULL DEFAULT 'private'
               CHECK (status IN ('published','private','pending','rejected')),
  lyrics       TEXT,
  plays        BIGINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_tracks_owner_idx  ON music_tracks (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_tracks_status_idx ON music_tracks (status, created_at DESC);
-- Поиск идёт по приведённым к нижнему регистру названию и исполнителю.
CREATE INDEX IF NOT EXISTS music_tracks_title_idx  ON music_tracks (lower(title));
CREATE INDEX IF NOT EXISTS music_tracks_artist_idx ON music_tracks (lower(artist));

CREATE TABLE IF NOT EXISTS music_playlists (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_public  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_playlists_owner_idx ON music_playlists (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS music_playlist_items (
  playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL REFERENCES music_tracks(id)    ON DELETE CASCADE,
  -- Порядок задаёт владелец; дробные значения не нужны — при вставке
  -- позиции пересчитываются в транзакции.
  position    INT  NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX IF NOT EXISTS music_playlist_items_order_idx ON music_playlist_items (playlist_id, position);

CREATE TABLE IF NOT EXISTS music_favorites (
  user_id    TEXT NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
  track_id   TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS music_history (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
  track_id  TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_history_user_idx ON music_history (user_id, played_at DESC);

-- На чём человек остановился. Одна строка на трек: продолжить слушать
-- нужно с последнего места, а не со всех сразу.
CREATE TABLE IF NOT EXISTS music_progress (
  user_id      TEXT NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
  track_id     TEXT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
  position_sec INT  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);
