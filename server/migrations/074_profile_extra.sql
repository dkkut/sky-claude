-- Расширенный профиль: аватар и bio уже сохранялись на сервере, но
-- баннер, наклейка/цвет ника, статус, ссылки и страна/язык/часовой
-- пояс писались только в localStorage (updateProfile в auth/store.ts) —
-- у другого человека и на другом устройстве их никогда не было видно.
-- Один JSONB, а не колонка на поле: это косметика профиля, а не то, по
-- чему когда-либо понадобится искать или на что ссылаться внешним
-- ключом. banner хранится тем же способом, что и уже существующий
-- avatar (TEXT), — тоже картинка, просто побольше.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banner TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_extra JSONB NOT NULL DEFAULT '{}'::jsonb;
