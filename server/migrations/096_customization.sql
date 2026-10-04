-- Маркет кастомизации (рамки/баннеры чата/темы профиля/оформление
-- списка чатов) был полностью клиентским: владение и экипировка жили
-- в localStorage браузера, а «покупка» ничего не списывала — кнопка
-- «Получить и применить» просто дописывала id в массив на устройстве.
-- Здесь — реальная сторона: кто чем владеет, что сейчас надето, и по
-- какой цене в баллах (server/wallet.mjs) это можно купить.
--
-- Внешний вид предметов (градиенты/анимации/мотивы) остаётся кодом на
-- клиенте (src/customization/catalog/*.ts) — в этом нет ничего
-- секретного, менять их может только деплой. Здесь только то, что
-- должно быть источником правды на сервере: цена и факт владения.

CREATE TABLE IF NOT EXISTS customization_catalog (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL CHECK (category IN ('frame','banner','profileTheme','chatListStyle')),
  price_points INT  NOT NULL CHECK (price_points > 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Владение — по одной строке на (профиль, предмет).
CREATE TABLE IF NOT EXISTS customization_inventory (
  id           TEXT PRIMARY KEY,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL REFERENCES customization_catalog(id),
  acquired_via TEXT NOT NULL DEFAULT 'purchase' CHECK (acquired_via IN ('purchase','admin_grant')),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customization_inventory_owner_item_idx
  ON customization_inventory (profile_id, item_id);
CREATE INDEX IF NOT EXISTS customization_inventory_profile_idx
  ON customization_inventory (profile_id);

-- Что сейчас надето — по одному предмету на категорию.
CREATE TABLE IF NOT EXISTS customization_equipped (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('frame','banner','profileTheme','chatListStyle')),
  item_id    TEXT NOT NULL,
  PRIMARY KEY (profile_id, category)
);

-- Идемпотентность покупки — тот же паттерн, что у skin_purchase_attempts
-- и ticket-заказов: повтор того же ключа (двойной тап, обрыв сети) не
-- списывает баллы дважды.
CREATE TABLE IF NOT EXISTS customization_purchase_attempts (
  idempotency_key TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('ok','error')),
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Цены по редкости: common 490, rare 1490, epic 2990, legendary 5990,
-- mythic 12990 баллов — тот же порядок величин, что у обычных подарков
-- (server/gifts.mjs), но дешевле: это разовая покупка перманентного
-- оформления, не расходуемый подарок кому-то другому.
INSERT INTO customization_catalog (id, category, price_points) VALUES
  ('frame-neon', 'frame', 2990),
  ('frame-blue-fire', 'frame', 2990),
  ('frame-purple-energy', 'frame', 2990),
  ('frame-stars', 'frame', 1490),
  ('frame-crystal', 'frame', 5990),
  ('frame-cyber-ring', 'frame', 2990),
  ('frame-lightning', 'frame', 5990),
  ('frame-flowers', 'frame', 1490),
  ('frame-golden', 'frame', 5990),
  ('frame-diamond', 'frame', 12990),
  ('frame-liquid', 'frame', 5990),
  ('banner-neon', 'banner', 2990),
  ('banner-space', 'banner', 2990),
  ('banner-galaxy', 'banner', 5990),
  ('banner-sunset', 'banner', 1490),
  ('banner-sakura', 'banner', 2990),
  ('banner-cyber', 'banner', 2990),
  ('banner-crystal', 'banner', 5990),
  ('banner-ocean', 'banner', 1490),
  ('banner-fire', 'banner', 2990),
  ('banner-vaporwave', 'banner', 2990),
  ('theme-galaxy', 'profileTheme', 5990),
  ('theme-cloud', 'profileTheme', 1490),
  ('theme-cyber', 'profileTheme', 2990),
  ('theme-crystal', 'profileTheme', 5990),
  ('theme-anime', 'profileTheme', 2990),
  ('theme-forest', 'profileTheme', 1490),
  ('theme-minimal', 'profileTheme', 490),
  ('theme-ocean', 'profileTheme', 1490),
  ('theme-royal', 'profileTheme', 5990),
  ('theme-night', 'profileTheme', 1490),
  ('theme-retro', 'profileTheme', 2990),
  ('theme-neon', 'profileTheme', 2990),
  ('cls-neon-strip', 'chatListStyle', 2990),
  ('cls-animated-gradient', 'chatListStyle', 5990),
  ('cls-glass-card', 'chatListStyle', 1490),
  ('cls-iridescent', 'chatListStyle', 5990),
  ('cls-cosmic-glow', 'chatListStyle', 2990),
  ('cls-gold-frame', 'chatListStyle', 5990)
ON CONFLICT (id) DO NOTHING;
