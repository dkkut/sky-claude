-- Sky Maps Core: учёт обращений к поставщикам карт, лимиты, переключатели, ошибки.
CREATE TABLE IF NOT EXISTS maps_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  features JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {geocode:true, static:true, route:true, friends:true, safety:true}
  limits   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"yandex:geocode": 1000, ...} в сутки; 0/нет — без предела
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO maps_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS maps_usage (
  day DATE NOT NULL,
  provider TEXT NOT NULL,
  feature TEXT NOT NULL,
  ok INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  limited INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider, feature)
);

CREATE TABLE IF NOT EXISTS maps_errors (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  feature TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maps_errors_recent ON maps_errors (created_at DESC);
