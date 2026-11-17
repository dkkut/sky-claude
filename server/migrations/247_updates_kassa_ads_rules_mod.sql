-- Пять систем (ноябрь-2026): проверка обновлений, перевод по Sky ID, реклама Sky, правила Sky Business, автомодерация каналов.
-- Миграция только добавляет.

/* ── 1. Обновления приложения ── */
CREATE TABLE IF NOT EXISTS app_update_settings (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  latest_version TEXT NOT NULL DEFAULT '',
  latest_build   INT  NOT NULL DEFAULT 0,
  min_build      INT  NOT NULL DEFAULT 0,
  mandatory      BOOLEAN NOT NULL DEFAULT FALSE,
  message_ru     TEXT NOT NULL DEFAULT 'Доступно обновление. Обновите Sky в магазинах приложений или на странице "Обновления"',
  message_en     TEXT NOT NULL DEFAULT 'An update is available. Update Sky in app stores or on the "Updates" page',
  forced_ru      TEXT NOT NULL DEFAULT 'Эта версия Sky больше не поддерживается. Обновите приложение, чтобы продолжить',
  forced_en      TEXT NOT NULL DEFAULT 'This version of Sky is no longer supported. Update the app to continue',
  stores         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_update_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

/* ── 1б. Официальный бот @sky_bot — синяя отметка (повторяется на сервере при запуске: server/skybot.mjs → ensureBotMark) ── */
INSERT INTO profiles (id, sky_id, username, name, is_bot) VALUES ('acc-skybot-official', NULL, 'sky_bot', 'Sky', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO verifications (id, subject_type, subject_id, mark, status, requested_by, decided_by, decided_at)
SELECT 'ver-skybot-official', 'official', 'acc-skybot-official', 'official', 'approved', 'acc-skybot-official', 'acc-skybot-official', now()
WHERE NOT EXISTS (SELECT 1 FROM verifications WHERE subject_type = 'official' AND subject_id = 'acc-skybot-official' AND status IN ('pending','approved'))
  AND NOT EXISTS (SELECT 1 FROM verifications WHERE id = 'ver-skybot-official');

/* ── 2. Переводы по Sky ID ── */
CREATE TABLE IF NOT EXISTS wallet_p2p_settings (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  fee_percent      NUMERIC(5,2) NOT NULL DEFAULT 0,   -- комиссия задаётся владельцем; по умолчанию без комиссии
  fee_min          INT NOT NULL DEFAULT 0,
  fee_max          INT NOT NULL DEFAULT 0,            -- 0 — без потолка
  min_amount       INT NOT NULL DEFAULT 10,           -- в рублях (для валюты — рублёвый эквивалент по курсу)
  max_amount       INT NOT NULL DEFAULT 100000,
  daily_limit      INT NOT NULL DEFAULT 300000,
  new_days         INT NOT NULL DEFAULT 3,
  new_daily_limit  INT NOT NULL DEFAULT 5000,
  velocity_max     INT NOT NULL DEFAULT 8,            -- переводов за 10 минут
  recipients_flag  INT NOT NULL DEFAULT 10,           -- разных получателей за сутки → пометка
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO wallet_p2p_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS wallet_p2p (
  id            TEXT PRIMARY KEY,
  sender_id     TEXT NOT NULL,
  recipient_id  TEXT NOT NULL,
  currency      TEXT NOT NULL,             -- RUB или код валютного счёта
  amount        BIGINT NOT NULL,           -- рубли или сотые доли валюты
  fee           BIGINT NOT NULL DEFAULT 0,
  rate_rub      NUMERIC(18,6),             -- курс на момент операции (для валюты)
  rub_equiv     BIGINT NOT NULL,           -- рублёвый эквивалент (для лимитов)
  note          TEXT,
  idem_key      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'done',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sender_id, idem_key)
);
CREATE INDEX IF NOT EXISTS wallet_p2p_sender_idx ON wallet_p2p (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_p2p_recipient_idx ON wallet_p2p (recipient_id, created_at DESC);
CREATE TABLE IF NOT EXISTS wallet_p2p_flags (
  id          BIGSERIAL PRIMARY KEY,
  transfer_id TEXT,
  user_id     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'review' CHECK (level IN ('review','blocked')),
  detail      TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_p2p_flags_open_idx ON wallet_p2p_flags (at DESC) WHERE reviewed_at IS NULL;
-- Заявки на подключение иностранных организаций и платёжных провайдеров: только учёт, ничего не подключает.
CREATE TABLE IF NOT EXISTS skykassa_intl_providers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  country    TEXT NOT NULL,
  legal_name TEXT NOT NULL DEFAULT '',
  currencies TEXT[] NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','checking','ready_for_adapter','rejected')),
  checklist  JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes      TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ── 3. Sky Ads: кампании от администрации, свои объявления Sky, защита ссылок ── */
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_placement_check;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS max_per_user_day INT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS admin_created BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS link_sig TEXT;
CREATE TABLE IF NOT EXISTS ad_house (
  id         TEXT PRIMARY KEY,
  service    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  cta        TEXT NOT NULL DEFAULT 'Открыть',
  module     TEXT NOT NULL,              -- раздел приложения, куда ведёт объявление (только внутренние переходы)
  tab        TEXT,
  priority   INT NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  placements TEXT[] NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ad_house_daily (
  day         DATE NOT NULL,
  house_id    TEXT NOT NULL,
  placement   TEXT NOT NULL,
  impressions INT NOT NULL DEFAULT 0,
  clicks      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, house_id, placement)
);
CREATE TABLE IF NOT EXISTS ad_link_tamper (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ad_house (id, service, title, body, cta, module, tab, priority, placements) VALUES
 ('house-messenger','Messenger','Sky Messenger','Чаты, каналы и звонки в одном приложении.','Открыть чаты','messages',NULL,50,'{video_banner,bloom_feed,channel_post,video_preroll,film_preroll}'),
 ('house-prime','Prime','Sky Prime','Музыка, кино, подкасты и книги без рекламы.','Узнать о Prime','extras','prime',90,'{video_banner,bloom_feed,channel_post,video_preroll,film_preroll}'),
 ('house-music','Music','Sky Music','Слушайте музыку и собирайте свою коллекцию.','Слушать','extras','music',60,'{video_banner,bloom_feed,channel_post,video_preroll,film_preroll}'),
 ('house-tv','TV','Sky TV','Телеканалы и эфир в Sky.','Смотреть','extras','tv',40,'{video_banner,bloom_feed,channel_post,video_preroll,film_preroll}'),
 ('house-studio','Studio','Sky Studio','Публикуйте музыку, видео и книги, развивайте канал.','Открыть Студию','studio',NULL,40,'{video_banner,bloom_feed,channel_post,video_preroll,film_preroll}'),
 ('house-business','Business','Sky для бизнеса','Касса, каталог и сервисы для организаций.','Открыть Business','business',NULL,40,'{video_banner,bloom_feed,channel_post,video_preroll,film_preroll}'),
 ('house-film','Film','Sky Film','Фильмы и сериалы с продолжением на любом устройстве.','Смотреть','extras','film',30,'{video_banner,bloom_feed,channel_post,video_preroll}')
ON CONFLICT DO NOTHING;

/* ── 4. Sky Business: правила организаций ── */
CREATE TABLE IF NOT EXISTS biz_rule_revisions (
  id           TEXT PRIMARY KEY,
  section      TEXT NOT NULL,
  version      INT  NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  change_note  TEXT NOT NULL DEFAULT '',
  created_by   TEXT,
  published_by TEXT,
  published_at TIMESTAMPTZ,
  notified     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (section, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS biz_rule_one_published ON biz_rule_revisions (section) WHERE status = 'published';
CREATE TABLE IF NOT EXISTS biz_rule_acks (
  profile_id  TEXT NOT NULL,
  section     TEXT NOT NULL,
  version     INT NOT NULL,
  business_id TEXT,
  acked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, section, version)
);

/* ── 5. Автомодерация каналов ── */
CREATE TABLE IF NOT EXISTS chan_mod_settings (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  review_score   INT NOT NULL DEFAULT 40,   -- с этого балла дело уходит модератору
  serious_score  INT NOT NULL DEFAULT 75,   -- «серьёзная угроза»: в начало очереди, рекомендация ограничить
  auto_restrict  BOOLEAN NOT NULL DEFAULT FALSE, -- автоограничение без человека (выключено по умолчанию; включает владелец)
  restrict_hours INT NOT NULL DEFAULT 72,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO chan_mod_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS chan_mod_cases (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'scan',         -- scan | reports | manual
  score       INT NOT NULL DEFAULT 0,
  signals     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review','dismissed','restricted','appealed','restored','closed')),
  serious     BOOLEAN NOT NULL DEFAULT FALSE,
  freeze_id   TEXT,
  decided_by  TEXT,
  decision    TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chan_mod_one_open ON chan_mod_cases (chat_id) WHERE status IN ('review','restricted','appealed');
CREATE TABLE IF NOT EXISTS chan_mod_log (
  id      BIGSERIAL PRIMARY KEY,
  case_id TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT,
  action  TEXT NOT NULL,
  detail  TEXT
);
CREATE TABLE IF NOT EXISTS chan_mod_reports (
  chat_id     TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  weight      NUMERIC(4,2) NOT NULL DEFAULT 1,
  outcome     TEXT,                           -- confirmed | dismissed — по итогам дела
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, reporter_id)
);
CREATE TABLE IF NOT EXISTS chan_mod_state (
  id        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_scan TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO chan_mod_state (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
