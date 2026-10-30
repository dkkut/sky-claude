-- SkyMoney: фраза восстановления (12 слов) и необязательное «13-е слово». Хранятся только хеши (scrypt + соль + перец).
CREATE TABLE IF NOT EXISTS money_recovery (
  sky_id       TEXT PRIMARY KEY,
  phrase_hash  TEXT NOT NULL,
  phrase_salt  TEXT NOT NULL,
  extra_hash   TEXT,
  extra_salt   TEXT,
  fails        INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
