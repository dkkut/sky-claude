// Фото исполнителя на прозрачном фоне («Мой поток»): загрузка, проверка прозрачности, видимость в каталоге треков.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const J = (o) => JSON.stringify(o);
const crc = (b) => { let c, x = ~0; for (const v of b) { c = (x ^ v) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; x = (x >>> 8) ^ c; } return ~x >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (ct) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = ct; const raw = Buffer.from(ct === 6 ? [0, 255, 0, 0, 128] : [0, 255, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
const url = (b) => 'data:image/png;base64,' + b.toString('base64');

const A = await mkuser(S, 'cuA'); const B = await mkuser(S, 'cuB');
const prime = (u) => q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-cu-${u.pid}','${u.pid}','active','standard', now() + interval '30 day') on conflict do nothing`);
[A, B].forEach(prime);
const P = Date.now().toString(36).replace(/\d/g, 'x');
const cid = 'acd-' + crypto.randomUUID();
q(`insert into music_artist_cards (id, name, name_norm, owner_id, created_by) values ('${cid}','Тест ${P}','тест ${P}','${A.pid}','${A.pid}')`);

let r = await call(`/api/music/artist-cards/${cid}/image/cutout`, { method: 'PUT', body: J({ dataUrl: url(png(2)) }) }, A.tok);
t('PNG без прозрачности отклоняется', r.status === 422 && r.data.error === 'no_transparency', J(r.data));
r = await call(`/api/music/artist-cards/${cid}/image/cutout`, { method: 'PUT', body: J({ dataUrl: url(png(6)) }) }, B.tok);
t('чужая карточка — нельзя', r.status === 403, J(r.data));
r = await call(`/api/music/artist-cards/${cid}/image/cutout`, { method: 'PUT', body: J({ dataUrl: url(png(6)) }) }, A.tok);
t('PNG с прозрачностью принимается', r.status === 200, J(r.data));
r = await call(`/api/music/artist-cards/${cid}/image/cutout`, { method: 'PUT', body: J({ dataUrl: 'data:image/png;base64,AAAA' }) }, A.tok);
t('мусор отклоняется', r.status === 400 || r.status === 403 || r.status === 422, String(r.status));
r = await call(`/api/music/artist-cards/${cid}/image/cutout`, {}, B.tok);
t('картинку видят вошедшие', r.status === 200);
r = await call(`/api/music/artist-cards/${cid}/image/zzz`, { method: 'PUT', body: J({ dataUrl: url(png(6)) }) }, A.tok);
t('неизвестный вид — не маршрут', r.status === 404 || r.status === 400, String(r.status));
const sample = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(4), Buffer.from([0x10, 0, 0, 0])]);
r = await call(`/api/music/artist-cards/${cid}/image/cutout`, { method: 'PUT', body: J({ dataUrl: 'data:image/webp;base64,' + sample.toString('base64') }) }, A.tok);
t('WebP VP8X с флагом прозрачности принимается', r.status === 200, J(r.data));

// каталог: у трека карточки с картинкой есть artistCardId, у остальных — нет
const tid = 'trk-' + crypto.randomUUID();
q(`insert into music_tracks (id, title, artist, mime, bytes, owner_id, status, artist_card_id) values ('${tid}','Т ${P}','Тест ${P}','audio/mpeg',1000,'${A.pid}','published','${cid}')`);
r = await call('/api/music/tracks?limit=200', {}, B.tok);
const tr = (r.data.tracks ?? []).find((x) => x.id === tid);
t('трек отдаёт artistCardId', tr?.artistCardId === cid, J(tr));
await call(`/api/music/artist-cards/${cid}/image/cutout`, { method: 'DELETE' }, A.tok);
r = await call('/api/music/tracks?limit=200', {}, B.tok);
t('после удаления картинки artistCardId пропадает', !(r.data.tracks ?? []).find((x) => x.id === tid)?.artistCardId);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
