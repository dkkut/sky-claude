-- Игровые серверы («как Discord») во вкладке «Каналы» игр: серверы, участники,
-- категории, каналы и сообщения. Раньше всё лежало в localStorage браузера
-- и было видно только самому человеку.
-- Голосовые каналы — обычные комнаты войс-пати (voice_rooms): комната
-- заводится при первом входе и закрывается, когда из неё выходит последний.

CREATE TABLE IF NOT EXISTS game_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '🎮',
  description TEXT NOT NULL DEFAULT '',
  owner_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_public   BOOLEAN NOT NULL DEFAULT true,
  invite_code TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_servers_owner_idx ON game_servers (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS game_servers_invite_idx ON game_servers (invite_code);

CREATE TABLE IF NOT EXISTS game_server_members (
  server_id  TEXT NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, profile_id)
);
CREATE INDEX IF NOT EXISTS game_server_members_profile_idx ON game_server_members (profile_id);

CREATE TABLE IF NOT EXISTS game_server_bans (
  server_id  TEXT NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, profile_id)
);

CREATE TABLE IF NOT EXISTS game_categories (
  id        TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS game_categories_server_idx ON game_categories (server_id);

CREATE TABLE IF NOT EXISTS game_channels (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
  category_id   TEXT NOT NULL REFERENCES game_categories(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('text','voice','announce')),
  position      INTEGER NOT NULL DEFAULT 0,
  voice_room_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_channels_server_idx ON game_channels (server_id);

CREATE TABLE IF NOT EXISTS game_channel_messages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES game_channels(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_channel_messages_idx ON game_channel_messages (channel_id, created_at DESC);
