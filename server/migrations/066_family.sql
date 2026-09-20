-- ============================================================
--  Sky Family: серверная семейная группа.
--
--  Раньше вся Sky Family жила в localStorage одного браузера
--  (src/family/store.ts): «приглашение» мгновенно добавляло участника
--  из локального списка аккаунтов устройства, Prime выдавался локальным
--  флагом (useAuthStore.grantPrime), а балансом, ролями и лимитами
--  управлял сам клиент. Реального сервера не было вовсе.
--
--  Здесь заводится реальная серверная сущность: семья, участники с
--  ролями, приглашения между настоящими Sky ID (через тот же
--  справочник людей, что и в мессенджере — server/directory.mjs),
--  и журнал действий. Sky Prime Family подключается к настоящей
--  таблице prime_subscriptions (server/skyid.mjs::grantPrime) — не
--  заводит вторую систему Prime.
--
--  Семейный счёт/цели/карманные деньги/сейф/капсулы времени и т.п.
--  (остальные вкладки FamilyModule) остаются как есть, локальными —
--  это отдельная, гораздо более крупная задача не по этому ТЗ.
-- ============================================================

CREATE TABLE IF NOT EXISTS families (
  id               TEXT PRIMARY KEY,           -- fam-<uuid>
  owner_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'suspended')),
  member_limit     INTEGER NOT NULL DEFAULT 8 CHECK (member_limit > 0),
  adult_limit      INTEGER NOT NULL DEFAULT 2 CHECK (adult_limit > 0),
  -- До какого момента у семьи оплачен Sky Prime Family. Правда о самом
  -- Prime — в prime_subscriptions (по каждому участнику отдельно), это
  -- поле — только чтобы знать, докуда семья вообще оплатила и на сколько
  -- продлевать при новом участнике/новой оплате.
  prime_paid_until TIMESTAMPTZ,
  settings         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS families_owner_idx ON families (owner_id);

-- ── Участники ─────────────────────────────────────────────────────────
-- profile_id пуст только у «ребёнка без входа» (заводит владелец без
-- приглашения — войти под этим участником нельзя, это просто карточка
-- внутри семьи). У настоящего участника profile_id всегда указывает на
-- его собственный Sky ID — семья не подменяет и не хранит чужой аккаунт.
CREATE TABLE IF NOT EXISTS family_members (
  id            TEXT PRIMARY KEY,             -- fm-<uuid>
  family_id     TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  profile_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  display_name  TEXT,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'adult', 'teen', 'child', 'guest')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'removed')),
  permissions   JSONB NOT NULL DEFAULT '{}',
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at       TIMESTAMPTZ,
  removed_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT family_members_account_or_placeholder CHECK (profile_id IS NOT NULL OR display_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS family_members_family_idx ON family_members (family_id, status);
-- Один реальный аккаунт — не больше одного активного членства сразу,
-- ни в этой семье, ни в какой другой: Sky Family не резиновая.
CREATE UNIQUE INDEX IF NOT EXISTS family_members_one_active_per_profile
  ON family_members (profile_id) WHERE status = 'active' AND profile_id IS NOT NULL;

-- ── Приглашения ───────────────────────────────────────────────────────
-- Одноразовые: partial-уникальный индекс не даёт прислать второе,
-- пока первое не решено — тот же приём, что и у courier_verifications
-- (миграция 065) и logi_video_reviews (миграция 047).
CREATE TABLE IF NOT EXISTS family_invitations (
  id           TEXT PRIMARY KEY,              -- fi-<uuid>
  family_id    TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  sender_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'adult' CHECK (role IN ('adult', 'teen', 'guest')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  resolved_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS family_invitations_recipient_idx
  ON family_invitations (recipient_id, status);
CREATE INDEX IF NOT EXISTS family_invitations_family_idx
  ON family_invitations (family_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS family_invitations_one_pending
  ON family_invitations (family_id, recipient_id) WHERE status = 'pending';

-- ── Журнал действий ───────────────────────────────────────────────────
-- Ни паролей, ни токенов, ни лишних персональных данных — только что
-- произошло и кто это сделал, как и у остальных журналов проекта.
CREATE TABLE IF NOT EXISTS family_audit_log (
  id         TEXT PRIMARY KEY,                -- fal-<uuid>
  family_id  TEXT REFERENCES families(id) ON DELETE SET NULL,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_audit_log_family_idx ON family_audit_log (family_id, created_at DESC);

-- ── Уведомления ───────────────────────────────────────────────────────
-- Тот же приём, что logi_courier_notifications (миграция 041/065):
-- отдельная таблица под фичу + свой push (server/signal.mjs::pushFamily),
-- а не общий "уведомления вообще".
CREATE TABLE IF NOT EXISTS family_notifications (
  id         TEXT PRIMARY KEY,                -- fnn-<uuid>
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id  TEXT REFERENCES families(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_notifications_user_idx
  ON family_notifications (user_id, created_at DESC);
