-- Sky Pets — питомец профиля и рынок скинов к нему. Раньше этой
-- системы не было вовсе (ни в БД, ни на сервере) — сейчас заводим её
-- целиком, по образцу 068_bloom.sql/079_voiceparty.sql: постоянные
-- данные в обычных таблицах, владение скином — по одной строке на
-- (профиль, скин), а не флагом внутри самого скина.

CREATE TABLE IF NOT EXISTS pets (
  id             TEXT PRIMARY KEY,
  profile_id     TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  type           TEXT NOT NULL DEFAULT 'dragon',
  name           TEXT NOT NULL DEFAULT 'Питомец',
  level          INT NOT NULL DEFAULT 1,
  experience     INT NOT NULL DEFAULT 0,
  active_skin_id TEXT,
  state          TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','happy','hungry','sleeping')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Каталог скинов. Цена и редкость — только здесь: клиент их никогда
-- не присылает, покупка на сервере всегда читает актуальную строку.
CREATE TABLE IF NOT EXISTS pet_skins (
  id               TEXT PRIMARY KEY,
  pet_type         TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  rarity           TEXT NOT NULL DEFAULT 'common'
                     CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic')),
  price_points     INT NOT NULL DEFAULT 0 CHECK (price_points >= 0),
  preview_media_id TEXT,
  preview_mime     TEXT,
  model_media_id   TEXT,
  model_mime       TEXT,
  animations       JSONB NOT NULL DEFAULT '[]'::jsonb,
  effects          JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_skins_type_idx ON pet_skins (pet_type) WHERE status = 'active';

ALTER TABLE pets
  ADD CONSTRAINT pets_active_skin_fk FOREIGN KEY (active_skin_id)
    REFERENCES pet_skins(id) ON DELETE SET NULL;

-- Владение скином. UNIQUE(profile_id, skin_id) — тот же приём, что и
-- везде в Sky для защиты от повторной выдачи: гонка из двух
-- одновременных покупок одного скина упрётся в этот индекс, а не
-- выдаст скин дважды.
CREATE TABLE IF NOT EXISTS user_pet_skins (
  id                  TEXT PRIMARY KEY,
  profile_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skin_id             TEXT NOT NULL REFERENCES pet_skins(id) ON DELETE CASCADE,
  acquisition_source  TEXT NOT NULL DEFAULT 'purchase' CHECK (acquisition_source IN ('purchase','gift','grant')),
  purchase_ref        TEXT,
  acquired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, skin_id)
);
CREATE INDEX IF NOT EXISTS user_pet_skins_profile_idx ON user_pet_skins (profile_id);
