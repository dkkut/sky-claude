-- Sky Ads — подключение уже существующего клиентского интерфейса
-- (src/ads: SkyAds.tsx, AdBlocks.tsx, store.ts) к реальному серверу.
-- До этой миграции вся реклама жила в localStorage: кампании,
-- «показы», «клики» и даже модерация были придуманы в браузере
-- (Math.random для показов/кликов, useAdsStore.moderate ничего не
-- проверял). Рекламодатель — уже существующий профиль (Sky ID),
-- отдельного аккаунта рекламодателя не заводим.

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                  TEXT PRIMARY KEY,
  advertiser_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  format              TEXT NOT NULL CHECK (format IN ('video','image','text','text_image')),
  placement           TEXT NOT NULL CHECK (placement IN
                        ('video_preroll','video_banner','bloom_feed','bloom_stories','channel_post','channel_pin')),
  media_id            TEXT,
  link_url            TEXT,

  -- Таргетинг: пустой список регионов = показывать всем регионам.
  -- Полярность обратная блокировкам контента Bloom/SkyVideo (там список
  -- запрещённых), здесь — список выбранных: рекламодатель выбирает,
  -- где показывать, а не где скрыть.
  target_regions      TEXT[] NOT NULL DEFAULT '{}',

  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                        ('draft','moderation','approved','rejected','scheduled','active','paused','completed','cancelled')),

  -- Деньги списываются один раз при создании (см. server/ads.mjs::
  -- createCampaign) через уже существующий кошелёк (wallet.spend) —
  -- отдельного платёжного движка нет. budget/daily_limit — целые рубли,
  -- как и весь остальной кошелёк Sky (server/wallet.mjs::validAmount).
  budget              INT NOT NULL,
  daily_limit         INT NOT NULL,
  duration_days       INT NOT NULL,
  -- Дневной потолок показов на площадку — снимок цены на момент
  -- создания (см. PLACEMENTS в ads.mjs): если цены поменяются позже,
  -- уже оплаченная кампания не должна задним числом получить другой лимit.
  max_impressions_per_day INT NOT NULL,
  wallet_tx_ref       TEXT,

  requested_start_at  TIMESTAMPTZ,
  starts_at           TIMESTAMPTZ,
  ends_at             TIMESTAMPTZ,

  reject_reason       TEXT,
  approved_by         TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  cancelled_by        TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  cancelled_at        TIMESTAMPTZ,
  paused_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ad_campaigns_advertiser_idx ON ad_campaigns (advertiser_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_campaigns_status_idx ON ad_campaigns (status);
CREATE INDEX IF NOT EXISTS ad_campaigns_serving_idx ON ad_campaigns (placement, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS ad_campaigns_dates_idx ON ad_campaigns (starts_at, ends_at);

-- История жизненного цикла кампании — для «Администратор должен видеть
-- историю изменений» и для опроса уведомлений рекламодателя (тот же
-- принцип, что recentEvents у Bloom: отдельная таблица не заменяет
-- admin_log — там по-прежнему пишутся все административные действия,
-- здесь — читаемая лента по конкретной кампании).
CREATE TABLE IF NOT EXISTS ad_campaign_events (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  actor_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  detail        TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_campaign_events_campaign_idx ON ad_campaign_events (campaign_id, created_at DESC);

-- Реальные показы. dedup-поля используют частотные ограничения
-- (server/ads.mjs::FREQ_CAP) — не бесконечная накрутка обновлением
-- страницы и не десятки показов одному человеку подряд.
CREATE TABLE IF NOT EXISTS ad_impressions (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  advertiser_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  placement      TEXT NOT NULL,
  region         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_impressions_campaign_idx ON ad_impressions (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_impressions_user_campaign_idx ON ad_impressions (campaign_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_impressions_user_placement_idx ON ad_impressions (user_id, placement, created_at DESC);

CREATE TABLE IF NOT EXISTS ad_clicks (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  impression_id  TEXT NOT NULL REFERENCES ad_impressions(id) ON DELETE CASCADE,
  advertiser_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  placement      TEXT NOT NULL,
  region         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Один клик на один показ: тот же показ дважды учтённым кликом не
  -- станет, сколько бы раз клиент ни повторил запрос (защита от replay).
  UNIQUE (impression_id)
);
CREATE INDEX IF NOT EXISTS ad_clicks_campaign_idx ON ad_clicks (campaign_id, created_at DESC);
