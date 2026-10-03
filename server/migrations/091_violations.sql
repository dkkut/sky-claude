-- Единая система нарушений и штрафов — Sky Market / склады / Sky PVZ.
--
-- Решение, из которого следует вся схема: одна система на три модуля,
-- не три отдельные. Прецедент такого устройства в проекте уже есть —
-- server/videoreview.mjs хранит видеообзор объекта одной таблицей с
-- généric-парой (subject_kind, subject_id) вместо отдельной таблицы на
-- склад и отдельной на ПВЗ. Здесь тот же приём: одна таблица
-- `violations` с (module, violator_kind, violator_id) плюс необязательная
-- organizационная привязка (org_kind, org_id) для склада/ПВЗ.
--
-- Деньги. У продавца нет внутреннего Sky-баланса (см. 039_market.sql,
-- «Sky не хранит деньги»), и штраф не списывается автоматически ни с
-- какого счёта — это НАЧИСЛЕНИЕ/ОБЯЗАТЕЛЬСТВО (`penalties`, статусы
-- accrued → payment_declared → paid), тем же приёмом, что заявления об
-- оплате у заказов Market и комиссия владельцу ПВЗ
-- (market_pvz_commissions.status). Новый внутренний баланс эта миграция
-- не заводит.
--
-- Версии регламента. Правило можно поменять, но нарушение должно
-- ссылаться на тот текст/санкцию/сумму, что действовали в момент
-- фиксации — поэтому `violations.rule_snapshot` замораживает нужные
-- поля правила прямо на строке нарушения, а не только FK на
-- `violation_rules`, которую администратор может отредактировать позже.
--
-- Неподменяемый журнал. `violation_audit_log` — append-only с тем же
-- приёмом, что и `admin_log` (058) и `market_pvz_audit` (059): BEFORE
-- UPDATE/DELETE триггер, который всегда бросает исключение. Это не
-- «проверка в коде, которую можно забыть», а гарантия на уровне самой
-- базы.

-- ============================================================
--  Правила регламента
-- ============================================================

CREATE TABLE IF NOT EXISTS violation_rules (
  id          TEXT PRIMARY KEY,                 -- vr-<uuid>
  module      TEXT NOT NULL CHECK (module IN ('market', 'warehouse', 'pvz')),
  -- Код пункта регламента, который видит администратор и на который
  -- ссылается нарушение («нарушен пункт M-12»). Уникален в пределах
  -- модуля, не глобально — у разных модулей свои номерные ряды.
  code        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity    TEXT NOT NULL CHECK (severity IN ('warning', 'minor', 'moderate', 'severe', 'critical')),
  -- Сумма по умолчанию. NULL — нарушение этого типа денежного штрафа не
  -- предполагает (например просто предупреждение).
  default_penalty_kop INTEGER CHECK (default_penalty_kop IS NULL OR default_penalty_kop >= 0),
  default_sanction    TEXT NOT NULL DEFAULT 'none'
    CHECK (default_sanction IN ('none', 'warning', 'remove_listing', 'restrict_publishing',
      'restrict_feature', 'suspend', 'restrict_staff', 'temp_block', 'perm_block')),
  -- Накопительная эскалация по числу повторов — конфигурируется
  -- администратором, не зашита во frontend. Пример:
  -- {"2": {"sanction": "restrict_feature"}, "3": {"sanction": "suspend"}}
  escalation  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Во сколько раз растёт сумма штрафа с каждым повтором (1 = не растёт).
  repeat_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (repeat_multiplier >= 1),
  -- Версия правила. Растёт при каждом смысловом изменении (не при
  -- вкл/выкл) — её и замораживает violations.rule_snapshot.
  version     INTEGER NOT NULL DEFAULT 1,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module, code)
);

CREATE INDEX IF NOT EXISTS violation_rules_module_idx ON violation_rules (module, active);

-- ============================================================
--  Нарушения
-- ============================================================

CREATE TABLE IF NOT EXISTS violations (
  id          TEXT PRIMARY KEY,                 -- vio-<uuid>
  module      TEXT NOT NULL CHECK (module IN ('market', 'warehouse', 'pvz')),

  -- Кто отвечает за нарушение — всегда профиль Sky ID: и продавец,
  -- и владелец склада/ПВЗ, и их сотрудник — это profiles.id
  -- (market_sellers.profile_id, logi_warehouses.seller_id,
  -- logi_warehouse_staff.profile_id, market_pickup_points.owner_id,
  -- market_pvz_staff.profile_id — везде один и тот же источник).
  violator_kind TEXT NOT NULL CHECK (violator_kind IN
    ('market_seller', 'warehouse_owner', 'warehouse_staff', 'pvz_owner', 'pvz_staff', 'buyer')),
  violator_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Организация, к которой относится нарушение сотрудника/владельца —
  -- для продавца и покупателя не нужна (сам себе организация).
  org_kind    TEXT NOT NULL DEFAULT '' CHECK (org_kind IN ('', 'warehouse', 'pvz')),
  org_id      TEXT NOT NULL DEFAULT '',

  -- Заказ/объект, связанный с нарушением — полиморфно, без FK
  -- (объекты живут в разных таблицах разных модулей): order/cell/
  -- rental/shipment/key и т.п.
  object_kind TEXT NOT NULL DEFAULT '',
  object_id   TEXT NOT NULL DEFAULT '',

  rule_id        TEXT NOT NULL REFERENCES violation_rules(id),
  -- Замороженный слепок правила на момент фиксации — см. шапку файла.
  rule_snapshot   JSONB NOT NULL,
  -- Скопирована из слепка — для индекса и фильтра без разбора JSON.
  severity        TEXT NOT NULL CHECK (severity IN ('warning', 'minor', 'moderate', 'severe', 'critical')),

  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'DETECTED' CHECK (status IN
    ('DETECTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'APPEALED', 'CANCELLED', 'CLOSED')),
  source      TEXT NOT NULL CHECK (source IN ('auto', 'manual')),

  -- NULL у created_by — автоматическая фиксация backend-системой, не
  -- человеком (раздел 12 брифа).
  created_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,

  reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT NOT NULL DEFAULT '',

  -- Санкция, которая реально назначена — может отличаться от
  -- default_sanction правила (решение администратора/апелляции).
  sanction_applied TEXT CHECK (sanction_applied IS NULL OR sanction_applied IN
    ('none', 'warning', 'remove_listing', 'restrict_publishing', 'restrict_feature',
      'suspend', 'restrict_staff', 'temp_block', 'perm_block')),

  -- Которое по счёту это подтверждённое нарушение данного нарушителя —
  -- считается и замораживается при подтверждении (не при создании:
  -- DETECTED/UNDER_REVIEW в счёт повторности не идут).
  repeat_count INTEGER NOT NULL DEFAULT 0,

  cancel_reason TEXT NOT NULL DEFAULT '',
  cancelled_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  cancelled_at  TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS violations_violator_idx ON violations (violator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS violations_module_status_idx ON violations (module, status);
CREATE INDEX IF NOT EXISTS violations_open_idx ON violations (created_at) WHERE status IN ('DETECTED', 'UNDER_REVIEW');
CREATE INDEX IF NOT EXISTS violations_rule_idx ON violations (rule_id);
CREATE INDEX IF NOT EXISTS violations_org_idx ON violations (org_kind, org_id) WHERE org_id <> '';

-- ============================================================
--  Штрафы — обязательство, не автосписание (см. шапку файла)
-- ============================================================

-- Куда платить штраф. Это реквизиты Sky (не нового внутреннего баланса —
-- см. шапку файла), которые задаёт исключительно владелец в админке:
-- прямая проверка isOwner() (server/admin.mjs), тот же приём, что уже
-- используют владельческие функции в server/tv.mjs — без RBAC-права,
-- которое можно выдать ещё кому-то. Строка не редактируется на месте —
-- каждое изменение добавляет новую активную запись и гасит предыдущую
-- (active=false), сама запись никогда не удаляется и не правится: это
-- те же «не переписывать прошлое», что и версии правил (violation_rules)
-- и неподменяемый журнал ниже. Уникальный частичный индекс гарантирует,
-- что активна всегда ровно одна запись.
CREATE TABLE IF NOT EXISTS violation_payment_settings (
  id          TEXT PRIMARY KEY,                 -- vps-<uuid>
  -- recipient/inn/kpp/bank_name/bic/account_number/corr_account или
  -- sbp_phone — состав полей не фиксируем здесь, это ответственность
  -- слоя server/violations.mjs и формы в админке.
  requisites  JSONB NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  set_by      TEXT NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS violation_payment_settings_one_active_idx
  ON violation_payment_settings ((TRUE)) WHERE active;

CREATE TABLE IF NOT EXISTS penalties (
  id           TEXT PRIMARY KEY,                -- pen-<uuid>
  violation_id TEXT NOT NULL REFERENCES violations(id) ON DELETE CASCADE,
  profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  amount_kop   INTEGER CHECK (amount_kop IS NULL OR amount_kop >= 0),
  currency     TEXT NOT NULL DEFAULT 'RUB',
  reason       TEXT NOT NULL DEFAULT '',

  status       TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN
    ('accrued', 'payment_declared', 'paid', 'cancelled', 'waived')),

  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- «Когда» — срок взноса.
  due_at       TIMESTAMPTZ,

  -- «Куда» — замороженный на момент начисления слепок реквизитов
  -- (violation_payment_settings, та что была active в момент issued_at).
  -- Замораживаем по тому же принципу, что rule_snapshot у violations:
  -- если владелец позже сменит счёт, уже выставленный и показанный
  -- нарушителю штраф не должен тихо поменять место оплаты у него под
  -- рукой — старый штраф платится туда, куда было сказано при выдаче.
  payment_requisites_snapshot JSONB NOT NULL,
  payment_settings_id         TEXT NOT NULL REFERENCES violation_payment_settings(id),

  -- Подпись назначения платежа, которую нарушитель увидит и укажет при
  -- переводе — формируется автоматически при начислении, не правится
  -- вручную: «Штраф за нарушение правил <код правила> в Sky, <id нарушения>».
  payment_purpose TEXT NOT NULL DEFAULT '',

  -- Плательщик заявляет «оплатил» — тем же приёмом, что заказы Market
  -- и ПВЗ-комиссии: заявление само по себе ничем не является, пока
  -- его не подтвердит администрация (paid_at/confirmed_by).
  declared_paid_at TIMESTAMPTZ,
  declared_by      TEXT REFERENCES profiles(id) ON DELETE SET NULL,

  paid_at      TIMESTAMPTZ,
  confirmed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,

  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  cancel_reason TEXT NOT NULL DEFAULT '',

  payment_reference TEXT NOT NULL DEFAULT '',

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS penalties_violation_idx ON penalties (violation_id);
CREATE INDEX IF NOT EXISTS penalties_profile_idx ON penalties (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS penalties_status_idx ON penalties (status);

-- ============================================================
--  Санкции — отдельно от штрафа: на одно нарушение их может быть
--  несколько последовательно (раздел 3 брифа).
-- ============================================================

CREATE TABLE IF NOT EXISTS violation_sanctions (
  id           TEXT PRIMARY KEY,                -- vsa-<uuid>
  violation_id TEXT NOT NULL REFERENCES violations(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN
    ('warning', 'remove_listing', 'restrict_publishing', 'restrict_feature',
      'suspend', 'restrict_staff', 'temp_block', 'perm_block')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lifted', 'expired')),
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ,
  lifted_at    TIMESTAMPTZ,
  lifted_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  lift_reason  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS violation_sanctions_violation_idx ON violation_sanctions (violation_id);
CREATE INDEX IF NOT EXISTS violation_sanctions_active_idx ON violation_sanctions (kind) WHERE status = 'active';

-- ============================================================
--  Обжалование
-- ============================================================

CREATE TABLE IF NOT EXISTS violation_appeals (
  id            TEXT PRIMARY KEY,                -- vap-<uuid>
  violation_id  TEXT NOT NULL REFERENCES violations(id) ON DELETE CASCADE,
  submitted_by  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  comment       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN
    ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED')),
  decided_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_reason  TEXT NOT NULL DEFAULT '',
  decision_comment TEXT NOT NULL DEFAULT '',
  -- Что именно изменилось решением — для истории (раздел 16: решение
  -- должно иметь изменённую санкцию, если применимо).
  sanction_change  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS violation_appeals_violation_idx ON violation_appeals (violation_id);
CREATE INDEX IF NOT EXISTS violation_appeals_submitter_idx ON violation_appeals (submitted_by, created_at DESC);
-- Не больше одной незакрытой апелляции на нарушение — вторую подавать
-- незачем, пока первая не решена.
CREATE UNIQUE INDEX IF NOT EXISTS violation_appeals_one_open_idx
  ON violation_appeals (violation_id) WHERE status IN ('SUBMITTED', 'UNDER_REVIEW');

-- ============================================================
--  Доказательства — метаданные здесь, файл на диске (см.
--  server/evidencestore.mjs, по образцу videostore.mjs).
-- ============================================================

CREATE TABLE IF NOT EXISTS violation_evidence (
  id           TEXT PRIMARY KEY,                -- vev-<uuid>
  violation_id TEXT REFERENCES violations(id) ON DELETE CASCADE,
  appeal_id    TEXT REFERENCES violation_appeals(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN
    ('photo', 'video', 'document', 'screenshot', 'order_data', 'tracking',
      'qr_operation', 'system_event', 'message')),
  mime         TEXT NOT NULL DEFAULT '',
  bytes        INTEGER NOT NULL DEFAULT 0,
  description  TEXT NOT NULL DEFAULT '',
  uploaded_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (violation_id IS NOT NULL OR appeal_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS violation_evidence_violation_idx ON violation_evidence (violation_id);
CREATE INDEX IF NOT EXISTS violation_evidence_appeal_idx ON violation_evidence (appeal_id);

-- ============================================================
--  Уведомления — по образцу garant_notifications (067_garant.sql).
-- ============================================================

CREATE TABLE IF NOT EXISTS violation_notifications (
  id           TEXT PRIMARY KEY,                -- vnn-<uuid>
  user_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  violation_id TEXT REFERENCES violations(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  text         TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS violation_notifications_user_idx
  ON violation_notifications (user_id, created_at DESC);

-- ============================================================
--  Неподменяемый журнал — тот же приём, что admin_log (058) и
--  market_pvz_audit (059): BEFORE UPDATE/DELETE триггер на уровне
--  самой базы, не только проверка в коде.
-- ============================================================

CREATE TABLE IF NOT EXISTS violation_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  violation_id TEXT,
  target_type TEXT NOT NULL DEFAULT '',
  target_id   TEXT NOT NULL DEFAULT '',
  actor_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS violation_audit_log_violation_idx
  ON violation_audit_log (violation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS violation_audit_log_target_idx
  ON violation_audit_log (target_type, target_id, created_at DESC);

CREATE OR REPLACE FUNCTION violation_audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'violation_audit_log: журнал только для записи — % запрещён', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS violation_audit_log_no_update ON violation_audit_log;
DROP TRIGGER IF EXISTS violation_audit_log_no_delete ON violation_audit_log;

CREATE TRIGGER violation_audit_log_no_update BEFORE UPDATE ON violation_audit_log
  FOR EACH ROW EXECUTE FUNCTION violation_audit_log_append_only();
CREATE TRIGGER violation_audit_log_no_delete BEFORE DELETE ON violation_audit_log
  FOR EACH ROW EXECUTE FUNCTION violation_audit_log_append_only();
