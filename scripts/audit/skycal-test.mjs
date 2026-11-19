// Sky Календарь: события, повторы, приглашения, изоляция, агрегатор источников, напоминания.
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000
// Запуск: . env.sh; node scripts/audit/skycal-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { occurrences, sweepCalendar } from '../../server/skycal.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) }); const P = (o) => ({ method: 'PUT', body: JSON.stringify(o) });
const day = 864e5, iso = (n) => new Date(Date.now() + n * day).toISOString();

// чистая логика повторов
const ev = (start, repeat, end = null) => ({ starts_at: start, ends_at: end, repeat });
t('weekly: 4 вхождения за 4 недели', occurrences(ev('2026-01-05T10:00:00Z', 'weekly'), new Date('2026-02-02T00:00:00Z'), new Date('2026-02-28T00:00:00Z')).length === 4);
t('monthly: 31 января → 28 февраля', occurrences(ev('2026-01-31T10:00:00Z', 'monthly'), new Date('2026-02-01T00:00:00Z'), new Date('2026-02-28T23:00:00Z'))[0]?.toISOString().slice(0, 10) === '2026-02-28');
t('yearly: через 3 года', occurrences(ev('2023-06-15T08:00:00Z', 'yearly'), new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z')).length === 1);
t('none вне диапазона', occurrences(ev('2026-01-05T10:00:00Z', 'none'), new Date('2026-02-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z')).length === 0);
t('многодневное событие пересекает диапазон', occurrences(ev('2026-01-30T10:00:00Z', 'none', '2026-02-03T10:00:00Z'), new Date('2026-02-01T00:00:00Z'), new Date('2026-02-02T00:00:00Z')).length === 1);

const a = await mkuser(S, 'CalA'); const b = await mkuser(S, 'CalB'); const c = await mkuser(S, 'CalC');
const [lo, hi] = [a.pid, b.pid].sort(); q(`INSERT INTO friendships (a_id,b_id,requested_by,status) VALUES ('${lo}','${hi}','${a.pid}','accepted')`);
const R = (tok, f = -1, to = 40) => call(`/api/cal/range?from=${encodeURIComponent(iso(f))}&to=${encodeURIComponent(iso(to))}`, {}, tok);

t('без входа 401', (await call('/api/cal/range')).status === 401);
t('плохой диапазон 400', (await call(`/api/cal/range?from=${iso(0)}&to=${iso(200)}`, {}, a.tok)).status === 400 && (await call('/api/cal/range?from=x&to=y', {}, a.tok)).status === 400);
t('без названия — 400', (await call('/api/cal/events', J({ title: '  ', start: iso(2) }), a.tok)).status === 400);
t('плохая дата — 400', (await call('/api/cal/events', J({ title: 'Х', start: 'вчера' }), a.tok)).status === 400);
t('конец раньше начала — 400', (await call('/api/cal/events', J({ title: 'Х', start: iso(3), end: iso(2) }), a.tok)).status === 400);
const e1 = await call('/api/cal/events', J({ title: 'Созвон по Sky', notes: 'Секретная заметка', start: iso(3), end: new Date(Date.now() + 3 * day + 36e5).toISOString(), repeat: 'weekly', remindMin: 30, color: 'pink' }), a.tok);
t('событие создано', e1.status === 200 && e1.data.id?.startsWith('cal-'), JSON.stringify(e1.data)); const id = e1.data.id;
const ra = await R(a.tok); const mine = ra.data.items.filter((x) => x.ref === id);
t('повторы раскрываются по диапазону (≈5 за 40 дней)', mine.length >= 5 && mine.length <= 6, String(mine.length));
t('автор видит название и заметку', mine[0].title === 'Созвон по Sky' && mine[0].notes === 'Секретная заметка' && mine[0].mine === true);
t('в БД название и заметка зашифрованы', !q(`SELECT title_enc || coalesce(notes_enc,'') FROM cal_events WHERE id='${id}'`).includes('Секретная'));
t('чужой не видит событие', !JSON.stringify((await R(c.tok)).data).includes('Созвон по Sky'));
t('чужой не правит и не удаляет — 404', (await call(`/api/cal/events/${id}`, P({ title: 'взлом' }), c.tok)).status === 404 && (await call(`/api/cal/events/${id}`, { method: 'DELETE' }, c.tok)).status === 404);
t('подмена владельца в теле игнорируется', await (async () => { const r = await call('/api/cal/events', J({ title: 'Чужое', start: iso(4), ownerId: c.pid, owner_id: c.pid }), a.tok); return r.status === 200 && !JSON.stringify((await R(c.tok)).data).includes('Чужое'); })());

// приглашения
t('не друга пригласить нельзя — 403', (await call(`/api/cal/events/${id}/invite`, J({ ids: [c.pid] }), a.tok)).status === 403);
t('чужой не приглашает от имени автора — 404', (await call(`/api/cal/events/${id}/invite`, J({ ids: [a.pid] }), b.tok)).status === 404);
const inv = await call(`/api/cal/events/${id}/invite`, J({ ids: [b.pid] }), a.tok); t('друга пригласили', inv.status === 200 && inv.data.sent === 1, JSON.stringify(inv.data));
t('приглашённый получил уведомление', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${b.pid}' AND kind='cal_invite'`)) === 1);
const pi = await call('/api/cal/invites', {}, b.tok); t('в списке приглашений', pi.data.invites.length === 1 && pi.data.invites[0].title === 'Созвон по Sky');
const rb = await R(b.tok); const bi = rb.data.items.find((x) => x.ref === id); t('приглашённый видит событие с пометкой pending', bi?.invite === 'pending' && bi.mine === false);
t('посторонний respond — 404', (await call(`/api/cal/events/${id}/respond`, J({ accept: true }), c.tok)).status === 404);
t('принять', (await call(`/api/cal/events/${id}/respond`, J({ accept: true }), b.tok)).status === 200);
t('going = 1', (await R(a.tok)).data.items.find((x) => x.ref === id).going === 1);
const gl = await call(`/api/cal/events/${id}/guests`, {}, a.tok); t('список гостей', gl.data.guests.length === 1 && gl.data.guests[0].status === 'accepted');
t('чужой список гостей — 404', (await call(`/api/cal/events/${id}/guests`, {}, c.tok)).status === 404);

// напоминание: событие через 20 минут, напомнить за 30
const e2 = await call('/api/cal/events', J({ title: 'Скоро', start: new Date(Date.now() + 20 * 60000).toISOString(), remindMin: 30 }), a.tok);
await call(`/api/cal/events/${e2.data.id}/invite`, J({ ids: [b.pid] }), a.tok); await call(`/api/cal/events/${e2.data.id}/respond`, J({ accept: true }), b.tok);
await sweepCalendar(); await sweepCalendar();
t('напоминание: автору и принявшему, по разу', Number(q(`SELECT count(*) FROM gift_notifications WHERE kind='cal_remind' AND ref_id='${e2.data.id}'`)) === 2);
t('напоминание не уходит чужому', Number(q(`SELECT count(*) FROM gift_notifications WHERE kind='cal_remind' AND user_id='${c.pid}'`)) === 0);

// агрегатор: капсула себе и цель Life
await call('/api/time/capsules', J({ text: 'Привет себе', openAt: iso(10) }), a.tok);
const li = await call('/api/life/items', J({ kind: 'task', title: 'Сдать отчёт', dueAt: iso(5) }), a.tok);
const ag = (await R(a.tok)).data;
t('агрегатор: капсула без текста', ag.items.some((x) => x.source === 'capsule') && !JSON.stringify(ag).includes('Привет себе'));
t('агрегатор: срок из Sky Life', li.status !== 200 || ag.items.some((x) => x.source === 'life' && x.title === 'Сдать отчёт'), JSON.stringify(li.data).slice(0, 120));
t('все источники доступны', ag.unavailable.length === 0, JSON.stringify(ag.unavailable));
t('чужой не видит капсулу и цель', (await R(c.tok)).data.items.length === 0);
// тикет и запись для проверки SQL источников (схемы)
t('SQL всех источников выполняется на пустых данных', (await R(b.tok)).data.unavailable.length === 0);

// правка и удаление
t('правка названия', (await call(`/api/cal/events/${id}`, P({ title: 'Созвон v2' }), a.tok)).status === 200 && (await R(a.tok)).data.items.find((x) => x.ref === id).title === 'Созвон v2');
t('гость получил уведомление об изменении', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${b.pid}' AND kind='cal_changed'`)) >= 1);
t('гость «удаляет» = выходит', (await call(`/api/cal/events/${id}`, { method: 'DELETE' }, b.tok)).data.left === true && !(await R(b.tok)).data.items.some((x) => x.ref === id));
t('автор удаляет', (await call(`/api/cal/events/${id}`, { method: 'DELETE' }, a.tok)).status === 200 && !(await R(a.tok)).data.items.some((x) => x.ref === id));
t('удаление каскадом убрало приглашения', Number(q(`SELECT count(*) FROM cal_invites WHERE event_id='${id}'`)) === 0);
// предел
q(`INSERT INTO cal_events (id, owner_id, title_enc, starts_at) SELECT 'cal-bulk'||g, '${c.pid}', 'x', now() FROM generate_series(1,500) g`);
t('предел 500 событий — 409', (await call('/api/cal/events', J({ title: 'лишнее', start: iso(1) }), c.tok)).status === 409);
console.log(`ok ${ok}, fail ${bad}`); process.exit(bad ? 1 : 0);
