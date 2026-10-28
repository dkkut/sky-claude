-- Билеты в «Сервисах для бизнеса»: мероприятие привязывается к организации SkyKassa Business,
-- вход проверяют сотрудники организации (в том числе новая роль «контролёр»), оплата — страницей оплаты организации.
ALTER TABLE ticket_events ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES kb_businesses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ticket_events_business_idx ON ticket_events (business_id) WHERE business_id IS NOT NULL;

ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS pay_via TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS kb_qr_id TEXT;
ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS pay_deadline TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ticket_orders_unpaid_idx ON ticket_orders (pay_deadline) WHERE status = 'awaiting_payment' AND pay_via = 'kassa';
