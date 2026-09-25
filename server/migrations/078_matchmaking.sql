-- Матчмейкинг Sky Games — реальный сервер вместо иллюзии.
--
-- ELO раньше не существовал: интерфейс на лету считал
-- 500 + wins*12 + hours*3 из статистики, которая сама лежала в
-- localStorage и правилась тем же браузером, что её показывал —
-- игрок мог выставить себе любой рейтинг простой правкой хранилища.
-- «Поиск матча» был setTimeout со случайной задержкой 6-11 секунд:
-- ни разу не участвовал второй реальный игрок, «найденный» матч был
-- декорацией с фиксированной картой «Mirage».

-- Рейтинг — только здесь, и только сервер имеет право его менять.
CREATE TABLE IF NOT EXISTS game_ratings (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL,
  elo        INT NOT NULL DEFAULT 1000,
  wins       INT NOT NULL DEFAULT 0,
  losses     INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, game_id)
);

-- Один человек — одна запись в очереди: PRIMARY KEY на profile_id
-- (а не отдельный id) сам по себе не даёт встать в очередь дважды
-- или зависнуть сразу в двух играх.
CREATE TABLE IF NOT EXISTS matchmaking_queue (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL,
  elo        INT NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matchmaking_queue_game_idx ON matchmaking_queue (game_id, elo);

-- team_a/team_b — массивы id профилей: сегодня матч 1v1 (реалистично
-- при живой популяции этого сервера), но формат не завязан на ровно
-- двух участников с каждой стороны — командный размер можно расширить,
-- не трогая схему.
CREATE TABLE IF NOT EXISTS matches (
  id           TEXT PRIMARY KEY,
  game_id      TEXT NOT NULL,
  team_a       TEXT[] NOT NULL,
  team_b       TEXT[] NOT NULL,
  avg_elo      INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS match_accepts (
  match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  accepted   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (match_id, profile_id)
);
