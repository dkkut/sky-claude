-- Sky Календарь: собственные события с повтором, напоминаниями и приглашениями друзей.
-- Даты из других сервисов (билеты, записи, парковки, цели Life, капсулы) читаются на лету и здесь НЕ дублируются.
CREATE TABLE IF NOT EXISTS cal_events (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_enc   TEXT NOT NULL,
  notes_enc   TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  repeat      TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none','daily','weekly','monthly','yearly')),
  remind_min  INTEGER CHECK (remind_min IS NULL OR (remind_min >= 0 AND remind_min <= 10080)),
  color       TEXT NOT NULL DEFAULT 'blue',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cal_events_owner_idx ON cal_events (owner_id, starts_at);
CREATE TABLE IF NOT EXISTS cal_invites (
  event_id    TEXT NOT NULL REFERENCES cal_events(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, profile_id)
);
CREATE INDEX IF NOT EXISTS cal_invites_profile_idx ON cal_invites (profile_id, status);
-- Одно напоминание на (событие, момент начала, человек).
CREATE TABLE IF NOT EXISTS cal_reminded (
  event_id    TEXT NOT NULL REFERENCES cal_events(id) ON DELETE CASCADE,
  occ_at      TIMESTAMPTZ NOT NULL,
  profile_id  TEXT NOT NULL,
  PRIMARY KEY (event_id, occ_at, profile_id)
);
