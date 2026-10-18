-- Почта обращений сайта: шифрованная копия (читать) + HMAC (искать). Открытая колонка `email` для новых записей остаётся пустой,
-- старые заполняет scripts/seal-site-emails.mjs (с проверкой обратной расшифровки). Только добавляет колонки.
ALTER TABLE site_appeals  ADD COLUMN IF NOT EXISTS email_enc  TEXT;
ALTER TABLE site_appeals  ADD COLUMN IF NOT EXISTS email_hmac TEXT;
ALTER TABLE site_releases ADD COLUMN IF NOT EXISTS email_enc  TEXT;
ALTER TABLE site_releases ADD COLUMN IF NOT EXISTS email_hmac TEXT;
ALTER TABLE site_appeals  ALTER COLUMN email SET DEFAULT '';
ALTER TABLE site_releases ALTER COLUMN email SET DEFAULT '';
CREATE INDEX IF NOT EXISTS site_appeals_email_hmac_idx  ON site_appeals (email_hmac);
CREATE INDEX IF NOT EXISTS site_releases_email_hmac_idx ON site_releases (email_hmac);
