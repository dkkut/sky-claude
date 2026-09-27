-- Quick Menu — какие разделы Sky показывать в PC Quick Actions (и,
-- в перспективе, в любом другом быстром доступе) и в каком порядке.
-- Одна строка на профиль, весь список — единым JSONB-массивом:
-- перестановка/переключение всегда идёт одним атомарным UPDATE, без
-- гонок между отдельными полями одного и того же списка.
CREATE TABLE IF NOT EXISTS quick_menu_settings (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
