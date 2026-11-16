// Профиль автора: автор музыки — правообладатель (владелец карточки), а не загрузивший. Модуль напрямую на Postgres.
process.chdir('/home/user/sky-claude/server');
const m = await import('../../server/creatorprofile.mjs');
const { query } = await import('../../server/db.mjs');
const s = 'cp' + Date.now().toString(36);
const A = s + 'a', U = s + 'u', V = s + 'v';
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log(c ? 'ok  ' : 'FAIL', n); };
for (const id of [A, U, V]) await query(`INSERT INTO profiles (id, username, name) VALUES ($1,$1,$1)`, [id]);
const card = 'card-' + s;
await query(`INSERT INTO music_artist_cards (id, name, name_norm, created_by, owner_id) VALUES ($1,$2,$2,$3,$4)`, [card, 'Автор ' + s, U, A]);
const trk = (id, status, owner, cardId) => query(`INSERT INTO music_tracks (id,title,artist,status,owner_id,artist_card_id,mime,bytes,plays) VALUES ($1,$1,'x',$2,$3,$4,'audio/mpeg',1,10)`, [id, status, owner, cardId]);
await trk('t1' + s, 'published', U, card);   // загрузил U, правообладатель A
await trk('t2' + s, 'private', U, card);
await trk('t3' + s, 'published', U, null);    // загрузил U без карточки правообладателя
await query(`INSERT INTO film_movies (id,owner_id,title,mime,status,views) VALUES ($1,$2,'Ф','video/mp4','published',7)`, ['f1' + s, A]);
await query(`INSERT INTO books (id,author_id,title,status) VALUES ($1,$2,'К','published')`, ['b1' + s, A]);
await query(`INSERT INTO podcasts (id,owner_id,title,status) VALUES ($1,$2,'П','published')`, ['p1' + s, A]);
await query(`INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)`, [V, A]);

const a = await m.getCreatorProfile(V, A);
t('музыка автора = треки на его карточке', a.directions.music.count === 1 && a.directions.music.tracks.length === 1);
t('частный трек чужим не виден', !a.directions.music.tracks.some((x) => x.id === 't2' + s));
const u = await m.getCreatorProfile(V, U);
t('загрузивший не автор музыки', u.directions.music.count === 0 && u.directions.music.tracks.length === 0);
t('кино/книги/подкасты автора', a.directions.film.count === 1 && a.directions.books.count === 1 && a.directions.podcasts.count === 1);
t('подписчики настоящие', a.followers === 1);
t('суммарные прослушивания и просмотры', a.totals.plays === 10 && a.totals.views === 7);
const own = await m.getCreatorProfile(A, A);
t('владелец видит и закрытое', own.directions.music.tracks.some((x) => x.id === 't2' + s));
await query(`UPDATE profiles SET profile_visibility = $2::jsonb WHERE id=$1`, [A, JSON.stringify({ showCreatorMusic: false, showCreatorStats: false })]);
const h = await m.getCreatorProfile(V, A);
t('скрытое направление не отдаётся', !h.directions.music && !!h.directions.film && h.visibility.music === false);
t('статистика скрывается отдельно', h.totals === undefined);
t('владельцу настройки не мешают', !!(await m.getCreatorProfile(A, A)).directions.music);
t('нет такого профиля', (await m.getCreatorProfile(V, 'nope')).error === 'not_found');
await query(`DELETE FROM follows WHERE following_id=$1`, [A]);
await query(`DELETE FROM music_tracks WHERE id LIKE $1`, ['t%' + s]);
await query(`DELETE FROM film_movies WHERE id=$1`, ['f1' + s]); await query(`DELETE FROM books WHERE id=$1`, ['b1' + s]); await query(`DELETE FROM podcasts WHERE id=$1`, ['p1' + s]);
await query(`DELETE FROM music_artist_cards WHERE id=$1`, [card]);
for (const id of [A, U, V]) await query(`DELETE FROM profiles WHERE id=$1`, [id]).catch(() => {});
console.log(ok, 'ok', bad, 'fail'); process.exit(bad ? 1 : 0);
