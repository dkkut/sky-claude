-- Серверный замок приложения: код и биометрия проверяются на сервере, состояние «закрыто» держит сессия в Redis.
CREATE TABLE IF NOT EXISTS app_lock_devices (
  sky_id        TEXT NOT NULL,
  device_hash   TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'web',      -- web | native | desktop
  pin_salt      TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,
  wa_cred_id    TEXT,
  wa_jwk        JSONB,
  wa_alg        INT,
  wa_count      BIGINT NOT NULL DEFAULT 0,
  fails         INT NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sky_id, device_hash)
);
