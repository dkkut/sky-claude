-- Sky TV: у каналов из первичного набора (миграция 030: «Первый канал», «Россия 1», НТВ…) нет источников, а импорт
-- создал одноимённые каналы с источниками рядом — получились двойники. Переносит источники на исходный канал и убирает двойник.
-- Запуск: docker compose exec -T postgres psql -U sky < scripts/tv-merge-seeded.sql   (сначала смотрит, потом применяет в одной транзакции)
BEGIN;
CREATE TEMP TABLE pairs ON COMMIT DROP AS
  SELECT s.id AS seed_id, d.id AS dup_id, s.name
    FROM tv_channels s
    JOIN tv_channels d ON lower(d.name) = lower(s.name) AND d.id <> s.id
   WHERE s.id LIKE 'ch-00000000-%' AND d.id NOT LIKE 'ch-00000000-%'
     AND NOT EXISTS (SELECT 1 FROM tv_sources x WHERE x.channel_id = s.id)
     AND EXISTS (SELECT 1 FROM tv_sources y WHERE y.channel_id = d.id);
SELECT name AS "объединяю" FROM pairs ORDER BY name;
UPDATE tv_sources t SET channel_id = p.seed_id FROM pairs p WHERE t.channel_id = p.dup_id;
DELETE FROM tv_channels WHERE id IN (SELECT dup_id FROM pairs);
SELECT c.name AS "остались без источника" FROM tv_channels c
 WHERE c.enabled AND NOT EXISTS (SELECT 1 FROM tv_sources x WHERE x.channel_id = c.id) ORDER BY c.position, c.name;
COMMIT;
