-- Псевдонимы исполнителей для голосового и обычного поиска: «Земфира» = «Zemfira», «ддт» = «DDT».
CREATE TABLE IF NOT EXISTS music_artist_aliases (
  id         BIGSERIAL PRIMARY KEY,
  alias_norm TEXT NOT NULL,            -- нормализованный псевдоним (как говорят)
  artist_norm TEXT NOT NULL,           -- нормализованное имя исполнителя (как в базе)
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alias_norm, artist_norm)
);
CREATE INDEX IF NOT EXISTS music_artist_aliases_alias_idx ON music_artist_aliases (alias_norm);
