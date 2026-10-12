-- Сайт (лендинг на корневом домене), управляемый из админки Sky: ссылки, скачивание, статус сервисов, апелляции, заявки на релиз.

CREATE TABLE IF NOT EXISTS site_links (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  sort       INT NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO site_links (key, label, url, sort) VALUES
  ('web',      'Веб-версия Sky',         'https://web.skymessenger.online', 1),
  ('youtube',  'YouTube',                'https://www.youtube.com/@kutlandru', 2),
  ('tiktok',   'TikTok',                 'https://www.tiktok.com/@sky_messenger', 3),
  ('telegram', 'Telegram-канал',         'https://t.me/kutlandcompanies', 4),
  ('discord',  'Discord',                'https://discord.gg/ZEvBtqTTk', 5),
  ('manager',  'Связь с менеджером',     'https://t.me/kutlandcomp', 6)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS site_files (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        BIGINT NOT NULL,
  sha256      TEXT NOT NULL,
  uploaded_by TEXT,
  downloads   BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Карточки платформ на странице «Скачать». status: available | soon | hidden. Ссылка — либо внешний адрес, либо загруженный файл.
CREATE TABLE IF NOT EXISTS site_downloads (
  platform   TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '',
  info       TEXT NOT NULL DEFAULT '',
  version    TEXT NOT NULL DEFAULT '',
  button     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'soon',
  url        TEXT NOT NULL DEFAULT '',
  file_id    TEXT REFERENCES site_files(id) ON DELETE SET NULL,
  sort       INT NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO site_downloads (platform, title, icon, info, version, button, status, url, sort) VALUES
  ('web',     'Web',     '🌐', 'Работает в браузере', 'v4.0', 'Открыть в браузере →', 'available', 'https://web.skymessenger.online', 1),
  ('windows', 'Windows', '🪟', 'Windows 10/11 · .exe',  '', 'Скачать .exe', 'soon', '', 2),
  ('android', 'Android', '🤖', 'Android 8+ · .apk',      '', 'Скачать .apk', 'soon', '', 3),
  ('ios',     'iOS',     '📱', 'iOS 15+ · App Store',   '', 'App Store',    'soon', '', 4),
  ('macos',   'macOS',   '🍎', 'macOS 12+ · .dmg',      '', 'Скачать .dmg', 'soon', '', 5),
  ('linux',   'Linux',   '🐧', 'Ubuntu / Debian · .deb', '', 'Скачать .deb', 'soon', '', 6)
ON CONFLICT DO NOTHING;

-- Статус сервисов (страница «Статус»). state: operational | degraded | outage | maintenance | dev
CREATE TABLE IF NOT EXISTS site_status_components (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  icon  TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'dev',
  note  TEXT NOT NULL DEFAULT '',
  sort  INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS site_status_meta (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  headline   TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO site_status_meta (id, headline, note) VALUES (TRUE, '', '') ON CONFLICT DO NOTHING;
INSERT INTO site_status_components (id, name, icon, state, sort) VALUES
  ('messenger', 'Sky Messenger', '💬', 'operational', 1),
  ('music',     'Sky Music',     '🎵', 'operational', 2),
  ('film',      'Sky Film',      '🎬', 'operational', 3),
  ('market',    'Sky Market',    '🛒', 'operational', 4),
  ('feed',      'Лента',         '📱', 'operational', 5),
  ('gaming',    'Sky Gaming',    '🎮', 'operational', 6),
  ('ai',        'Sky AI',        '✨', 'operational', 7),
  ('infra',     'Серверная инфраструктура', '🖥️', 'operational', 8)
ON CONFLICT DO NOTHING;

-- Апелляции и заявки на релиз, поданные с сайта. Файлы лежат на диске (site_attachments), не в базе.
CREATE TABLE IF NOT EXISTS site_appeals (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  token_hash  TEXT NOT NULL,                 -- секрет подачи: нужен, чтобы дозагрузить файлы к своей заявке
  kind        TEXT NOT NULL,
  username    TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL,
  ref         TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'ru',
  status      TEXT NOT NULL DEFAULT 'new',   -- new | review | accepted | rejected | closed
  answer      TEXT NOT NULL DEFAULT '',
  handled_by  TEXT,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS site_appeals_status_idx ON site_appeals (status, created_at DESC);

CREATE TABLE IF NOT EXISTS site_releases (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  token_hash  TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- music | film
  email       TEXT NOT NULL,
  title       TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  lang        TEXT NOT NULL DEFAULT 'ru',
  status      TEXT NOT NULL DEFAULT 'new',   -- new | review | approved | rejected
  answer      TEXT NOT NULL DEFAULT '',
  handled_by  TEXT,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS site_releases_status_idx ON site_releases (status, created_at DESC);

CREATE TABLE IF NOT EXISTS site_attachments (
  id         TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL,                  -- appeal | release
  owner_id   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'file',   -- file | audio | cover | video
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_attachments_owner_idx ON site_attachments (owner_kind, owner_id);
