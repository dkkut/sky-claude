-- Доверенные устройства: где уже был вход по коду. Для Car/Console/TV профиль, у которого включён
-- второй фактор, можно открывать без кода на таком устройстве — если владелец включил это у профиля.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS skip_code_trusted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sky_trusted_devices (
  sky_id      TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sky_id, device_hash)
);
