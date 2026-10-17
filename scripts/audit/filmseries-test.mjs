// Сериалы Sky Film: сезоны, серии, права, порядок, «дальше», продолжение, публикация, субтитры.
// Запуск: . env.sh; ADMIN_GATE=off node server/server.mjs &; node scripts/audit/filmseries-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const prime = (u) => { q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-fs-${u.pid}','${u.pid}','active','standard', now() + interval '30 days') on conflict do nothing`); q(`update profiles set is_prime=true where id='${u.pid}'`); };
const mp4 = () => { const b = Buffer.alloc(2048, 1); b.write('ftyp', 4, 'latin1'); b.write('isom', 8, 'latin1'); return b; };
const upload = async (u, qs) => {
  const r = await fetch(`${B}/api/film/upload?${qs}`, { method: 'POST', headers: { authorization: `Bearer ${u.tok}`, 'content-type': 'video/mp4' }, body: mp4() });
  const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = text; } return { status: r.status, data: d };
};

const A = await mkuser(S, 'fsOwn'); const V = await mkuser(S, 'fsView'); const N = await mkuser(S, 'fsNoPrime');
const M = await mkuser(S, 'fsMod'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${M.pid}'`);
prime(A); prime(V);

let r = await call('/api/film/series', {}, N.tok);
t('без Prime — отказ', r.status === 403 && r.data.error === 'prime_required', r.status);

r = await call('/api/film/series', { method: 'POST', body: JSON.stringify({ title: 'Тестовый сериал', description: 'Описание', genre: 'драма' }) }, A.tok);
t('создание сериала', r.status === 201 && r.data.series?.title === 'Тестовый сериал' && r.data.seasons?.length === 1, JSON.stringify(r.data).slice(0, 200));
const SID = r.data.id; const S1 = r.data.seasons[0].id;
r = await call('/api/film/series', { method: 'POST', body: JSON.stringify({ title: '' }) }, A.tok);
t('пустое название — 400', r.status === 400);

r = await call(`/api/film/series/${SID}/seasons`, { method: 'POST', body: JSON.stringify({ title: 'Второй' }) }, A.tok);
t('второй сезон получает номер 2', r.status === 201 && r.data.number === 2, JSON.stringify(r.data).slice(0, 150));
const S2 = r.data.id;
r = await call(`/api/film/series/${SID}/seasons`, { method: 'POST', body: JSON.stringify({ number: 2 }) }, A.tok);
t('повтор номера сезона — 409', r.status === 409);
r = await call(`/api/film/series/${SID}/seasons`, { method: 'POST', body: JSON.stringify({}) }, V.tok);
t('чужой сериал не правится', r.status === 403 || r.status === 404, r.status);

const e1 = await upload(A, `title=${encodeURIComponent('Серия 1')}&seasonId=${S1}&epNo=1&introStart=5&introEnd=40`);
t('загрузка серии 1', e1.status === 201 && e1.data.movie?.seriesId === SID && e1.data.movie.epNo === 1 && e1.data.movie.introEnd === 40, JSON.stringify(e1.data).slice(0, 250));
const e2 = await upload(A, `title=${encodeURIComponent('Серия 2')}&seasonId=${S1}`);
t('номер серии по умолчанию — следующий', e2.status === 201 && e2.data.movie?.epNo === 2, JSON.stringify(e2.data).slice(0, 200));
const e3 = await upload(A, `title=${encodeURIComponent('Серия 1 сезона 2')}&seasonId=${S2}&epNo=1`);
t('серия во втором сезоне', e3.status === 201 && e3.data.movie?.epNo === 1);
const dup = await upload(A, `title=dup&seasonId=${S1}&epNo=1`);
t('занятый номер — 409 и записи нет', dup.status === 409 && q(`select count(*) from film_movies where title='dup'`) === '0', JSON.stringify(dup.data));
const foreign = await upload(V, `title=x&seasonId=${S1}`);
t('чужой сезон — 403, записи нет', foreign.status === 403 && q(`select count(*) from film_movies where title='x' and owner_id='${V.pid}'`) === '0', foreign.status);

r = await call('/api/film/catalog', {}, A.tok);
t('серии не попадают в общий каталог фильмов', !r.data.movies.some((m) => m.seriesId));
r = await call('/api/film/mine', {}, A.tok);
t('серии не засоряют «мои фильмы»', !r.data.movies.some((m) => m.seriesId));

r = await call(`/api/film/series/${SID}`, {}, A.tok);
t('владелец видит сезоны и серии по порядку', r.data.seasons.length === 2 && r.data.seasons[0].episodes.map((e) => e.epNo).join() === '1,2' && r.data.seasons[1].episodes.length === 1, JSON.stringify(r.data.seasons.map((s) => s.episodes.length)));
t('«смотреть» для нового — первая серия', r.data.resume?.episodeId === e1.data.movie.id && r.data.resume.fresh === true);
r = await call(`/api/film/series/${SID}`, {}, V.tok);
t('чужой закрытый сериал не виден', r.status === 404);
r = await call('/api/film/series', {}, V.tok);
t('закрытый сериал не в каталоге', !r.data.series.some((s) => s.id === SID));

// дальше: 1 → 2 → (сезон 2) 1 → нет
r = await call(`/api/film/episode/${e1.data.movie.id}/next`, {}, A.tok);
t('следующая после 1 — серия 2', r.data.next?.id === e2.data.movie.id);
r = await call(`/api/film/episode/${e2.data.movie.id}/next`, {}, A.tok);
t('следующая после последней серии сезона — первая серия сезона 2', r.data.next?.id === e3.data.movie.id);
r = await call(`/api/film/episode/${e3.data.movie.id}/next`, {}, A.tok);
t('после последней серии — null', r.data.next === null);

// прогресс и «продолжить»
await call('/api/film/progress', { method: 'POST', body: JSON.stringify({ movieId: e1.data.movie.id, position: 300, duration: 1000 }) }, A.tok);
r = await call(`/api/film/series/${SID}`, {}, A.tok);
t('продолжить с места той же серии', r.data.resume?.episodeId === e1.data.movie.id && r.data.resume.position === 300, JSON.stringify(r.data.resume));
await call('/api/film/progress', { method: 'POST', body: JSON.stringify({ movieId: e1.data.movie.id, position: 990, duration: 1000 }) }, A.tok);
r = await call(`/api/film/series/${SID}`, {}, A.tok);
t('серия досмотрена → предлагается следующая', r.data.resume?.episodeId === e2.data.movie.id && r.data.resume.next === true, JSON.stringify(r.data.resume));

// правка серии
r = await call(`/api/film/episode/${e2.data.movie.id}`, { method: 'PATCH', body: JSON.stringify({ epNo: 1 }) }, A.tok);
t('номер уже занят — 409', r.status === 409);
r = await call(`/api/film/episode/${e2.data.movie.id}`, { method: 'PATCH', body: JSON.stringify({ introStart: 50, introEnd: 10 }) }, A.tok);
t('заставка с концом раньше начала — 400', r.status === 400);
r = await call(`/api/film/episode/${e2.data.movie.id}`, { method: 'PATCH', body: JSON.stringify({ seasonId: S2, epNo: 2 }) }, V.tok);
t('чужую серию не правят', r.status === 403);

// субтитры
const srt = '1\n00:00:01,000 --> 00:00:03,000\nПривет\n';
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles/ru`, { method: 'PUT', body: JSON.stringify({ content: srt }) }, A.tok);
t('субтитры SRT принимаются', r.status === 200, JSON.stringify(r.data));
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles/ru`, {}, A.tok);
t('SRT превращён в WebVTT с точкой в метках', r.status === 200 && r.text.startsWith('WEBVTT') && r.text.includes('00:00:01.000 --> 00:00:03.000'), r.text.slice(0, 80));
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles`, {}, A.tok);
t('список дорожек', r.data.subtitles?.length === 1 && r.data.subtitles[0].lang === 'ru');
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles/xx`, { method: 'PUT', body: JSON.stringify({ content: srt }) }, A.tok);
t('неизвестный язык — 400', r.status === 400);
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles/en`, { method: 'PUT', body: JSON.stringify({ content: 'просто текст' }) }, A.tok);
t('не субтитры — 400', r.status === 400);
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles/en`, { method: 'PUT', body: JSON.stringify({ content: srt }) }, V.tok);
t('чужому нельзя добавить дорожку', r.status === 403 || r.status === 404, r.status);
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles/ru`, {}, V.tok);
t('чужую закрытую дорожку не отдают', r.status === 404);

// публикация
r = await call(`/api/film/series/${SID}/submit`, { method: 'POST', body: JSON.stringify({ license: 'open' }) }, A.tok);
t('отправка на проверку', r.status === 200 && r.data.sent === 3, JSON.stringify(r.data));
r = await call(`/api/film/series/${SID}/submit`, { method: 'POST', body: '{}' }, A.tok);
t('повтор — 409', r.status === 409);
r = await call('/api/film/series', {}, V.tok);
t('до проверки сериала в каталоге нет', !r.data.series.some((s) => s.id === SID));
r = await call(`/api/film/series/${SID}/moderate`, { method: 'POST', body: JSON.stringify({ approve: true }) }, V.tok);
t('обычный зритель не модерирует', r.status === 403, r.status);
r = await call('/api/film/series-moderation', {}, M.tok);
t('очередь сериалов у модератора', r.data.series?.some((s) => s.id === SID), JSON.stringify(r.data).slice(0, 120));
r = await call(`/api/film/series/${SID}/moderate`, { method: 'POST', body: JSON.stringify({ approve: true }) }, M.tok);
t('одобрение сериала', r.status === 200 && r.data.status === 'published', JSON.stringify(r.data));
r = await call('/api/film/series', {}, V.tok);
t('сериал в каталоге и счётчики верны', r.data.series.find((s) => s.id === SID)?.episodes === 3, JSON.stringify(r.data.series.map((s) => [s.id === SID, s.episodes])));
r = await call(`/api/film/series/${SID}`, {}, V.tok);
t('зритель видит серии', r.status === 200 && r.data.seasons[0].episodes.length === 2);
r = await call(`/api/film/movie/${e1.data.movie.id}/subtitles/ru`, {}, V.tok);
t('опубликованная дорожка доступна зрителю', r.status === 200);
r = await call('/api/film/catalog', {}, V.tok);
t('серии всё равно не в каталоге фильмов', !r.data.movies.some((m) => m.seriesId));

// удаление
r = await call(`/api/film/series/${SID}`, { method: 'DELETE' }, V.tok);
t('зритель не удаляет чужой сериал', r.status === 403 || r.status === 404, r.status);
r = await call(`/api/film/series/${SID}`, { method: 'DELETE' }, A.tok);
t('владелец удаляет сериал', r.status === 200);
t('серии, сезоны и дорожки ушли каскадом', q(`select (select count(*) from film_movies where series_id='${SID}')||'/'||(select count(*) from film_seasons where series_id='${SID}')||'/'||(select count(*) from film_subtitles where movie_id='${e1.data.movie.id}')`) === '0/0/0');
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
