// «Продолжить на другом устройстве» (server/handoff.mjs). API: OWNER_USERNAME=любой ADMIN_GATE=off. (. env.sh; node scripts/audit/handoff-test.mjs <каталог с api.log>)
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 240) : JSON.stringify(x).slice(0, 240)); } };
const dev = () => 'dv' + crypto.randomBytes(14).toString('hex');
const H = (path, o = {}, tok, d) => call('/api/handoff' + path, o, tok, d ? { 'x-sky-device': d } : {});
const post = (p, b, tok, d) => H(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, tok, d);
const idem = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sb = await import('../../server/handoff.mjs');

/* чистая логика */
const now = Date.now(), fresh = new Date(now - 10_000).toISOString();
t('цель: подходит', sb.targetProblem({ id: 'b', status: 'approved', last_profile: 'p', last_seen: fresh }, { fromId: 'a', profileId: 'p', now }) === null);
t('цель: сам себе', sb.targetProblem({ id: 'a', status: 'approved', last_seen: fresh }, { fromId: 'a', profileId: 'p', now }) === 'same_device');
t('цель: не подтверждено', sb.targetProblem({ id: 'b', status: 'pending', last_seen: fresh }, { fromId: 'a', profileId: 'p', now }) === 'recipient_not_trusted');
t('цель: другой профиль', sb.targetProblem({ id: 'b', status: 'approved', last_profile: 'q', last_seen: fresh }, { fromId: 'a', profileId: 'p', now }) === 'other_profile');
t('цель: не на связи', sb.targetProblem({ id: 'b', status: 'approved', last_seen: new Date(now - 600_000).toISOString() }, { fromId: 'a', profileId: 'p', now }) === 'device_offline');
t('цель: нет такого', sb.targetProblem(undefined, {}) === 'unknown_device');
const snap = { position: 100, createdAt: new Date(now - 60_000).toISOString() };
t('место: нет записи — берём снимок', sb.resolvePosition(snap, null).position === 100);
t('место: запись старее снимка', sb.resolvePosition(snap, { position: 50, updatedAt: new Date(now - 90_000).toISOString() }).position === 100);
t('место: на третьем устройстве позже — берём его', (() => { const r = sb.resolvePosition(snap, { position: 400, updatedAt: new Date(now - 5_000).toISOString() }); return r.position === 400 && r.newerElsewhere; })());
t('место: запись от самой передачи не считается «позже»', !sb.resolvePosition(snap, { position: 100, updatedAt: new Date(now - 59_000).toISOString() }).newerElsewhere);

/* стенд */
const A = await mkuser(S, 'hoa'), X = await mkuser(S, 'hox');
const skyA = q(`select sky_id from profiles where id='${A.pid}'`);
const PH = dev(), TV = dev(), PC = dev(), CAR = dev(), XD = dev();
const ids = { music: 'trk-' + crypto.randomBytes(6).toString('hex'), film: 'mov-' + crypto.randomBytes(6).toString('hex'), video: 'svd-' + crypto.randomBytes(6).toString('hex'), podcast: 'ep-' + crypto.randomBytes(6).toString('hex'), book: 'bk-' + crypto.randomBytes(6).toString('hex'), pod: 'pc-' + crypto.randomBytes(6).toString('hex') };
q(`insert into music_tracks (id, owner_id, title, artist, mime, bytes, status) values ('${ids.music}','${A.pid}','Песня','Артист','audio/mpeg',10,'private')`);
q(`insert into film_movies (id, owner_id, title, mime, status, duration_sec) values ('${ids.film}','${A.pid}','Фильм','video/mp4','private',3600)`);
q(`insert into sky_videos (id, owner_id, title, mime, status) values ('${ids.video}','${A.pid}','Ролик','video/mp4','published')`);
q(`insert into podcasts (id, owner_id, title, status) values ('${ids.pod}','${A.pid}','Подкаст','published')`);
q(`insert into podcast_episodes (id, podcast_id, title, published) values ('${ids.podcast}','${ids.pod}','Выпуск',true)`);
q(`insert into books (id, author_id, title, status) values ('${ids.book}','${A.pid}','Книга','published')`);

let r = await post('/device/register', { name: 'Телефон', kind: 'phone' }, A.tok); t('без заголовка устройства — отказ', r.status === 400, r);
r = await post('/device/register', { name: 'Телефон', kind: 'phone' }, A.tok, PH); t('первое устройство подтверждено', r.status === 200 && r.data.status === 'approved', r);
const phId = r.data.id;
r = await post('/device/register', { name: 'ТВ', kind: 'tv' }, A.tok, TV); t('второе без доверия — ждёт подтверждения', r.data.status === 'pending', r);
const tvId = r.data.id;
r = await post('/device/register', { name: 'ПК', kind: 'desktop' }, A.tok, PC); const pcId = r.data.id;
r = await H('/devices', {}, A.tok, PH); t('список: только подтверждённые, ждущие — числом', r.status === 200 && r.data.devices.length === 1 && r.data.pendingApproval === 2, r.data);
r = await call(`/api/transfer/devices/${pcId}/approve`, { method: 'POST', body: '{}' }, A.tok, { 'x-sky-device': PH }); t('ПК подтверждён с телефона (общий реестр Transfer)', r.status === 200, r);
r = await call(`/api/transfer/devices/${tvId}/approve`, { method: 'POST', body: '{}' }, A.tok, { 'x-sky-device': PH });
r = await H('/devices', {}, A.tok, PH); t('в списке три устройства', r.data.devices.length === 3 && r.data.devices.find((d) => d.id === phId)?.current === true, r.data);
t('ТВ и ПК доступны для передачи', r.data.devices.filter((d) => d.canReceive).length === 2, r.data);

/* отправка */
const base = { toDevice: pcId, kind: 'film', itemId: ids.film, title: 'Фильм', position: 1234.5, duration: 3600 };
r = await post('/send', { ...base, idemKey: idem() }, A.tok); t('отправка без устройства — отказ', r.status === 400 || r.status === 403, r);
r = await post('/send', { ...base, toDevice: phId, idemKey: idem() }, A.tok, PH); t('себе — нельзя', r.data.error === 'same_device', r.data);
r = await post('/send', { ...base, kind: 'bogus', idemKey: idem() }, A.tok, PH); t('неизвестный вид', r.data.error === 'bad_kind', r.data);
r = await post('/send', { ...base, itemId: 'x;drop', idemKey: idem() }, A.tok, PH); t('мусорный id', r.data.error === 'bad_item', r.data);
r = await post('/send', { ...base, idemKey: 'x' }, A.tok, PH); t('нет ключа идемпотентности', r.data.error === 'bad_idem', r.data);
r = await post('/send', { ...base, itemId: 'mov-nonexistent', idemKey: idem() }, A.tok, PH); t('чужого/несуществующего материала нет', r.data.error === 'not_found', r.data);
r = await post('/send', { ...base, toDevice: 'dev-00000000-0000-0000-0000-000000000000', idemKey: idem() }, A.tok, PH); t('неизвестное устройство', r.data.error === 'unknown_device', r.data);
q(`update transfer_devices set last_seen = now() - interval '10 minutes' where id='${pcId}'`);
r = await post('/send', { ...base, idemKey: idem() }, A.tok, PH); t('устройство не на связи — понятный отказ с названием', r.status === 409 && r.data.error === 'device_offline' && r.data.name === 'ПК', r);
r = await post('/device/heartbeat', {}, A.tok, PC); t('сигнал устройства', r.status === 200, r);
const key1 = idem();
r = await post('/send', { ...base, idemKey: key1 }, A.tok, PH); t('отправка принята', r.status === 201 && r.data.handoff.state === 'pending' && r.data.handoff.position === 1234.5, r);
const h1 = r.data.handoff.id;
t('место записано в настоящий прогресс кино', q(`select position_sec from film_progress where user_id='${A.pid}' and movie_id='${ids.film}'`) === '1235' || q(`select position_sec from film_progress where user_id='${A.pid}' and movie_id='${ids.film}'`) === '1234');
r = await post('/send', { ...base, idemKey: key1 }, A.tok, PH); t('повтор с тем же ключом — тот же результат без дубля', r.data.duplicate === true && r.data.handoff.id === h1, r.data);
t('в базе одна запись', q(`select count(*) from handoffs where sky_id='${skyA}' and idem_key='${key1}'`) === '1');
r = await H('/pending', {}, A.tok, PC); t('получатель видит ожидающую', r.data.handoffs.length === 1 && r.data.handoffs[0].id === h1 && r.data.handoffs[0].title === 'Фильм', r.data);
r = await H('/pending', {}, A.tok, PH); t('другое устройство её не видит', r.data.handoffs.length === 0, r.data);
r = await post(`/${h1}/accept`, {}, A.tok, PH); t('отправитель принять не может', r.status === 404, r);
r = await post(`/${h1}/accept`, {}, X.tok, PC); t('чужой аккаунт не принимает', r.status === 404 || r.status === 403 || r.status === 409, r);
r = await H(`/${h1}`, {}, X.tok, XD); t('чужой не видит статус', r.status === 404 || r.status === 403 || r.status === 409, r);
/* вторая передача на то же устройство вытесняет первую */
r = await post('/send', { ...base, position: 1300, idemKey: idem() }, A.tok, PH); const h2 = r.data.handoff.id;
r = await H(`/${h1}`, {}, A.tok, PH); t('прежняя вытеснена (нет дубля воспроизведения)', r.data.handoff.state === 'superseded', r.data);
r = await post(`/${h1}/accept`, {}, A.tok, PC); t('вытесненную принять нельзя', r.status === 409, r);
t('ожидающая одна', (await H('/pending', {}, A.tok, PC)).data.handoffs.length === 1);
r = await post(`/${h2}/accept`, {}, A.tok, PC); t('принято: место и состояние', r.status === 200 && r.data.handoff.state === 'accepted' && r.data.handoff.position === 1300 && r.data.newerElsewhere === false, r.data);
r = await post(`/${h2}/accept`, {}, A.tok, PC); t('повторное принятие безвредно', r.status === 200 && r.data.duplicate === true, r);
r = await post(`/${h2}/decline`, {}, A.tok, PC); t('после принятия отклонить нельзя', r.status === 409, r);
r = await H(`/${h2}`, {}, A.tok, PH); t('отправитель видит «принято»', r.data.handoff.state === 'accepted', r.data);

/* конфликт: пока ждали, место записали на третьем устройстве */
r = await post('/send', { ...base, position: 100, idemKey: idem() }, A.tok, PH); const h3 = r.data.handoff.id;
await sleep(3500);
q(`update film_progress set position_sec = 2000, updated_at = now() where user_id='${A.pid}' and movie_id='${ids.film}'`);
r = await post(`/${h3}/accept`, {}, A.tok, PC); t('позже записанное место на другом устройстве побеждает', r.data.newerElsewhere === true && r.data.handoff.position === 2000, r.data);

/* отклонение, отмена, срок */
r = await post('/send', { ...base, idemKey: idem() }, A.tok, PH); const h4 = r.data.handoff.id;
r = await post(`/${h4}/decline`, {}, A.tok, PC); t('отклонено получателем', r.status === 200, r);
r = await H(`/${h4}`, {}, A.tok, PH); t('отправитель видит «отклонено»', r.data.handoff.state === 'declined', r.data);
r = await post('/send', { ...base, idemKey: idem() }, A.tok, PH); const h5 = r.data.handoff.id;
r = await post(`/${h5}/cancel`, {}, A.tok, PC); t('отменить может только отправитель', r.status === 404, r);
r = await post(`/${h5}/cancel`, {}, A.tok, PH); t('отмена отправителем', r.status === 200, r);
r = await post('/send', { ...base, idemKey: idem() }, A.tok, PH); const h6 = r.data.handoff.id;
q(`update handoffs set expires_at = now() - interval '1 second' where id='${h6}'`);
r = await post(`/${h6}/accept`, {}, A.tok, PC); t('истёкшую принять нельзя — «истекло»', r.status === 410 || r.data.error === 'expired', r);
r = await H(`/${h6}`, {}, A.tok, PH); t('статус истёкшей', r.data.handoff.state === 'expired', r.data);

/* виды контента */
for (const [kind, extra] of [['music', {}], ['podcast', {}], ['video', {}], ['book', { mode: 'audio', audioChapter: 3 }], ['book', { mode: 'text', textChapter: 2, textOffset: 500 }]]) {
  r = await post('/send', { toDevice: pcId, kind, itemId: ids[kind], title: kind, position: kind === 'book' && extra.mode === 'text' ? 500 : 777, duration: 1000, extra, idemKey: idem() }, A.tok, PH);
  t(`отправка: ${kind}${extra.mode ? '/' + extra.mode : ''}`, r.status === 201, r);
  if (r.status === 201) await post(`/${r.data.handoff.id}/decline`, {}, A.tok, PC);
}
t('музыка: место в music_progress', q(`select position_sec from music_progress where user_id='${A.pid}' and track_id='${ids.music}'`) === '777');
t('подкаст: место в podcast_progress', q(`select position_sec from podcast_progress where user_id='${A.pid}' and episode_id='${ids.podcast}'`) === '777');
t('видео: место в sky_video_progress (новая таблица)', q(`select position_sec from sky_video_progress where user_id='${A.pid}' and video_id='${ids.video}'`) === '777');
t('книга: глава и смещение текста', q(`select text_chapter||':'||text_offset from book_progress where user_id='${A.pid}' and book_id='${ids.book}'`) === '2:500');
t('книга: аудиоглава сохранена отдельно', q(`select audio_chapter from book_progress where user_id='${A.pid}' and book_id='${ids.book}'`) === '3');
r = await H(`/video-progress/${ids.video}`, {}, A.tok, PH); t('место видео читается', r.data.progress?.position === 777, r.data);
r = await H(`/video-progress/${ids.video}`, { method: 'PUT', body: JSON.stringify({ position: 55, duration: 300 }) }, A.tok, PH); t('место видео пишется', r.status === 200, r);
r = await H(`/video-progress/${ids.video}`, {}, X.tok, XD); t('чужой профиль видит только своё (пусто)', !r.data.progress, r.data);
r = await H(`/video-progress/svd-nonexistent`, { method: 'PUT', body: JSON.stringify({ position: 5 }) }, A.tok, PH); t('место в несуществующее видео не пишется', r.status === 404, r);

/* чужой аккаунт: не может слать на наши устройства и не видит их */
await post('/device/register', { name: 'Чужой', kind: 'phone' }, X.tok, XD);
r = await post('/send', { ...base, idemKey: idem() }, X.tok, XD); t('чужой не может отправить на наше устройство', r.data.error === 'unknown_device' || r.status >= 400, r);
r = await H('/devices', {}, X.tok, XD); t('чужой не видит наши устройства', r.data.devices.every((d) => ![phId, pcId, tvId].includes(d.id)), r.data);
r = await post('/send', { ...base, idemKey: idem() }, X.tok, XD); t('чужой не открывает наш материал', r.status >= 400);

/* другой профиль на устройстве-получателе */
q(`update transfer_devices set last_profile = 'prof-other' where id='${pcId}'`);
r = await post('/send', { ...base, idemKey: idem() }, A.tok, PH); t('на устройстве выбран другой профиль — понятный отказ', r.data.error === 'other_profile', r.data);
await post('/device/heartbeat', {}, A.tok, PC);

/* настройки, история, продолжить */
r = await H('/prefs', { method: 'PUT', body: JSON.stringify({ accept: 'off' }) }, A.tok, PH); t('приём можно выключить', r.data.accept === 'off', r.data);
r = await post('/send', { ...base, idemKey: idem() }, A.tok, PH); t('при выключенном приёме отправка закрыта', r.data.error === 'handoff_disabled', r.data);
await H('/prefs', { method: 'PUT', body: JSON.stringify({ accept: 'ask', historyDays: 90 }) }, A.tok, PH);
r = await H('/history', {}, A.tok, PH); t('история продолжений', r.data.history.length >= 8 && r.data.history[0].fromName === 'Телефон', r.data.history.length);
r = await H('/continue', {}, A.tok, PH); t('«где остановились»: по всем видам', r.data.items.length >= 4 && ['music', 'podcast', 'film', 'video', 'book'].every((k) => r.data.items.some((i) => i.kind === k) || k === 'film'), r.data.items.map((i) => i.kind));
r = await H('/history', { method: 'DELETE' }, A.tok, PH); t('очистка истории', r.status === 200 && (await H('/history', {}, A.tok, PH)).data.history.length === 0);
r = await call('/api/handoff/devices'); t('без входа — 401', r.status === 401);

/* общий реестр: ТВ, вошедший по QR-входу, доверяется сразу (trusted) */
console.log(`\nHandoff: ${ok} ok, ${bad} FAIL`); process.exit(bad ? 1 : 0);
