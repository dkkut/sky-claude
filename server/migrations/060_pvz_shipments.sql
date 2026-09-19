-- ============================================================
--  Sky ПВЗ как бизнес: владение, поставки, QR, комиссия
-- ============================================================
--
-- 059 дал пункту выдачи сотрудников, ячейки, ключи и безопасную
-- выдачу по коду. Здесь пункт выдачи становится ещё и бизнесом,
-- которым может владеть не только Sky-администрация: у него
-- появляется владелец, платная активация, роли вместо вольного
-- набора прав, партия («поставка») из нескольких заказов с
-- приёмкой по QR и комиссия владельцу при закрытии заказа.
--
-- Все прежние точки (заведённые администрацией через
-- upsertPickupPoint) продолжают работать как раньше: owner_id у
-- них пуст, owner_status ни на что не влияет, покупатель как
-- забирал заказ кодом получения, так и забирает.

-- ── Владение точкой ───────────────────────────────────────────────────
--
-- owner_id пуст у точек Sky-администрации — это не пробел, а факт:
-- такими точками распоряжается администрация, и подписка им не нужна.
ALTER TABLE market_pickup_points
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE market_pickup_points
  ADD COLUMN IF NOT EXISTS owner_status TEXT NOT NULL DEFAULT 'active'
    CHECK (owner_status IN ('pending_activation', 'active', 'suspended'));

CREATE INDEX IF NOT EXISTS market_pickup_points_owner_idx
  ON market_pickup_points (owner_id) WHERE owner_id IS NOT NULL;

-- ── Роль сотрудника вместо вольного набора прав ────────────────────────
--
-- 059 завела permissions как список строк — гибко, но спецификация
-- пункта выдачи как бизнеса просит именно роли. Столбец добавляется
-- рядом, permissions не трогается (059 и его проверки живы), а
-- pvzops.mjs дальше решает права по role, а не по permissions.
ALTER TABLE market_pvz_staff
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee'
    CHECK (role IN ('owner', 'manager', 'employee', 'read_only'));

UPDATE market_pvz_staff SET role = 'manager'
  WHERE role = 'employee' AND 'admin' = ANY(permissions);

-- ── Подписка владельца точки ────────────────────────────────────────────
--
-- Деньги списываются из кошелька Sky, тем же способом, что и подписка
-- продавца (market_seller_payments, market.mjs) — это плата Sky за
-- инфраструктуру, а не часть чьей-то сделки. Внешнего платёжного
-- вебхука в Sky нет ни для одной подписки; изобретать его отдельно
-- для ПВЗ означало бы завести вторую систему оплаты рядом с первой.
CREATE TABLE IF NOT EXISTS market_pvz_owner_payments (
  id         TEXT PRIMARY KEY,
  pvz_id     TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  days       INTEGER NOT NULL CHECK (days > 0),
  until      TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pvz_owner_payments_idx
  ON market_pvz_owner_payments (pvz_id, created_at DESC);

-- ── Поставка: несколько заказов, отправленных в ПВЗ одним разом ───────
--
-- Не путать с market_shipments (039) — там путь ОДНОГО заказа до
-- покупателя или до ПВЗ, отдельно на каждый заказ. Поставка — это
-- партия из нескольких таких заказов, которую продавец собирает и
-- завозит в ПВЗ разом: своя приёмка, свой QR, свой путь.

CREATE TABLE IF NOT EXISTS market_pvz_shipments (
  id             TEXT PRIMARY KEY,
  pvz_id         TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  seller_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  method         TEXT NOT NULL DEFAULT 'seller_self'
    CHECK (method IN ('seller_self', 'carrier', 'other')),
  carrier_title  TEXT NOT NULL DEFAULT '',
  tracking       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'shipped', 'received', 'received_partial', 'cancelled')),
  -- QR поставки — обратимо зашифрованный случайный токен, тем же
  -- способом, что код получения заказа (crypto.mjs): продавцу нужно
  -- показать его снова, если он открыл поставку через день.
  qr_token_enc   TEXT,
  expected_count INTEGER NOT NULL DEFAULT 0,
  received_count INTEGER NOT NULL DEFAULT 0,
  shipped_at     TIMESTAMPTZ,
  shipped_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  received_at    TIMESTAMPTZ,
  received_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pvz_shipments_pvz_idx
  ON market_pvz_shipments (pvz_id, status);
CREATE INDEX IF NOT EXISTS market_pvz_shipments_seller_idx
  ON market_pvz_shipments (seller_id, created_at DESC);

-- ── Заказ внутри поставки ───────────────────────────────────────────────
--
-- Один заказ живёт максимум в одной ЖИВОЙ поставке одновременно —
-- иначе один и тот же товар можно было бы «принять» в двух местах.
CREATE TABLE IF NOT EXISTS market_pvz_shipment_items (
  id           TEXT PRIMARY KEY,
  shipment_id  TEXT NOT NULL REFERENCES market_pvz_shipments(id) ON DELETE CASCADE,
  order_id     TEXT NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'received', 'missing')),
  scanned_at   TIMESTAMPTZ,
  scanned_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (shipment_id, order_id)
);

CREATE INDEX IF NOT EXISTS market_pvz_shipment_items_shipment_idx
  ON market_pvz_shipment_items (shipment_id);

-- Заказ живёт не более чем в одной незакрытой поставке.
CREATE UNIQUE INDEX IF NOT EXISTS market_pvz_shipment_items_live_order_idx
  ON market_pvz_shipment_items (order_id)
  WHERE status IN ('expected', 'received');

-- Заказ, приехавший без своей поставки (лишний скан) — требует разбора,
-- а не тихого игнора и не автоматического добавления куда попало.
CREATE TABLE IF NOT EXISTS market_pvz_unmatched_scans (
  id          BIGSERIAL PRIMARY KEY,
  pvz_id      TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  shipment_id TEXT REFERENCES market_pvz_shipments(id) ON DELETE SET NULL,
  order_id    TEXT REFERENCES market_orders(id) ON DELETE SET NULL,
  raw_token   TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL DEFAULT '',
  actor_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pvz_unmatched_pvz_idx
  ON market_pvz_unmatched_scans (pvz_id, resolved, created_at DESC);

-- ── QR заказа и QR получения ─────────────────────────────────────────────
--
-- Два разных QR на одном заказе, и оба обратимо зашифрованы (продавцу
-- и покупателю нужно уметь показать их снова):
--   pvz_ship_token_enc  — печатает продавец на коробке; сканирует ПВЗ
--                          при приёмке поставки. Замена — перезапись
--                          того же столбца: старый токен этим уже
--                          инвалидирован, второй проверки не нужно.
--   pickup_qr_token_enc — показывает покупатель при выдаче; сканирует
--                          сотрудник. Рядом остаётся числовой
--                          pickup_code_enc (059) как запасной способ
--                          назвать код вслух, если сканер недоступен.
ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS pvz_ship_token_enc TEXT;
ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS pickup_qr_token_enc TEXT;

-- ── Комиссия владельцу точки ─────────────────────────────────────────────
--
-- Процент — системный параметр (PVZ_OWNER_COMMISSION_PERCENT,
-- pvzops.mjs), но применённый процент и суммы хранятся в строке
-- начисления: смена параметра в будущем не должна задним числом
-- менять то, что уже начислено.
CREATE TABLE IF NOT EXISTS market_pvz_commissions (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL UNIQUE REFERENCES market_orders(id) ON DELETE CASCADE,
  pvz_id        TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_amount_kop INTEGER NOT NULL CHECK (order_amount_kop > 0),
  percent       NUMERIC(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  amount_kop    INTEGER NOT NULL CHECK (amount_kop >= 0),
  -- Прямой платёж продавец → владелец точки, мимо Sky (как и вся
  -- оплата сделки) — Sky только фиксирует, что стороны заявили.
  status        TEXT NOT NULL DEFAULT 'accrued'
    CHECK (status IN ('accrued', 'declared_paid', 'disputed', 'cancelled')),
  declared_paid_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pvz_commissions_owner_idx
  ON market_pvz_commissions (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_pvz_commissions_seller_idx
  ON market_pvz_commissions (seller_id, status);

-- ── Точечное расширение журнала: сканы и поставки — тоже события ПВЗ ──
--
-- market_pvz_audit (059) уже пишет и хранит без права правки/удаления;
-- новые действия просто ложатся в тот же action-текст, схему трогать
-- не нужно.
