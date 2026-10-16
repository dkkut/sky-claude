-- Модуль 5: «Партнёры» — каталог настоящих партнёров Sky с проверкой и подтверждением, журналом изменений и скрытыми внутренними данными.
CREATE TABLE IF NOT EXISTS partners (
  id            TEXT PRIMARY KEY,                       -- ptn-<uuid>
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other',          -- shop | service | finance | entertainment | education | other
  website       TEXT NOT NULL DEFAULT '',               -- только https
  logo          BYTEA,                                  -- png/jpeg/webp до 300 КБ; отдаётся через API, не публично
  logo_type     TEXT,
  contact_enc   TEXT NOT NULL DEFAULT '',               -- внутренние контакты, зашифрованы (encryptSecret); людям НЕ отдаются
  starts_at     DATE,                                   -- начало сотрудничества
  ends_at       DATE,                                   -- срок действия (после него партнёр не показывается)
  offers        JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{title, terms, promoCode, endsAt}]
  conditions    TEXT NOT NULL DEFAULT '',               -- общие условия акции
  sort          INTEGER NOT NULL DEFAULT 100,
  status        TEXT NOT NULL DEFAULT 'draft',          -- draft | review | active | suspended | archive
  created_by    TEXT,
  updated_by    TEXT,                                   -- кто правил последним (подтверждает другой человек)
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partners_status_idx ON partners (status, sort);

CREATE TABLE IF NOT EXISTS partner_log (
  id          BIGSERIAL PRIMARY KEY,
  partner_id  TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,                            -- create | update | submit | approve | return | suspend | resume | archive | logo
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,       -- какие поля изменены (без значений внутренних контактов)
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_log_idx ON partner_log (partner_id, at DESC);
