-- Вход на ТВ, консоли и в машине по QR-коду или коду подключения: устройство просит код,
-- подтверждает человек на телефоне, где уже выполнен вход в Sky ID.
CREATE TABLE IF NOT EXISTS device_links (
  id            TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL,
  poll_hash     TEXT NOT NULL,
  verify_hash   TEXT NOT NULL,              -- проверочное число, которое показано на устройстве
  kind          TEXT NOT NULL DEFAULT 'other',  -- tv | console | car | other (со слов устройства)
  label         TEXT NOT NULL DEFAULT '',
  ua            TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  lang          TEXT NOT NULL DEFAULT '',
  app           BOOLEAN NOT NULL DEFAULT FALSE,   -- родное приложение, а не браузер
  attempts      INT  NOT NULL DEFAULT 0,          -- неверные проверочные числа
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied | cancelled | exhausted | consumed
  sky_id        TEXT,                              -- кто подтвердил / кто смотрел запрос
  decided_sid   TEXT,                              -- сессия телефона, с которой подтвердили
  decided_ip    TEXT,
  decided_at    TIMESTAMPTZ,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS device_links_code_idx    ON device_links (code_hash);
CREATE INDEX IF NOT EXISTS device_links_user_idx    ON device_links (sky_id, created_at DESC);
CREATE INDEX IF NOT EXISTS device_links_created_idx ON device_links (created_at);
