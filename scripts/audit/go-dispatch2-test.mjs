// Sky GO: доставка в диспетчерской — автоотмена «курьер не найден», экран диспетчера, ручное назначение курьера. API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const ADM = (path, o, tok) => call('/api/admin/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const PUT = (b) => ({ method: 'PUT', body: JSON.stringify({ value: b }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITY = 'Москва';
const { validInn } = await import('../../server/sellerrules.mjs');
const gen = (len, fn) => { for (let i = 0; i < 100000; i += 1) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

const A = await mkuser(S, 'd2Adm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const D = await mkuser(S, 'd2Disp'); q(`update profiles set is_admin=true, admin_role='go_admin' where id='${D.pid}'`);
const C = await mkuser(S, 'd2Cust'); const K = await mkuser(S, 'd2Cour'); const K2 = await mkuser(S, 'd2Cour2');
for (const u of [K, K2]) q(`update profiles set date_of_birth='1990-05-05' where id='${u.pid}'`);
const cfg = await G('/config', {}, C.tok);
if (!cfg.data.cities?.includes(CITY)) await ADM('/settings/cities', PUT([CITY]), A.tok);
await ADM('/settings/delivery_tariff', PUT({ base: 100, perKm: 20, minRub: 150, foodBase: 50, foodPerKm: 10, foodMin: 100, sizeSurcharge: { s: 0, m: 50, l: 150 } }), A.tok);
for (const [k, v] of [['dispatch_mode', 'pool'], ['dispatch_search_timeout_min', 20]]) await ADM(`/settings/${k}`, PUT(v), A.tok);
q(`delete from go_zones`);
const courierSetup = async (u, lat, lng) => {
  const inn = gen(12, (s) => validInn(s, { length: 12 }));
  let r = await G('/executors', J({ role: 'courier', legalForm: 'npd', city: CITY, fields: { fullName: 'Иванов Иван Иванович', inn, phone: '+79991234567' }, extra: { transport: 'bike' } }), u.tok);
  const id = r.data.id;
  await call(`/api/go/executors/${id}/docs?kind=id_doc`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, u.tok);
  await G(`/executors/${id}/submit`, J({}), u.tok);
  await call(`/api/admin/go/applications/${id}/decide`, J({ action: 'approve', note: '' }), A.tok);
  q(`insert into wallet_accounts(user_id,balance) values ('${u.pid}',300) on conflict (user_id) do update set balance = wallet_accounts.balance + 300`);
  await G('/subscription/courier/buy', J({}), u.tok);
  await G('/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: '4111111111111111', holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест-банк' }) }, u.tok);
  return (await G('/presence', J({ role: 'courier', online: true, lat, lng }), u.tok)).status === 200;
};
t('курьеры допущены', (await Promise.all([courierSetup(K, 55.7605, 37.6205), courierSetup(K2, 55.79, 37.65)])).every(Boolean));
q(`update go_presence set online = false where role = 'courier' and profile_id <> '${K.pid}' and profile_id <> '${K2.pid}'`);
// второй курьер сначала не на линии: ручное назначение на него должно отказать
q(`update go_presence set online = false where profile_id = '${K2.pid}'`);

const FROM = { address: 'Тверская 1', lat: 55.76, lng: 37.62 }; const TO = { address: 'Арбат 10', lat: 55.75, lng: 37.59 };
const dBody = (extra = {}) => ({ scenario: 'p2p', city: CITY, from: FROM, to: TO, size: 's', parcel: { description: 'Документы', weightKg: 1, size: 's' },
  sender: { name: 'Отправитель', phone: '+79990000001' }, recipient: { name: 'Получатель', phone: '+79990000002' }, ...extra });

/* Экран диспетчера показывает доставку */
let r = await G('/delivery/orders', J(dBody()), C.tok); const o1 = r.data.orderId;
r = await ADM('/dispatch/board', {}, D.tok); const row = r.data.orders?.find((x) => x.id === o1);
t('диспетчерский экран показывает заказ доставки с видом', r.status === 200 && row?.kind === 'delivery' && row.status === 'searching', JSON.stringify(row));
t('на экране видно число курьеров на линии', r.data.onlineCouriers && Object.values(r.data.onlineCouriers).reduce((a, b) => a + b, 0) >= 1, JSON.stringify(r.data.onlineCouriers));

/* Ручное назначение курьера */
r = await ADM(`/dispatch/orders/${o1}/assign`, J({ driverId: K.pid }), D.tok); t('назначение без причины отклонено', r.status === 400 && r.data.error === 'note_required');
r = await ADM(`/dispatch/orders/${o1}/assign`, J({ driverId: K2.pid, note: 'клиент звонил' }), D.tok); t('курьер не на линии — назначение отклонено', r.status >= 400 && /offline/.test(r.data.error), JSON.stringify(r.data));
r = await ADM(`/dispatch/orders/${o1}/assign`, J({ driverId: K.pid, note: 'клиент звонил' }), C.tok); t('обычный человек назначать не может', r.status === 403);
r = await ADM(`/dispatch/orders/${o1}/assign`, J({ driverId: K.pid, note: 'клиент звонил' }), D.tok); t('диспетчер назначил курьера', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('заказ у курьера в статусе assigned', q(`select status||'|'||executor_id from go_orders where id='${o1}'`) === `assigned|${K.pid}`);
r = await ADM(`/dispatch/orders/${o1}/assign`, J({ driverId: K.pid, note: 'ещё раз' }), D.tok); t('повторное назначение невозможно', r.status >= 400);
r = await ADM(`/dispatch/orders/${o1}/log`, {}, D.tok); t('в журнале решений есть ручное назначение', r.data.log?.some((l) => l.event === 'manual_assign'), JSON.stringify(r.data.log));
t('курьеру пришло уведомление о заказе', Number(q(`select count(*) from go_notified where user_id='${K.pid}'`)) >= 1);
await G(`/delivery/orders/${o1}/cancel`, J({}), C.tok);

/* Автоотмена: курьер не найден */
q(`update go_presence set online = false where role = 'courier'`);
r = await G('/delivery/orders', J(dBody()), C.tok); const o2 = r.data.orderId;
q(`update go_orders set created_at = now() - interval '30 minutes' where id='${o2}'`);
let st = 'searching';
for (let i = 0; i < 20 && st === 'searching'; i += 1) { await sleep(1500); st = q(`select status from go_orders where id='${o2}'`); }
t('доставка без курьера за 20 минут отменена сама', st === 'cancelled' && q(`select cancel_reason from go_orders where id='${o2}'`) === 'no_couriers', st);
t('заказчику ушло одно уведомление «курьер не найден»', q(`select count(*) from go_notified where user_id='${C.pid}' and key='${o2}:no_couriers'`) === '1');

/* Не трогаем чужое: доставка еды (дочерняя) и заказ организации не отменяются таймером */
const o3 = `go-d2-${Date.now()}`;
q(`insert into go_orders (id, kind, customer_id, status, price_rub, city, data, parent_id, created_at) select '${o3}','delivery','${C.pid}','searching',100,'${CITY}','{"scenario":"food"}'::jsonb, id, now() - interval '60 minutes' from go_orders where id='${o1}'`);
await sleep(13000);
t('доставка еды (дочерняя) таймером не отменяется', q(`select status from go_orders where id='${o3}'`) === 'searching');
// отложенная доставка не считается «ищущей» — таймер её не трогает
r = await G('/delivery/orders', J(dBody({ scheduledAt: new Date(Date.now() + 5 * 3600000).toISOString() })), C.tok); const o4 = r.data.orderId;
q(`update go_orders set created_at = now() - interval '2 hours' where id='${o4}'`);
await sleep(13000);
t('запланированная доставка таймером не отменяется', q(`select status from go_orders where id='${o4}'`) === 'scheduled');

console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
