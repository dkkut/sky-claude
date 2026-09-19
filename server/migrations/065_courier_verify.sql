-- ============================================================
--  «Работа курьером»: проверка личности (16+, паспорт), заявка на
--  допуск, самостоятельное взятие заказов из пула, настоящее
--  подтверждение получения/доставки кодом и заработок.
--
--  Курьерский профиль (logi_couriers), сотрудничество с продавцом,
--  переписка, поручение по заказу — всё это уже было (миграция 041) и
--  здесь не дублируется. Меняется то, что раньше отсутствовало
--  совсем: у профиля появляется собственный статус допуска, у
--  допуска — проверка паспорта и возраста, а у поручения — путь,
--  которым курьер берёт заказ сам (а не только получает от продавца) и
--  подтверждает получение/доставку кодом, а не одной кнопкой.
-- ============================================================

-- ── Дата рождения ────────────────────────────────────────────────────
-- Раньше в проекте не было ни одного поля возраста — значит, ни одна
-- функция сервиса ещё не могла его проверить. Курьеру 16+ нужен
-- честный расчёт, а не число, присланное клиентом.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- ── Статус допуска курьера ──────────────────────────────────────────
-- Раньше registerCourier сразу делал профиль рабочим — заявка и
-- допуск были одним и тем же действием. Теперь это разные вещи:
-- регистрация заводит анкету, а допуск к работе (approved) даёт
-- только решение администратора после проверки паспорта.
ALTER TABLE logi_couriers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'));
ALTER TABLE logi_couriers ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE logi_couriers ADD COLUMN IF NOT EXISTS status_by TEXT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE logi_couriers ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS logi_couriers_status_idx ON logi_couriers (status);

-- ── Проверка паспорта ────────────────────────────────────────────────
-- Одна строка — одна попытка проверки. Партиальный уникальный индекс
-- не даёт завести вторую заявку, пока первая ещё не решена, — то же
-- решение, что и у logi_video_reviews (миграция 047).
CREATE TABLE IF NOT EXISTS courier_verifications (
  id            TEXT PRIMARY KEY,        -- cvr-<uuid>
  profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'verified', 'rejected', 'expired', 'invalid')),
  -- ФИО, как в документе, — только если реально понадобится сверка
  -- вручную. Зашифровано тем же ключом содержимого, что и остальные
  -- персональные данные проекта (server/crypto.mjs::encryptContent).
  full_name_enc TEXT,
  reviewer_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  reject_reason TEXT,
  operation_id  TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_verifications_profile_idx
  ON courier_verifications (profile_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS courier_verifications_one_pending_idx
  ON courier_verifications (profile_id) WHERE status = 'pending';

-- Скан/фото документа. Байты — зашифрованы (server/crypto.mjs::
-- encryptBytes), тем же приёмом, что и вложения чата (миграция 011):
-- один самодостаточный BYTEA, без отдельной таблицы ключей.
CREATE TABLE IF NOT EXISTS courier_verification_docs (
  id              TEXT PRIMARY KEY,     -- cvd-<uuid>
  verification_id TEXT NOT NULL REFERENCES courier_verifications(id) ON DELETE CASCADE,
  mime            TEXT NOT NULL,
  bytes           INTEGER NOT NULL CHECK (bytes > 0),
  data            BYTEA NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_verification_docs_idx
  ON courier_verification_docs (verification_id);

-- ── Поручения: самостоятельное взятие заказа ────────────────────────
-- Раньше заказ мог получить только курьер, которого выбрал продавец
-- (logi_collabs → assignCourier). Теперь продавец может вместо этого
-- выставить заказ «в пул» — courier_id пуст, статус 'open' — и любой
-- подходящий по зоне курьер берёт его сам, атомарно: гонку из двух
-- одновременных «взять» решает то же самое ограничение order_id
-- UNIQUE, что уже было.
ALTER TABLE logi_courier_assignments ALTER COLUMN courier_id DROP NOT NULL;
ALTER TABLE logi_courier_assignments DROP CONSTRAINT IF EXISTS logi_courier_assignments_status_check;
ALTER TABLE logi_courier_assignments ADD CONSTRAINT logi_courier_assignments_status_check
  CHECK (status IN ('open', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'problem'));
ALTER TABLE logi_courier_assignments ADD COLUMN IF NOT EXISTS city_id TEXT NOT NULL DEFAULT '';
ALTER TABLE logi_courier_assignments ADD COLUMN IF NOT EXISTS district TEXT NOT NULL DEFAULT '';
ALTER TABLE logi_courier_assignments ADD COLUMN IF NOT EXISTS price_kop BIGINT NOT NULL DEFAULT 0 CHECK (price_kop >= 0);
ALTER TABLE logi_courier_assignments ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
ALTER TABLE logi_courier_assignments ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE logi_courier_assignments ADD COLUMN IF NOT EXISTS problem_reason TEXT;
ALTER TABLE logi_courier_assignments ADD COLUMN IF NOT EXISTS ticket_id TEXT;
CREATE INDEX IF NOT EXISTS logi_assign_pool_idx
  ON logi_courier_assignments (city_id, district, status) WHERE status = 'open';

-- Курьер — такое же действующее лицо в истории заказа, как сотрудник
-- ПВЗ (миграция 059): подтверждает получение/доставку не покупатель и
-- не продавец нажатием кнопки, а курьер кодом/QR.
ALTER TABLE market_order_events DROP CONSTRAINT IF EXISTS market_order_events_actor_role_check;
ALTER TABLE market_order_events
  ADD CONSTRAINT market_order_events_actor_role_check
  CHECK (actor_role IN ('buyer', 'seller', 'support', 'system', 'pvz_staff', 'courier'));

-- ── Заработок курьера ────────────────────────────────────────────────
-- Один заработок на один заказ — UNIQUE(order_id) страхует от
-- повторного начисления, даже если подтверждение доставки почему-то
-- дойдёт до сервера дважды (двойной сабмит, повтор запроса).
CREATE TABLE IF NOT EXISTS courier_earnings (
  id             TEXT PRIMARY KEY,      -- ce-<uuid>
  courier_id     TEXT NOT NULL REFERENCES logi_couriers(id) ON DELETE CASCADE,
  profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assignment_id  TEXT NOT NULL REFERENCES logi_courier_assignments(id) ON DELETE CASCADE,
  order_id       TEXT NOT NULL UNIQUE REFERENCES market_orders(id) ON DELETE CASCADE,
  amount_kop     BIGINT NOT NULL CHECK (amount_kop > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_earnings_profile_idx
  ON courier_earnings (profile_id, created_at DESC);
