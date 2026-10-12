-- Тех. поддержка с лендинга: обращение гостя (без входа) попадает в ТУ ЖЕ очередь поддержки, что и обращения из приложения.
-- У такого тикета нет автора-профиля; контакт — почта (зашифрована), по коду + почте человек смотрит статус и отвечает на сайте.
ALTER TABLE support_tickets ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'app';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS guest_email TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS guest_hash  TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS guest_code  TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS guest_lang  TEXT NOT NULL DEFAULT 'ru';
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_guest_code_idx ON support_tickets (guest_code) WHERE guest_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_tickets_guest_hash_idx ON support_tickets (guest_hash, created_at DESC) WHERE guest_hash IS NOT NULL;
