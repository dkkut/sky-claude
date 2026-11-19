-- Sky Вопросы: вопросы и ответы людей экосистемы с голосами и «лучшим ответом».
CREATE TABLE IF NOT EXISTS qa_questions (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','removed')),
  best_answer_id TEXT,
  answers     INTEGER NOT NULL DEFAULT 0,
  views       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qa_questions_new_idx ON qa_questions (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS qa_questions_author_idx ON qa_questions (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qa_questions_tags_idx ON qa_questions USING GIN (tags);
CREATE TABLE IF NOT EXISTS qa_answers (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES qa_questions(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  score       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','removed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, author_id)
);
CREATE INDEX IF NOT EXISTS qa_answers_author_idx ON qa_answers (author_id);
CREATE TABLE IF NOT EXISTS qa_votes (
  answer_id   TEXT NOT NULL REFERENCES qa_answers(id) ON DELETE CASCADE,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  value       SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (answer_id, profile_id)
);
CREATE TABLE IF NOT EXISTS qa_reports (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('question','answer')),
  target_id   TEXT NOT NULL,
  reporter_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS qa_reports_open_uniq ON qa_reports (kind, target_id, reporter_id) WHERE status = 'open';
