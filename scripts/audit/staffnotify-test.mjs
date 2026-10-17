// Оповещения сотрудников о новых очередях (server/staffnotify.mjs).  (. env.sh; API с STAFF_NOTIFY_PER_MIN=5; OWNER_USERNAME=ownertest STAFF_NOTIFY_PER_MIN=5 node scripts/audit/staffnotify-test.mjs <каталог>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const wait = (ms = 600) => new Promise((r) => setTimeout(r, ms));
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'snown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const sup = await mkuser(S, 'snsup'); const nop = await mkuser(S, 'snnop'); const fin = await mkuser(S, 'snfin'); const usr = await mkuser(S, 'snusr');
q(`update profiles set is_admin=true, admin_role='support_admin' where id='${sup.pid}'`);
q(`update profiles set is_admin=true, admin_role='skykassa_staff' where id='${fin.pid}'`);
q(`update profiles set is_admin=true, admin_role='finance_admin' where id='${nop.pid}'`);
q(`update profiles set is_admin=false where is_admin and id not in ('${sup.pid}','${fin.pid}','${nop.pid}')`); // остатки прошлых прогонов вытесняют из выборки adminsWith (LIMIT 200)
q(`delete from staff_notify_prefs`); q(`delete from gift_notifications where kind='staff_queue'`);
const cnt = (u, like = '%') => Number(q(`select count(*) from gift_notifications where user_id='${u.pid}' and kind='staff_queue' and ref_id like '${like}'`));
const put = (b, u) => call('/api/staff/notify-prefs', { method: 'PUT', body: JSON.stringify(b) }, u.tok);

// ручка настроек
t('человек не видит настройки', (await call('/api/staff/notify-prefs', {}, usr.tok)).status === 403);
let r = await call('/api/staff/notify-prefs', {}, sup.tok);
t('по умолчанию оба канала включены', r.data.inApp && r.data.push && r.data.muted.length === 0, JSON.stringify(r.data));
t('сотруднику видны только его категории', r.data.categories.some((c) => c.key === 'support') && !r.data.categories.some((c) => c.key === 'topup'));
r = await call('/api/staff/notify-prefs', {}, own.tok);
t('владельцу видны все категории', r.data.categories.some((c) => c.key === 'topup') && r.data.categories.some((c) => c.key === 'support'));
r = await put({ muted: ['nonsense', 'support'] }, sup);
t('неизвестные категории отбрасываются', r.data.muted.length === 1 && r.data.muted[0] === 'support');
await put({}, sup);

// сквозной случай: человек создаёт обращение → сотрудник поддержки и владелец получают, финансист нет
const tk = await call('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject: 'Не работает вход', body: 'Не могу войти в аккаунт, помогите пожалуйста' }) }, usr.tok);
await wait(900);
t('обращение создано', tk.status === 200 || tk.status === 201, JSON.stringify(tk.data).slice(0, 120));
t('сотрудник поддержки получил уведомление', cnt(sup) >= 1, String(cnt(sup)));
t('владелец получил уведомление', cnt(own) >= 1);
t('сотрудник без нужного права не получил', cnt(nop) === 0);
t('автор обращения не получил', cnt(usr) === 0);

// прямые вызовы ядра
const { notifyStaff } = await import('../../server/staffnotify.mjs');
await notifyStaff('topup', { title: 'T', body: 'b', dedupe: 'd1' }); await wait();
t('пополнение: финансист получил', cnt(fin, 'topup:%') === 1);
t('пополнение: сотрудник поддержки и финансист без права не получили', cnt(sup, 'topup:%') === 0 && cnt(nop, 'topup:%') === 0);
await notifyStaff('topup', { title: 'T', body: 'b', dedupe: 'd1' }); await wait();
t('повтор того же события не дублируется', cnt(fin, 'topup:%') === 1);
await notifyStaff('topup', { title: 'T', body: 'b', dedupe: 'd2', except: fin.pid }); await wait();
t('автор события исключён', cnt(fin, 'topup:%') === 1 && cnt(own, 'topup:%') === 2, `fin=${cnt(fin,'topup:%')} own=${cnt(own,'topup:%')}`);
await notifyStaff('topup', { title: 'T', body: 'b', dedupe: 'd3', skipOwner: true }); await wait();
t('skipOwner не шлёт владельцу', cnt(own, 'topup:%') === 2 && cnt(fin, 'topup:%') === 2);
await put({ muted: ['topup'] }, fin);
await notifyStaff('topup', { title: 'T', body: 'b', dedupe: 'd4' }); await wait();
t('отключённая категория не приходит', cnt(fin, 'topup:%') === 2 && cnt(own, 'topup:%') === 3);
await put({ muted: [], inApp: false, push: true }, fin);
await notifyStaff('topup', { title: 'T', body: 'b', dedupe: 'd5' }); await wait();
t('канал «Уведомления» выключен — строки нет', cnt(fin, 'topup:%') === 2);
await put({ muted: [], inApp: false, push: false }, fin);
await notifyStaff('topup', { title: 'T', body: 'b', dedupe: 'd6' }); await wait();
t('оба канала выключены — ничего', cnt(fin, 'topup:%') === 2);
await put({}, fin);
await notifyStaff('nonexistent', { title: 'T', dedupe: 'x' }); await notifyStaff('topup', { title: 'T' });
t('неизвестная категория и событие без ключа не падают', true);

// предел на человека
const lim = Number(process.env.STAFF_NOTIFY_PER_MIN ?? 30);
const before = cnt(fin, 'topup:%');
for (let i = 0; i < lim + 15; i++) await notifyStaff('topup', { title: 'T', body: 'b', dedupe: `flood${i}` });
await wait(1200);
const got = cnt(fin, 'topup:%') - before;
t(`предел: не больше ${lim + 2} строк на человека за минуту`, got <= lim + 2, String(got));
t('сверх предела — сводное сообщение', cnt(fin, 'topup:%') > before);
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
