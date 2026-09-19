-- ============================================================
--  Sky ПВЗ: сотрудники, ячейки, ключи, безопасная выдача, журнал
-- ============================================================
--
-- market_pickup_points (039) до сих пор был просто справочником точек:
-- Sky-администрация вписывает название и адрес, а дальше маркет знает
-- только «сюда можно везти». У точки не было ни сотрудников, ни учёта
-- ячеек, ни живого журнала — покупатель сам подтверждал получение
-- кнопкой (marketorders.received), и это никуда не делось: тот путь
-- как работал, так и работает. Здесь появляется параллельный,
-- дополнительный путь — для точек, где приём ведёт сотрудник: ячейки,
-- ключи, проверка кода при выдаче, и всё это под тем же order_id и
-- тем же pickup_point_id, что уже есть у настоящего заказа.

-- ── Сотрудники пункта ────────────────────────────────────────────────
--
-- Разрешения — не роль «сотрудник = админ»: у роли Sky (admin.mjs) это
-- вообще не пересекается. Сотрудник ПВЗ получает ровно те права,
-- которые ему выдали для ЭТОЙ точки, и не получает прав Sky-панели.

CREATE TABLE IF NOT EXISTS market_pvz_staff (
  id           TEXT PRIMARY KEY,
  pvz_id       TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Закрытый список: просмотр, приём, размещение, выдача, ячейки,
  -- ключи, возвраты, административные операции самой точки.
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  added_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  revoked_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (pvz_id, profile_id)
);

CREATE INDEX IF NOT EXISTS market_pvz_staff_profile_idx
  ON market_pvz_staff (profile_id) WHERE status = 'active';

-- ── Ячейки ────────────────────────────────────────────────────────────
--
-- FREE → RESERVED/OCCUPIED → FREE. BLOCKED и MAINTENANCE — аварийные,
-- ставятся вручную и не идут в оборот, пока сотрудник не снимет их.

CREATE TABLE IF NOT EXISTS market_pvz_cells (
  id               TEXT PRIMARY KEY,
  pvz_id           TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  size             TEXT NOT NULL DEFAULT 'M' CHECK (size IN ('S', 'M', 'L', 'XL')),
  status           TEXT NOT NULL DEFAULT 'FREE'
                   CHECK (status IN ('FREE', 'RESERVED', 'OCCUPIED', 'BLOCKED', 'MAINTENANCE')),
  -- Есть ли у ячейки отдельный физический ключ (учитывается ниже).
  has_key          BOOLEAN NOT NULL DEFAULT FALSE,
  current_order_id TEXT REFERENCES market_orders(id) ON DELETE SET NULL,
  block_reason     TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pvz_id, number)
);

CREATE INDEX IF NOT EXISTS market_pvz_cells_pvz_idx ON market_pvz_cells (pvz_id, status);

-- Один заказ — одна живая ячейка. Без этого два сотрудника одновременно
-- положили бы один заказ в две разные ячейки, и обе были бы «правы».
CREATE UNIQUE INDEX IF NOT EXISTS market_pvz_cells_order_idx
  ON market_pvz_cells (current_order_id) WHERE current_order_id IS NOT NULL;

-- ── Ключи ─────────────────────────────────────────────────────────────
--
-- Ключ — внутренний инструмент точки: сотрудники берут его на смену и
-- сдают обратно, чтобы открыть конкретную ячейку. current_holder — это
-- сотрудник, а не покупатель: покупателю ключ на руки не выдаётся,
-- посылку сотрудник достаёт и передаёт через стойку сам.

CREATE TABLE IF NOT EXISTS market_pvz_keys (
  id                    TEXT PRIMARY KEY,
  pvz_id                TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  cell_id               TEXT NOT NULL REFERENCES market_pvz_cells(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'AVAILABLE'
                        CHECK (status IN ('AVAILABLE', 'ISSUED', 'LOST', 'BLOCKED')),
  current_holder_id     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  issued_at             TIMESTAMPTZ,
  returned_at           TIMESTAMPTZ,
  returned_confirmed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pvz_keys_cell_idx ON market_pvz_keys (cell_id, created_at DESC);

-- Одна ячейка — не больше одного действующего ключа одновременно
-- (AVAILABLE или ISSUED). Потерянный или заблокированный ключ не в
-- счёт: под него заводится новая строка после перекодировки замка.
CREATE UNIQUE INDEX IF NOT EXISTS market_pvz_keys_live_idx
  ON market_pvz_keys (cell_id) WHERE status IN ('AVAILABLE', 'ISSUED');

-- ── Журнал ПВЗ ────────────────────────────────────────────────────────
--
-- Только для записи — тот же приём, что у admin_log (058): UPDATE и
-- DELETE отклоняются триггером в самой базе, а не проверкой в коде.

CREATE TABLE IF NOT EXISTS market_pvz_audit (
  id          BIGSERIAL PRIMARY KEY,
  pvz_id      TEXT NOT NULL REFERENCES market_pickup_points(id) ON DELETE CASCADE,
  actor_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  suspicious  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pvz_audit_pvz_idx ON market_pvz_audit (pvz_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_pvz_audit_susp_idx ON market_pvz_audit (created_at DESC) WHERE suspicious;

CREATE OR REPLACE FUNCTION market_pvz_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'market_pvz_audit: журнал только для записи — % запрещён', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS market_pvz_audit_no_update ON market_pvz_audit;
DROP TRIGGER IF EXISTS market_pvz_audit_no_delete ON market_pvz_audit;

CREATE TRIGGER market_pvz_audit_no_update BEFORE UPDATE ON market_pvz_audit
  FOR EACH ROW EXECUTE FUNCTION market_pvz_audit_append_only();
CREATE TRIGGER market_pvz_audit_no_delete BEFORE DELETE ON market_pvz_audit
  FOR EACH ROW EXECUTE FUNCTION market_pvz_audit_append_only();

-- ── Точечная доработка market_pickup_points / market_orders ──────────

-- Временное закрытие точки сотрудником (переучёт, авария) — отдельно
-- от active (039): active выключает точку из каталога и это решение
-- Sky-администрации (upsertPickupPoint), а staff_closed — это решение
-- самой точки, и оно не должно давать сотруднику того же рычага, что
-- есть у Sky-администрации.
ALTER TABLE market_pickup_points
  ADD COLUMN IF NOT EXISTS staff_closed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE market_pickup_points
  ADD COLUMN IF NOT EXISTS staff_closed_reason TEXT NOT NULL DEFAULT '';

-- Код получения. Шифруется тем же ключом, что адрес и контакт заказа
-- (crypto.mjs) — обратимо, потому что покупателю нужно показать его
-- снова, если он открыл заказ через день. Заводится сервером в момент
-- ready_for_pickup для destination = pickup_point и никогда не
-- принимается от клиента.
ALTER TABLE market_orders
  ADD COLUMN IF NOT EXISTS pickup_code_enc TEXT;

-- Сотрудник ПВЗ — новая, но третья сторона журнала переходов заказа:
-- он не покупатель и не продавец, и подменять их актёра нельзя.
-- Список расширяется, а не переписывается — старые строки этой
-- проверке уже удовлетворяют.
ALTER TABLE market_order_events DROP CONSTRAINT IF EXISTS market_order_events_actor_role_check;
ALTER TABLE market_order_events
  ADD CONSTRAINT market_order_events_actor_role_check
  CHECK (actor_role IN ('buyer', 'seller', 'support', 'system', 'pvz_staff'));
