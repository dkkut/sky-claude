-- Файрвол Sky: уровень защиты 0–4 («Атака»), настройки, журнал. Блокировки адресов лежат в уже существующей defense_ip_blocks.
CREATE TABLE IF NOT EXISTS firewall_state (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  level        INT NOT NULL DEFAULT 0,
  pinned_until TIMESTAMPTZ,            -- уровень поставлен вручную: автоматика его не снижает до этого срока
  reason       TEXT NOT NULL DEFAULT '',
  set_by       TEXT,                   -- NULL — автоматика
  set_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cf_prev      TEXT                    -- прежний уровень защиты Cloudflare (если «Атака» его меняла)
);
INSERT INTO firewall_state (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS firewall_settings (
  id   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO firewall_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS firewall_events (
  id     BIGSERIAL PRIMARY KEY,
  at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind   TEXT NOT NULL,                -- level_up | level_down | level_manual | ban | unban | cloudflare | settings
  level  INT NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS firewall_events_at_idx ON firewall_events (at DESC);
