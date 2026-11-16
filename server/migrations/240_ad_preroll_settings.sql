-- Настройки рекламы перед видео, которые правит администрация (раньше — только переменная окружения и зашитые числа).
CREATE TABLE IF NOT EXISTS ad_preroll_settings (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled          BOOLEAN  NOT NULL DEFAULT TRUE,
  cooldown_sec     INTEGER  NOT NULL DEFAULT 240,
  skip_after_sec   INTEGER  NOT NULL DEFAULT 5,
  max_per_user_day INTEGER  NOT NULL DEFAULT 5,
  label            TEXT     NOT NULL DEFAULT 'Реклама',
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ad_preroll_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
