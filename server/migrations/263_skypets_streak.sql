-- Sky Pets: серия ухода (дни подряд) — достигнутые вехи и что человек уже видел
CREATE TABLE IF NOT EXISTS sp_streak_marks (
  pet_id TEXT NOT NULL REFERENCES sp_pets(id) ON DELETE CASCADE, milestone INT NOT NULL,
  reached_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (pet_id, milestone)
);
CREATE TABLE IF NOT EXISTS sp_streak_seen (
  pet_id TEXT NOT NULL REFERENCES sp_pets(id) ON DELETE CASCADE, profile_id TEXT NOT NULL, milestone INT NOT NULL,
  PRIMARY KEY (pet_id, profile_id, milestone)
);
