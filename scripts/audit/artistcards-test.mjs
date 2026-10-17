// Карточки музыканта: предложение, создание, автопривязка при публикации, заявка на владение, объединение дублей с откатом.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const prime = (u) => { q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-ac-${u.pid}','${u.pid}','active','standard', now() + interval '30 days') on conflict do nothing`); q(`update profiles set is_prime=true where id='${u.pid}'`); };

const A = await mkuser(S, 'acAuthor'); const B = await mkuser(S, 'acOther'); const M = await mkuser(S, 'acMod');
q(`update profiles set is_admin=true, admin_role='content_admin' where id='${M.pid}'`);
prime(A); prime(B); prime(M);
const P = Date.now().toString(36);
const ru = `Земфира${P}`.replace(/\d/g, ''); // кириллица + буквы суффикса
const en = `Zemfira${P}`.replace(/\d/g, '');
const track = (id, owner, artist, status = 'private') => q(`insert into music_tracks (id, owner_id, title, artist, genre, status, mime, bytes, duration_sec) values ('${id}','${owner}','Песня ${id}','${artist}','pop','${status}','audio/mpeg',1000,100)`);
const T1 = `trk-${crypto.randomUUID()}`; const T2 = `trk-${crypto.randomUUID()}`;
track(T1, A.pid, ru); track(T2, B.pid, en);

let r = await call(`/api/music/artist-cards/suggest?name=${encodeURIComponent(ru)}`, {}, A.tok);
t('нет карточки: предлагается создать', r.status === 200 && r.data.exact === null && r.data.canCreate === true, JSON.stringify(r.data));
r = await call('/api/music/artist-cards', { method: 'POST', body: JSON.stringify({ name: `Чужой${P}Исп` }) }, A.tok);
t('нельзя создать карточку для имени без своего трека', r.status === 403 && r.data.error === 'no_own_track', JSON.stringify(r.data));
r = await call('/api/music/artist-cards', { method: 'POST', body: JSON.stringify({ name: ru, bio: 'О себе', genres: ['pop'] }) }, A.tok);
t('создание по своему треку', r.status === 200 && r.data.id && r.data.linked === 1, JSON.stringify(r.data));
const C1 = r.data.id;
r = await call('/api/music/artist-cards', { method: 'POST', body: JSON.stringify({ name: ru.toUpperCase() }) }, A.tok);
t('дубль по имени (регистр) — 409', r.status === 409 && r.data.error === 'exists', JSON.stringify(r.data));
r = await call(`/api/music/artist-cards/suggest?name=${encodeURIComponent(ru)}`, {}, A.tok);
t('теперь «уже есть»', r.data.exact?.id === C1 && r.data.canCreate === false);
r = await call(`/api/music/artist-cards/suggest?name=${encodeURIComponent(en)}`, {}, B.tok);
t('транслит: «Zemfira…» предлагает похожую карточку «Земфира…»', r.data.exact === null && r.data.similar.some((x) => x.id === C1), JSON.stringify(r.data));

// создание не даёт владения
r = await call(`/api/music/artist-cards/${C1}`, { method: 'PATCH', body: JSON.stringify({ bio: 'взлом' }) }, A.tok);
t('создатель без подтверждения карточку не правит', r.status === 403);

// автопривязка при публикации
q(`update music_tracks set status='private', artist_card_id=NULL where id='${T2}'`);
r = await call(`/api/music/track/${T2}/submit`, { method: 'POST', body: '{}' }, B.tok);
const card2 = q(`select artist_card_id from music_tracks where id='${T2}'`);
t('отправка трека на публикацию создаёт/находит карточку автоматически', r.status === 200 && card2.startsWith('acd-') && card2 !== C1, `${r.status} ${card2}`);
t('карточка помечена как созданная автоматически', q(`select auto_created from music_artist_cards where id='${card2}'`) === 't');

// чтение
r = await call(`/api/music/artist-cards/${C1}`, {}, B.tok);
t('карточка читается, опубликованных треков пока нет', r.status === 200 && r.data.card.name === ru && r.data.card.trackList.length === 0, JSON.stringify(r.data).slice(0, 200));
r = await call(`/api/music/artist-cards?q=${encodeURIComponent(ru.slice(0, 6))}`, {}, B.tok);
t('поиск по каталогу карточек', r.data.cards.some((c) => c.id === C1));

// заявка на владение
r = await call(`/api/music/artist-cards/${C1}/claim`, { method: 'POST', body: JSON.stringify({ note: 'Это я, у меня есть доказательства', links: ['https://example.com/me', 'http://insecure.example'] }) }, B.tok);
t('чужой исполнитель: заявка без своего трека — отказ', r.status === 403 && r.data.error === 'no_own_track', JSON.stringify(r.data));
r = await call(`/api/music/artist-cards/${C1}/claim`, { method: 'POST', body: JSON.stringify({ note: 'коротко' }) }, A.tok);
t('заявка без пояснения — 400', r.status === 400 && r.data.error === 'note_required');
r = await call(`/api/music/artist-cards/${C1}/claim`, { method: 'POST', body: JSON.stringify({ note: 'Это моя карточка, треки загружал я', links: ['https://example.com/me', 'http://insecure.example'] }) }, A.tok);
t('заявка владельца треков', r.status === 200 && r.data.id, JSON.stringify(r.data));
const CL = r.data.id;
r = await call(`/api/music/artist-cards/${C1}/claim`, { method: 'POST', body: JSON.stringify({ note: 'Повторная заявка без нужды' }) }, A.tok);
t('вторая заявка — 409', r.status === 409 && r.data.error === 'already_pending');
r = await call('/api/admin/artist-cards/claims', {}, A.tok);
t('очередь заявок обычному человеку недоступна', r.status === 403);
r = await call('/api/admin/artist-cards/claims', {}, M.tok);
const item = r.data.items?.find((i) => i.id === CL);
t('сотрудник видит заявку, ссылки только https', !!item && item.links.join() === 'https://example.com/me' && item.ownTracks === 1, JSON.stringify(item));
r = await call(`/api/admin/artist-cards/claims/${CL}/decide`, { method: 'POST', body: JSON.stringify({ approve: false }) }, M.tok);
t('отказ без причины — 400', r.status === 400 && r.data.error === 'reason_required');
r = await call(`/api/admin/artist-cards/claims/${CL}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }, M.tok);
t('одобрение', r.status === 200);
r = await call(`/api/music/artist-cards/${C1}`, {}, A.tok);
t('владелец подтверждён, видит isOwner', r.data.card.isOwner === true && r.data.card.confirmedOwner === true);
r = await call(`/api/music/artist-cards/${C1}`, { method: 'PATCH', body: JSON.stringify({ bio: 'Новое описание', genres: ['rock', 'pop'] }) }, A.tok);
t('подтверждённый владелец правит карточку', r.status === 200 && (await call(`/api/music/artist-cards/${C1}`, {}, B.tok)).data.card.bio === 'Новое описание');
r = await call(`/api/music/artist-cards/${C1}`, { method: 'PATCH', body: JSON.stringify({ bio: 'чужое' }) }, B.tok);
t('чужой карточку не правит', r.status === 403);
r = await call(`/api/music/artist-cards/${C1}/claim`, { method: 'POST', body: JSON.stringify({ note: 'Тоже хочу быть владельцем карточки' }) }, B.tok);
t('карточка с владельцем: чужая заявка отклоняется', r.status === 403 || r.status === 409, JSON.stringify(r.data));

// дубли и объединение
r = await call('/api/admin/artist-cards/duplicates', {}, M.tok);
const pair = r.data.pairs?.find((p) => [p.a.id, p.b.id].includes(C1) && [p.a.id, p.b.id].includes(card2));
t('Земфира/Zemfira найдены как дубли', !!pair && pair.sameAfterTranslit === true, JSON.stringify(r.data.pairs?.slice(0, 2)));
r = await call('/api/admin/artist-cards/merge', { method: 'POST', body: JSON.stringify({ from: card2, into: C1 }) }, M.tok);
t('объединение без причины — 400', r.status === 400);
r = await call('/api/admin/artist-cards/merge', { method: 'POST', body: JSON.stringify({ from: card2, into: C1, reason: 'Один и тот же исполнитель' }) }, A.tok);
t('объединение обычному человеку недоступно', r.status === 403);
r = await call('/api/admin/artist-cards/merge', { method: 'POST', body: JSON.stringify({ from: card2, into: card2, reason: 'сам в себя' }) }, M.tok);
t('нельзя объединить карточку саму с собой', r.status === 400 && r.data.error === 'same_card');
r = await call('/api/admin/artist-cards/merge', { method: 'POST', body: JSON.stringify({ from: card2, into: C1, reason: 'Один и тот же исполнитель' }) }, M.tok);
t('объединение', r.status === 200 && r.data.moved === 1, JSON.stringify(r.data));
t('трек перенесён на целевую карточку', q(`select artist_card_id from music_tracks where id='${T2}'`) === C1);
r = await call(`/api/music/artist-cards/${card2}`, {}, B.tok);
t('старая ссылка ведёт на объединённую карточку', r.status === 200 && r.data.card.id === C1 && r.data.card.redirectedFrom === card2);
t('старое имя стало псевдонимом для голосового поиска', Number(q(`select count(*) from music_artist_aliases where alias_norm = (select name_norm from music_artist_cards where id='${card2}')`)) === 1);
r = await call('/api/admin/artist-cards/merge', { method: 'POST', body: JSON.stringify({ from: card2, into: C1, reason: 'повторное объединение' }) }, M.tok);
t('повторное объединение — 409', r.status === 409 && r.data.error === 'already_merged');

// откат
r = await call(`/api/admin/artist-cards/${card2}/unmerge`, { method: 'POST', body: JSON.stringify({ reason: 'Это разные исполнители' }) }, M.tok);
t('откат объединения', r.status === 200, JSON.stringify(r.data));
t('трек вернулся на свою карточку', q(`select artist_card_id from music_tracks where id='${T2}'`) === card2);
t('псевдоним убран', Number(q(`select count(*) from music_artist_aliases where alias_norm = (select name_norm from music_artist_cards where id='${card2}')`)) === 0);

// снятие владельца
r = await call(`/api/admin/artist-cards/${C1}/revoke-owner`, { method: 'POST', body: JSON.stringify({}) }, M.tok);
t('снять владельца без причины — 400', r.status === 400);
r = await call(`/api/admin/artist-cards/${C1}/revoke-owner`, { method: 'POST', body: JSON.stringify({ reason: 'Спорная заявка' }) }, M.tok);
t('снятие владельца', r.status === 200);
r = await call(`/api/music/artist-cards/${C1}`, { method: 'PATCH', body: JSON.stringify({ bio: 'после снятия' }) }, A.tok);
t('после снятия владелец правок не делает', r.status === 403);
t('действия в журнале администрации', Number(q(`select count(*) from admin_log where type in ('artist_merge','artist_unmerge','artist_claim_approve','artist_owner_revoke')`)) >= 4);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
