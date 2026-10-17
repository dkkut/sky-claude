-- Sky GO: возвраты по оплаченным заказам. Деньги идут напрямую между людьми — Sky записывает договорённость и решает споры, но сам не возвращает.
CREATE TABLE IF NOT EXISTS go_refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES go_orders(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  executor_id TEXT NOT NULL,
  amount_rub INTEGER NOT NULL CHECK (amount_rub > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  executor_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS go_refunds_executor_idx ON go_refunds (executor_id, status);
CREATE INDEX IF NOT EXISTS go_refunds_customer_idx ON go_refunds (customer_id);
CREATE INDEX IF NOT EXISTS go_refunds_status_idx ON go_refunds (status, updated_at);
