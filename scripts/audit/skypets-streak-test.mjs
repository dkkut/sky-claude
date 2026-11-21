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
// 8) восстановление: серия 4 дня (дни 5..2 назад), вчера пропущен → можно вернуть
await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); await query('DELETE FROM sp_streak_marks WHERE pet_id=$1', [pid]);
for (const d of [5, 4, 3, 2]) await hist(d, A);
s = await core.streakOf(A, pid); ok(s.current === 0 && s.restore.available && s.restore.lostStreak === 4 && s.restore.left === 5, '8: вчера пропущен, серия оборвана, восстановление доступно: ' + JSON.stringify(s.restore));
ok((await core.streakRestore('acc-nobody', pid)).error === 'not_found', '8: не хозяин');
let rr = await core.streakRestore(B, pid); ok(rr.ok && rr.streak.current === 5 && rr.streak.restore.left === 4 && !rr.streak.restore.possible, '8: восстановлено, серия 5 (с вчера), осталось 4: ' + JSON.stringify(rr.error ?? rr.streak.current));
ok((await core.streakRestore(A, pid)).error === 'nothing_to_restore', '8: второй раз нечего');
const rA = await core.streakOf(A, pid); ok(rA.restore.left === 5, '8: лимит у A отдельный от B');
// 9) два пропущенных дня — вернуть нельзя
await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); await query('DELETE FROM sp_streak_saves WHERE pet_id=$1', [pid]);
for (const d of [6, 5, 4, 3]) await hist(d, A);
s = await core.streakOf(A, pid); ok(!s.restore.possible && (await core.streakRestore(A, pid)).error === 'nothing_to_restore', '9: пропуск двух дней не восстановить');
// 10) лимит 5 в месяц на человека
for (let i = 0; i < 5; i++) { await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); await query(`DELETE FROM sp_streak_saves WHERE pet_id=$1 AND kind='restore' AND day = (now() - interval '1 day')::date`, [pid]); for (const d of [4, 3, 2]) await hist(d, A);
  const x = await core.streakRestore(A, pid); if (i < 5 && !x.ok && i < 4) ok(false, '10: восстановление ' + i + ' ' + x.error); }
await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); await query(`DELETE FROM sp_streak_saves WHERE pet_id=$1 AND kind='restore'`, [pid]);
await query(`DELETE FROM sp_streak_saves WHERE profile_id=$1`, [A]);
for (let i = 0; i < 5; i++) await query(`INSERT INTO sp_streak_saves (pet_id, profile_id, kind, day, grp, created_at) VALUES ($1,$2,'restore', now()::date - $3::int - 10, $4, now())`, [pid, A, i, 'x' + i]);
for (const d of [4, 3, 2]) await hist(d, A);
ok((await core.streakRestore(A, pid)).error === 'restore_limit', '10: шестое восстановление за месяц отклонено');
ok((await core.streakRestore(B, pid)).ok, '10: у другого человека свой лимит');
// 11) заморозка: 5 дней не рвут серию и не растят
await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); await query('DELETE FROM sp_streak_saves WHERE pet_id=$1', [pid]); await query('DELETE FROM sp_streak_saves WHERE profile_id=ANY($1)', [[A, B]]);
ok((await core.streakFreeze(A, pid)).error === 'no_streak', '11: без серии замораживать нечего');
for (const d of [3, 2, 1, 0]) await hist(d, A);
const fz = await core.streakFreeze(A, pid); ok(fz.ok && fz.streak.freeze.active && !fz.streak.freeze.available && fz.streak.freeze.left === 0 && fz.streak.current === 4, '11: заморожено: ' + JSON.stringify(fz.error ?? fz.streak.freeze));
ok((await core.streakFreeze(A, pid)).error === 'freeze_active', '11: повторно нельзя');
ok((await core.streakFreeze(B, pid)).error === 'freeze_active', '11: у питомца одна активная заморозка');
// сдвигаем «сегодня» назад: ухода нет уже 3 дня, но заморозка прикрывает
const old = (await query(`SELECT id FROM sp_streak_saves WHERE pet_id=$1`, [pid])).rowCount; ok(old === 5, '11: 5 дней заморозки');
await query(`UPDATE sp_streak_saves SET day = day - 3 WHERE pet_id=$1`, [pid]); await query('DELETE FROM sp_history WHERE pet_id=$1', [pid]); for (const d of [5, 4, 3]) await hist(d, A);
s = await core.streakOf(A, pid); ok(s.current === 3 && !s.restore.possible, '11: дни заморозки (−3…+1) серию не порвали и не выросли: current ' + s.current);
await query('DELETE FROM sp_streak_saves WHERE pet_id=$1', [pid]); await query(`UPDATE sp_history SET created_at = created_at - interval '3 day' WHERE pet_id=$1`, [pid]);
s = await core.streakOf(A, pid); ok(s.current === 0, '11: без заморозки та же картина — серия оборвана');
console.log(`streak: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
