-- Охват пуша по запуску рассылки: у скольких получателей есть подписка и сколько пушей ушло.
ALTER TABLE notify_broadcast_runs ADD COLUMN IF NOT EXISTS push_targets INT NOT NULL DEFAULT 0;
ALTER TABLE notify_broadcast_runs ADD COLUMN IF NOT EXISTS push_sent INT NOT NULL DEFAULT 0;
