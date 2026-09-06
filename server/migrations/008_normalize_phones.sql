-- ============================================================
--  Один номер — один Sky ID.
--
--  Номер хранился так, как его набрали: «+79001234567»,
--  «79001234567» и «89001234567» попадали в разные строки, и один
--  человек, войдя однажды через восьмёрку, заводил себе второй
--  аккаунт с пустыми профилями.
--
--  Приводим к единому виду «+цифры». Там, где приведение столкнуло бы
--  две существующие записи, оставляем как есть: молча слить два
--  аккаунта нельзя — у каждого свои профили, кошелёк и переписка.
-- ============================================================

-- Российская восьмёрка → семёрка (только 11 цифр: в других странах
-- кода «8» нет).
UPDATE sky_ids s
   SET phone = '+7' || substring(s.phone from 2), updated_at = now()
 WHERE s.phone ~ '^8[0-9]{10}$'
   AND NOT EXISTS (
     SELECT 1 FROM sky_ids o WHERE o.phone = '+7' || substring(s.phone from 2)
   );

-- Номер без плюса, но с кодом страны.
UPDATE sky_ids s
   SET phone = '+' || s.phone, updated_at = now()
 WHERE s.phone ~ '^[0-9]{10,15}$'
   AND NOT EXISTS (SELECT 1 FROM sky_ids o WHERE o.phone = '+' || s.phone);

-- Остатки разделителей: пробелы, скобки, дефисы.
UPDATE sky_ids s
   SET phone = '+' || regexp_replace(s.phone, '[^0-9]', '', 'g'), updated_at = now()
 WHERE s.phone !~ '^\+[0-9]{10,15}$'
   AND regexp_replace(s.phone, '[^0-9]', '', 'g') ~ '^[0-9]{10,15}$'
   AND NOT EXISTS (
     SELECT 1 FROM sky_ids o
      WHERE o.phone = '+' || regexp_replace(s.phone, '[^0-9]', '', 'g')
   );
