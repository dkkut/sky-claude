-- Технические работы на лендинге: включаются из админки, баннер закрывает сайт (приложение не затрагивается).
ALTER TABLE site_status_meta ADD COLUMN IF NOT EXISTS maint_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE site_status_meta ADD COLUMN IF NOT EXISTS maint_title  TEXT NOT NULL DEFAULT '';
ALTER TABLE site_status_meta ADD COLUMN IF NOT EXISTS maint_text   TEXT NOT NULL DEFAULT '';
ALTER TABLE site_status_meta ADD COLUMN IF NOT EXISTS maint_until  TIMESTAMPTZ;
ALTER TABLE site_status_meta ADD COLUMN IF NOT EXISTS maint_by     TEXT;
ALTER TABLE site_status_meta ADD COLUMN IF NOT EXISTS maint_at     TIMESTAMPTZ;
