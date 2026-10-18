-- Простые переключатели платформы (сейчас: баннер о перебоях в Sky Media). Только добавляет таблицу.
CREATE TABLE IF NOT EXISTS platform_flags (
  key        TEXT PRIMARY KEY,
  on_flag    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
