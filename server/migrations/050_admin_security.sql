-- ============================================================
--  Безопасность панели администратора
-- ============================================================
--
-- Панель администратора — единственное место, откуда управляется вся
-- экосистема: люди, магазины, деньги, содержимое, права. Компрометация
-- одного административного аккаунта означала компрометацию всего.
--
-- Что было до этой миграции, и почему здесь появилось то, что появилось:
--
--   is_admin был одним тумблером на всё. Человек, позванный разбирать
--   жалобы, получал заодно телеканалы, склады и выдачу прав. Отсюда —
--   роли и права по направлениям, с отказом по умолчанию.
--
--   Один администратор в одиночку заводил второго, разжаловал третьего и
--   банил четвёртого. Скомпрометированный аккаунт за минуту снимал всех
--   остальных. Отсюда — очередь действий, которые подтверждает владелец.
--
--   Украденная сессия сразу давала все критические действия: ничего, кроме
--   входа, не спрашивалось. Отсюда — короткоживущее одноразовое
--   подтверждение личности перед опасным.
--
--   Журнал ничем не был скреплён: вырезанную строку нельзя было заметить.
--   Отсюда — цепочка отпечатков.
--
-- Прежние права никуда не деваются: администратор без назначенной роли
-- считается полноправным, как и был. Сузить роль — отдельное действие, а
-- не побочный эффект выкладки.

-- ── Роль администратора ────────────────────────────────────────────
--
-- Пусто — старый полноправный администратор. Это не оплошность, а
-- условие того, чтобы выкладка ничего не сломала: права, которые были,
-- остаются, пока владелец не решит иначе.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS admin_role TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS admin_role_set_at TIMESTAMPTZ;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS admin_role_set_by TEXT REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_admin_idx ON profiles (admin_role) WHERE is_admin;

-- ── Журнал: цепочка отпечатков ─────────────────────────────────────
--
-- Отпечаток строки считается от её содержимого и отпечатка предыдущей.
-- Вырезать запись из середины, не тронув всё, что после неё, нельзя:
-- цепочка разойдётся, и проверка это покажет.
--
-- Это не делает журнал неудаляемым — против того, у кого есть доступ к
-- базе, база не защищается. Это делает удаление заметным, а заметность
-- и есть то, ради чего журнал ведут.

ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS hash TEXT;
-- Роль на момент действия. Роль могли сменить потом, а журнал должен
-- отвечать на вопрос «кем он был, когда это делал».
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'profile';
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT 'ok';
-- Приметы запроса — обезличенные. Полный адрес и строка обозревателя
-- это данные о человеке; для разбора происшествия достаточно понимать,
-- «тот же это источник или другой».
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS ua_hash TEXT;
ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE INDEX IF NOT EXISTS admin_log_seq_idx ON admin_log (seq);
CREATE INDEX IF NOT EXISTS admin_log_actor_idx ON admin_log (actor_id, created_at DESC);

-- ── Повторное подтверждение личности ───────────────────────────────
--
-- Обычной авторизации мало для опасного. Украденная сессия — это чужие
-- руки на той же клавиатуре; подтверждение спрашивает то, чего у чужих
-- рук нет.
--
-- Код здесь лежит отпечатком, а не сам: утёкший дамп не должен
-- превращаться в связку одноразовых ключей.

CREATE TABLE IF NOT EXISTS admin_step_up (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Под какое именно действие выдано. Подтверждение, годное на всё,
  -- равно отсутствию подтверждения.
  purpose    TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('app', 'email')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_step_up_actor_idx ON admin_step_up (actor_id, purpose);
CREATE INDEX IF NOT EXISTS admin_step_up_age_idx ON admin_step_up (expires_at);

-- ── Действия, которые подтверждает владелец ────────────────────────
--
-- Два ключа: один заводит, другой поворачивает. Администратор оформляет
-- заявку, владелец её подтверждает, и только тогда что-то происходит.
--
-- Слепок действия записывается при создании и не меняется: подтверждают
-- ровно то, что видели. Иначе заявка «выдать 100 ₽» превращалась бы в
-- «выдать 100 000 ₽» между показом и нажатием.

CREATE TABLE IF NOT EXISTS admin_pending_actions (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  actor_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id    TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  -- Что именно сделать. Зашифровано: внутри бывают суммы и причины.
  payload_enc  TEXT NOT NULL,
  -- Отпечаток слепка: по нему видно, что подтверждают то же самое.
  payload_hash TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  decided_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  executed_at  TIMESTAMPTZ,
  -- Итог выполнения: ради него всё и затевалось.
  outcome      TEXT NOT NULL DEFAULT '',
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_pending_idx
  ON admin_pending_actions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_pending_actor_idx
  ON admin_pending_actions (actor_id, created_at DESC);

-- ── События безопасности ───────────────────────────────────────────
--
-- Отдельно от журнала действий: там «что сделали», здесь «что
-- происходило». Отказ в доступе — не действие, но именно он показывает
-- подбор прав раньше, чем подбор удастся.

CREATE TABLE IF NOT EXISTS admin_security_events (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  ip_hash    TEXT,
  ua_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_sec_events_idx
  ON admin_security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_sec_events_actor_idx
  ON admin_security_events (actor_id, created_at DESC);

-- ── Аварийный режим ────────────────────────────────────────────────
--
-- Одна строка на весь сервис. Включается владельцем при подозрении на
-- компрометацию: административные действия закрываются, обычная жизнь
-- экосистемы продолжается — люди не должны страдать оттого, что у нас
-- что-то случилось.

CREATE TABLE IF NOT EXISTS admin_lockdown (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  reason     TEXT NOT NULL DEFAULT '',
  set_by     TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  set_at     TIMESTAMPTZ
);

INSERT INTO admin_lockdown (id, active) VALUES (TRUE, FALSE) ON CONFLICT DO NOTHING;
