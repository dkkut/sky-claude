-- Sky Personal Storage: квота, ретеншен, прямой доступ к файлу, чат и
-- TV-код комнаты «Вместе».
--
-- До этой миграции личная коллекция (film_movies/music_tracks со
-- status='private') существовала, но ничем не была ограничена: ни по
-- месту (можно было залить сколько угодно гигабайт), ни по времени
-- (неиспользуемое лежало вечно). Доступ к чужому личному файлу был
-- только один — на время сеанса «Вместе» (watchgrant.mjs), и только
-- для фильмов. Этой миграцией добавляется то, чего не было:
--
--   1. Поля для учёта квоты и 20-дневного ретеншена — на обеих таблицах,
--      кино и музыки, потому что квота у них одна на двоих.
--   2. storage_shares — явный доступ конкретному человеку к конкретному
--      файлу, в обход сеанса «Вместе»: «Поделиться» из личного хранилища.
--   3. together_messages — чат внутри комнаты (не замена Sky Messenger).
--   4. together_join_codes — короткий одноразовый код для входа в
--      комнату с Android TV, где вводить приглашение неудобно.

-- ============================================================
--  Квота и ретеншен: кино и музыка
-- ============================================================

-- retention_keep — явно защищает личную загрузку от уборки
-- неиспользуемого, даже если 20 дней никто не открывал. Название не
-- «saved» намеренно: film_saved/music_favorites — это уже существующее
-- избранное (закладка на чужой или свой ролик, показывается в «Моём»),
-- совсем другая вещь, и общее слово здесь было бы путаницей — отметить
-- фильм избранным не должно значить «не удалять его автоматически».
--
-- owner_last_used_at — именно ВЛАДЕЛЕЦ, не любой зритель: совместный
-- просмотр не должен тихо продлевать жизнь файлу, который сам владелец
-- давно не открывал (см. §8 брифа — активность в комнате учитывается
-- отдельно, при решении об удалении, а не путём автоматического
-- продления этого поля).
ALTER TABLE film_movies
  ADD COLUMN IF NOT EXISTS retention_keep BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE music_tracks
  ADD COLUMN IF NOT EXISTS retention_keep BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Уборщику неиспользуемого личного нужен именно этот отбор: private +
-- не защищено + давно не открывалось владельцем.
CREATE INDEX IF NOT EXISTS film_movies_retention_idx
  ON film_movies (owner_last_used_at)
  WHERE status = 'private' AND retention_keep = FALSE;

CREATE INDEX IF NOT EXISTS music_tracks_retention_idx
  ON music_tracks (owner_last_used_at)
  WHERE status = 'private' AND retention_keep = FALSE;

-- ============================================================
--  Прямой доступ: «Поделиться» конкретному пользователю
-- ============================================================

-- Отдельная сущность от together_participants: доступ здесь не привязан
-- ни к какому сеансу и живёт, пока владелец его не отзовёт (или не
-- истёк срок). Owner файла не меняется никогда — см. §6 брифа: доступ
-- не передаёт владение.
CREATE TABLE IF NOT EXISTS storage_shares (
  id             TEXT PRIMARY KEY,

  owner_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shared_with_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- 'movie' — film_movies, 'track' — music_tracks. Открытый список по
  -- тому же принципу, что session_type в together: добавить третий вид
  -- должно стоить строки в CHECK, не миграции схемы.
  file_kind      TEXT NOT NULL CHECK (file_kind IN ('movie', 'track')),
  file_id        TEXT NOT NULL,

  -- VIEW подразумевается самим фактом строки; DOWNLOAD — отдельное
  -- разрешение и по умолчанию выключено (§5 брифа).
  can_download   BOOLEAN NOT NULL DEFAULT FALSE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);

-- Одно действующее разрешение на пару (кому, какой файл). Частичный
-- индекс — отозванные и истёкшие не мешают выдать заново.
CREATE UNIQUE INDEX IF NOT EXISTS storage_shares_live_idx
  ON storage_shares (shared_with_id, file_kind, file_id)
  WHERE revoked_at IS NULL;

-- «Доступ имеют» на экране владельца.
CREATE INDEX IF NOT EXISTS storage_shares_owner_idx
  ON storage_shares (owner_id, file_kind, file_id)
  WHERE revoked_at IS NULL;

-- «Доступные мне» на экране получателя.
CREATE INDEX IF NOT EXISTS storage_shares_recipient_idx
  ON storage_shares (shared_with_id, created_at DESC)
  WHERE revoked_at IS NULL;

-- ============================================================
--  Чат комнаты «Вместе»
-- ============================================================

-- Не замена Sky Messenger (§24 брифа) — отдельный, маленький, только
-- внутри сеанса. Текст не шифруется отдельно: сеанс и так закрыт по
-- участникам, а модерация должна уметь прочитать то, на что жалуются.
CREATE TABLE IF NOT EXISTS together_messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES together_sessions(id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS together_messages_session_idx
  ON together_messages (session_id, created_at);

-- ============================================================
--  TV-код: вход в комнату с Android TV
-- ============================================================

-- Отдельно от together_invitations: там приглашение именное (известен
-- invitee_id), а здесь — короткий код, который владелец показывает на
-- экране телевизора и человек вводит с телефона/другого устройства, где
-- уже вошёл в свой Sky ID. Поэтому invitee здесь не известен заранее.
-- В базе — только отпечаток кода (SHA-256), как и у приглашений.
CREATE TABLE IF NOT EXISTS together_join_codes (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES together_sessions(id) ON DELETE CASCADE,
  created_by   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  code_hash    TEXT NOT NULL,

  -- Короткий срок жизни и ограничение попыток — §45 брифа. Каждая
  -- неудачная попытка увеличивает attempts; по достижении потолка код
  -- дальше не проверяется, даже если формально не истёк.
  max_attempts INTEGER NOT NULL DEFAULT 5,
  attempts     INTEGER NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_by      TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at   TIMESTAMPTZ
);

-- Активный код сессии ищется по сеансу; действующих одновременно может
-- быть несколько (выключили экран, попросили новый), поэтому без
-- уникального индекса — только по актуальности при проверке.
CREATE INDEX IF NOT EXISTS together_join_codes_session_idx
  ON together_join_codes (session_id, created_at DESC);
