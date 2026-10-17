// Метки контента: Explicit (автор/модератор), «Старая версия» (только модератор, с причиной), источник, фильтр, журнал.
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const prime = (u) => { q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-lb-${u.pid}','${u.pid}','active','standard', now() + interval '30 days') on conflict do nothing`); q(`update profiles set is_prime=true where id='${u.pid}'`); };

const A = await mkuser(S, 'lbAuthor'); const V = await mkuser(S, 'lbViewer'); const M = await mkuser(S, 'lbMod');
q(`update profiles set is_admin=true, admin_role='content_admin' where id='${M.pid}'`);
prime(A); prime(V); prime(M);
const P = Date.now().toString(36);
const add = (id, title, explicit, status = 'published') => q(`insert into music_tracks (id, owner_id, title, artist, genre, status, mime, bytes, duration_sec, explicit, license_source) values ('${id}','${A.pid}','${title}','Art${P}','pop','${status}','audio/mpeg',1000,100,${explicit},'исходник')`);
add(`trk-lb-${P}1`, `Чистый${P}`, false); add(`trk-lb-${P}2`, `Грубый${P}`, true); add(`trk-lb-${P}3`, `Личный${P}`, false, 'private');

let r = await call(`/api/music/tracks?q=${P}`, {}, V.tok);
const byTitle = (rows, t0) => rows.find((x) => x.title.startsWith(t0));
t('в списке трека есть итоговый explicit', byTitle(r.data.tracks, 'Грубый')?.explicit === true && !byTitle(r.data.tracks, 'Чистый')?.explicit, JSON.stringify(r.data.tracks.map((x) => [x.title, x.explicit])));
r = await call(`/api/music/tracks?q=${P}&hideExplicit=1`, {}, V.tok);
t('фильтр «скрыть Explicit» убирает E-треки', !byTitle(r.data.tracks, 'Грубый') && !!byTitle(r.data.tracks, 'Чистый'));

r = await call(`/api/labels/track/trk-lb-${P}1`, {}, V.tok);
t('карточка: источник и лицензия', r.status === 200 && r.data.source.addedBy && r.data.source.source === 'исходник' && r.data.source.author === `Art${P}` && r.data.explicit === false, JSON.stringify(r.data));
r = await call(`/api/labels/track/trk-lb-${P}3`, {}, V.tok);
t('чужой личный трек метки не отдаёт', r.status === 404);

// автор: свои отметки
r = await call(`/api/labels/track/trk-lb-${P}1`, { method: 'PUT', body: JSON.stringify({ explicit: true, sourceNote: 'Студийная запись 2019', rightsholder: 'ООО «Лейбл»' }) }, A.tok);
t('автор ставит Explicit, источник, правообладателя', r.status === 200, JSON.stringify(r.data));
r = await call(`/api/labels/track/trk-lb-${P}1`, {}, V.tok);
t('изменения видны зрителю', r.data.explicit === true && r.data.explicitBy === 'author' && r.data.source.source === 'Студийная запись 2019' && r.data.source.rightsholder === 'ООО «Лейбл»', JSON.stringify(r.data));
r = await call(`/api/labels/track/trk-lb-${P}1`, { method: 'PUT', body: JSON.stringify({ explicit: false }) }, V.tok);
t('чужой трек автор-метки не правит', r.status === 403);
r = await call(`/api/labels/track/trk-lb-${P}1`, { method: 'PUT', body: JSON.stringify({ legacy: true }) }, A.tok);
t('«Старая версия» автору не доступна (поле игнорируется)', (await call(`/api/labels/track/trk-lb-${P}1`, {}, V.tok)).data.legacy === false);

// модератор
r = await call(`/api/labels/track/trk-lb-${P}1/moderate`, { method: 'PUT', body: JSON.stringify({ explicit: false }) }, M.tok);
t('модератор без причины — 400', r.status === 400 && r.data.error === 'reason_required');
r = await call(`/api/labels/track/trk-lb-${P}1/moderate`, { method: 'PUT', body: JSON.stringify({ explicit: false, reason: 'Проверено: лексики нет' }) }, A.tok);
t('автор не модерирует', r.status === 403);
r = await call(`/api/labels/track/trk-lb-${P}1/moderate`, { method: 'PUT', body: JSON.stringify({ explicit: false, reason: 'Проверено: лексики нет' }) }, M.tok);
t('модератор снимает E с причиной', r.status === 200 && r.data.labels.explicit === false && r.data.labels.explicitBy === 'moderator', JSON.stringify(r.data));
r = await call(`/api/labels/track/trk-lb-${P}1`, { method: 'PUT', body: JSON.stringify({ explicit: true }) }, A.tok);
t('решение модератора перекрывает отметку автора', (await call(`/api/labels/track/trk-lb-${P}1`, {}, V.tok)).data.explicit === false);
r = await call(`/api/labels/track/trk-lb-${P}2/moderate`, { method: 'PUT', body: JSON.stringify({ legacy: true, reason: 'Подтверждено: издание до 2012 г.' }) }, M.tok);
t('модератор ставит «Старая версия»', r.status === 200 && r.data.labels.legacy === true && /цензуре/.test(r.data.labels.legacyText), JSON.stringify(r.data));
r = await call(`/api/music/tracks?q=${P}`, {}, V.tok);
t('в списке трека есть legacy', byTitle(r.data.tracks, 'Грубый')?.legacy === true && !byTitle(r.data.tracks, 'Чистый')?.legacy);
r = await call(`/api/labels/batch?kind=track&ids=trk-lb-${P}1,trk-lb-${P}2,trk-lb-${P}3`, {}, V.tok);
t('пакет для списков: видимое есть, чужое личное — нет', r.data.labels[`trk-lb-${P}2`]?.explicit === true && r.data.labels[`trk-lb-${P}2`]?.legacy === true && !(`trk-lb-${P}3` in r.data.labels), JSON.stringify(r.data));
r = await call(`/api/labels/track/trk-lb-${P}2`, {}, M.tok);
t('модератору виден журнал изменений с причиной', r.data.history?.some((h) => h.by === 'moderator' && /2012/.test(h.reason ?? '')), JSON.stringify(r.data.history));
r = await call(`/api/labels/track/trk-lb-${P}2`, {}, V.tok);
t('зрителю журнал не отдаётся', !r.data.history);
t('в журнале администрации есть запись', Number(q(`select count(*) from admin_log where type='content_label'`)) >= 2);

// настройки текста
r = await call('/api/labels/settings', { method: 'PUT', body: JSON.stringify({ legacyEnabled: false }) }, V.tok);
t('текст меток обычному человеку не правится', r.status === 403);
r = await call('/api/labels/settings', { method: 'PUT', body: JSON.stringify({ legacyEnabled: false }) }, M.tok);
r = await call(`/api/labels/track/trk-lb-${P}2`, {}, V.tok);
t('метку «Старая версия» можно выключить глобально', r.data.legacy === false);
await call('/api/labels/settings', { method: 'PUT', body: JSON.stringify({ legacyEnabled: true }) }, M.tok);
r = await call('/api/labels/settings', { method: 'PUT', body: JSON.stringify({ legacyText: 'Версия до изменения правил' }) }, M.tok);
t('текст метки настраивается', r.status === 200 && r.data.settings.legacyText === 'Версия до изменения правил');
await call('/api/labels/settings', { method: 'PUT', body: JSON.stringify({ legacyText: 'Старая версия — до вступления в силу законодательства о цензуре' }) }, M.tok);

// кино
q(`insert into film_movies (id, owner_id, title, mime, bytes, status, explicit) values ('mov-00000000-0000-0000-0000-${P.padEnd(12,'0').slice(0,12)}','${A.pid}','Фильм${P}','video/mp4',100,'published',true)`);
const mid = `mov-00000000-0000-0000-0000-${P.padEnd(12,'0').slice(0,12)}`;
r = await call(`/api/film/catalog?hideExplicit=1`, {}, V.tok);
t('кино: фильтр «скрыть Explicit»', !r.data.movies.some((m) => m.id === mid));
r = await call(`/api/film/catalog`, {}, V.tok);
t('кино: итоговый explicit в карточке', r.data.movies.find((m) => m.id === mid)?.explicit === true);
r = await call(`/api/labels/movie/${mid}/moderate`, { method: 'PUT', body: JSON.stringify({ legacy: true, reason: 'Подтверждено издателем' }) }, M.tok);
t('кино: «Старая версия» ставит модератор', r.status === 200 && r.data.labels.legacy === true);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
