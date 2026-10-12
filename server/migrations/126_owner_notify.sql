-- Настройки уведомлений владельца: что присылать (только заявки на подтверждение / все действия администрации) и куда (раздел «Уведомления» / push).
CREATE TABLE IF NOT EXISTS owner_notify_prefs (
  profile_id TEXT PRIMARY KEY,
  mode       TEXT NOT NULL DEFAULT 'requests' CHECK (mode IN ('requests', 'all')),
  in_app     BOOLEAN NOT NULL DEFAULT TRUE,
  push       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
