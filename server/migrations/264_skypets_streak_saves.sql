-- Sky Pets: спасение серии — восстановление пропущенного вчерашнего дня и заморозка на 5 дней
CREATE TABLE IF NOT EXISTS sp_streak_saves (
  id BIGSERIAL PRIMARY KEY, pet_id TEXT NOT NULL REFERENCES sp_pets(id) ON DELETE CASCADE, profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('restore','freeze')), day DATE NOT NULL, grp TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (pet_id, day, kind)
);
CREATE INDEX IF NOT EXISTS sp_streak_saves_profile ON sp_streak_saves (profile_id, kind, created_at);
