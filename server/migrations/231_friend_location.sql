-- Карта друзей: кто кому показывает своё местоположение и последняя известная точка.
CREATE TABLE IF NOT EXISTS loc_share (
  owner_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, viewer_id),
  CHECK (owner_id <> viewer_id)
);
CREATE INDEX IF NOT EXISTS loc_share_viewer ON loc_share (viewer_id);

-- Одна последняя точка на человека. Истории перемещений нет: новая точка заменяет прежнюю, «остановить» стирает.
CREATE TABLE IF NOT EXISTS loc_last (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed_ms REAL,
  accuracy_m REAL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
