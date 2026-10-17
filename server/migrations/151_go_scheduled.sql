-- Sky GO: заказ такси «на потом». Заказ ждёт в статусе scheduled и сам начинает поиск за lead минут до времени.
ALTER TABLE go_orders ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE go_orders ADD COLUMN IF NOT EXISTS search_started_at TIMESTAMPTZ;   -- когда начался поиск (для тайм-аута; у обычных заказов — created_at)
CREATE INDEX IF NOT EXISTS go_orders_scheduled_idx ON go_orders (scheduled_at) WHERE status = 'scheduled';
