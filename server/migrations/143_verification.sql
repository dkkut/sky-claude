-- Отметки верификации (модуль 6): пользователь, группа, канал, видеоканал, «официальный» аккаунт/сервис.
-- Присвоить себе отметку нельзя: её даёт только решение сотрудника по заявке (или владелец — «официальный»).
CREATE TABLE IF NOT EXISTS verifications (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('user','chat_group','chat_channel','video_channel','official')),
  subject_id    TEXT NOT NULL,
  mark          TEXT NOT NULL DEFAULT 'verified' CHECK (mark IN ('verified','official')),
  status        TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked','withdrawn')),
  requested_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  note          TEXT,                         -- пояснение заявителя (зашифровано)
  links         TEXT,                         -- ссылки-подтверждения (зашифровано, JSON-массив)
  decided_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_reason TEXT,                       -- обязательна при отказе и снятии (зашифрована)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- На один объект — одна «живая» запись (ожидает или действует).
CREATE UNIQUE INDEX IF NOT EXISTS verifications_live_uq ON verifications (subject_type, subject_id) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS verifications_queue_idx ON verifications (status, created_at);
CREATE INDEX IF NOT EXISTS verifications_requester_idx ON verifications (requested_by, created_at DESC);

-- История — только добавление: заявка, решение, снятие, смена отметки.
CREATE TABLE IF NOT EXISTS verification_history (
  id              BIGSERIAL PRIMARY KEY,
  verification_id TEXT NOT NULL REFERENCES verifications(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  actor_id        TEXT,
  reason          TEXT,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_history_idx ON verification_history (verification_id, id);

-- Критерии: тексты для заявителя и числовые минимумы, которые проверяет сервер. Правит администрация.
CREATE TABLE IF NOT EXISTS verification_settings (
  id                 BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  min_account_days   INT NOT NULL DEFAULT 30,
  require_email      BOOLEAN NOT NULL DEFAULT TRUE,
  min_members        INT NOT NULL DEFAULT 10,
  min_videos         INT NOT NULL DEFAULT 3,
  retry_days         INT NOT NULL DEFAULT 14,    -- повторная заявка после отказа
  criteria_text      TEXT NOT NULL DEFAULT '',
  updated_by         TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO verification_settings (id, criteria_text) VALUES (TRUE,
  E'Аккаунт настоящий и ведётся владельцем.\nИмя и описание не вводят в заблуждение и не копируют чужие.\nУказаны ссылки, подтверждающие, что вы — тот, за кого себя выдаёте (сайт, соцсети, документы).\nНет действующих нарушений правил Sky.')
ON CONFLICT DO NOTHING;
