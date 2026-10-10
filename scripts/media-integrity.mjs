#!/usr/bin/env node
/**
 * Отчёт о согласованности медиа: записи в базе без файла в хранилище и
 * (отдельным счётом) файлы без записи. ТОЛЬКО ЧТЕНИЕ — ничего не удаляет и
 * не меняет: решение, что делать с найденным, принимает человек.
 *
 *   docker compose exec api node scripts/media-integrity.mjs
 *
 * Запись без файла — это «фильм/трек не открывается»: список показывает
 * её, а выдача отвечает 404. Файл без записи занимает место зря; такие
 * файлы убирают плановые sweepOrphan*, здесь они лишь считаются.
 */
import { query, closeDb } from '../server/db.mjs';
import * as film from '../server/filmstore.mjs';
import * as music from '../server/musicstore.mjs';
import * as skyvideo from '../server/skyvideostore.mjs';

const checks = [
  { name: 'Sky Film (видео)', sql: `SELECT id, owner_id, title, status FROM film_movies`, size: film.sizeOf },
  { name: 'Sky Film (постеры)', sql: `SELECT id, owner_id, title, status FROM film_movies WHERE has_poster`, size: (id) => film.sizeOf(film.posterIdFor ? film.posterIdFor(id) : `pst-${id.slice(4)}`) },
  { name: 'Sky Music (звук)', sql: `SELECT id, owner_id, title, status FROM music_tracks`, size: music.sizeOf },
  { name: 'Sky Music (обложки)', sql: `SELECT id, owner_id, title, status FROM music_tracks WHERE has_cover`, size: (id) => music.sizeOf(`cov-${id.slice(4)}`) },
  { name: 'SkyVideo (видео)', sql: `SELECT id, owner_id, title, status FROM sky_videos WHERE status <> 'draft'`, size: skyvideo.sizeOf },
];

let problems = 0;
for (const c of checks) {
  const { rows } = await query(c.sql);
  const broken = [];
  for (const r of rows) {
    let size = null;
    try { size = await c.size(r.id); } catch { size = null; }
    if (size === null || size === 0) broken.push(r);
  }
  problems += broken.length;
  console.log(`\n${c.name}: записей ${rows.length}, без файла ${broken.length}`);
  for (const b of broken.slice(0, 50)) console.log(`  ${b.id}  владелец=${b.owner_id}  статус=${b.status}  «${String(b.title).slice(0, 60)}»`);
  if (broken.length > 50) console.log(`  … и ещё ${broken.length - 50}`);
}
console.log(problems ? `\nИтого записей без файла: ${problems}. Ничего не изменено.` : '\nРасхождений не найдено.');
await closeDb();
