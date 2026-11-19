// Sky Time: капсулы времени, Sky Balance, «В этот день». Модуль напрямую на Postgres (DATABASE_URL, ключи шифрования; миграции накатаны).
import { listCapsules, createCapsule, cancelCapsule, openDue, getBalance, saveBalance, addUsage, usageReport, clearUsage, thisDay } from '../../server/skytime.mjs';
import { query, pool } from '../../server/db.mjs';
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, x); } };
const sfx = Date.now().toString(36);
const mk = async (tag) => { const id = `acc-st-${tag}-${sfx}`, sid = `sky-${id}`; await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [sid, `${id}@t.test`]); await query('INSERT INTO profiles (id, sky_id, username, name) VALUES ($1,$2,$3,$4)', [id, sid, `st${tag}${sfx}`.slice(0, 20), `Тест ${tag}`]); return id; };
const [a, b, c] = [await mk('a'), await mk('b'), await mk('c')];
const f = (x, y) => { const [p, q] = x < y ? [x, y] : [y, x]; return query(`INSERT INTO friendships (a_id,b_id,requested_by,status) VALUES ($1,$2,$1,'accepted')`, [p, q]); };
await f(a, b);
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString();

// — капсулы: валидация
t('короткий текст', (await createCapsule(a, { text: 'a', openAt: day(5) })).error === 'bad_text');
t('дата в прошлом', (await createCapsule(a, { text: 'привет себе', openAt: day(-1) })).error === 'too_soon');
t('меньше часа', (await createCapsule(a, { text: 'привет себе', openAt: new Date(Date.now() + 600_000).toISOString() })).error === 'too_soon');
t('дальше 10 лет', (await createCapsule(a, { text: 'привет себе', openAt: day(4000) })).error === 'too_far');
t('мусорная дата', (await createCapsule(a, { text: 'привет себе', openAt: 'завтра' })).error === 'bad_date');
t('не другу', (await createCapsule(a, { text: 'привет не другу', openAt: day(5), to: c })).error === 'not_friend');
const self = await createCapsule(a, { text: 'Письмо себе из прошлого', title: 'Секрет', openAt: day(30), locked: true }); t('капсула себе', !!self.id);
const fr = await createCapsule(a, { text: 'Другу: помнишь?', openAt: day(10), to: b }); t('капсула другу', !!fr.id);

// — запечатанное никто не читает
let la = await listCapsules(a), lb = await listCapsules(b);
t('автор видит запечатанные без текста', la.sealed.length === 2 && la.sealed.every((x) => x.text === undefined && x.title === undefined), JSON.stringify(la.sealed[0]));
t('получатель видит факт, но не текст', lb.sealed.length === 1 && lb.sealed[0].text === undefined && lb.sealed[0].peer.id === a);
t('чужой ничего не видит', (await listCapsules(c)).sealed.length === 0);
t('в БД текст зашифрован', !(await query('SELECT text_enc FROM time_capsules WHERE id = $1', [self.id])).rows[0].text_enc.includes('Письмо'));

// — отмена
t('locked не отменить', (await cancelCapsule(a, self.id)).error === 'locked');
t('чужую не отменить', (await cancelCapsule(b, fr.id)).error === 'not_found');
const tmp = await createCapsule(a, { text: 'отменяемая', openAt: day(3) });
t('отмена своей незапечатанной намертво', (await cancelCapsule(a, tmp.id)).ok === true);
t('повторная отмена', (await cancelCapsule(a, tmp.id)).error === 'not_sealed');

// — вскрытие: раньше срока нельзя, после — можно
t('до срока не вскрывается', (await openDue()).filter((id) => id === fr.id).length === 0);
await query(`UPDATE time_capsules SET open_at = now() - interval '1 minute', created_at = now() - interval '2 days' WHERE id = ANY($1)`, [[self.id, fr.id]]);
const opened = await openDue();
t('после срока вскрылись обе', opened.includes(self.id) && opened.includes(fr.id));
t('повторно не вскрывается', (await openDue()).length === 0);
la = await listCapsules(a); lb = await listCapsules(b);
t('получатель читает текст', lb.opened.length === 1 && lb.opened[0].text === 'Другу: помнишь?');
t('автор себе читает', la.opened.some((x) => x.text === 'Письмо себе из прошлого' && x.title === 'Секрет'));
t('автор читает вскрытую другу', la.opened.some((x) => x.text === 'Другу: помнишь?'));
t('чужой всё ещё не читает', (await listCapsules(c)).opened.length === 0);
t('вскрытую не отменить', (await cancelCapsule(a, fr.id)).error === 'not_sealed');
t('уведомление о вскрытии', (await query(`SELECT count(*)::int AS n FROM gift_notifications WHERE user_id = $1 AND kind = 'capsule_open'`, [b])).rows[0].n === 1);

// — лимиты (гонка: параллельные создания не обходят предел)
const many = await Promise.all(Array.from({ length: 14 }, (_, i) => createCapsule(b, { text: `капсула ${i}`, openAt: day(20 + i) })));
t('не больше 10 в сутки при гонке', many.filter((r) => r.id).length === 10 && many.filter((r) => r.error === 'daily_limit').length === 4, JSON.stringify(many.map((r) => r.error || 'ok')));

// — Sky Balance
t('учёт выключен по умолчанию', (await getBalance(a)).tracking === false);
t('пока выключен — не пишет', (await addUsage(a, [{ module: 'music', sec: 60 }])).skipped === true);
t('плохой лимит', (await saveBalance(a, { tracking: true, dailyTotal: 2 })).error === 'bad_value');
t('тихие часы парой', (await saveBalance(a, { tracking: true, quietFrom: 1380 })).error === 'quiet_both');
const sv = await saveBalance(a, { tracking: true, dailyTotal: 120, limits: { music: 30, 'bad key!': 10, video: 45 }, quietFrom: 1380, quietTo: 420, tzOffset: 180 });
t('настройки сохранены', sv.ok && sv.dailyTotal === 120 && sv.limits.music === 30 && sv.limits.video === 45 && !('bad key!' in sv.limits) && sv.quietFrom === 1380 && sv.tzOffset === 180);
await addUsage(a, [{ module: 'music', sec: 100 }, { module: 'music', sec: 500 }, { module: 'video', sec: 50 }, { module: 'BAD MODULE', sec: 10 }, { module: 'x', sec: -5 }]);
let rep = await usageReport(a, 7);
t('сумма: 100 + 120 (потолок пачки) + 50', rep.total === 270 && rep.todayTotal === 270, JSON.stringify(rep));
t('разделы по убыванию', rep.byModule[0].module === 'music' && rep.byModule[0].seconds === 220 && rep.byModule.length === 2);
t('семь дней в отчёте', rep.byDay.length === 7 && rep.byDay[6].seconds === 270);
t('чужие данные отдельно', (await usageReport(b, 7)).total === 0);
const spam = await addUsage(a, Array.from({ length: 12 }, (_, i) => ({ module: `m${i}`, sec: 1 })));
const spam2 = await addUsage(a, Array.from({ length: 12 }, (_, i) => ({ module: `n${i}`, sec: 1 })));
await addUsage(a, Array.from({ length: 12 }, (_, i) => ({ module: `p${i}`, sec: 1 })));
await addUsage(a, Array.from({ length: 12 }, (_, i) => ({ module: `q${i}`, sec: 1 })));
t('не больше 40 разных разделов в сутки', (await query(`SELECT count(*)::int AS n FROM time_usage WHERE profile_id = $1`, [a])).rows[0].n <= 40);
await clearUsage(a); t('очистка', (await usageReport(a, 7)).total === 0);

// — «В этот день»
const old = new Date(); old.setUTCFullYear(old.getUTCFullYear() - 2);
await query(`INSERT INTO bloom_posts (id, author_id, kind, body, created_at) VALUES ($1,$2,'text','Старый пост',$3)`, [`bp-st-${sfx}`, a, old.toISOString()]);
await query(`UPDATE profiles SET created_at = $2 WHERE id = $1`, [a, old.toISOString()]);
await query(`UPDATE friendships SET created_at = $3 WHERE a_id = $1 AND b_id = $2`, [...(a < b ? [a, b] : [b, a]), old.toISOString()]);
const td = await thisDay(a);
t('пост', td.items.some((i) => i.kind === 'post' && i.text === 'Старый пост' && i.year === old.getUTCFullYear()));
t('регистрация', td.items.some((i) => i.kind === 'registered'));
t('друг', td.items.some((i) => i.kind === 'friend' && i.peer.id === b));
t('чужие данные не попадают', (await thisDay(c)).items.length === 0);
t('сегодняшнее не показывается как прошлое', !td.items.some((i) => i.year >= new Date().getUTCFullYear()));
t('мусорная дата — сегодня', typeof (await thisDay(a, 'abc')).date === 'string');

console.log(`ok ${ok}, fail ${bad}`); await pool.end(); process.exit(bad ? 1 : 0);
