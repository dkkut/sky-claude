-- Вход по SSH по личному токену администратора (server/sshgate.mjs, режим token).
-- Доступ к SSH выдаёт ТОЛЬКО владелец: по одному человеку (у себя владелец имеет доступ всегда).
CREATE TABLE IF NOT EXISTS ssh_access (
  profile_id     TEXT PRIMARY KEY,
  granted_by     TEXT NOT NULL,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  note           TEXT NOT NULL DEFAULT '',
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT NOT NULL DEFAULT ''
);

-- Вход по токену: владелец узнаёт о нём сразу и 25 минут может отменить («Это не я») или подтвердить («Это я»).
ALTER TABLE ssh_gate_requests ADD COLUMN IF NOT EXISTS mode         TEXT NOT NULL DEFAULT 'owner';     -- owner (подтверждает владелец до входа) | token (токен, владельца уведомляем)
ALTER TABLE ssh_gate_requests ADD COLUMN IF NOT EXISTS actor_id     TEXT;                               -- чей токен вошёл
ALTER TABLE ssh_gate_requests ADD COLUMN IF NOT EXISTS notice_until TIMESTAMPTZ;                        -- до какого времени можно отменить вход
ALTER TABLE ssh_gate_requests ADD COLUMN IF NOT EXISTS owner_ack    TEXT;                               -- me | not_me | NULL
ALTER TABLE ssh_gate_requests ADD COLUMN IF NOT EXISTS owner_ack_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ssh_gate_requests_notice_idx ON ssh_gate_requests (notice_until) WHERE mode = 'token';
