-- Приглашения новых людей в Sky: у каждого профиля своя ссылка с кодом; регистрация по ссылке записывается один раз на нового человека.
CREATE TABLE IF NOT EXISTS invite_links (
  profile_id TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invite_uses (
  invitee_sky_id    TEXT PRIMARY KEY,            -- один человек приглашается один раз
  inviter_profile_id TEXT NOT NULL,
  code              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invite_uses_inviter_idx ON invite_uses (inviter_profile_id, created_at DESC);
