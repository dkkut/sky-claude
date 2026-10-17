-- Витрина коллекционера в профиле: настройки лежат на сервере, чтобы их видели другие люди.
CREATE TABLE IF NOT EXISTS nft_showcases (
  profile_id   TEXT PRIMARY KEY,
  background   TEXT NOT NULL DEFAULT 'galaxy',
  layout       TEXT NOT NULL DEFAULT 'grid' CHECK (layout IN ('grid','carousel','spotlight')),
  description  TEXT NOT NULL DEFAULT '',
  pinned       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
