-- Sky Трансляции (live-стримы) — реестр эфиров на сервере вместо
-- BroadcastChannel: канал между вкладками ОДНОГО браузера физически не
-- мог показать трансляцию другому человеку или другому устройству —
-- она была локальной иллюзией для одной вкладки. Кто сейчас смотрит —
-- живое состояние в памяти хаба (server/streams.mjs), как и у голосовых
-- комнат (server/voiceparty.mjs) — то же решение, тот же повод: роль/
-- мьют там меняются много раз в секунду, здесь так же часто меняются
-- зрители и реакции.

CREATE TABLE IF NOT EXISTS live_streams (
  id                      TEXT PRIMARY KEY,
  author_id               TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  category                TEXT NOT NULL DEFAULT 'other'
                            CHECK (category IN ('gaming','talk','music','creative','sport','irl','other')),
  tags                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  source                  TEXT NOT NULL DEFAULT 'camera' CHECK (source IN ('camera','screen')),
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                TIMESTAMPTZ,
  peak_viewers            INT NOT NULL DEFAULT 0,
  total_donations_points  BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS live_streams_live_idx ON live_streams (started_at DESC) WHERE ended_at IS NULL;
-- Один активный эфир на автора одновременно — нельзя вести две
-- трансляции сразу с одного и того же профиля.
CREATE UNIQUE INDEX IF NOT EXISTS live_streams_one_active_idx ON live_streams (author_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS live_stream_bans (
  stream_id   TEXT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, profile_id)
);

-- Донаты — неизменяемый журнал настоящего SkyCoin (баллы кошелька),
-- а не число «с потолка» в локальном сторе. idempotency_key защищает
-- от двойного списания при повторной отправке того же запроса.
CREATE TABLE IF NOT EXISTS live_stream_donations (
  id              TEXT PRIMARY KEY,
  stream_id       TEXT NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  from_id         TEXT NOT NULL REFERENCES profiles(id),
  to_id           TEXT NOT NULL REFERENCES profiles(id),
  amount          INT NOT NULL CHECK (amount > 0),
  message         TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_stream_donations_stream_idx ON live_stream_donations (stream_id, created_at DESC);
