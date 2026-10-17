-- Уведомления владельца: включать ли его собственные действия и от каких администраторов уведомления отключены.
ALTER TABLE owner_notify_prefs ADD COLUMN IF NOT EXISTS include_own BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE owner_notify_prefs ADD COLUMN IF NOT EXISTS muted_admins JSONB NOT NULL DEFAULT '[]'::jsonb;
