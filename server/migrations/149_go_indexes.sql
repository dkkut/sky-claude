-- Sky GO: индексы под запросы распределения и диспетчерского экрана (только IF NOT EXISTS, данные не меняются).
CREATE INDEX IF NOT EXISTS go_presence_online_idx ON go_presence (role, city) WHERE online;
CREATE INDEX IF NOT EXISTS go_orders_executor_active_idx ON go_orders (executor_id, kind) WHERE status IN ('assigned','en_route','arrived','in_ride','heading_pickup','at_pickup','picked_up','delivering','at_recipient');
CREATE INDEX IF NOT EXISTS go_orders_board_idx ON go_orders (kind, created_at) WHERE status IN ('searching','assigned','en_route','arrived','in_ride','dispute');
CREATE INDEX IF NOT EXISTS go_orders_pay_wait_idx ON go_orders (updated_at) WHERE status IN ('awaiting_payment','payment_reported','dispute');
CREATE INDEX IF NOT EXISTS go_order_offers_expire_idx ON go_order_offers (expires_at) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS go_order_offers_recent_idx ON go_order_offers (driver_id, offered_at DESC);
CREATE INDEX IF NOT EXISTS go_subscriptions_active_idx ON go_subscriptions (profile_id, role, expires_at DESC);
