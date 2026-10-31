-- Текст владельца профиля под песней в разделе «Музыка» профиля.
ALTER TABLE profile_music ADD COLUMN IF NOT EXISTS note TEXT;
