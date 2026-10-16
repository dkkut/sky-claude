-- Sky ID для сторонних сервисов: OpenID Connect поверх OAuth 2.0 (authorization code + PKCE).
-- Секретов в открытом виде здесь нет: секреты клиентов и коды — только хеши; закрытый ключ подписи — зашифрованным (encryptSecret).
CREATE TABLE IF NOT EXISTS oidc_clients (
  id               TEXT PRIMARY KEY,                       -- публичный идентификатор клиента
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  homepage_url     TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL CHECK (kind IN ('confidential', 'public')),
  secret_hash      TEXT,                                   -- HMAC секрета; у публичных клиентов пусто
  redirect_uris    JSONB NOT NULL DEFAULT '[]'::jsonb,     -- точный список разрешённых адресов возврата
  scopes           JSONB NOT NULL DEFAULT '["openid"]'::jsonb,   -- что клиент вообще может запрашивать
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  secret_rotated_at TIMESTAMPTZ
);

-- Запрос авторизации: создаётся при открытии страницы входа через Sky, живёт 10 минут, решается один раз.
CREATE TABLE IF NOT EXISTS oidc_requests (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oidc_clients(id),
  profile_id     TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  scope          TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT '',
  nonce          TEXT NOT NULL DEFAULT '',
  code_challenge TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  decided_at     TIMESTAMPTZ,
  ip_hash        TEXT
);
CREATE INDEX IF NOT EXISTS oidc_requests_profile_idx ON oidc_requests (profile_id, created_at DESC);

-- Код авторизации: только хеш, одноразовый, живёт 60 секунд.
CREATE TABLE IF NOT EXISTS oidc_codes (
  code_hash      TEXT PRIMARY KEY,
  request_id     TEXT NOT NULL UNIQUE REFERENCES oidc_requests(id),
  client_id      TEXT NOT NULL,
  profile_id     TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  scope          TEXT NOT NULL,
  nonce          TEXT NOT NULL DEFAULT '',
  code_challenge TEXT NOT NULL,
  auth_time      TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);

-- Токены доступа (непрозрачные, только хеш). Привязаны к клиенту, человеку и выданным разрешениям.
CREATE TABLE IF NOT EXISTS oidc_tokens (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  client_id   TEXT NOT NULL,
  profile_id  TEXT NOT NULL,
  scope       TEXT NOT NULL,
  code_hash   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS oidc_tokens_profile_idx ON oidc_tokens (profile_id, client_id);

-- Согласие человека для клиента + постоянный попарный идентификатор (sub): свой у каждого клиента, по нему клиенты не сопоставят одного человека.
CREATE TABLE IF NOT EXISTS oidc_consents (
  profile_id   TEXT NOT NULL,
  client_id    TEXT NOT NULL REFERENCES oidc_clients(id),
  sub          TEXT NOT NULL,
  scope        TEXT NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  PRIMARY KEY (profile_id, client_id),
  UNIQUE (client_id, sub)
);

-- Ключи подписи ID-токенов (ES256). Закрытая часть — зашифрованная; старые ключи остаются в наборе для проверки.
CREATE TABLE IF NOT EXISTS oidc_keys (
  kid             TEXT PRIMARY KEY,
  alg             TEXT NOT NULL DEFAULT 'ES256',
  public_jwk      JSONB NOT NULL,
  private_sealed  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at      TIMESTAMPTZ
);

-- Журнал событий без персональных данных: что, кто (профиль), какому клиенту.
CREATE TABLE IF NOT EXISTS oidc_events (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind       TEXT NOT NULL,
  client_id  TEXT,
  profile_id TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS oidc_events_at_idx ON oidc_events (at DESC);
