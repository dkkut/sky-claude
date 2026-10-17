-- Sky GO: обращения в поддержку по заказам (ссылка на общий тикет Sky) и настройки уведомлений получателя.
CREATE TABLE IF NOT EXISTS go_support_links (
  ticket_id  TEXT PRIMARY KEY REFERENCES support_tickets(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id   TEXT REFERENCES go_orders(id) ON DELETE SET NULL,
  category   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS go_support_links_profile_idx ON go_support_links (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS go_support_links_order_idx ON go_support_links (order_id);
CREATE INDEX IF NOT EXISTS go_support_links_cat_idx ON go_support_links (category, created_at DESC);

-- push: false отключает пуши этой группы; запись в разделе «Уведомления» остаётся всегда (это история).
CREATE TABLE IF NOT EXISTS go_notify_prefs (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  prefs      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
