-- Sky Pets — полноценная экосистема: коллекционирование, прогрессия,
-- внутриигровая экономика (Pet Coins, отдельная от Sky Money) и Sky
-- Skin Market. Расширяет то, что уже было в мессенджере (PetHouse и
-- т.д. — клиент-локальный прототип без сервера), а не переписывает
-- заново: 12 персонажей из старого petData.ts и часть примеров скинов
-- из petSkins.ts переносятся сюда как стартовые данные каталога (см.
-- server/petsEcon.mjs, сид при первом запуске).

-- ───────── Каталог типов питомцов (админ управляет) ─────────
CREATE TABLE IF NOT EXISTS pet_types (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  species      TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  base_color   TEXT NOT NULL,
  base_rarity  TEXT NOT NULL DEFAULT 'common'
                 CHECK (base_rarity IN ('common','uncommon','rare','epic','legendary','mythic','secret')),
  sounds       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- NULL = не продаётся (стартовый или только по событию/достижению).
  price_pet_coins  INT CHECK (price_pet_coins IS NULL OR price_pet_coins >= 0),
  available_from   TEXT NOT NULL DEFAULT 'starter' CHECK (available_from IN ('starter','shop','event','achievement')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── Питомцы пользователей — конкретные экземпляры ─────────
CREATE TABLE IF NOT EXISTS pets (
  id                 TEXT PRIMARY KEY,
  profile_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type_id            TEXT NOT NULL REFERENCES pet_types(id),
  name               TEXT NOT NULL,
  rarity             TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic','secret')),
  level              INT NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp                 INT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  stage              TEXT NOT NULL DEFAULT 'baby' CHECK (stage IN ('baby','young','adult','special')),
  stage_history      JSONB NOT NULL DEFAULT '[]'::jsonb,
  mood               TEXT NOT NULL DEFAULT 'idle' CHECK (mood IN ('idle','happy','excited','sleepy','love','angry')),
  happiness          INT NOT NULL DEFAULT 70 CHECK (happiness BETWEEN 0 AND 100),
  energy             INT NOT NULL DEFAULT 80 CHECK (energy BETWEEN 0 AND 100),
  hunger             INT NOT NULL DEFAULT 80 CHECK (hunger BETWEEN 0 AND 100),
  loyalty            INT NOT NULL DEFAULT 10 CHECK (loyalty BETWEEN 0 AND 100),
  intelligence       INT NOT NULL DEFAULT 10 CHECK (intelligence BETWEEN 0 AND 100),
  luck               INT NOT NULL DEFAULT 10 CHECK (luck BETWEEN 0 AND 100),
  stats_updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  acquisition_source TEXT NOT NULL DEFAULT 'starter' CHECK (acquisition_source IN ('starter','shop','event','gift','achievement')),
  acquired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pets_profile_idx ON pets (profile_id);
-- Только один «любимый» питомец на профиль одновременно.
CREATE UNIQUE INDEX IF NOT EXISTS pets_one_active_idx ON pets (profile_id) WHERE is_active;

-- Видимость питомца — можно полностью отключить показ.
CREATE TABLE IF NOT EXISTS pet_visibility_settings (
  profile_id          TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  show_in_profile     BOOLEAN NOT NULL DEFAULT true,
  show_near_messages  BOOLEAN NOT NULL DEFAULT true,
  show_in_chats       BOOLEAN NOT NULL DEFAULT true,
  hidden_entirely     BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Журнал ухода — источник правды для cooldown на сервере.
CREATE TABLE IF NOT EXISTS pet_care_log (
  id          TEXT PRIMARY KEY,
  pet_id      TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('feed','play','pet','sleep','walk','toy')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pet_care_log_pet_action_idx ON pet_care_log (pet_id, action, created_at DESC);

-- ───────── Pet Coins — отдельная валюта, никогда не Sky Money ─────────
CREATE TABLE IF NOT EXISTS pet_wallets (
  profile_id  TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Immutable-журнал: строки никогда не редактируются и не удаляются
-- (кроме каскада при удалении профиля) — только добавляются.
CREATE TABLE IF NOT EXISTS pet_currency_transactions (
  id              TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
                    'earn_care','earn_quest','earn_achievement','earn_event','earn_minigame',
                    'earn_admin_grant','spend_shop','spend_market','burn_fee','refund'
                  )),
  amount          BIGINT NOT NULL CHECK (amount <> 0),
  descr           TEXT NOT NULL DEFAULT '',
  ref             TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pet_currency_tx_idem_idx
  ON pet_currency_transactions (profile_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pet_currency_tx_profile_idx ON pet_currency_transactions (profile_id, created_at DESC);

-- ───────── Достижения ─────────
CREATE TABLE IF NOT EXISTS pet_achievements (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  metric         TEXT NOT NULL,
  goal           INT NOT NULL DEFAULT 1,
  reward_xp      INT NOT NULL DEFAULT 0,
  reward_coins   INT NOT NULL DEFAULT 0,
  reward_item_id TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pet_user_achievements (
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES pet_achievements(id) ON DELETE CASCADE,
  progress       INT NOT NULL DEFAULT 0,
  unlocked_at    TIMESTAMPTZ,
  PRIMARY KEY (profile_id, achievement_id)
);

-- ───────── Ежедневные задания (максимум 3 в сутки — проверяется в коде) ─────────
CREATE TABLE IF NOT EXISTS pet_quests (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  metric         TEXT NOT NULL,
  goal           INT NOT NULL DEFAULT 1,
  reward_xp      INT NOT NULL DEFAULT 0,
  reward_coins   INT NOT NULL DEFAULT 0,
  reward_item_id TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pet_user_quests (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  quest_id     TEXT NOT NULL REFERENCES pet_quests(id),
  assigned_on  DATE NOT NULL,
  progress     INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  claimed_at   TIMESTAMPTZ,
  UNIQUE (profile_id, quest_id, assigned_on)
);
CREATE INDEX IF NOT EXISTS pet_user_quests_today_idx ON pet_user_quests (profile_id, assigned_on);

-- ───────── Сезонные события ─────────
CREATE TABLE IF NOT EXISTS pet_events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','ended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pet_event_rewards (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES pet_events(id) ON DELETE CASCADE,
  metric         TEXT NOT NULL,
  goal           INT NOT NULL DEFAULT 1,
  reward_xp      INT NOT NULL DEFAULT 0,
  reward_coins   INT NOT NULL DEFAULT 0,
  reward_item_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pet_event_progress (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reward_id   TEXT NOT NULL REFERENCES pet_event_rewards(id) ON DELETE CASCADE,
  progress    INT NOT NULL DEFAULT 0,
  claimed_at  TIMESTAMPTZ,
  PRIMARY KEY (profile_id, reward_id)
);

-- ───────── SKY SKIN MARKET ─────────
CREATE TABLE IF NOT EXISTS skin_collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_id    TEXT REFERENCES pet_events(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skin_items (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  description              TEXT NOT NULL DEFAULT '',
  item_type                TEXT NOT NULL CHECK (item_type IN
                             ('skin','outfit','headwear','accessory','aura','effect','animation','background','trail','emote')),
  pet_type_id              TEXT REFERENCES pet_types(id),
  rarity                   TEXT NOT NULL CHECK (rarity IN ('common','uncommon','rare','epic','legendary','mythic','secret')),
  availability             TEXT NOT NULL CHECK (availability IN ('unlimited','limited','event','exclusive')),
  supply                   INT CHECK (supply IS NULL OR supply > 0),
  issued_count             INT NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  price_pet_coins          INT CHECK (price_pet_coins IS NULL OR price_pet_coins >= 0),
  price_sky_money_kopecks  INT CHECK (price_sky_money_kopecks IS NULL OR price_sky_money_kopecks >= 0),
  collection_id            TEXT REFERENCES skin_collections(id) ON DELETE SET NULL,
  event_id                 TEXT REFERENCES pet_events(id) ON DELETE SET NULL,
  preview_media_id         TEXT,
  preview_mime             TEXT,
  model_media_id           TEXT,
  model_mime               TEXT,
  animations               JSONB NOT NULL DEFAULT '[]'::jsonb,
  effects                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  author_id                TEXT REFERENCES profiles(id),
  released_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (availability <> 'limited' OR supply IS NOT NULL),
  CHECK (price_pet_coins IS NOT NULL OR price_sky_money_kopecks IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS skin_items_type_idx ON skin_items (item_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS skin_items_pet_type_idx ON skin_items (pet_type_id) WHERE status = 'active';

-- Владение — по одной строке на (профиль, предмет); Limited дополнительно
-- несёт номер экземпляра, который сервер выдаёт атомарно (см. purchaseSkin
-- в petsEcon.mjs) и который никогда не повторяется для одного item_id.
CREATE TABLE IF NOT EXISTS skin_inventory (
  id              TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL REFERENCES skin_items(id),
  instance_number INT,
  acquired_via    TEXT NOT NULL DEFAULT 'purchase' CHECK (acquired_via IN
                    ('purchase','event','achievement','quest','gift','admin_grant','trade')),
  acquired_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS skin_inventory_owner_item_idx ON skin_inventory (profile_id, item_id);
CREATE UNIQUE INDEX IF NOT EXISTS skin_inventory_instance_idx ON skin_inventory (item_id, instance_number) WHERE instance_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS skin_inventory_profile_idx ON skin_inventory (profile_id);

-- Идемпотентность покупки: повтор того же ключа не списывает дважды.
CREATE TABLE IF NOT EXISTS skin_purchase_attempts (
  idempotency_key TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL REFERENCES skin_items(id),
  status          TEXT NOT NULL CHECK (status IN ('ok','error')),
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Экипировка — по одному предмету на одиночный слот питомца.
CREATE TABLE IF NOT EXISTS skin_equipment (
  pet_id      TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL CHECK (slot IN ('skin','outfit','headwear','aura','effect','trail')),
  item_id     TEXT NOT NULL REFERENCES skin_items(id),
  equipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pet_id, slot)
);
-- Множественные слоты (аксессуары, эмоции) — своя позиция внутри слота.
CREATE TABLE IF NOT EXISTS skin_equipment_multi (
  pet_id      TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL CHECK (slot IN ('accessory','emote')),
  position    INT NOT NULL DEFAULT 0,
  item_id     TEXT NOT NULL REFERENCES skin_items(id),
  equipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pet_id, slot, position)
);

-- ───────── Заготовка вторичного P2P-рынка (создана, но не включена) ─────────
CREATE TABLE IF NOT EXISTS skin_listings (
  id              TEXT PRIMARY KEY,
  seller_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inventory_id    TEXT NOT NULL REFERENCES skin_inventory(id) ON DELETE CASCADE,
  price_pet_coins INT NOT NULL CHECK (price_pet_coins > 0),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','sold')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ
);
-- Один и тот же экземпляр нельзя выставить дважды одновременно.
CREATE UNIQUE INDEX IF NOT EXISTS skin_listings_one_active_idx ON skin_listings (inventory_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS skin_transactions (
  id              TEXT PRIMARY KEY,
  listing_id      TEXT REFERENCES skin_listings(id),
  item_id         TEXT NOT NULL REFERENCES skin_items(id),
  seller_id       TEXT REFERENCES profiles(id),
  buyer_id        TEXT NOT NULL REFERENCES profiles(id),
  price_pet_coins INT NOT NULL DEFAULT 0,
  price_sky_money_kopecks INT NOT NULL DEFAULT 0,
  fee_pet_coins   INT NOT NULL DEFAULT 0,
  kind            TEXT NOT NULL CHECK (kind IN ('primary_purchase','p2p_trade')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skin_ownership_history (
  id              TEXT PRIMARY KEY,
  item_id         TEXT NOT NULL REFERENCES skin_items(id),
  instance_number INT,
  from_profile_id TEXT REFERENCES profiles(id),
  to_profile_id   TEXT NOT NULL REFERENCES profiles(id),
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── Экономические параметры — настраиваются из админки, не хардкод ─────────
CREATE TABLE IF NOT EXISTS pet_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO pet_config (key, value) VALUES
  ('max_level', '50'),
  ('xp_per_level_base', '200'),
  ('market_fee_percent', '10'),
  ('daily_quest_count', '3'),
  ('accessory_slots', '3'),
  ('emote_slots', '4')
ON CONFLICT (key) DO NOTHING;

-- ───────── Стартовый каталог достижений и заданий (брифу нужны примеры,
-- дальше их заводит админка — таблица позволяет добавлять новые без
-- изменения кода) ─────────
INSERT INTO pet_achievements (id, title, description, metric, goal, reward_xp, reward_coins) VALUES
  ('ach-first-pet',    'Первый питомец',    'Заведите своего первого питомца',              'pets_owned',        1,  0,  50),
  ('ach-int-10',       '10 взаимодействий', 'Позаботьтесь о питомце 10 раз',                'interactions_total',10, 0,  30),
  ('ach-days-7',       '7 дней вместе',     'Заходите к питомцу 7 разных дней',             'days_together',     7,  0,  100),
  ('ach-int-100',      '100 взаимодействий','Позаботьтесь о питомце 100 раз',               'interactions_total',100,0,  200),
  ('ach-lvl-10',       'Питомец 10 уровня', 'Прокачайте питомца до 10 уровня',              'level_reached',     10, 0,  150),
  ('ach-lvl-50',       'Питомец 50 уровня', 'Прокачайте питомца до 50 уровня',              'level_reached',     50, 0,  500),
  ('ach-pets-5',       '5 питомцев',        'Соберите 5 питомцев',                          'pets_owned',        5,  0,  300),
  ('ach-pets-10',      '10 питомцев',       'Соберите 10 питомцев',                         'pets_owned',        10, 0,  600),
  ('ach-collector',    'Коллекционер',      'Соберите 10 скинов',                           'skins_owned',       10, 0,  400),
  ('ach-night-owl',    'Ночной игрок',      'Позаботьтесь о питомце 20 раз ночью',          'night_interactions',20, 0,  250)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pet_quests (id, title, description, metric, goal, reward_xp, reward_coins) VALUES
  ('pq-feed',        'Покормить питомца',        'Покормите питомца сегодня',            'care_feed',      1,  20, 10),
  ('pq-play',        'Поиграть с питомцем',      'Поиграйте с питомцем сегодня',          'care_play',      1,  20, 10),
  ('pq-interact',    'Позаботиться о питомце',   'Выполните любое взаимодействие',       'interactions_total', 1, 15, 10),
  ('pq-xp',          'Набрать опыт',             'Наберите 50 очков опыта',               'xp_gained',      50, 0,  20),
  ('pq-equip',       'Использовать аксессуар',   'Наденьте на питомца аксессуар',         'equip_accessory',1,  10, 15)
ON CONFLICT (id) DO NOTHING;
