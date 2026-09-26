-- Кабинет турниров Sky Games.
--
-- Раньше турниры существовали только в localStorage: createTourney/
-- joinTourney писали в браузер того, кто нажал кнопку, — ни другой
-- человек, ни тем более другое устройство того же человека вообще не
-- видели эти записи. «Участники» — просто список id, без проверки
-- места и без единого события другому пользователю.
--
-- Здесь турнир и его участники — общие для всех, как и остальной Sky
-- Games. Бракетов и автоматического судейства нет и не может быть
-- честно: игры внешние (CS2/Dota 2/Fortnite), у Sky нет своего игрового
-- сервера, который сообщил бы исход раунда турнира. Кабинет отвечает
-- за то, что можно сделать честно: создать турнир, набрать участников
-- по-настоящему, организатору — закрыть его как «начался»/«завершён».

CREATE TABLE IF NOT EXISTS tournaments (
  id            TEXT PRIMARY KEY,
  game_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  format        TEXT NOT NULL,
  prize         TEXT NOT NULL DEFAULT '',
  teams_max     INTEGER NOT NULL DEFAULT 16,
  organizer_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'finished', 'cancelled')),
  starts_at     TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournaments_game_idx   ON tournaments (game_id, status);
CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments (status, starts_at);

CREATE TABLE IF NOT EXISTS tournament_participants (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, profile_id)
);
