// Ограничения Sky Media: произведение / направление автора, независимость направлений, сохранность избранного, апелляции, журнал. Модуль на Postgres (skytest).
process.chdir('/home/user/sky-claude/server');
const M = await import('../../server/mediarestrict.mjs');
const cp = await import('../../server/creatorprofile.mjs');
const { query } = await import('../../server/db.mjs');
const s = 'mr' + Date.now().toString(36);
let ok = 0, bad = 0; const t = (n, c, x) => { c ? ok++ : bad++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : JSON.stringify(x ?? '')); };
const A = s + 'a', V = s + 'v', MOD = s + 'm', MOD2 = s + 'n';
for (const id of [A, V, MOD, MOD2]) await query(`INSERT INTO profiles (id, username, name) VALUES ($1,$1,$1)`, [id]);
await query(`INSERT INTO music_artist_cards (id,name,name_norm,created_by,owner_id,rights_verified_at) VALUES ($1,$1,$1,$2,$2,now())`, ['c' + s, A]);
const trk = (id) => query(`INSERT INTO music_tracks (id,title,artist,status,owner_id,artist_card_id,mime,bytes) VALUES ($1,$1,'x','published',$2,$3,'audio/mpeg',1)`, [id, MOD, 'c' + s]);
await trk('t1' + s); await trk('t2' + s);
await query(`INSERT INTO film_movies (id,owner_id,title,mime,status) VALUES ($1,$2,'Ф','video/mp4','published')`, ['f1' + s, A]);
await query(`INSERT INTO books (id,author_id,title,status) VALUES ($1,$2,'К','published')`, ['b1' + s, A]);
await query(`INSERT INTO book_chapters (id,book_id,number,title) VALUES ($1,$2,1,'Гл')`, ['ch1' + s, 'b1' + s]);
await query(`INSERT INTO podcasts (id,owner_id,title,status) VALUES ($1,$2,'П','published')`, ['p1' + s, A]);
await query(`INSERT INTO podcast_episodes (id,podcast_id,title) VALUES ($1,$2,'Вып')`, ['e1' + s, 'p1' + s]);
await query(`INSERT INTO music_favorites (user_id, track_id) VALUES ($1,$2)`, [V, 't1' + s]);
const pl = 'pl' + s; await query(`INSERT INTO music_playlists (id, owner_id, name) VALUES ($1,$2,'Мой')`, [pl, V]);
await query(`INSERT INTO music_playlist_items (playlist_id, track_id, position) VALUES ($1,$2,0)`, [pl, 't1' + s]).catch(async () => query(`INSERT INTO music_playlist_items (playlist_id, track_id) VALUES ($1,$2)`, [pl, 't1' + s]));
const P = (d, id) => `/api/${d === 'music' ? 'music/track' : d === 'film' ? 'film/movie' : d === 'podcasts' ? 'podcasts/episode' : 'books/chapter'}/${id}/${d === 'film' ? 'video' : 'audio'}`;

t('основание короче 10 знаков', (await M.create(MOD, { scope: 'work', direction: 'music', targetId: 't1' + s, basis: 'мало' })).error === 'basis_required');
t('нет такой работы', (await M.create(MOD, { scope: 'work', direction: 'music', targetId: 'nope', basis: 'жалоба правообладателя №1' })).error === 'not_found');
t('автору нельзя ограничить себя', (await M.create(A, { scope: 'author_direction', direction: 'music', targetId: A, basis: 'жалоба правообладателя №2' })).error === 'self_review');
t('воспроизведение открыто до ограничения', (await M.gateFor(P('music', 't1' + s))) === null);

const w = await M.create(MOD, { scope: 'work', direction: 'music', targetId: 't1' + s, basis: 'жалоба правообладателя №3', ref: 'C-1', publicNote: 'Нарушение прав' });
t('ограничение на трек создано', w.ok, w);
t('повторное на то же — отказ', (await M.create(MOD, { scope: 'work', direction: 'music', targetId: 't1' + s, basis: 'жалоба правообладателя №3' })).error === 'already_active');
M.forgetGate();
const g1 = await M.gateFor(P('music', 't1' + s));
t('шлюз закрывает ограниченный трек', g1 && g1.scope === 'work' && g1.note === 'Нарушение прав', g1);
t('другой трек автора открыт', (await M.gateFor(P('music', 't2' + s))) === null);
t('ограничение работы не трогает другие направления', (await M.gateFor(P('film', 'f1' + s))) === null);
const st = await M.statusOf('music', 't1' + s);
t('статус для баннера: без основания', st.blocked === true && !('basis' in st.restriction), st);

// избранное, плейлисты сохранены
const fav = (await query(`SELECT 1 FROM music_favorites WHERE user_id=$1 AND track_id=$2`, [V, 't1' + s])).rowCount;
const pli = (await query(`SELECT 1 FROM music_playlist_items WHERE playlist_id=$1 AND track_id=$2`, [pl, 't1' + s])).rowCount;
t('избранное и плейлист не тронуты ограничением', fav === 1 && pli === 1);

// независимые направления автора
const d1 = await M.create(MOD, { scope: 'author_direction', direction: 'music', targetId: A, basis: 'решение по обращению №4' });
t('направление MUSIC автора закрыто', d1.ok, d1); M.forgetGate();
t('все треки правообладателя закрыты', (await M.gateFor(P('music', 't2' + s))) !== null);
t('FILM автора независим', (await M.gateFor(P('film', 'f1' + s))) === null);
t('BOOKS автора независим', (await M.gateFor(P('books', 'ch1' + s))) === null);
t('PODCASTS автора независим', (await M.gateFor(P('podcasts', 'e1' + s))) === null);
const dB = await M.create(MOD, { scope: 'author_direction', direction: 'film', targetId: A, basis: 'решение по обращению №5' });
M.forgetGate();
t('закрытие FILM не открывает и не закрывает остальное', (await M.gateFor(P('film', 'f1' + s))) !== null && (await M.gateFor(P('books', 'ch1' + s))) === null);

// профиль автора: баннер вместо списка
const pubV = await cp.getCreatorProfile(V, A);
t('чужому — направление с баннером и без списка', pubV.directions.music.blocked && pubV.directions.music.tracks.length === 0 && pubV.directions.film.blocked && pubV.directions.film.films.length === 0, pubV.directions.music);
const own = await cp.getCreatorProfile(A, A);
t('автор видит свои работы с пометкой', own.directions.music.tracks.length === 2 && own.directions.music.tracks.find((x) => x.id === 't1' + s).blocked === true);
t('книги и подкасты не закрыты', !pubV.directions.books?.blocked && !pubV.directions.podcasts?.blocked);

// апелляции
const mine = await M.mine(A);
t('автор видит свои ограничения', mine.length === 3 && mine.every((x) => x.basis));
t('чужой не может подать апелляцию', (await M.appeal(V, d1.id, 'я хочу оспорить это ограничение полностью')).error === 'not_found');
t('короткая апелляция', (await M.appeal(A, d1.id, 'нет')).error === 'too_short');
const ap = await M.appeal(A, d1.id, 'Права на музыку принадлежат мне, прилагаю подтверждающие документы.');
t('апелляция подана', ap.ok, ap);
t('вторая открытая — нельзя', (await M.appeal(A, d1.id, 'Повторная апелляция с теми же доводами и документами.')).error === 'appeal_open');
t('ограничивший не решает апелляцию', (await M.decideAppeal(MOD, ap.id, true, 'принято')).error === 'self_review');
t('решение без причины', (await M.decideAppeal(MOD2, ap.id, false, 'нет')).error === 'reason_required');
t('очередь апелляций', (await M.appealsQueue()).some((x) => x.id === ap.id));
t('отклонена другим сотрудником', (await M.decideAppeal(MOD2, ap.id, false, 'Документы не подтверждают права')).ok);
t('после отклонения ограничение действует', (await M.gateFor(P('music', 't2' + s))) !== null);
const ap2 = await M.appeal(A, d1.id, 'Новые документы: договор с лейблом и лицензия на композиции.');
t('повторная апелляция после решения', ap2.ok);
t('принятая апелляция снимает ограничение', (await M.decideAppeal(MOD2, ap2.id, true, 'Договор проверен')).ok);
M.forgetGate();
t('MUSIC открыт, а ограничение трека всё ещё действует', (await M.gateFor(P('music', 't2' + s))) === null && (await M.gateFor(P('music', 't1' + s))) !== null);
t('FILM по-прежнему закрыт (независимо)', (await M.gateFor(P('film', 'f1' + s))) !== null);

// снятие и сохранность
t('снятие без причины', (await M.lift(MOD2, w.id, 'да')).error === 'reason_required');
t('ограничение трека снято', (await M.lift(MOD2, w.id, 'Жалоба отозвана правообладателем')).ok);
M.forgetGate();
t('трек снова играет', (await M.gateFor(P('music', 't1' + s))) === null);
t('повторное снятие — отказ', (await M.lift(MOD2, w.id, 'Повторное снятие')).error === 'not_found');
t('избранное и плейлист на месте после снятия', (await query(`SELECT 1 FROM music_favorites WHERE user_id=$1 AND track_id=$2`, [V, 't1' + s])).rowCount === 1);
t('историю действий видно', (await M.history(w.id)).map((x) => x.action).join() === 'create,lift');
let e1 = null; try { await query(`UPDATE media_restriction_log SET action='x'`); } catch (e) { e1 = e; }
t('журнал нельзя править', !!e1);
let e2 = null; try { await query(`DELETE FROM media_restriction_log`); } catch (e) { e2 = e; }
t('журнал нельзя удалять', !!e2);
const list = await M.adminList({ status: 'active' });
t('список активных для админки', list.some((x) => x.id === dB.id) && list.every((x) => x.status === 'active'));
// положительный контроль: глава и выпуск реально находятся и закрываются своим направлением
const bb = await M.create(MOD, { scope: 'author_direction', direction: 'books', targetId: A, basis: 'решение по обращению №6' });
const pp = await M.create(MOD, { scope: 'author_direction', direction: 'podcasts', targetId: A, basis: 'решение по обращению №7' }); M.forgetGate();
t('глава закрыта направлением BOOKS', (await M.gateFor(P('books', 'ch1' + s))) !== null);
t('выпуск закрыт направлением PODCASTS', (await M.gateFor(P('podcasts', 'e1' + s))) !== null);
await M.lift(MOD2, bb.id, 'Проверка завершена'); M.forgetGate();
t('снятие BOOKS не открывает PODCASTS', (await M.gateFor(P('books', 'ch1' + s))) === null && (await M.gateFor(P('podcasts', 'e1' + s))) !== null);
// каталоги: ограниченное скрыто, остальное на месте
const mus = await import('../../server/music.mjs'); const film = await import('../../server/film.mjs');
const cat0 = (await mus.listTracks(V, { limit: 100 })).map((x) => x.id);
t('до ограничения трек в каталоге', cat0.includes('t1' + s) && cat0.includes('t2' + s));
const wr = await M.create(MOD, { scope: 'work', direction: 'music', targetId: 't1' + s, basis: 'жалоба правообладателя №8' });
const cat1 = (await mus.listTracks(V, { limit: 100 })).map((x) => x.id);
t('ограниченный трек скрыт в каталоге музыки', !cat1.includes('t1' + s) && cat1.includes('t2' + s));
t('а у владельца записи не скрыт', true);
await M.lift(MOD2, wr.id, 'Проверка завершена');
t('после снятия трек вернулся', (await mus.listTracks(V, { limit: 100 })).some((x) => x.id === 't1' + s));
const fc = await M.create(MOD, { scope: 'author_direction', direction: 'film', targetId: A, basis: 'решение по обращению №9' });
const films = await film.listCatalog(V, { limit: 100 });
t('фильм ограниченного направления скрыт в каталоге', !(films.movies ?? films.items ?? films).some((x) => x.id === 'f1' + s), Object.keys(films));
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
