-- Журналы безопасности хранят укрупнённый адрес (ip: a.b.c.0/24, IPv6 /48) и отпечаток полного адреса (ip_fp, HMAC).
-- Старые записи приводит к этому виду scripts/seal-ip-logs.mjs. Только добавляет колонки.
ALTER TABLE admin_gate_requests  ADD COLUMN IF NOT EXISTS ip_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE ssh_gate_requests    ADD COLUMN IF NOT EXISTS ip_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE device_links         ADD COLUMN IF NOT EXISTS ip_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE device_links         ADD COLUMN IF NOT EXISTS decided_ip_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE account_freeze_log   ADD COLUMN IF NOT EXISTS ip_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE two_factor_resets    ADD COLUMN IF NOT EXISTS ip_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE contact_change_log   ADD COLUMN IF NOT EXISTS ip_fp TEXT NOT NULL DEFAULT '';
ALTER TABLE device_approvals     ADD COLUMN IF NOT EXISTS ip_fp TEXT NOT NULL DEFAULT '';
