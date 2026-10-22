-- Sky GO «Организации», этап 3: задаток за запись через страницу оплаты SkyKassa Business. Только добавляет.
ALTER TABLE kb_items ADD COLUMN IF NOT EXISTS deposit_rub INT NOT NULL DEFAULT 0;
ALTER TABLE gop_bookings ADD COLUMN IF NOT EXISTS deposit_rub  INT NOT NULL DEFAULT 0;
ALTER TABLE gop_bookings ADD COLUMN IF NOT EXISTS qr_id        TEXT;
ALTER TABLE gop_bookings ADD COLUMN IF NOT EXISTS pay_deadline TIMESTAMPTZ;
DROP INDEX IF EXISTS gop_bookings_item_idx;
CREATE INDEX IF NOT EXISTS gop_bookings_item_idx ON gop_bookings (item_id, starts_at) WHERE status IN ('awaiting_payment','requested','confirmed');
CREATE INDEX IF NOT EXISTS gop_bookings_qr_idx ON gop_bookings (qr_id) WHERE qr_id IS NOT NULL;
