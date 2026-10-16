-- Подтверждение SSH: рубильник «приостановить новые входы» (владелец). Существующие SSH-сессии он НЕ обрывает — только закрывает новые входы.
CREATE TABLE IF NOT EXISTS ssh_gate_state (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  paused     BOOLEAN NOT NULL DEFAULT FALSE,
  reason     TEXT NOT NULL DEFAULT '',
  set_by     TEXT,
  set_at     TIMESTAMPTZ
);
INSERT INTO ssh_gate_state (id) VALUES (TRUE) ON CONFLICT DO NOTHING;
