// Квитанции администратору: каждое его действие приходит ему же в «Уведомления», даже когда он делает его сам.
// (. env.sh; node scripts/audit/selfnotify-test.mjs <каталог>) — API с ADMIN_GATE=off OWNER_USERNAME=ownertest
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'snown'); q(`update profiles set username='ownertest', is_admin=true, admin_role='super_admin' where id='${own.pid}'`);
const adm = await mkuser(S, 'snadm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm.pid}'`);
const usr = await mkuser(S, 'snusr');
q(`delete from gift_notifications where user_id in ('${own.pid}','${adm.pid}','${usr.pid}')`);
const self = (u) => Number(q(`select count(*) from gift_notifications where user_id='${u.pid}' and kind='admin_self'`));
const selfBodies = (u) => q(`select body from gift_notifications where user_id='${u.pid}' and kind='admin_self'`);
const mod = (u, closed) => call('/api/admin/modules/music', { method: 'PUT', body: JSON.stringify({ closed, reason: 'тест' }) }, u.tok);
const scan = (u) => call('/api/admin/resources/disk-scan', { method: 'POST', body: '{}' }, u.tok);

await mod(adm, true); await sleep(700);
t('администратор получает квитанцию о своём действии (через журнал администрации)', self(adm) === 1, selfBodies(adm));
t('в квитанции есть суть действия', /module closed|module_closed|music/.test(selfBodies(adm)), selfBodies(adm));
await mod(adm, false); await sleep(500);
t('каждое следующее действие — своя квитанция', self(adm) === 2);

const before = self(adm); await scan(adm); await sleep(700);
t('действие без записи в logAdmin (HTTP-ручка админки) тоже даёт квитанцию', self(adm) === before + 1, selfBodies(adm));
t('квитанция HTTP-уровня называет маршрут', /disk-scan/.test(selfBodies(adm)));

await mod(own, true); await sleep(500);
t('владельцу о его собственном действии квитанция тоже приходит', self(own) === 1, selfBodies(own));
await mod(own, false); await sleep(300);

// Владелец с режимом «Все действия» + «Мои действия»: видит действия как admin_action, без дубля квитанцией.
await call('/api/owner/notify-prefs', { method: 'PUT', body: JSON.stringify({ mode: 'all', inApp: true, push: false, includeOwn: true }) }, own.tok);
const s0 = self(own); const a0 = Number(q(`select count(*) from gift_notifications where user_id='${own.pid}' and kind='admin_action'`));
await mod(own, true); await sleep(600); await mod(own, false); await sleep(300);
t('при «Мои действия» нет дубля: приходит admin_action, а не admin_self', self(own) === s0 && Number(q(`select count(*) from gift_notifications where user_id='${own.pid}' and kind='admin_action'`)) > a0);
const o1 = Number(q(`select count(*) from gift_notifications where user_id='${own.pid}' and kind='admin_action'`));
await mod(adm, true); await sleep(600); await mod(adm, false); await sleep(300);
t('действия другого администратора владелец по-прежнему получает', Number(q(`select count(*) from gift_notifications where user_id='${own.pid}' and kind='admin_action'`)) > o1);
await call('/api/owner/notify-prefs', { method: 'PUT', body: JSON.stringify({ mode: 'requests', inApp: true, push: true }) }, own.tok);

const sa = self(adm);
await call('/api/admin/modules/music', { method: 'PUT', body: JSON.stringify({ closed: true }) }, adm.tok); // без причины — отказ
await sleep(400);
t('отклонённый запрос (400) квитанцией не считается', self(adm) === sa);
t('обычный человек квитанций не получает', self(usr) === 0);
await call('/api/admin/modules', {}, usr.tok);
t('запрос обычного человека к админке ничего не создаёт', self(usr) === 0);
q(`update gift_notifications set read_at=now() where user_id='${adm.pid}'`);
const gate = await call('/api/admin/gate', {}, adm.tok); await sleep(300);
t('служебные запросы шлюза входа не считаются действиями', self(adm) === Number(q(`select count(*) from gift_notifications where user_id='${adm.pid}' and kind='admin_self'`)));
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
