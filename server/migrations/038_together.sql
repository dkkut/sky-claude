-- Sky «Вместе»: совместный просмотр и совместное прослушивание.
--
-- До этой миграции у «Вместе» не было в базе ни одной строки, и это
-- видно было по поведению: «комнаты» жили в состоянии браузера, а
-- «синхронизация» шла через BroadcastChannel — канал между вкладками
-- ОДНОГО браузера. Два человека не видели друг друга никогда, а
-- воспроизведение было таймером, прибавлявшим секунду к числу.
--
-- Четыре решения, из которых следует вся схема.
--
-- 1. Сессия закрытая по устройству, а не по договорённости. Право
--    войти даёт строка в together_participants, а не знание
--    идентификатора сессии. Угаданный или подсмотренный session_id не
--    даёт ничего: сервер сначала ищет строку участника, и только потом
--    отвечает хоть что-нибудь.
--
-- 2. Сервер — единственный источник состояния воспроизведения. Позиция
--    хранится не числом «сколько сейчас», а парой «позиция + момент,
--    когда она была такой». Из этой пары текущая позиция считается в
--    любой миг и для любого опоздавшего: вошедший на сороковой минуте
--    попадает на сороковую минуту, а не на нулевую.
--
-- 3. Сервер не раздаёт медиа. Здесь нет ни байта фильма и ни байта
--    трека — только права и состояние. Файл каждый участник тянет сам,
--    своим пропуском, и права на него проверяет модуль кино или музыки,
--    как для одиночного просмотра. Поэтому «Вместе» не может стать
--    дырой в чужих ограничениях: оно просто не участвует в выдаче.
--
-- 4. Тип сессии — строка с проверкой, а не перечисление. Добавить
--    третий вид (скажем, чтение книги вместе) должно стоить одной
--    строки в CHECK, а не переписывания таблицы.

-- ============================================================
--  Сессия
-- ============================================================

CREATE TABLE IF NOT EXISTS together_sessions (
  id            TEXT PRIMARY KEY,

  -- Владелец. Только он по умолчанию управляет воспроизведением и
  -- только он зовёт людей. Идентификатор приходит из токена, не из тела
  -- запроса: подменить его нечем.
  owner_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Вид сессии. 'watch' — кино и видео, 'listen' — музыка. Список
  -- намеренно открыт для пополнения: см. решение 4 выше.
  session_type  TEXT NOT NULL CHECK (session_type IN ('watch', 'listen')),

  -- Из какого модуля содержимое. Один идентификатор без указания
  -- модуля бессмыслен: 'm-…' в кино и 't-…' в музыке живут в разных
  -- таблицах, и проверять права надо в разных.
  content_kind  TEXT NOT NULL CHECK (content_kind IN ('movie', 'track', 'album', 'playlist')),
  content_id    TEXT NOT NULL,

  -- Название сессии: то, что человек написал при создании. Название
  -- содержимого сюда не копируется — оно берётся из своего модуля, и
  -- копия разошлась бы с оригиналом после переименования.
  title         TEXT NOT NULL DEFAULT '',

  -- planned — позвали, но ещё не начали; live — идёт; ended —
  -- закончена. Из ended выхода нет: заново открыть завершённую сессию
  -- нельзя, заводится новая.
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'live', 'ended')),

  -- Потолок участников. Хранится в строке, а не в коде страницы:
  -- иначе «поднять предел» означало бы пересобрать приложение, а
  -- «обойти предел» — поправить число в браузере.
  max_participants INTEGER NOT NULL DEFAULT 10 CHECK (max_participants BETWEEN 2 AND 100),

  -- Настройки сессии. Сегодня здесь один ключ — control: 'owner' или
  -- 'all'. Отдельным столбцом он не стал намеренно: следующая настройка
  -- не должна стоить миграции.
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── Состояние воспроизведения ───────────────────────────────
  -- Ровно один источник правды на всех. Клиент сюда ничего не пишет
  -- напрямую: он присылает событие, сервер решает, можно ли, и меняет
  -- строку сам.

  playing       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Позиция и момент, когда она была такой. Пока playing истинно,
  -- текущая позиция = position_ms + (сейчас - position_at) * rate.
  position_ms   BIGINT NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
  position_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Скорость. Отдельно от позиции: на ускоренном воспроизведении
  -- пересчёт «сколько прошло» без неё врёт тем сильнее, чем дольше
  -- никто не трогал плеер.
  rate          NUMERIC(4, 2) NOT NULL DEFAULT 1 CHECK (rate BETWEEN 0.25 AND 4),

  -- Очередь для музыки: список идентификаторов треков и место в нём.
  -- Для кино пусто.
  queue         JSONB NOT NULL DEFAULT '[]'::jsonb,
  queue_index   INTEGER NOT NULL DEFAULT 0 CHECK (queue_index >= 0),

  -- Номер состояния, растущий на каждое изменение. Нужен против двух
  -- бед сразу: события, пришедшие не в том порядке (сеть их
  -- переставляет), и повтор давнего события — оба приходят с номером
  -- меньше текущего и отбрасываются.
  state_seq     BIGINT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ
);

-- Свои сессии и приглашения человек открывает чаще всего.
CREATE INDEX IF NOT EXISTS together_sessions_owner_idx
  ON together_sessions (owner_id, created_at DESC);

-- Уборщику нужны брошенные: живые, но давно без единого события.
CREATE INDEX IF NOT EXISTS together_sessions_live_idx
  ON together_sessions (status, position_at)
  WHERE status <> 'ended';

-- ============================================================
--  Участники
-- ============================================================

CREATE TABLE IF NOT EXISTS together_participants (
  session_id  TEXT NOT NULL REFERENCES together_sessions(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- owner — создатель; participant — позванный. moderator и host
  -- перечислены заранее: право управлять воспроизведением уже сейчас
  -- спрашивается у роли, и добавление третьей роли не потребует
  -- трогать проверки.
  role        TEXT NOT NULL DEFAULT 'participant'
              CHECK (role IN ('owner', 'participant', 'moderator', 'host')),

  -- invited — позвали, ответа нет; joined — принял и вошёл; declined —
  -- отказался; left — вышел сам; removed — убрал владелец.
  --
  -- Строка не удаляется ни в одном из случаев: удалённая строка стирает
  -- и след того, что человека звали, а он отказался. История сессии
  -- должна остаться целой.
  status      TEXT NOT NULL DEFAULT 'invited'
              CHECK (status IN ('invited', 'joined', 'declined', 'left', 'removed')),

  -- Кто позвал. Владелец зовёт сам себя при создании.
  invited_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,

  invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at   TIMESTAMPTZ,
  left_at     TIMESTAMPTZ,

  -- Пара — первичный ключ: дважды позвать одного человека в одну
  -- сессию база просто не даст. Проверка «нет ли уже такого» в коде
  -- была бы гонкой: два одновременных приглашения проходят её оба.
  PRIMARY KEY (session_id, user_id)
);

-- «Где я участвую» — запрос, с которого начинается каждый экран.
CREATE INDEX IF NOT EXISTS together_participants_user_idx
  ON together_participants (user_id, status);

-- ============================================================
--  Приглашения
-- ============================================================

-- Зачем здесь ещё и одноразовый секрет, если приглашение и так именное.
--
-- Именное приглашение само по себе строже ссылки: ссылку можно
-- переслать, а личность переслать нельзя. Поэтому личность здесь —
-- главная проверка, и она обязательна всегда. Секрет добавлен ВТОРЫМ
-- условием, а не вместо первого: он гасит повтор (принять дважды
-- нельзя), даёт срок годности и позволяет владельцу отозвать
-- приглашение, не удаляя следа. В базе лежит не он сам, а его отпечаток:
-- утечка дампа не даёт принять ни одно приглашение.
CREATE TABLE IF NOT EXISTS together_invitations (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES together_sessions(id) ON DELETE CASCADE,

  -- Кому. Принять приглашение может только этот профиль — сравнение
  -- идёт с идентификатором из токена.
  invitee_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inviter_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Отпечаток секрета (SHA-256). Сам секрет не хранится нигде.
  token_hash  TEXT NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);

-- Одно действующее приглашение на человека в сессию. Частичный
-- уникальный индекс: отозванные и использованные не мешают позвать
-- снова.
CREATE UNIQUE INDEX IF NOT EXISTS together_invitations_live_idx
  ON together_invitations (session_id, invitee_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS together_invitations_invitee_idx
  ON together_invitations (invitee_id, created_at DESC);

-- ============================================================
--  Журнал
-- ============================================================

-- Что записываем: кто создал, кого позвал, кто вошёл и вышел, кому
-- отказано и почему, кто завершил. Чего не записываем: секретов
-- приглашений и содержимого чата сессии.
CREATE TABLE IF NOT EXISTS together_log (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT REFERENCES together_sessions(id) ON DELETE CASCADE,
  actor_id    TEXT,
  event       TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS together_log_session_idx
  ON together_log (session_id, created_at DESC);
