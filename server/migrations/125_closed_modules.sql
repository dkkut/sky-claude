-- Закрытие модулей из админки: модуль закрыт → вместо него баннер «Сервис временно недоступен».
CREATE TABLE IF NOT EXISTS closed_modules (
  module      TEXT PRIMARY KEY,
  reason      TEXT NOT NULL,
  show_reason BOOLEAN NOT NULL DEFAULT FALSE,
  closed_by   TEXT,
  closed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
