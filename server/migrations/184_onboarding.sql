-- Путеводитель для новых людей: состояние знакомства на Sky ID (общее для всех устройств и профилей).
-- Строка создаётся ТОЛЬКО при регистрации нового Sky ID; у прежних людей строки нет — им путеводитель сам не показывается.
CREATE TABLE IF NOT EXISTS onboarding_state (
  sky_id      TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','started','completed','skipped')),
  step        INT  NOT NULL DEFAULT 0,
  interest    TEXT,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
