-- ============================================================
--  Мероприятия (campaigns) — награды за подтверждённую активность
-- ============================================================
--
-- Название «Мероприятия» в интерфейсе намеренно не задевает таблицы
-- Sky Tickets: там «мероприятия» — это ticket_events (концерты,
-- показы, билеты), совсем другая сущность. Здесь — второй, отдельный
-- смысл того же русского слова: маркетинговая кампания с наградой за
-- выполненное условие. Чтобы не путать одно с другим ни в коде, ни в
-- логах, здесь всюду английские имена campaign/campaign_* и свой
-- префикс id (camp-, cplv-, cpp-, cprg-), а право называется
-- 'campaigns', а не 'events' и не 'tickets'.
--
-- Первое мероприятие — «Опубликуй видео и получи Sky Prime» — награда
-- зависит от количества просмотров ролика. У Sky нет доступа к API
-- внешних соцсетей, поэтому «просмотры» здесь — это подтверждённые
-- переходы по собственной, отслеживаемой на сервере ссылке участника
-- (campaign_clicks), а не число, которое прислал бы клиент о самом
-- ролике. Это единственная величина, которую сервер способен считать
-- сам, не веря никому на слово — остальное (сам факт публикации,
-- содержание ролика) подтверждает вручную поддержка при выдаче
-- награды, что и требует сценарий ниже.

CREATE TABLE IF NOT EXISTS campaigns (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  conditions    TEXT NOT NULL DEFAULT '',
  reward_kind   TEXT NOT NULL DEFAULT 'prime' CHECK (reward_kind IN ('prime')),
  has_cover     BOOLEAN NOT NULL DEFAULT FALSE,
  cover_mime    TEXT,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_active_idx ON campaigns (active, archived);

-- Шкала наград — строки, не константы во frontend: администратор
-- меняет уровни, не трогая код. Один уровень на кампанию — по
-- уникальному порогу просмотров, не по porядковому номеру, чтобы два
-- уровня не могли случайно совпасть по условию.
CREATE TABLE IF NOT EXISTS campaign_levels (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  views_threshold INT NOT NULL CHECK (views_threshold > 0),
  reward_days     INT NOT NULL CHECK (reward_days > 0 AND reward_days <= 90),
  sort_order      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (campaign_id, views_threshold)
);

CREATE INDEX IF NOT EXISTS campaign_levels_campaign_idx
  ON campaign_levels (campaign_id, views_threshold);

-- Участие: один человек — одна запись на кампанию. token_enc — токен
-- ссылки, зашифрованный обратимо (crypto.mjs encryptContent), тем же
-- приёмом, что QR заказа в Sky PVZ: человеку нужно уметь открыть свою
-- ссылку снова, не только увидеть её один раз при первом участии.
CREATE TABLE IF NOT EXISTS campaign_participations (
  id                TEXT PRIMARY KEY,
  campaign_id       TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_enc         TEXT NOT NULL,
  video_url         TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspicious', 'blocked')),
  suspicious_reason TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, profile_id)
);

CREATE INDEX IF NOT EXISTS campaign_participations_profile_idx
  ON campaign_participations (profile_id);

-- Переходы по ссылке участника — единственный сигнал, который сервер
-- меряет сам. visitor_hash обезличивает адрес и устройство (тот же
-- приём, что fingerprint в adminsec.mjs), а уникальность пары
-- (участие, посетитель) не даёт один и тот же переход накрутить
-- повторными нажатиями с того же места.
CREATE TABLE IF NOT EXISTS campaign_clicks (
  id               BIGSERIAL PRIMARY KEY,
  participation_id TEXT NOT NULL REFERENCES campaign_participations(id) ON DELETE CASCADE,
  visitor_hash     TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participation_id, visitor_hash)
);

CREATE INDEX IF NOT EXISTS campaign_clicks_participation_idx
  ON campaign_clicks (participation_id, created_at DESC);

-- Заявка на награду. UNIQUE(participation_id, level_id) — структурная
-- защита от повторной выдачи одного и того же уровня, той же формы,
-- что и market_pvz_commissions UNIQUE(order_id): не логика приложения
-- проверяет «уже было», а сама база отказывает второй строке.
-- ticket_id — обращение в существующей системе поддержки (не отдельная
-- своя), pending_action_id — заявка в существующей системе владельца
-- «два ключа» (adminsec.mjs), которая и выдаёт Prime по факту
-- одобрения: у начисления нет своего пути к Prime, только через неё.
CREATE TABLE IF NOT EXISTS campaign_reward_grants (
  id                 TEXT PRIMARY KEY,
  participation_id   TEXT NOT NULL REFERENCES campaign_participations(id) ON DELETE CASCADE,
  level_id           TEXT NOT NULL REFERENCES campaign_levels(id) ON DELETE RESTRICT,
  views_at_request   INT NOT NULL,
  reward_days        INT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'granted', 'failed')),
  ticket_id          TEXT REFERENCES support_tickets(id) ON DELETE SET NULL,
  pending_action_id  TEXT REFERENCES admin_pending_actions(id) ON DELETE SET NULL,
  granted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participation_id, level_id)
);

CREATE INDEX IF NOT EXISTS campaign_reward_grants_participation_idx
  ON campaign_reward_grants (participation_id);
