-- ============================================================
--  Общедоступный склад: ячейки, аренда, видеообзор, согласия
-- ============================================================
--
-- Склад до сих пор был личным: владелец, его сотрудники и его же товар.
-- Общий склад устроен иначе — в него приходит чужой продавец, кладёт
-- чужой товар в запираемую ячейку и платит за неё владельцу склада.
-- Отсюда всё, что ниже.
--
-- Денег Sky по-прежнему не держит. Аренда ячейки — тот же прямой
-- перевод, что и в сделке маркета: продавец платит владельцу склада по
-- его реквизитам, а Sky только ведёт учёт, кто что заявил и кто что
-- подтвердил. Ни баланса склада, ни вывода, ни комиссии здесь нет и
-- быть не должно.
--
-- Открыть общий склад нельзя одним переключателем. Регламент требует
-- запираемых ячеек, зонирования и учёта, и проверить это по анкете
-- невозможно — поэтому обязателен видеообзор помещения, который
-- смотрит администрация. До её решения склад остаётся личным.

-- ── Режим склада ───────────────────────────────────────────────────
--
-- Два поля вместо одного нарочно. «Режим» — это чего хочет владелец,
-- «состояние» — что решила администрация. Одно поле заставляло бы
-- хранить заявку и результат в одном месте, и отказ выглядел бы как
-- возврат в личный режим, то есть как будто заявки и не было.

ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS shared_state TEXT NOT NULL DEFAULT 'off'
    CHECK (shared_state IN ('off', 'review', 'active', 'rejected', 'suspended'));

-- Цена одной ячейки за расчётный срок. Целые копейки: рубли с копейками
-- в double однажды дают 79.99999999999999.
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS cell_price_kop INTEGER NOT NULL DEFAULT 0
    CHECK (cell_price_kop >= 0);

-- За сколько дней берётся цена ячейки, и в каких пределах можно снять.
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS cell_period_days INTEGER NOT NULL DEFAULT 7
    CHECK (cell_period_days BETWEEN 1 AND 365);
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS min_rent_days INTEGER NOT NULL DEFAULT 7
    CHECK (min_rent_days BETWEEN 1 AND 365);
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS max_rent_days INTEGER NOT NULL DEFAULT 180
    CHECK (max_rent_days BETWEEN 1 AND 3650);

-- Куда платить за ячейку. Зашифровано, как и реквизиты продавца:
-- присланные в переписке реквизиты подменяет тот, кто в переписку попал.
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS payment_details_enc TEXT;
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS has_payment_details BOOLEAN NOT NULL DEFAULT FALSE;

-- Правила конкретного склада поверх общего регламента: что здесь
-- нельзя, когда приёмка, как получить ключ.
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS shared_rules TEXT NOT NULL DEFAULT '';

-- Зоны по регламенту (п. 2.1). Хранятся списком: они всегда читаются и
-- пишутся вместе, и отдельной таблицей были бы шестью строками,
-- которые никто никогда не спросит поодиночке.
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS zones JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Есть ли видеонаблюдение (п. 8.1) и охрана. Арендатор вправе знать до
-- того, как повёз товар.
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS has_cctv BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE logi_warehouses
  ADD COLUMN IF NOT EXISTS has_guard BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS logi_warehouses_shared_idx
  ON logi_warehouses (shared_state) WHERE shared_state = 'active';

-- ── Ячейки ─────────────────────────────────────────────────────────
--
-- Регламент, п. 3: у каждой ячейки свой номер, свой замок и свой ключ,
-- и ячейка с пропавшим ключом выводится из эксплуатации до перекодировки.
-- Поэтому «заблокирована» — отдельное состояние, а не отсутствие
-- арендатора.

CREATE TABLE IF NOT EXISTS logi_cells (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  -- Номер ячейки: то, что написано на дверце. Видит и арендатор, и кладовщик.
  number       TEXT NOT NULL,
  zone         TEXT NOT NULL DEFAULT '',
  size         TEXT NOT NULL DEFAULT 'medium'
    CHECK (size IN ('small', 'medium', 'large')),
  -- Своя цена, если эта ячейка дороже или дешевле прочих. Пусто —
  -- берётся цена склада.
  price_kop    INTEGER CHECK (price_kop IS NULL OR price_kop >= 0),
  state        TEXT NOT NULL DEFAULT 'free'
    CHECK (state IN ('free', 'rented', 'blocked')),
  -- Почему выведена из эксплуатации: пропал ключ, сломан замок, следы
  -- вскрытия (п. 3.8, 5.4).
  block_reason TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Два «номера 14» на одном складе — это два разных ответа на вопрос,
  -- в какую дверцу класть.
  UNIQUE (warehouse_id, number)
);

CREATE INDEX IF NOT EXISTS logi_cells_wh_idx ON logi_cells (warehouse_id, state);

-- ── Аренда ячейки ──────────────────────────────────────────────────
--
-- Состояния те же по смыслу, что у заказа маркета, и по той же причине:
-- Sky перевода не видит, а видит только заявления сторон. «Оплачено» —
-- это слово арендодателя, а не проверка платежа.

CREATE TABLE IF NOT EXISTS logi_cell_rentals (
  id             TEXT PRIMARY KEY,
  cell_id        TEXT NOT NULL REFERENCES logi_cells(id) ON DELETE CASCADE,
  warehouse_id   TEXT NOT NULL REFERENCES logi_warehouses(id) ON DELETE CASCADE,
  -- Арендатор. Обычно продавец, но склад вправе пустить и не продавца.
  tenant_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  days           INTEGER NOT NULL CHECK (days > 0),
  price_kop      INTEGER NOT NULL CHECK (price_kop >= 0),
  total_kop      INTEGER NOT NULL CHECK (total_kop >= 0),
  status         TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'payment_declared', 'active', 'ended', 'cancelled')),
  -- Ключ на руках у арендатора или лежит в своём месте (п. 3.3, 3.6).
  key_state      TEXT NOT NULL DEFAULT 'stored'
    CHECK (key_state IN ('stored', 'issued', 'lost')),
  paid_declared_at TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  cancel_reason  TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_cell_rentals_tenant_idx
  ON logi_cell_rentals (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS logi_cell_rentals_wh_idx
  ON logi_cell_rentals (warehouse_id, status);

-- Одна ячейка — одна живая аренда. Без этого два продавца оплатили бы
-- одну дверцу, и оба были бы правы.
CREATE UNIQUE INDEX IF NOT EXISTS logi_cell_rentals_live_idx
  ON logi_cell_rentals (cell_id)
  WHERE status IN ('created', 'payment_declared', 'active');

-- ── Журнал ключей и ячеек ──────────────────────────────────────────
--
-- Регламент требует фиксировать выдачу ключа (п. 3.4) и сохранять следы
-- при разборе пропажи (п. 9.3). Журнал только дописывается: запись,
-- которую можно поправить задним числом, ничего не доказывает.

CREATE TABLE IF NOT EXISTS logi_cell_events (
  id         TEXT PRIMARY KEY,
  cell_id    TEXT NOT NULL REFERENCES logi_cells(id) ON DELETE CASCADE,
  rental_id  TEXT REFERENCES logi_cell_rentals(id) ON DELETE SET NULL,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_cell_events_idx ON logi_cell_events (cell_id, created_at DESC);

-- ── Видеообзор объекта ─────────────────────────────────────────────
--
-- Сделано не «видеообзор склада», а «видеообзор объекта»: тот же обзор
-- понадобится пункту выдачи, и заводить под него вторую такую же
-- таблицу означало бы вторую такую же очередь модерации и второй такой
-- же набор ошибок в ней.
--
-- Сам файл лежит на диске: гигабайт видео в Postgres раздувает каждую
-- резервную копию и не даёт отдать кусок по диапазону.

CREATE TABLE IF NOT EXISTS logi_video_reviews (
  id           TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('warehouse', 'pickup_point')),
  subject_id   TEXT NOT NULL,
  uploader_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mime         TEXT NOT NULL,
  bytes        BIGINT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Кто и когда решил, и почему отказал. «Отклонён» без причины
  -- заставляет владельца гадать и снимать то же самое второй раз.
  reviewer_id  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  reject_reason TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logi_video_subject_idx
  ON logi_video_reviews (subject_kind, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS logi_video_pending_idx
  ON logi_video_reviews (created_at) WHERE status = 'pending';

-- Один обзор на проверке на объект. Иначе очередь администрации
-- забивается десятью дублями одного склада.
CREATE UNIQUE INDEX IF NOT EXISTS logi_video_one_pending_idx
  ON logi_video_reviews (subject_kind, subject_id) WHERE status = 'pending';

-- ── Согласия с документами ─────────────────────────────────────────
--
-- Галочка в интерфейсе — это то, что человек видел. Запись здесь — то,
-- что мы сможем показать через год: когда согласился и с какой
-- редакцией. Отпечаток текста хранится рядом с редакцией, потому что
-- номер редакции можно проставить и не тронув текст, а отпечаток врать
-- не умеет: правка документа меняет его, и прежнее согласие перестаёт
-- считаться действующим.
--
-- Время ставит сервер. Присланное клиентом время доказательством быть
-- не может: его выставляет тот, чьё согласие мы и записываем.

CREATE TABLE IF NOT EXISTS sky_agreements (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  doc_code    TEXT NOT NULL,
  revision    TEXT NOT NULL,
  doc_hash    TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, doc_code)
);

CREATE INDEX IF NOT EXISTS sky_agreements_doc_idx ON sky_agreements (doc_code, revision);
