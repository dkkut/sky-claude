-- Блокировка ПВЗ администрацией Sky (отдельно от active и от временного закрытия самой точкой).
ALTER TABLE market_pickup_points ADD COLUMN IF NOT EXISTS admin_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE market_pickup_points ADD COLUMN IF NOT EXISTS admin_block_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE market_pickup_points ADD COLUMN IF NOT EXISTS admin_blocked_by TEXT;
ALTER TABLE market_pickup_points ADD COLUMN IF NOT EXISTS admin_blocked_at TIMESTAMPTZ;
