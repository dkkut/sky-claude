-- Согласие с документами: когда и с какой редакцией.
--
-- Одной отметки «согласился» мало: документы меняются, и через год
-- нужно будет сказать не «да», а «да, с редакцией от такого-то числа».
-- Поэтому редакция хранится рядом с датой.
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS legal_revision    TEXT;
ALTER TABLE sky_ids ADD COLUMN IF NOT EXISTS legal_accepted_at TIMESTAMPTZ;
