-- Sky Parking: оплата через SkyKassa Business на реквизиты организации (не с кошелька). Сессия ждёт оплаты (awaiting_payment) и
-- включается, когда организация подтвердит поступление в своём кабинете SkyKassa Business. Старые сессии (pay_via = 'wallet') не меняются.
ALTER TABLE parking_sessions DROP CONSTRAINT IF EXISTS parking_sessions_status_check;
ALTER TABLE parking_sessions ADD CONSTRAINT parking_sessions_status_check CHECK (status IN ('awaiting_payment','active','ended','cancelled'));
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS pay_via TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS pay_deadline TIMESTAMPTZ;
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS start_minutes INT;
CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_vehicle_pending ON parking_sessions(vehicle_id) WHERE status = 'awaiting_payment' AND vehicle_id IS NOT NULL;

ALTER TABLE parking_payments DROP CONSTRAINT IF EXISTS parking_payments_status_check;
ALTER TABLE parking_payments ADD CONSTRAINT parking_payments_status_check CHECK (status IN ('pending','paid','refunded','cancelled'));
ALTER TABLE parking_payments ADD COLUMN IF NOT EXISTS pay_via TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE parking_payments ADD COLUMN IF NOT EXISTS kb_qr_id TEXT;
ALTER TABLE parking_payments ADD COLUMN IF NOT EXISTS kb_payment_id TEXT;
CREATE INDEX IF NOT EXISTS parking_payments_qr_idx ON parking_payments (kb_qr_id);
