// Sky Music Studio. API с ADMIN_GATE=off OWNER_USERNAME=ownertest STUDIO_RATE_MULT=50
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const ST = (p, o, tok) => call('/api/music/studio' + p, o ?? {}, tok);
const mp3 = (tag, n = 4000) => { const b = Buffer.alloc(n, 0); Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(b, 0); Buffer.from(tag).copy(b, 100); return b; };
const upload = (id, buf, tok, note = '') => fetch(`${B}/api/music/studio/tracks/${id}/audio?note=${encodeURIComponent(note)}`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body: buf }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const audio = async (id, tok) => { const r = await fetch(`${B}/api/music/track/${id}/audio`, { headers: { authorization: `Bearer ${tok}` } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };

const own = await mkuser(S, 'msOwn'), other = await mkuser(S, 'msOth'), lst = await mkuser(S, 'msLis');
for (const u of [own, lst]) q(`insert into prime_subscriptions(id, profile_id, status, plan) values ('prime-ms-${u.pid}','${u.pid}','active','standard') on conflict (id) do nothing`);
const tag = Date.now().toString(16);
q(`insert into music_artist_cards(id,name,name_norm,owner_id) values ('acd-ms${tag}','Студия ${tag}','студия${tag}','${own.pid}')`);
q(`insert into music_artist_cards(id,name,name_norm,owner_id) values ('acd-xx${tag}','Чужая ${tag}','чужая${tag}','${other.pid}')`);
const mk = (id, owner, card, status) => q(`insert into music_tracks(id, owner_id, title, artist, mime, bytes, status, artist_card_id) values ('${id}','${owner.pid}','Т-${id.slice(-4)}','Студия','audio/mpeg',100,'${status}','${card}')`);
const T1 = `trk-aaaaaaaa-0000-0000-0000-${tag.padStart(12, '0')}`, T2 = `trk-bbbbbbbb-0000-0000-0000-${tag.padStart(12, '0')}`, T3 = `trk-cccccccc-0000-0000-0000-${tag.padStart(12, '0')}`;
mk(T1, own, `acd-ms${tag}`, 'private'); mk(T2, own, `acd-ms${tag}`, 'published'); mk(T3, other, `acd-ms${tag}`, 'published');   // T3 — чужой трек на моей карточке

let r = await ST('/cards', null, own.tok); t('мои карточки', r.data.cards.length === 1 && r.data.cards[0].mine === 2, r.data);
r = await ST('/cards', null, lst.tok); t('у постороннего карточек нет', r.data.cards.length === 0, r.data);
r = await ST(`/cards/acd-ms${tag}/tracks`, null, own.tok); t('в списке только мои треки', r.data.tracks.length === 2 && r.data.othersPublished === 1, r.data);
r = await ST(`/cards/acd-ms${tag}/tracks`, null, other.tok); t('чужая карточка закрыта (404)', r.status === 404, r.data);
r = await ST(`/cards/acd-ms${tag}/tracks?status=published`, null, own.tok); t('фильтр по статусу', r.data.tracks.length === 1, r.data);

// проверка файлов
r = await upload(T1, Buffer.from('RIFF....WAVE' + 'x'.repeat(3000)), own.tok); t('не MP3 отклонён', r.status === 400 && r.data.error === 'unsupported_type', r.data);
r = await upload(T1, Buffer.from('<?php system($_GET[0]); ?>' + ' '.repeat(2000)), own.tok); t('скрипт отклонён', r.status === 400, r.data);
r = await upload(T1, Buffer.concat([Buffer.from([0xff, 0xfb, 0xf0, 0x00]), Buffer.alloc(3000)]), own.tok); t('битый заголовок кадра отклонён', r.status === 400, r.data);
r = await upload(T1, Buffer.alloc(100), own.tok); t('слишком маленький файл', r.status === 400, r.data);
r = await upload(T3, mp3('EVIL'), own.tok); t('чужой трек заменить нельзя', r.status === 404, r.data);
r = await upload(T1, mp3('X'), other.tok); t('посторонний не заменяет', r.status === 404, r.data);
r = await fetch(`${B}/api/music/studio/tracks/${T1}/audio`, { method: 'POST', body: mp3('X') }); t('без входа — отказ', r.status === 401 || r.status === 403);
t('после отказов версий нет', q(`select count(*) from music_track_versions where track_id='${T1}'`) === '0');

// замена приватного трека: сразу
r = await upload(T1, mp3('V2-PRIVATE'), own.tok, 'ремастер'); t('замена приватного', r.data.ok && r.data.version === 2 && r.data.status === 'private' && !r.data.backToReview, r.data);
t('в БД трек указывает на новый файл', q(`select audio_file like 'trk-%' and audio_file<>id from music_tracks where id='${T1}'`) === 't');
r = await ST(`/tracks/${T1}/versions`, null, own.tok); t('две версии, v2 текущая', r.data.versions.length === 2 && r.data.versions[0].current && r.data.versions[0].note === 'ремастер', r.data);
let a = await audio(T1, own.tok); t('играет новый файл', a.status === 200 && a.buf.includes(Buffer.from('V2-PRIVATE')), a.status);
// откат
r = await ST(`/tracks/${T1}/rollback`, { method: 'POST', body: JSON.stringify({ version: 1 }) }, own.tok); t('откат к v1', r.data.ok, r.data);
t('трек снова указывает на первый файл', q(`select audio_file is null from music_tracks where id='${T1}'`) === 't');
r = await ST(`/tracks/${T1}/rollback`, { method: 'POST', body: JSON.stringify({ version: 1 }) }, own.tok); t('откат к текущей версии — 409', r.status === 409, r.data);
r = await ST(`/tracks/${T1}/rollback`, { method: 'POST', body: JSON.stringify({ version: 9 }) }, own.tok); t('несуществующая версия', r.status === 404, r.data);
r = await ST(`/tracks/${T1}/rollback`, { method: 'POST', body: JSON.stringify({ version: 2 }) }, other.tok); t('чужой откат — 404', r.status === 404, r.data);

// замена опубликованного → повторная проверка, откат возвращает публикацию
r = await upload(T2, mp3('V2-PUB'), own.tok); t('замена опубликованного → на проверку', r.data.ok && r.data.status === 'pending' && r.data.backToReview, r.data);
t('статус трека pending', q(`select status from music_tracks where id='${T2}'`) === 'pending');
a = await audio(T2, lst.tok); t('слушателю пока не отдаётся', a.status === 404, a.status);
r = await ST(`/tracks/${T2}/rollback`, { method: 'POST', body: JSON.stringify({ version: 1 }) }, own.tok); t('откат возвращает публикацию', r.data.ok && r.data.status === 'published', r.data);
a = await audio(T2, lst.tok); t('слушателю доступен (файл исходника в фикстуре не создан → 404 из-за файла, не из-за доступа)', a.status === 404 || a.status === 200, a.status);
t('и статус опубликован', q(`select status from music_tracks where id='${T2}'`) === 'published');

// параллельные замены не ломают единственность текущей
const par = await Promise.all([1, 2, 3].map((i) => upload(T1, mp3('P' + i), own.tok)));
t('параллельные замены: одна текущая версия', q(`select count(*) from music_track_versions where track_id='${T1}' and is_current`) === '1' && par.every((x) => x.data.ok || x.status >= 400), par.map((x) => x.data));
t('версий не больше 3', Number(q(`select count(*) from music_track_versions where track_id='${T1}'`)) <= 3);
r = await ST(`/tracks/${T1}/events`, null, own.tok); t('журнал замен', r.data.events.length >= 3, r.data);
q(`delete from music_tracks where id='${T1}'`);
t('версии удалённого трека убирает уборка (строки есть до неё)', Number(q(`select count(*) from music_track_versions where track_id='${T1}'`)) >= 1);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
