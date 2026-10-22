-- Sky QR: личный QR-код профиля для обмена контактами. В коде — только случайный публичный код, не токен и не секрет.
CREATE TABLE IF NOT EXISTS sky_qr_cards (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  fields     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- какие необязательные данные показывать после сканирования
  scans      INT NOT NULL DEFAULT 0,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
