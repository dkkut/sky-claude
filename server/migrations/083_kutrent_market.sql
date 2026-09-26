-- ============================================================
-- KutRent Market — сайт-партнёр (market.kutrent.online).
--
-- Отдельный внешний сайт, но не отдельный сервис: работает тем же
-- API-процессом и той же базой, что и Sky (см. server/kutrentmarket.mjs),
-- поэтому пополнение баланса Sky — обычный внутрипроцессный вызов
-- wallet.credit(), без сети и подписей между сервисами.
--
-- Свои таблицы, с префиксом kutrent_, чтобы не путаться с таблицами
-- основного Sky Market (server/market.mjs) — это разные, не связанные
-- друг с другом системы.
-- ============================================================

-- Анонимная «сессия» посетителя сайта — не аккаунт Sky и не требует
-- регистрации: просто устойчивый идентификатор браузера, чтобы вкладки
-- «Профиль»/«Заказы» показывали настоящую историю посетителя, а не
-- то, что раньше жило только в localStorage той же вкладки.
CREATE TABLE IF NOT EXISTS kutrent_sessions (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kutrent_market_orders (
  id                      TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES kutrent_sessions(id),
  kind                    TEXT NOT NULL CHECK (kind IN ('sky_topup')),
  amount_rub              INTEGER NOT NULL CHECK (amount_rub > 0),
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'paid', 'cancelled')),
  -- Ник получателя на момент создания заказа — и сам профиль, чтобы
  -- смена ника получателем задним числом не переадресовала уже
  -- созданный заказ на другого человека.
  sky_recipient_username  TEXT,
  sky_recipient_profile_id TEXT,
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kutrent_orders_session_idx ON kutrent_market_orders (session_id, created_at DESC);
