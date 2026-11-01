// Sky Safety (модуль напрямую). Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/safety-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const s = await import('../../server/safety.mjs');
const chats = await import('../../server/chats.mjs');
const { SKYBOT_PROFILE } = await import('../../server/skybotid.mjs');
const { query, pool } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log('✗', n); } };
const id = `${Date.now()}`;
const mk = async (n) => { await query('INSERT INTO sky_ids (id, email, email_verified) VALUES ($1,$2,TRUE)', [`sky-sf-${n}-${id}`, `sf${n}${id}@t.test`]); await query('INSERT INTO profiles (id, sky_id, username, name) VALUES ($1,$2,$3,$4)', [`acc-sf${n}${id}`, `sky-sf-${n}-${id}`, `sf${n}${id}`, `Имя${n}`]); return `acc-sf${n}${id}`; };
const [A, B, C] = [await mk('a'), await mk('b'), await mk('c')];
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const [a1, b1] = pair(A, B);
await query(`INSERT INTO friendships (a_id,b_id,requested_by,status) VALUES ($1,$2,$1,'accepted')`, [a1, b1]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const texts = async (who) => { await wait(400); return (await chats.listMessages(chats.directChatId(who, SKYBOT_PROFILE), who, 30, null) ?? []).map((m) => String(m.text)); };

t('нельзя включить без контактов', (await s.saveSettings(A, { enabled: true, timeoutSec: 60 })).error === 'need_contact');
t('нельзя добавить не-друга', (await s.addContact(A, C)).error === 'not_friends');
t('нельзя добавить себя', (await s.addContact(A, A)).error === 'bad_contact');
t('добавить друга можно', (await s.addContact(A, B)).ok === true);
t('контакту пришло приглашение', (await texts(B)).some((x) => x.includes('доверенным контактом')));
t('без согласия контакта включить нельзя', (await s.saveSettings(A, { enabled: true })).error === 'need_contact');
t('чужой не примет приглашение', (await s.answerInvite(C, A, true)).error === 'not_found');
t('контакт принимает', (await s.answerInvite(B, A, true)).ok === true);
t('плохой срок отклонён', (await s.saveSettings(A, { enabled: true, timeoutSec: 5 })).error === 'bad_timeout');
t('включить можно', (await s.saveSettings(A, { enabled: true, timeoutSec: 30 })).ok === true);

t('медленная остановка не событие', (await s.trigger(A, { speedBeforeKmh: 12 })).error === 'bad_speed');
t('мусорная скорость отклонена', (await s.trigger(A, { speedBeforeKmh: 'x' })).error === 'bad_speed');
const tr = await s.trigger(A, { speedBeforeKmh: 80, dropKmh: 75, lat: 55.75, lng: 37.6, signals: 'impact,gps' });
t('событие создано', tr.ok && tr.deadlineSec === 30);
t('человеку отправлена просьба подтвердить', (await texts(A)).some((x) => x.includes('резкую остановку')));
t('повторное событие в кулдаун', (await s.trigger(A, { speedBeforeKmh: 90 })).error === 'cooldown');
t('в ожидании видно в состоянии', (await s.getState(A)).pending?.id === tr.id);
t('чужой не подтвердит', (await s.confirmSafe(C, tr.id)).error === 'not_found');
t('до срока никого не предупредили', (await s.sweepSafety()) === 0);
t('«Я в порядке» закрывает событие', (await s.confirmSafe(A, tr.id)).ok === true);
await query(`UPDATE safety_events SET deadline_at = now() - interval '1 second' WHERE id = $1`, [tr.id]);
t('после ответа предупреждения нет', (await s.sweepSafety()) === 0 && !(await texts(B)).some((x) => x.includes('не ответил')));

// без ответа
await query('DELETE FROM safety_events WHERE profile_id = $1', [A]);
const tr2 = await s.trigger(A, { speedBeforeKmh: 70, lat: 55.7, lng: 37.5 });
await query(`UPDATE safety_events SET deadline_at = now() - interval '1 second' WHERE id = $1`, [tr2.id]);
t('без ответа — предупреждение ровно один раз', (await s.sweepSafety()) === 1 && (await s.sweepSafety()) === 0);
const got = await texts(B);
t('контакту пришло с ссылкой на карту', got.some((x) => x.includes('не ответил') && x.includes('yandex.ru/maps') && x.includes('37.500000,55.700000')));
t('есть оговорка «не доказательство»', got.some((x) => x.includes('не доказательство')));
t('человеку сообщили об отправке', (await texts(A)).some((x) => x.includes('отправлено предупреждение')));

// событие без точки (GPS потерян) — всё равно предупреждаем, но не выдумываем координаты
await query('DELETE FROM safety_events WHERE profile_id = $1', [A]);
const tr3 = await s.trigger(A, { speedBeforeKmh: 60 });
await query(`UPDATE safety_events SET deadline_at = now() - interval '1 second' WHERE id = $1`, [tr3.id]);
await s.sweepSafety();
t('без GPS координаты не выдуманы', (await texts(B)).some((x) => x.includes('Положение определить не удалось')));

// убрали последний контакт — функция выключается
await s.removeContact(A, B);
t('без контактов функция выключена', (await s.getState(A)).enabled === false);
t('выключенную нельзя запустить', (await s.trigger(A, { speedBeforeKmh: 90 })).error === 'not_enabled');

for (const p of [A, B, C]) { await query('DELETE FROM messages WHERE chat_id = $1', [chats.directChatId(p, SKYBOT_PROFILE)]); await query('DELETE FROM profiles WHERE id=$1', [p]); }
await query(`DELETE FROM sky_ids WHERE id LIKE $1`, [`sky-sf-%-${id}`]);
console.log(`safety: ${ok} ok, ${bad} fail`); await pool.end(); process.exit(bad ? 1 : 0);
