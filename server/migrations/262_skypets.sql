-- Sky Pets: виртуальные питомцы (каталог, яйца, питомцы с несколькими хозяевами, дом, город, магазин, задания, модерация).
-- Валюта игры — «монеты» (мягкая, внутри Sky Pets); платные позиции — только баллы Prime через wallet.spendPointsIn.
CREATE TABLE IF NOT EXISTS sp_images (
  id TEXT PRIMARY KEY,                       -- pim-<uuid>; файл лежит на диске (шифрован), не в базе
  author_id TEXT NOT NULL, mime TEXT NOT NULL, width INT NOT NULL, height INT NOT NULL, bytes INT NOT NULL,
  has_alpha BOOLEAN NOT NULL DEFAULT TRUE, sizes JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_species (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'common' CHECK (rarity IN ('common','rare','epic','legendary')),
  art JSONB NOT NULL DEFAULT '{}', image_id TEXT, view JSONB NOT NULL DEFAULT '{}',
  base_stats JSONB NOT NULL DEFAULT '{}', max_level INT NOT NULL DEFAULT 30 CHECK (max_level BETWEEN 5 AND 100),
  cost_coins INT NOT NULL DEFAULT 0, season TEXT, exclusive BOOLEAN NOT NULL DEFAULT FALSE, builtin BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','pending','review','approved','rejected','needs_changes','published','archived')),
  author_id TEXT, publish_at TIMESTAMPTZ, hold_event TEXT, version INT NOT NULL DEFAULT 1,
  evolves_to TEXT, evolve_level INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_eggs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'common', rarity TEXT NOT NULL DEFAULT 'common',
  art JSONB NOT NULL DEFAULT '{}', image_id TEXT, price_coins INT NOT NULL DEFAULT 0, price_points INT NOT NULL DEFAULT 0,
  hatch_seconds INT NOT NULL DEFAULT 600 CHECK (hatch_seconds BETWEEN 5 AND 604800), interactions INT NOT NULL DEFAULT 3,
  season TEXT, builtin BOOLEAN NOT NULL DEFAULT FALSE, buyable BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'published', author_id TEXT, publish_at TIMESTAMPTZ, version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_egg_drops (
  egg_id TEXT NOT NULL REFERENCES sp_eggs(id) ON DELETE CASCADE, species_id TEXT NOT NULL REFERENCES sp_species(id) ON DELETE CASCADE,
  weight INT NOT NULL CHECK (weight BETWEEN 1 AND 100000), PRIMARY KEY (egg_id, species_id)
);
CREATE TABLE IF NOT EXISTS sp_skins (
  id TEXT PRIMARY KEY, species_id TEXT NOT NULL REFERENCES sp_species(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL DEFAULT 'common', art JSONB NOT NULL DEFAULT '{}', image_id TEXT, view JSONB NOT NULL DEFAULT '{}',
  price_coins INT NOT NULL DEFAULT 0, price_points INT NOT NULL DEFAULT 0, unlock_level INT, season TEXT, limited_until TIMESTAMPTZ,
  category TEXT NOT NULL DEFAULT 'common', builtin BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'published', author_id TEXT, publish_at TIMESTAMPTZ, version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('food','toy','accessory','clothes','furniture','interior','decor','house','bed','bowl')),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', rarity TEXT NOT NULL DEFAULT 'common',
  art JSONB NOT NULL DEFAULT '{}', image_id TEXT, effect JSONB NOT NULL DEFAULT '{}',
  price_coins INT NOT NULL DEFAULT 0, price_points INT NOT NULL DEFAULT 0, season TEXT, conditions TEXT NOT NULL DEFAULT '',
  builtin BOOLEAN NOT NULL DEFAULT FALSE, shop BOOLEAN NOT NULL DEFAULT TRUE, giftable BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'published', author_id TEXT, publish_at TIMESTAMPTZ, version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Снимки версий для «вернуть прежнюю версию»
CREATE TABLE IF NOT EXISTS sp_versions (
  subject TEXT NOT NULL, subject_id TEXT NOT NULL, version INT NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, subject_id, version)
);
CREATE TABLE IF NOT EXISTS sp_mod_log (
  id BIGSERIAL PRIMARY KEY, subject TEXT NOT NULL, subject_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sp_mod_log_subj ON sp_mod_log (subject, subject_id, id);

CREATE TABLE IF NOT EXISTS sp_players (
  profile_id TEXT PRIMARY KEY, coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0), starter_given BOOLEAN NOT NULL DEFAULT FALSE,
  visit_policy TEXT NOT NULL DEFAULT 'friends' CHECK (visit_policy IN ('all','friends','none')),
  notify TEXT NOT NULL DEFAULT 'all' CHECK (notify IN ('all','important','off')), daily_at DATE,
  stats JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_inventory (
  profile_id TEXT NOT NULL, item_id TEXT NOT NULL, qty INT NOT NULL DEFAULT 0 CHECK (qty >= 0), PRIMARY KEY (profile_id, item_id)
);
CREATE TABLE IF NOT EXISTS sp_skin_owned (profile_id TEXT NOT NULL, skin_id TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (profile_id, skin_id));
CREATE TABLE IF NOT EXISTS sp_player_eggs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, egg_id TEXT NOT NULL REFERENCES sp_eggs(id),
  state TEXT NOT NULL DEFAULT 'unhatched' CHECK (state IN ('unhatched','incubating','ready','hatched','gifted')),
  incubate_at TIMESTAMPTZ, ready_at TIMESTAMPTZ, touches INT NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'shop',
  partner_id TEXT, pet_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sp_player_eggs_owner ON sp_player_eggs (owner_id, state);
CREATE TABLE IF NOT EXISTS sp_pets (
  id TEXT PRIMARY KEY, species_id TEXT NOT NULL REFERENCES sp_species(id), name TEXT NOT NULL,
  character TEXT NOT NULL DEFAULT 'calm', shared BOOLEAN NOT NULL DEFAULT FALSE, skin_id TEXT,
  level INT NOT NULL DEFAULT 1, xp BIGINT NOT NULL DEFAULT 0,
  energy INT NOT NULL DEFAULT 80, satiety INT NOT NULL DEFAULT 80, health INT NOT NULL DEFAULT 100, hygiene INT NOT NULL DEFAULT 80, fun INT NOT NULL DEFAULT 70,
  stat_at TIMESTAMPTZ NOT NULL DEFAULT now(), skills JSONB NOT NULL DEFAULT '{}', accessories JSONB NOT NULL DEFAULT '[]',
  sleeping_until TIMESTAMPTZ, room TEXT NOT NULL DEFAULT 'living', source TEXT NOT NULL DEFAULT 'egg',
  actions_total INT NOT NULL DEFAULT 0, deleted_at TIMESTAMPTZ, born_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_owners (
  pet_id TEXT NOT NULL REFERENCES sp_pets(id) ON DELETE CASCADE, profile_id TEXT NOT NULL, favorite BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (pet_id, profile_id)
);
CREATE INDEX IF NOT EXISTS sp_owners_profile ON sp_owners (profile_id);
CREATE TABLE IF NOT EXISTS sp_history (
  id BIGSERIAL PRIMARY KEY, pet_id TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}',
  xp INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sp_history_pet ON sp_history (pet_id, id DESC);
CREATE TABLE IF NOT EXISTS sp_invites (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, egg_id TEXT NOT NULL REFERENCES sp_eggs(id), player_egg_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  chat_id TEXT, pet_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS sp_invites_open ON sp_invites (from_id, to_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS sp_houses (
  id TEXT PRIMARY KEY, profile_id TEXT, pet_id TEXT, name TEXT NOT NULL DEFAULT '',
  rooms JSONB NOT NULL DEFAULT '["living","kitchen","bath","bed"]', style JSONB NOT NULL DEFAULT '{}', placed JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sp_houses_profile ON sp_houses (profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sp_houses_pet ON sp_houses (pet_id) WHERE pet_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sp_tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('daily','weekly','joint','seasonal','holiday','event')),
  action TEXT NOT NULL, target INT NOT NULL DEFAULT 1 CHECK (target BETWEEN 1 AND 1000), reward JSONB NOT NULL DEFAULT '{}',
  event_id TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, builtin BOOLEAN NOT NULL DEFAULT FALSE, sort INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sp_task_progress (
  profile_id TEXT NOT NULL, task_id TEXT NOT NULL, period TEXT NOT NULL, progress INT NOT NULL DEFAULT 0, claimed_at TIMESTAMPTZ,
  PRIMARY KEY (profile_id, task_id, period)
);
CREATE TABLE IF NOT EXISTS sp_ach_claims (
  profile_id TEXT NOT NULL, key TEXT NOT NULL, pet_id TEXT NOT NULL DEFAULT '', claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, key, pet_id)
);
CREATE TABLE IF NOT EXISTS sp_events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK (kind IN ('collection','tournament','contest','holiday','season')),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, reward JSONB NOT NULL DEFAULT '{}', metric TEXT NOT NULL DEFAULT 'actions',
  active BOOLEAN NOT NULL DEFAULT TRUE, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_event_scores (
  event_id TEXT NOT NULL REFERENCES sp_events(id) ON DELETE CASCADE, profile_id TEXT NOT NULL, score INT NOT NULL DEFAULT 0, claimed_at TIMESTAMPTZ,
  PRIMARY KEY (event_id, profile_id)
);
CREATE TABLE IF NOT EXISTS sp_gifts (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('egg','item')), ref_id TEXT NOT NULL, qty INT NOT NULL DEFAULT 1,
  message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sp_transfers (
  id TEXT PRIMARY KEY, pet_id TEXT NOT NULL REFERENCES sp_pets(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('transfer','delete')),
  from_id TEXT NOT NULL, to_id TEXT, owners TEXT[] NOT NULL DEFAULT '{}', agreed TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','declined','cancelled','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sp_reactions (
  id BIGSERIAL PRIMARY KEY, house_owner TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL, pet_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sp_reactions_owner ON sp_reactions (house_owner, id DESC);
CREATE TABLE IF NOT EXISTS sp_photos (
  id TEXT PRIMARY KEY, pet_id TEXT NOT NULL REFERENCES sp_pets(id) ON DELETE CASCADE, actor_id TEXT NOT NULL, pose TEXT NOT NULL DEFAULT 'sit',
  caption TEXT NOT NULL DEFAULT '', snapshot JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sp_rate (profile_id TEXT NOT NULL, action TEXT NOT NULL, win BIGINT NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (profile_id, action, win));
CREATE TABLE IF NOT EXISTS sp_purchases (
  profile_id TEXT NOT NULL, idem_key TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, qty INT NOT NULL DEFAULT 1,
  coins BIGINT NOT NULL DEFAULT 0, points BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, idem_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS sp_transfers_open ON sp_transfers (pet_id) WHERE status = 'pending';
