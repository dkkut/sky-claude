-- Имя отдельного кода: чтобы в админке отличать ключи внутри серии
-- (кому выдан, для чего). Видно только администраторам.
ALTER TABLE sky_codes ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
