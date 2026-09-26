-- Войс-пати: голосовые комнаты.
--
-- Раньше комнаты существовали только в localStorage браузера, а список
-- комнат синхронизировался между вкладками через BroadcastChannel —
-- то есть ни один другой человек на другом устройстве вообще не видел
-- список комнат и не мог до них достучаться. Голос при этом был
-- настоящим WebRTC (getUserMedia/RTCPeerConnection), но сигналинг
-- offer/answer/ICE тоже шёл через BroadcastChannel — то есть физически
-- мог долететь только между вкладками одного и того же браузера.
--
-- Здесь — только то, что должно пережить обновление страницы и быть
-- видно всем: сама комната (метаданные) и список забаненных. Кто прямо
-- сейчас в комнате — состояние живое и меняется много раз в секунду
-- (говорит/не говорит, поднята рука), оно держится в памяти хаба
-- (server/signal.mjs), как и список онлайн-соединений — держать это в
-- базе означало бы писать на диск при каждом чихе микрофона.

CREATE TABLE IF NOT EXISTS voice_rooms (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  category         TEXT NOT NULL DEFAULT 'other',
  owner_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_private       BOOLEAN NOT NULL DEFAULT false,
  invite_code      TEXT NOT NULL,
  max_participants INTEGER NOT NULL DEFAULT 25,
  permissions      JSONB NOT NULL DEFAULT '{"whoCanSpeak":"everyone","whoCanReact":"everyone","requireApprovalToSpeak":false}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for    TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS voice_rooms_live_idx ON voice_rooms (created_at DESC) WHERE ended_at IS NULL AND scheduled_for IS NULL;
CREATE INDEX IF NOT EXISTS voice_rooms_scheduled_idx ON voice_rooms (scheduled_for) WHERE ended_at IS NULL AND scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS voice_rooms_owner_idx ON voice_rooms (owner_id);

CREATE TABLE IF NOT EXISTS voice_room_bans (
  room_id    TEXT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, profile_id)
);
