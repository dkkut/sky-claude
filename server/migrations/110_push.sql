-- Подписки на пуш-уведомления: браузеры/PWA (Web Push) и приложение Android (FCM).
-- Подписка принадлежит профилю; битые (404/410 от провайдера) удаляются сами.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('web','fcm')),
  endpoint   TEXT NOT NULL,          -- web: адрес провайдера; fcm: токен устройства
  p256dh     TEXT,
  auth       TEXT,
  ua         TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at TIMESTAMPTZ,
  UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_profile_idx ON push_subscriptions (profile_id);
