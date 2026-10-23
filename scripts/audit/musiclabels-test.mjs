// Лейблы, альбомы, подтверждение прав правообладателя; владелец сервиса управляет всем; публикация владельца без проверки.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const prime = (u) => q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-ml-${u.pid}','${u.pid}','active','standard', now() + interval '30 day') on conflict do nothing`);
const J = (o) => JSON.stringify(o);
q("update profiles set username = username || 'old' || floor(random()*100000)::text where lower(username)='ownertest'");
const A = await mkuser(S, 'mlA'); const B = await mkuser(S, 'mlB'); const M = await mkuser(S, 'mlMod'); const O = await mkuser(S, 'mlOwner');
q(`update profiles set is_admin=true, admin_role='content_admin' where id='${M.pid}'`);
q(`update profiles set username='ownertest' where id='${O.pid}'`);
[A, B, M].forEach(prime);
const P = Date.now().toString(36).replace(/\d/g, 'x');

let r = await call('/api/music/labels', { method: 'POST', body: J({ name: `Лейбл ${P}`, description: 'о нас' }) }, A.tok);
t('создание лейбла', r.status === 200 && r.data.id?.startsWith('lbl-'), J(r.data)); const L1 = r.data.id;
r = await call('/api/music/labels', { method: 'POST', body: J({ name: `ЛЕЙБЛ ${P}` }) }, B.tok);
t('дубль имени — 409', r.status === 409);
r = await call(`/api/music/labels/${L1}`, { method: 'PATCH', body: J({ description: 'взлом' }) }, B.tok);
t('чужой лейбл не правится', r.status === 403);
r = await call(`/api/music/labels/${L1}`, { method: 'PATCH', body: J({ description: 'новое' }) }, A.tok);
t('владелец правит лейбл', r.status === 200);

// карточка и треки
const C1 = `acd-${crypto.randomUUID()}`; const T1 = `trk-${crypto.randomUUID()}`; const T2 = `trk-${crypto.randomUUID()}`;
q(`insert into music_artist_cards (id,name,name_norm,created_by,owner_id) values ('${C1}','Арт${P}','арт${P}','${A.pid}','${A.pid}')`);
for (const [id, o] of [[T1, A.pid], [T2, B.pid]]) q(`insert into music_tracks (id,owner_id,title,artist,genre,status,mime,bytes,duration_sec) values ('${id}','${o}','Песня','Арт','Pop','private','audio/mpeg',1000,100)`);
r = await call('/api/music/albums', { method: 'POST', body: J({ title: 'Альбом 1', year: 2024, cardId: C1, labelId: L1 }) }, A.tok);
t('альбом на своей карточке и лейбле', r.status === 200 && r.data.id?.startsWith('alb-'), J(r.data)); const AL = r.data.id;
r = await call('/api/music/albums', { method: 'POST', body: J({ title: 'Чужой', cardId: C1 }) }, B.tok);
t('на чужую карточку альбом не создаётся', r.status === 403 && r.data.error === 'card_not_yours');
r = await call('/api/music/albums', { method: 'POST', body: J({ title: 'Плохой год', year: 1500 }) }, A.tok);
t('год вне диапазона', r.status === 400);
r = await call(`/api/music/albums/${AL}/tracks`, { method: 'POST', body: J({ trackIds: [T1, T2] }) }, A.tok);
t('в альбом попадает только свой трек', r.status === 200 && r.data.changed === 1, J(r.data));
t('у трека название альбома', q(`select album from music_tracks where id='${T1}'`) === 'Альбом 1');
r = await call(`/api/music/albums/${AL}`, { method: 'PATCH', body: J({ title: 'Альбом 1 (deluxe)' }) }, B.tok);
t('чужой альбом не правится', r.status === 403);
r = await call(`/api/music/albums/${AL}`, { method: 'PATCH', body: J({ title: 'Альбом 1 (deluxe)' }) }, O.tok);
t('владелец сервиса правит любой альбом', r.status === 200);
t('название альбома обновилось у треков', q(`select album from music_tracks where id='${T1}'`) === 'Альбом 1 (deluxe)');
r = await call(`/api/music/albums/${AL}`, {}, A.tok);
t('чтение альбома: треки и права', r.status === 200 && r.data.tracks.length === 1 && r.data.canEdit === true);
r = await call(`/api/music/labels/${L1}`, { method: 'PATCH', body: J({ name: `Лейбл ${P} 2` }) }, O.tok);
t('владелец сервиса правит любой лейбл', r.status === 200);

// владелец сервиса правит любую карточку
r = await call(`/api/music/artist-cards/${C1}`, { method: 'PATCH', body: J({ bio: 'правка владельца' }) }, O.tok);
t('владелец сервиса правит любую карточку', r.status === 200, J(r.data));
r = await call(`/api/music/artist-cards/${C1}`, { method: 'PATCH', body: J({ bio: 'взлом' }) }, B.tok);
t('посторонний карточку не правит', r.status === 403);

// права правообладателя
r = await call('/api/music/rights', { method: 'POST', body: J({ kind: 'card', subjectId: C1, holder: 'ООО Ромашка', note: 'договор с исполнителем', links: ['https://example.com/doc'] }) }, B.tok);
t('заявку подаёт только управляющий объектом', r.status === 403);
r = await call('/api/music/rights', { method: 'POST', body: J({ kind: 'card', subjectId: C1, holder: 'ООО Ромашка', note: 'кор', links: [] }) }, A.tok);
t('короткое пояснение отклоняется', r.status === 400 && r.data.error === 'note_required');
r = await call('/api/music/rights', { method: 'POST', body: J({ kind: 'card', subjectId: C1, holder: 'ООО Ромашка', note: 'договор с исполнителем от 2024', links: ['https://example.com/doc', 'http://bad'] }) }, A.tok);
t('заявка на подтверждение прав', r.status === 200 && r.data.id?.startsWith('rcl-'), J(r.data)); const R1 = r.data.id;
r = await call('/api/music/rights', { method: 'POST', body: J({ kind: 'card', subjectId: C1, holder: 'ООО Ромашка', note: 'договор с исполнителем от 2024' }) }, A.tok);
t('вторая открытая заявка — 409', r.status === 409);
r = await call('/api/admin/music-rights', {}, B.tok);
t('очередь прав закрыта для обычного человека', r.status === 403);
r = await call('/api/admin/music-rights', {}, M.tok);
t('очередь видна сотруднику', r.status === 200 && r.data.items.some((x) => x.id === R1 && x.links.length === 1 && x.note.includes('договор')), J(r.data).slice(0, 200));
r = await call(`/api/admin/music-rights/${R1}/decide`, { method: 'POST', body: J({ approve: false }) }, M.tok);
t('отказ без причины — 400', r.status === 400);
r = await call(`/api/admin/music-rights/${R1}/decide`, { method: 'POST', body: J({ approve: true }) }, M.tok);
t('подтверждение прав', r.status === 200);
r = await call(`/api/music/artist-cards/${C1}`, {}, A.tok);
t('карточка помечена подтверждённой', r.data.card?.rightsVerified === true && r.data.card?.rightsHolder === 'ООО Ромашка', J(r.data).slice(0, 200));
r = await call(`/api/admin/music-rights/${R1}/decide`, { method: 'POST', body: J({ approve: true }) }, M.tok);
t('повторное решение — 409', r.status === 409);
r = await call('/api/admin/music-rights/revoke', { method: 'POST', body: J({ kind: 'card', subjectId: C1, reason: 'коротко' }) }, M.tok);
t('снятие подтверждения', r.status === 200);
t('отметка снята', q(`select rights_verified_at is null from music_artist_cards where id='${C1}'`) === 't');
// админ-обзор
r = await call('/api/admin/music-labels', {}, O.tok);
t('владелец видит все лейблы и альбомы', r.status === 200 && r.data.labels.some((x) => x.id === L1) && r.data.albums.some((x) => x.id === AL), r.status + JSON.stringify(r.data).slice(0, 300));
r = await call('/api/admin/music-labels', {}, B.tok);
t('обзор закрыт для обычного человека', r.status === 403);

// фото и баннер карточки
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await call(`/api/music/artist-cards/${C1}/image/photo`, { method: 'PUT', body: J({ dataUrl: PNG }) }, A.tok);
t('владелец карточки грузит фото', r.status === 200, J(r.data));
r = await call(`/api/music/artist-cards/${C1}/image/banner`, { method: 'PUT', body: J({ dataUrl: PNG }) }, O.tok);
t('владелец сервиса грузит баннер любой карточки', r.status === 200);
r = await call(`/api/music/artist-cards/${C1}/image/photo`, { method: 'PUT', body: J({ dataUrl: PNG }) }, B.tok);
t('посторонний картинку не грузит', r.status === 403);
r = await call(`/api/music/artist-cards/${C1}/image/photo`, { method: 'PUT', body: J({ dataUrl: 'data:image/png;base64,AAAA' }) }, A.tok);
t('не картинка (сигнатура) отклоняется', r.status === 400 && r.data.error === 'bad_image');
r = await call(`/api/music/artist-cards/${C1}/image/photo`, { method: 'PUT', body: J({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }) }, A.tok);
t('SVG запрещён', r.status === 400);
r = await call(`/api/music/artist-cards/${C1}`, {}, B.tok);
t('в карточке флаги картинок', r.data.card?.hasPhoto === true && r.data.card?.hasBanner === true, J(r.data).slice(0, 200));
r = await call(`/api/music/artist-cards/${C1}/image/banner`, {}, B.tok);
t('картинку видят вошедшие', r.status === 200);
r = await call(`/api/music/artist-cards/${C1}/image/banner`, { method: 'DELETE' }, B.tok);
t('посторонний не удаляет', r.status === 403);
r = await call(`/api/music/artist-cards/${C1}/image/banner`, { method: 'DELETE' }, O.tok);
t('владелец сервиса удаляет баннер', r.status === 200);
r = await call(`/api/music/artist-cards/${C1}`, {}, A.tok);
t('флаг баннера снят', r.data.card?.hasBanner === false && r.data.card?.hasPhoto === true);

// публикация владельца без проверки
q(`update music_tracks set owner_id='${O.pid}' where id='${T2}'`);
r = await call(`/api/music/track/${T2}/submit`, { method: 'POST', body: '{}' }, O.tok);
t('владелец сервиса: трек сразу опубликован', r.status === 200 && q(`select status from music_tracks where id='${T2}'`) === 'published', J(r.data).slice(0, 200));
r = await call(`/api/music/track/${T1}/submit`, { method: 'POST', body: '{}' }, A.tok);
t('обычный автор: трек на проверку', r.status === 200 && q(`select status from music_tracks where id='${T1}'`) === 'pending');

// удаление
r = await call(`/api/music/albums/${AL}`, { method: 'DELETE' }, A.tok);
t('удаление альбома отвязывает треки', r.status === 200 && q(`select album_id is null from music_tracks where id='${T1}'`) === 't');
r = await call(`/api/music/labels/${L1}`, { method: 'DELETE' }, A.tok);
t('удаление лейбла', r.status === 200);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
