-- «Поток на двоих»: общий музыкальный поток двух друзей. Работает только после принятия приглашения; любой из двоих может завершить.
CREATE TABLE IF NOT EXISTS music_duo (
  id           TEXT PRIMARY KEY,
  a_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  b_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','ended')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (a_id < b_id),
  CHECK (requested_by = a_id OR requested_by = b_id)
);
-- Одна живая пара (ожидание или действует) на двоих.
CREATE UNIQUE INDEX IF NOT EXISTS music_duo_live_pair ON music_duo (a_id, b_id) WHERE status IN ('pending','active');
CREATE INDEX IF NOT EXISTS music_duo_b_idx ON music_duo (b_id, status);
