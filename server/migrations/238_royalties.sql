-- Sky Royalties: фонды, прослушивания, расчёт Pro Rata, доли соавторов, баланс по журналу, выплаты, защита от накруток.
-- Только добавляет. Деньги здесь — в копейках (BIGINT); выплата в кошелёк Sky округляется вниз до рубля, остаток копеек не теряется.

CREATE TABLE IF NOT EXISTS royalty_settings (
  id             INT PRIMARY KEY CHECK (id = 1),
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,           -- пока выключено, прослушивания пишутся, но периоды не закрываются
  prime_pool_bp  INT NOT NULL DEFAULT 1500 CHECK (prime_pool_bp BETWEEN 0 AND 10000),   -- 15 % — первоначальный лимит от чистой выручки музыкальной части Prime
  ad_pool_bp     INT CHECK (ad_pool_bp BETWEEN 0 AND 10000),        -- NULL = не задано владельцем
  music_share_bp INT CHECK (music_share_bp BETWEEN 0 AND 10000),    -- доля музыки в стоимости Prime; NULL = не задано
  tax_bp         INT NOT NULL DEFAULT 0 CHECK (tax_bp BETWEEN 0 AND 10000),
  store_bp       INT NOT NULL DEFAULT 0 CHECK (store_bp BETWEEN 0 AND 10000),
  payment_bp     INT NOT NULL DEFAULT 0 CHECK (payment_bp BETWEEN 0 AND 10000),
  min_payout_kopecks BIGINT NOT NULL DEFAULT 50000 CHECK (min_payout_kopecks >= 0),  -- 500 ₽
  hold_days      INT NOT NULL DEFAULT 14 CHECK (hold_days BETWEEN 0 AND 180),
  require_kyc    BOOLEAN NOT NULL DEFAULT TRUE,
  min_listen_sec INT NOT NULL DEFAULT 30 CHECK (min_listen_sec BETWEEN 5 AND 120),
  fraud          JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO royalty_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS royalty_periods (
  id          TEXT PRIMARY KEY,                       -- YYYY-MM
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  snapshot    JSONB,                                  -- настройки на момент закрытия
  recon       JSONB,                                  -- сверка: фонд, распределено, удержано, нераспределено
  closed_by   TEXT,
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Выручка по источникам (вводит финансист по факту, подтверждает; по закрытому периоду не меняется).
CREATE TABLE IF NOT EXISTS royalty_revenue (
  id              BIGSERIAL PRIMARY KEY,
  period          TEXT NOT NULL REFERENCES royalty_periods(id),
  source          TEXT NOT NULL CHECK (source IN ('prime_music','ad_free')),
  country         TEXT NOT NULL DEFAULT '*',
  gross_kopecks   BIGINT NOT NULL CHECK (gross_kopecks >= 0),        -- prime_music: вся выручка Prime; ad_free: чистая рекламная выручка Sky Music
  refunds_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (refunds_kopecks >= 0),
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  entered_by      TEXT NOT NULL,
  confirmed_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, source, country)
);

-- Действительные прослушивания. Сервер сам измеряет время между «начало» и «конец»; клиент секунды не присылает.
CREATE TABLE IF NOT EXISTS royalty_plays (
  id          BIGSERIAL PRIMARY KEY,
  play_key    TEXT NOT NULL,
  listener_id TEXT NOT NULL,
  track_id    TEXT NOT NULL,
  card_id     TEXT,                                   -- правообладатель на момент прослушивания
  period      TEXT NOT NULL,
  country     TEXT NOT NULL DEFAULT 'ZZ',
  sub_kind    TEXT NOT NULL CHECK (sub_kind IN ('prime','free')),
  device_hash TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','valid','review','invalid','abandoned')),
  flags       TEXT[] NOT NULL DEFAULT '{}',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (listener_id, play_key)
);
CREATE INDEX IF NOT EXISTS royalty_plays_period ON royalty_plays (period, status, sub_kind, country);
CREATE INDEX IF NOT EXISTS royalty_plays_listener ON royalty_plays (listener_id, started_at DESC);
CREATE INDEX IF NOT EXISTS royalty_plays_card ON royalty_plays (card_id, period);

-- Доли соавторов трека. Версии; активная — одна на трек. Нет активной — 100 % владельцу карточки.
CREATE TABLE IF NOT EXISTS royalty_splits (
  id           BIGSERIAL PRIMARY KEY,
  track_id     TEXT NOT NULL,
  version      INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','rejected','superseded')),
  proposed_by  TEXT NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  UNIQUE (track_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS royalty_splits_active ON royalty_splits (track_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS royalty_splits_proposed ON royalty_splits (track_id) WHERE status = 'proposed';
CREATE TABLE IF NOT EXISTS royalty_split_parts (
  split_id    BIGINT NOT NULL REFERENCES royalty_splits(id) ON DELETE CASCADE,
  holder_id   TEXT NOT NULL,
  bp          INT NOT NULL CHECK (bp BETWEEN 1 AND 10000),
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (split_id, holder_id)
);

-- Кто обязан принять предложение о долях (новые получатели и действующие получатели).
CREATE TABLE IF NOT EXISTS royalty_split_ack (
  split_id    BIGINT NOT NULL REFERENCES royalty_splits(id) ON DELETE CASCADE,
  holder_id   TEXT NOT NULL,
  accepted_at TIMESTAMPTZ,
  PRIMARY KEY (split_id, holder_id)
);

CREATE TABLE IF NOT EXISTS royalty_profiles (
  profile_id    TEXT PRIMARY KEY,
  kyc_status    TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none','pending','verified','rejected')),
  kyc_note      TEXT,                                  -- внутренний, автору не показывается
  kyc_by        TEXT,
  kyc_at        TIMESTAMPTZ,
  requisites_enc TEXT,                                 -- зашифрованные реквизиты (на будущее; сейчас выплата только в кошелёк Sky)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Заявка автора на участие в роялти.
CREATE TABLE IF NOT EXISTS royalty_enrollments (
  profile_id  TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','approved','rejected','needs_info')),
  checks      JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason      TEXT,
  decided_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);

-- Начисления закрытого периода: по треку, сегменту (тип подписки × страна) и получателю.
CREATE TABLE IF NOT EXISTS royalty_accruals (
  id               BIGSERIAL PRIMARY KEY,
  period           TEXT NOT NULL REFERENCES royalty_periods(id),
  track_id         TEXT NOT NULL,
  card_id          TEXT,
  holder_id        TEXT NOT NULL,
  seg_kind         TEXT NOT NULL,
  seg_country      TEXT NOT NULL,
  source           TEXT NOT NULL,
  pool_bp          INT NOT NULL,
  net_kopecks      BIGINT NOT NULL,
  fund_kopecks     BIGINT NOT NULL,
  seg_plays        BIGINT NOT NULL,
  track_plays      BIGINT NOT NULL,
  review_plays     BIGINT NOT NULL DEFAULT 0,
  split_bp         INT NOT NULL,
  split_id         BIGINT,
  amount_kopecks   BIGINT NOT NULL,                    -- по действительным прослушиваниям
  held_kopecks     BIGINT NOT NULL DEFAULT 0,          -- по прослушиваниям на проверке (остаток)
  review_left      BIGINT NOT NULL DEFAULT 0,
  extra_kopecks    BIGINT NOT NULL DEFAULT 0,          -- доплата после проверки подозрительных прослушиваний (в расчётные поля не входит)
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','available','unclaimed')),
  release_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, track_id, seg_kind, seg_country, holder_id)
);
CREATE INDEX IF NOT EXISTS royalty_accruals_holder ON royalty_accruals (holder_id, period);

-- Баланс — ТОЛЬКО сумма журнала. Журнал только дописывается.
CREATE TABLE IF NOT EXISTS royalty_ledger (
  id        BIGSERIAL PRIMARY KEY,
  holder_id TEXT NOT NULL,
  bucket    TEXT NOT NULL CHECK (bucket IN ('pending','available','held','unclaimed','reserved','paid')),
  delta     BIGINT NOT NULL,
  kind      TEXT NOT NULL,
  period    TEXT,
  ref       TEXT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS royalty_ledger_holder ON royalty_ledger (holder_id, bucket);
CREATE INDEX IF NOT EXISTS royalty_ledger_ref ON royalty_ledger (ref);

CREATE TABLE IF NOT EXISTS royalty_payouts (
  id             TEXT PRIMARY KEY,
  holder_id      TEXT NOT NULL,
  amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
  status         TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','paid','rejected','cancelled')),
  idem_key       TEXT NOT NULL,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  note           TEXT,
  UNIQUE (holder_id, idem_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS royalty_payouts_open ON royalty_payouts (holder_id) WHERE status = 'requested';

-- Неизменяемый журнал критических действий (цепочка хешей).
CREATE TABLE IF NOT EXISTS royalty_audit (
  seq       BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id  TEXT,
  action    TEXT NOT NULL,
  subject   TEXT,
  detail    JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  hash      TEXT NOT NULL
);

-- Охрана: журнал баланса и аудит только дописываются; выручка и расчётные поля закрытого периода не меняются.
CREATE OR REPLACE FUNCTION royalty_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'royalty: таблица только дописывается'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS royalty_ledger_guard ON royalty_ledger;
CREATE TRIGGER royalty_ledger_guard BEFORE UPDATE OR DELETE ON royalty_ledger FOR EACH ROW EXECUTE FUNCTION royalty_append_only();
DROP TRIGGER IF EXISTS royalty_audit_guard ON royalty_audit;
CREATE TRIGGER royalty_audit_guard BEFORE UPDATE OR DELETE ON royalty_audit FOR EACH ROW EXECUTE FUNCTION royalty_append_only();

CREATE OR REPLACE FUNCTION royalty_revenue_guard() RETURNS trigger AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM royalty_periods WHERE id = COALESCE(OLD.period, NEW.period);
  IF st = 'closed' THEN RAISE EXCEPTION 'royalty: период закрыт'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS royalty_revenue_guard_t ON royalty_revenue;
CREATE TRIGGER royalty_revenue_guard_t BEFORE UPDATE OR DELETE ON royalty_revenue FOR EACH ROW EXECUTE FUNCTION royalty_revenue_guard();

CREATE OR REPLACE FUNCTION royalty_accrual_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'royalty: начисления не удаляются'; END IF;
  IF NEW.amount_kopecks <> OLD.amount_kopecks OR NEW.fund_kopecks <> OLD.fund_kopecks OR NEW.holder_id <> OLD.holder_id
     OR NEW.track_id <> OLD.track_id OR NEW.period <> OLD.period OR NEW.split_bp <> OLD.split_bp OR NEW.pool_bp <> OLD.pool_bp THEN
    RAISE EXCEPTION 'royalty: расчётные поля начисления не меняются';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS royalty_accrual_guard_t ON royalty_accruals;
CREATE TRIGGER royalty_accrual_guard_t BEFORE UPDATE OR DELETE ON royalty_accruals FOR EACH ROW EXECUTE FUNCTION royalty_accrual_guard();
