// Sky Pets: серия ухода и вехи (модуль напрямую на Postgres). DATABASE_URL=… REDIS_URL=… node scripts/audit/skypets-streak-test.mjs
import { query } from '../../server/db.mjs';
import * as core from '../../server/spcore.mjs';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const u = (n) => `acc-st-${n}-${Date.now()}`; const A = u('a'), B = u('b');
for (const id of [A, B]) await query(`INSERT INTO profiles (id, name, username) VALUES ($1,$1,$1) ON CONFLICT DO NOTHING`, [id]).catch(() => {});
await core.ensurePlayer(A); await core.ensurePlayer(B);
const pid = 'pet-' + crypto.randomUUID();
const sp = (await query('SELECT id FROM sp_species LIMIT 1')).rows[0]?.id ?? (await core.overview(A), (await query('SELECT id FROM sp_species LIMIT 1')).rows[0].id);
await query(`INSERT INTO sp_pets (id, species_id, name, shared) VALUES ($1,$2,'Тест',true)`, [pid, sp]);
for (const o of [A, B]) await query('INSERT INTO sp_owners (pet_id, profile_id) VALUES ($1,$2)', [pid, o]);
const day = (n) => `now() - interval '${n} day'`;
const hist = (d, who = A) => query(`INSERT INTO sp_history (pet_id, actor_id, action, created_at) VALUES ($1,$2,'feed', ${day(d)})`, [pid, who]);
// 1) пусто
let s = await core.streakOf(A, pid); ok(s.current === 0 && s.best === 0 && s.next === 10 && s.unseen.length === 0, 'пустая серия');
// 2) 9 дней подряд, заканчивая вчера: серия жива (сегодня ещё можно)
for (let d = 1; d <= 9; d++) await hist(d, d % 2 ? A : B);
s = await core.streakOf(A, pid); ok(s.current === 9 && !s.doneToday && s.next === 10, 'серия 9, сегодня ещё не ухаживали: ' + JSON.stringify(s).slice(0, 80));
// 3) действие сегодня -> 10, веха 10 достигнута, награда обоим один раз
const c0 = [A, B].map(async (o) => Number((await query('SELECT coins FROM sp_players WHERE profile_id=$1', [o])).rows[0].coins));
const before = await Promise.all(c0);
await query(`UPDATE sp_pets SET stat_at = now() - interval '3 hour', satiety = 30 WHERE id=$1`, [pid]);
const r = await core.act(A, pid, 'feed', { itemId: 'food-kibble' });
ok(r.ok && r.streakReached?.includes(10), 'веха 10 в ответе: ' + JSON.stringify(r.streakReached ?? r.error));
const after = await Promise.all([A, B].map(async (o) => Number((await query('SELECT coins FROM sp_players WHERE profile_id=$1', [o])).rows[0].coins)));
ok(after[0] >= before[0] + 50 && after[1] === before[1] + 50, `награда 50 монет каждому хозяину: ${before}→${after}`);
s = await core.streakOf(B, pid); ok(s.current === 10 && s.doneToday && s.unseen.join() === '10' && s.milestones.find((m) => m.m === 10).reached, 'B видит непросмотренную веху 10');
// 4) повторное действие в тот же день — второй награды нет
await query(`UPDATE sp_pets SET stat_at = now() - interval '3 hour', satiety = 30 WHERE id=$1`, [pid]);
const r2 = await core.act(A, pid, 'feed', { itemId: 'food-kibble' }); ok(!r2.streakReached?.length, 'повтор веху не даёт');
const final = Number((await query('SELECT coins FROM sp_players WHERE profile_id=$1', [B])).rows[0].coins); ok(final === after[1], 'монеты B не изменились повторно');
// 5) отметка «видел» только своя
ok((await core.streakSeen(B, pid, 10)).ok, 'B отметил'); ok((await core.streakOf(B, pid)).unseen.length === 0 && (await core.streakOf(A, pid)).unseen.join() === '10', 'у A всё ещё непросмотренная');
ok((await core.streakSeen(B, pid, 11)).error === 'bad_request', 'чужая веха');
ok((await core.streakSeen('acc-nobody', pid, 10)).error === 'not_found', 'не хозяин');
// 6) перерыв сбрасывает серию, но вехи и лучший результат остаются
await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); for (const d of [1, 2, 3, 6, 7]) await hist(d);
s = await core.streakOf(A, pid); ok(s.current === 3 && s.best === 3 && s.milestones.find((m) => m.m === 10).reached, `перерыв: current ${s.current} best ${s.best}`);
// 7) серия жива, если последний день — вчера; мертва, если позавчера
await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); await hist(2); await hist(3); s = await core.streakOf(A, pid); ok(s.current === 0 && s.best === 2, 'последний день позавчера — серия оборвана');
console.log(`streak: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
