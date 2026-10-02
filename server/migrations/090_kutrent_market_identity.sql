-- ============================================================
-- KutRent Market — вход через Sky ID, свой Authenticator, своя сессия
-- сайта вместо анонимной.
--
-- Прежняя модель (анонимная kutrent_sessions + пополнение произвольного
-- Sky-ника, который вводил посетитель) была кассой-киоском: по решению
-- владельца она заменяется на личный кабинет — входишь через Sky ID,
-- пополняешь только свой же баланс. Старые таблицы и строки не трогаем:
-- в kutrent_sessions/kutrent_market_orders уже может быть история
-- реальных заказов, а связать анонимную сессию с конкретным Sky ID по
-- имеющимся данным нечем — угадывать нельзя.
-- ============================================================

-- Пользователь KutRent Market — ровно один на профиль Sky (не на Sky ID
-- целиком: у одного Sky ID бывает несколько профилей, и их баланс
-- путать нельзя).
CREATE TABLE IF NOT EXISTS kutrent_market_users (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL UNIQUE REFERENCES profiles(id),
  sky_id        TEXT NOT NULL REFERENCES sky_ids(id),
  -- Непредсказуемый, не последовательный, не зависящий от количества
  -- пользователей, неизменяемый. Не секрет — не пароль и не токен
  -- сессии: по одному Authenticator без собственной сессии владельца
  -- ничего не сделать, он только для подбора в поиске поддержки/админки.
  authenticator TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kutrent_market_users_sky_idx ON kutrent_market_users (sky_id);

-- Сессия сайта после входа через Sky ID. Отдельная от прежней
-- kutrent_sessions: здесь сессия обязана сразу вести к настоящему
-- пользователю Market, промежуточного «анонимного» состояния нет.
CREATE TABLE IF NOT EXISTS kutrent_market_sessions (
  id             TEXT PRIMARY KEY,
  market_user_id TEXT NOT NULL REFERENCES kutrent_market_users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kutrent_market_sessions_user_idx ON kutrent_market_sessions (market_user_id);

-- Одноразовая передача личности с основного домена Sky на
-- market.kutrent.online: куки между доменами не ходят, поэтому личность
-- переносит не кука, а короткоживущий одноразовый токен в адресе
-- редиректа. Храним только отпечаток токена и когда он погашен — тот же
-- приём, что уже применяется для приглашений «Вместе»
-- (together_invites.token_hash/used_at).
CREATE TABLE IF NOT EXISTS kutrent_market_sso_tokens (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Заказы больше не обязаны идти через анонимную сессию и не несут
-- получателя «по нику»: получатель — это всегда сам вошедший. Колонку
-- session_id делаем необязательной (старые строки её не теряют),
-- добавляем market_user_id для новых заказов.
ALTER TABLE kutrent_market_orders
  ALTER COLUMN session_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS market_user_id TEXT REFERENCES kutrent_market_users(id);
CREATE INDEX IF NOT EXISTS kutrent_orders_market_user_idx ON kutrent_market_orders (market_user_id, created_at DESC);
