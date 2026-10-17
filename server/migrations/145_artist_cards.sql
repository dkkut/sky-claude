-- Карточки музыкантов (модуль 10): каталожная сущность «исполнитель», отдельная от профиля-артиста (music_artists).
-- Карточка появляется из треков (автопредложение/создание), совпадения ищутся по нормализованному имени и транслиту,
-- дубли объединяет администрация, владение подтверждается заявкой (claim) и решением сотрудника.
CREATE TABLE IF NOT EXISTS music_artist_cards (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_norm    TEXT NOT NULL,
  bio          TEXT,                     -- зашифровано
  genres       TEXT NOT NULL DEFAULT '',
  auto_created BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  owner_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,   -- подтверждённый владелец карточки
  merged_into  TEXT REFERENCES music_artist_cards(id) ON DELETE SET NULL,
  hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Среди «живых» карточек имя уникально.
CREATE UNIQUE INDEX IF NOT EXISTS music_artist_cards_live_name ON music_artist_cards (name_norm) WHERE merged_into IS NULL AND NOT hidden;
CREATE INDEX IF NOT EXISTS music_artist_cards_owner ON music_artist_cards (owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS music_artist_claims (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES music_artist_cards(id) ON DELETE CASCADE,
  claimant_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note        TEXT,                      -- зашифровано
  links       TEXT,                      -- зашифровано, JSON-массив https-ссылок
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','withdrawn','revoked')),
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  reason      TEXT,                      -- зашифровано
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_artist_claims_pending_uq ON music_artist_claims (card_id, claimant_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS music_artist_claims_owner_uq ON music_artist_claims (card_id) WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS music_artist_card_log (
  id       BIGSERIAL PRIMARY KEY,
  card_id  TEXT NOT NULL,
  event    TEXT NOT NULL,                -- created, auto_created, merged, unmerged, claim_*, owner_revoked, edited
  actor_id TEXT,
  detail   TEXT,                         -- JSON (например, список перенесённых треков)
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_artist_card_log_idx ON music_artist_card_log (card_id, id);

ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS artist_card_id TEXT REFERENCES music_artist_cards(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS music_tracks_card_idx ON music_tracks (artist_card_id) WHERE artist_card_id IS NOT NULL;
