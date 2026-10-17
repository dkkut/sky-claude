-- Удаление аккаунта с восстановлением в течение 30 дней.
ALTER TABLE sky_ids  ADD COLUMN IF NOT EXISTS deletion_purge_at TIMESTAMPTZ;      -- не NULL — аккаунт ожидает удаления
ALTER TABLE sky_ids  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;      -- не NULL — данные уже стёрты (остался псевдоним)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_purge_at TIMESTAMPTZ;      -- удаление одного профиля
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS account_deletions (
  id           TEXT PRIMARY KEY,                       -- del-<uuid>
  sky_id       TEXT NOT NULL,
  profile_id   TEXT,                                   -- NULL — весь Sky ID
  scope        TEXT NOT NULL CHECK (scope IN ('account', 'profile')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_at     TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  ip_hash      TEXT,                                   -- HMAC адреса, не сам адрес
  ack          JSONB NOT NULL DEFAULT '{}'::jsonb,     -- какие предупреждения человек подтвердил (баланс, подписка…)
  error        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS account_deletions_due_idx ON account_deletions (purge_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS account_deletions_sky_idx ON account_deletions (sky_id, requested_at DESC);
-- Одна действующая заявка на объект.
CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_one_pending ON account_deletions (sky_id, COALESCE(profile_id, '')) WHERE status = 'pending';

-- Манифест для восстановления/сверки на время ожидания: что было у человека, без секретов и без больших файлов.
-- Шифруется; удаляется в момент окончательной очистки.
CREATE TABLE IF NOT EXISTS account_deletion_manifests (
  deletion_id TEXT PRIMARY KEY REFERENCES account_deletions(id) ON DELETE CASCADE,
  data_enc    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at   TIMESTAMPTZ
);
