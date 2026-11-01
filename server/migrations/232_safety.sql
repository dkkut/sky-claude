-- Sky Safety: настройки, доверенные контакты (с согласием), события «подтвердите безопасность».
CREATE TABLE IF NOT EXISTS safety_settings (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  timeout_sec INT NOT NULL DEFAULT 60 CHECK (timeout_sec BETWEEN 30 AND 180),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS safety_contacts (
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id),
  CHECK (owner_id <> contact_id)
);
CREATE INDEX IF NOT EXISTS safety_contacts_contact ON safety_contacts (contact_id);
CREATE TABLE IF NOT EXISTS safety_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','alerted','no_contacts')),
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  speed_before_kmh REAL, drop_kmh REAL, signals TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS safety_events_due ON safety_events (deadline_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS safety_events_profile ON safety_events (profile_id, created_at DESC);
