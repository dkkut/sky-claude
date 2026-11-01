// Карта друзей (модуль напрямую). Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/friendloc-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const f = await import('../../server/friendloc.mjs');
const { query, pool } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log('✗', n); } };
const id = `${Date.now()}`;
const mk = async (n) => { await query('INSERT INTO sky_ids (id, email, email_verified) VALUES ($1,$2,TRUE)', [`sky-fl-${n}-${id}`, `fl${n}${id}@t.test`]); await query('INSERT INTO profiles (id, sky_id, username, name) VALUES ($1,$2,$3,$4)', [`acc-fl${n}${id}`, `sky-fl-${n}-${id}`, `fl${n}${id}`, `Имя${n}`]); return `acc-fl${n}${id}`; };
const [A, B, C] = [await mk('a'), await mk('b'), await mk('c')];
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const [a1, b1] = pair(A, B);
await query(`INSERT INTO friendships (a_id,b_id,requested_by,status) VALUES ($1,$2,$1,'accepted')`, [a1, b1]);

t('без включения точку не принимает', (await f.putPosition(A, { lat: 55.75, lng: 37.6 })).error === 'not_sharing');
t('нельзя делиться с не-другом', (await f.setSharing(A, [C])).error === 'not_friends');
t('нельзя делиться с собой', (await f.setSharing(A, [A])).ok === true && (await f.sharedWith(A)).length === 0);
t('делиться с другом можно', (await f.setSharing(A, [B])).ok === true);
t('нулевая точка отклонена', (await f.putPosition(A, { lat: 0, lng: 0 })).error === 'bad_point');
t('мусор отклонён', (await f.putPosition(A, { lat: 'x', lng: 1 })).error === 'bad_point');
t('точка принята', (await f.putPosition(A, { lat: 55.75, lng: 37.6, speed: 10, accuracy: 12 })).ok === true);

let v = await f.visibleFriends(B);
t('друг видит точку и скорость 36 км/ч', v.friends.length === 1 && v.friends[0].point.lat === 55.75 && v.friends[0].speedKmh === 36 && v.friends[0].stale === false);
t('посторонний не видит', (await f.visibleFriends(C)).friends.length === 0);
t('сам себя в списке не видит', (await f.visibleFriends(A)).friends.length === 0);

await query(`UPDATE loc_last SET updated_at = now() - interval '30 minutes' WHERE profile_id = $1`, [A]);
v = await f.visibleFriends(B); t('старше 10 минут — stale', v.friends[0].stale === true);
await query(`UPDATE loc_last SET updated_at = now() - interval '2 days' WHERE profile_id = $1`, [A]);
v = await f.visibleFriends(B); t('старше суток — точки нет', v.friends[0].point === null);

await f.putPosition(A, { lat: 55.8, lng: 37.7 });
await query(`DELETE FROM friendships WHERE a_id=$1 AND b_id=$2`, [a1, b1]);
t('дружба разорвана — не видно', (await f.visibleFriends(B)).friends.length === 0);
await query(`INSERT INTO friendships (a_id,b_id,requested_by,status) VALUES ($1,$2,$1,'accepted')`, [a1, b1]);
t('вернули дружбу — разрешение сохранилось', (await f.visibleFriends(B)).friends.length === 1);

await f.stopSharing(A);
t('остановка стирает точку и доступ', (await f.visibleFriends(B)).friends.length === 0 && (await query('SELECT 1 FROM loc_last WHERE profile_id=$1', [A])).rowCount === 0);
await f.setSharing(A, [B]); await f.putPosition(A, { lat: 55.7, lng: 37.5 });
await f.setSharing(A, []);
t('пустой список стирает точку', (await query('SELECT 1 FROM loc_last WHERE profile_id=$1', [A])).rowCount === 0);

for (const p of [A, B, C]) { await query('DELETE FROM profiles WHERE id=$1', [p]); }
await query(`DELETE FROM sky_ids WHERE id LIKE $1`, [`sky-fl-%-${id}`]);
console.log(`friendloc: ${ok} ok, ${bad} fail`); await pool.end(); process.exit(bad ? 1 : 0);
