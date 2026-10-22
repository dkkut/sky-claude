// Архив материалов (server/contentarchive.mjs): удаление владельцем → архив 20 дней → возврат / окончательное удаление / уборка и напоминание за 2 дня.
// (DATABASE_URL=… node scripts/audit/contentarchive-test.mjs <каталог с api.log>; API запущен с миграцией 186)
import { call, mkuser } from './lib.mjs';
import { query, pool } from '../../server/db.mjs';
const S = process.argv[2];
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const q = (t, p) => query(t, p);

const A = await mkuser(S, 'arca'), B = await mkuser(S, 'arcb');
await q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ($1,$2,'active','test')`, [`pg${Date.now()}`, A.pid]);
const { randomUUID: u } = await import('node:crypto');
const tid = `trk-${u()}`, mid = `mov-${u()}`, vid = `svid-${u()}`, bid = `bok-${u()}`;
await q(`INSERT INTO music_tracks (id, owner_id, title, artist, mime, bytes, status) VALUES ($1,$2,'Мой трек','Я','audio/mpeg',10,'private')`, [tid, A.pid]);
await q(`INSERT INTO film_movies (id, owner_id, title, mime, status) VALUES ($1,$2,'Мой фильм','video/mp4','private')`, [mid, A.pid]);
await q(`INSERT INTO sky_videos (id, owner_id, title, mime) VALUES ($1,$2,'Моё видео','video/mp4')`, [vid, A.pid]);
await q(`INSERT INTO books (id, author_id, title) VALUES ($1,$2,'Моя книга')`, [bid, A.pid]);

// чужой не может убрать в архив чужое: прежний путь отвечает отказом, материал на месте
let r = await call(`/api/music/track/${tid}`, { method: 'DELETE' }, B.tok);
ok(r.status === 403 || r.status === 404, 'чужой трек удалить нельзя', String(r.status));
ok((await q('SELECT 1 FROM music_tracks WHERE id=$1 AND owner_id=$2', [tid, A.pid])).rowCount === 1, 'чужой запрос ничего не изменил');

// владелец: трек, фильм, видео уходят в архив
r = await call(`/api/music/track/${tid}`, { method: 'DELETE' }, A.tok); ok(r.status === 200 && r.data.archived === true, 'трек → архив', r.text.slice(0, 100));
r = await call(`/api/film/movie/${mid}`, { method: 'DELETE' }, A.tok); ok(r.status === 200 && r.data.archived === true, 'фильм → архив', r.text.slice(0, 100));
r = await call(`/api/skyvideo/video/${vid}`, { method: 'DELETE' }, A.tok); ok(r.status === 200 && r.data.archived === true, 'видео → архив', r.text.slice(0, 100));
const { archiveByOwner, sweepArchive } = await import('../../server/contentarchive.mjs');
const ab = await archiveByOwner('book', bid, A.pid); ok(ab.ok, 'книга → архив');
r = await call(`/api/music/track/${tid}`, { method: 'DELETE' }, A.tok); ok(r.status !== 200 || r.data.archived !== true || r.data.duplicate, 'повторное удаление не дублирует запись');
ok((await q(`SELECT count(*)::int n FROM content_archive WHERE owner_id=$1 AND state='archived'`, [A.pid])).rows[0].n === 4, 'в архиве ровно 4 записи');
const row = (await q('SELECT owner_id, status FROM music_tracks WHERE id=$1', [tid])).rows[0];
ok(row && row.owner_id === null && row.status === 'rejected', 'строка жива, скрыта и без владельца');

r = await call('/api/archive', {}, A.tok); ok(r.status === 200 && r.data.items.length === 4 && r.data.days === 20 && r.data.items.every((i) => i.daysLeft === 20), 'список архива', r.text.slice(0, 120));
r = await call('/api/archive', {}, B.tok); ok(r.data.items.length === 0, 'чужой архив пуст');
r = await call('/api/archive'); ok(r.status === 401, 'без входа архива нет');
const items = (await call('/api/archive', {}, A.tok)).data.items;
const idOf = (kind) => items.find((i) => i.kind === kind).id;

// чужой не возвращает и не стирает
r = await call(`/api/archive/${idOf('track')}/restore`, { method: 'POST', body: '{}' }, B.tok); ok(r.status === 404, 'чужой не вернёт');
r = await call(`/api/archive/${idOf('track')}/purge`, { method: 'POST', body: '{}' }, B.tok); ok(r.status === 404, 'чужой не сотрёт');
// возврат
r = await call(`/api/archive/${idOf('track')}/restore`, { method: 'POST', body: '{}' }, A.tok); ok(r.status === 200, 'возврат трека');
const back = (await q('SELECT owner_id, status FROM music_tracks WHERE id=$1', [tid])).rows[0];
ok(back.owner_id === A.pid && back.status === 'private', 'трек снова у владельца, личный');
r = await call(`/api/archive/${idOf('track')}/restore`, { method: 'POST', body: '{}' }, A.tok); ok(r.status === 404, 'повторный возврат невозможен');
// окончательное удаление сейчас
r = await call(`/api/archive/${idOf('video')}/purge`, { method: 'POST', body: '{}' }, A.tok); ok(r.status === 200, 'видео удалено окончательно');
ok((await q('SELECT 1 FROM sky_videos WHERE id=$1', [vid])).rowCount === 0, 'видео стёрто из базы');

// уборка киношных сирот не трогает архив
const { sweepOrphanFilms } = await import('../../server/film.mjs'); await sweepOrphanFilms();
ok((await q('SELECT 1 FROM film_movies WHERE id=$1', [mid])).rowCount === 1, 'уборка сирот не стёрла фильм из архива');

// напоминание за 2 дня и стирание по сроку
await q(`UPDATE content_archive SET purge_at = now() + interval '40 hours' WHERE item_id=$1`, [mid]);
let sw = await sweepArchive(); ok(sw.warned >= 1, 'напоминание за 2 дня отправлено', JSON.stringify(sw));
const nt = await q(`SELECT 1 FROM gift_notifications WHERE user_id=$1 AND kind='archive_warning'`, [A.pid]); ok(nt.rowCount === 1, 'уведомление создано');
sw = await sweepArchive(); ok((await q(`SELECT 1 FROM gift_notifications WHERE user_id=$1 AND kind='archive_warning'`, [A.pid])).rowCount === 1, 'напоминание не повторяется');
await q(`UPDATE content_archive SET purge_at = now() - interval '1 minute' WHERE item_id IN ($1,$2)`, [mid, bid]);
sw = await sweepArchive(); ok(sw.purged === 2, 'просроченное стёрто', JSON.stringify(sw));
ok((await q('SELECT 1 FROM film_movies WHERE id=$1', [mid])).rowCount === 0 && (await q('SELECT 1 FROM books WHERE id=$1', [bid])).rowCount === 0, 'фильм и книга удалены из базы');
ok((await q(`SELECT count(*)::int n FROM content_archive WHERE owner_id=$1 AND state='archived'`, [A.pid])).rows[0].n === 0, 'в архиве пусто');
await q('DELETE FROM music_tracks WHERE id=$1', [tid]);
console.log(`\n${pass} ok, ${fail} fail`); await pool.end(); process.exit(fail ? 1 : 0);
