// Серверные проверки Media Home / SkyWave / Поток на двоих / homedata на настоящей базе.
// Запуск: DATABASE_URL=… REDIS_URL=… node scripts/audit/mediawave-test.mjs (миграции уже применены).
import assert from 'node:assert/strict';
import { query, pool } from '../../server/db.mjs';
const H = await import('../../server/mediahome.mjs');
const W = await import('../../server/mediawave.mjs');
const D = await import('../../server/musicduo.mjs');
const X = await import('../../server/homedata.mjs');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };
const sfx = Date.now().toString(36);
const mkP = async (tag) => {
  const id = `acc-t${tag}${sfx}`; await query(`INSERT INTO sky_ids (id, email) VALUES ($1,$2)`, [`sky-${id}`, `${id}@t.test`]);
  await query(`INSERT INTO profiles (id, username, name, sky_id) VALUES ($1,$2,$3,$4)`, [id, `u${tag}${sfx}`, `Имя ${tag}`, `sky-${id}`]);
  await query(`INSERT INTO prime_subscriptions (id, profile_id, status, plan) VALUES ($1,$2,'active','standard')`, [`ps-${id}`, id]);
  return id;
};
const A = await mkP('a'); const B = await mkP('b'); const C = await mkP('c');
const tr = async (i, genre, artist, plays) => { const id = `trk-${sfx}-${i}`; await query(`INSERT INTO music_tracks (id, owner_id, title, artist, genre, mime, bytes, status, plays) VALUES ($1,$2,$3,$4,$5,'audio/mpeg',1000,'published',$6)`, [id, C, `Трек ${i}`, artist, genre, plays]); return id; };
const t1 = await tr(1, 'Rock', 'Band X', 50); const t2 = await tr(2, 'Rock', 'Band Y', 40); const t3 = await tr(3, 'Jazz', 'Duo Z', 30); const t4 = await tr(4, 'Pop', 'Solo Q', 20);
await query(`INSERT INTO music_favorites (user_id, track_id) VALUES ($1,$2),($1,$3),($4,$2),($4,$5)`, [A, t1, t3, B, t4]);

// раскладки
const home = await H.getHome(A); ok(home.layouts.length === 1 && home.layouts[0].active, 'создан активный вариант по умолчанию');
const cr = await H.createLayout(A, { name: 'Второй' }); ok(cr.layout?.id, 'второй вариант');
await H.activateLayout(A, cr.layout.id); ok((await H.listLayouts(A)).filter((l) => l.active).length === 1, 'один активный');
ok((await H.saveLayout(B, cr.layout.id, { name: 'x' })).error === 'not_found', 'чужой вариант недоступен');
ok((await H.deleteLayout(B, cr.layout.id)).error === 'not_found', 'чужой вариант не удалить');
ok((await H.deleteLayout(A, cr.layout.id)).ok, 'удаление активного'); ok((await H.listLayouts(A)).some((l) => l.active), 'после удаления есть активный');
ok((await H.deleteLayout(A, (await H.listLayouts(A))[0].id)).error === 'last_layout', 'последний не удаляется');
for (let i = 0; i < 7; i += 1) await H.createLayout(A, { name: `v${i}` }); ok((await H.createLayout(A, {})).error === 'too_many_layouts', 'предел вариантов');

// подборки
const w = await W.buildWave(A); ok(w.prime && Array.isArray(w.shelves), 'wave собран');
const ids = w.shelves.map((s) => s.id); ok(ids.includes('my_music'), 'Твоя музыка из избранного'); ok(ids.includes('new') && ids.includes('trending'), 'общие подборки');
const fy = w.shelves.find((s) => s.id === 'for_you'); ok(fy && fy.personal && fy.items.every((i) => i.id !== t1 && i.id !== t3), 'для тебя — без уже избранного');
ok(w.shelves.every((s) => s.items.length <= 12), 'предел подборки');
await W.sendFeedback(A, { kind: 'music', itemId: t2, signal: 'hide' });
ok(!(await W.buildWave(A)).shelves.some((s) => s.items.some((i) => i.id === t2)), 'скрытое исключено везде');
await W.sendFeedback(A, { kind: 'music', itemId: t4, signal: 'mute_author', authorKey: 'm:solo q' });
ok(!(await W.buildWave(A)).shelves.some((s) => s.items.some((i) => i.id === t4)), 'автор приглушён');
ok((await W.sendFeedback(A, { kind: 'x', itemId: 'a', signal: 'hide' })).error === 'bad_request', 'плохой вид отклонён');
await W.clearFeedback(A); ok((await W.buildWave(A)).shelves.some((s) => s.items.some((i) => i.id === t2)), 'очистка истории рекомендаций');
await W.savePrefs(A, { hidden: ['new'] }); ok((await W.buildWave(A)).hidden.includes('new'), 'скрытие сохранено');
const wB = await W.buildWave(B); ok(!wB.shelves.some((s) => s.items.some((i) => i.id === t2 && s.id === 'my_music')), 'чужая история не видна');
const none = await W.buildWave(C); ok(none.shelves.find((s) => s.id === 'for_you')?.personal !== true, 'без данных — не персональная');
await query(`DELETE FROM prime_subscriptions WHERE profile_id=$1`, [B]);
ok(!(await W.buildWave(B)).shelves.some((s) => s.items.some((i) => i.kind === 'music')), 'без Prime музыки нет');
await query(`INSERT INTO prime_subscriptions (id, profile_id, status, plan) VALUES ($1,$2,'active','standard')`, [`ps2-${B}`, B]);
await W.saveAdminConfig(A, { disabled: ['trending'] }); ok(!(await W.buildWave(A)).shelves.some((s) => s.id === 'trending'), 'админ отключил подборку');
await W.saveAdminConfig(A, { disabled: [] });
const dg = await W.diagnostics(7); ok(dg.shelves.every((s) => s.errors === 0), 'ни одна подборка не падала с ошибкой');
const dg0 = dg; ok(dg.shelves.length > 0 && dg.shelves.every((s) => !('profile_id' in s)), 'диагностика без личных данных');

// поток на двоих
ok((await D.inviteDuo(A, B)).error === 'not_friends', 'не друзья — нельзя');
const [fa, fb] = A < B ? [A, B] : [B, A];
await query(`INSERT INTO friendships (a_id, b_id, requested_by, status) VALUES ($1,$2,$1,'accepted')`, [fa, fb]);
const inv = await D.inviteDuo(A, B); ok(inv.ok, 'приглашение'); ok((await D.inviteDuo(A, B)).error === 'already_exists', 'повтор приглашения');
ok((await D.duoQueue(A, inv.id)).error === 'not_active', 'до принятия очереди нет');
ok((await D.actDuo(A, inv.id, 'accept')).error === 'forbidden', 'пригласивший не принимает сам');
ok((await D.actDuo(C, inv.id, 'accept')).error === 'not_found', 'посторонний не видит');
ok((await D.actDuo(B, inv.id, 'accept')).ok, 'принятие');
const q = await D.duoQueue(A, inv.id); ok(q.tracks.length > 0, 'очередь собрана'); ok(q.tracks[0].id === t1, 'общее избранное первым'); ok(q.tracks.every((t) => t.reason), 'у каждого причина');
ok((await W.buildWave(A)).shelves.some((s) => s.id === 'together'), 'подборка «Вместе интереснее»');
ok((await D.actDuo(B, inv.id, 'end')).ok, 'завершение'); ok((await D.duoQueue(A, inv.id)).error === 'not_active', 'после завершения очереди нет');
ok(!(await W.buildWave(A)).shelves.some((s) => s.id === 'together'), 'подборка исчезла');

// данные виджетов
const sec = await X.securitySummary(A); ok(sec.score >= 0 && sec.score <= 100 && sec.factors.length === 7, 'защита: балл');
ok(JSON.stringify(sec).indexOf('hash') < 0, 'в ответе защиты нет секретов');
const st = await X.storageUsage(A); ok(st.quotaBytes > 0 && st.usedBytes >= 0, 'хранилище');
ok(Array.isArray((await X.activeBookings(A)).bookings), 'брони'); ok(Array.isArray((await X.popularEvents()).events), 'события');

await pool.end();
console.log(`mediawave-test: ${n} проверок пройдено`);
