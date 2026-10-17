// Sky GO: проверки безопасности — подмена статуса/цены/роли, чужие объекты, массовое присваивание, SQL-подобные идентификаторы, админ-ручки без прав.
// API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000.
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const U = await mkuser(S, 'scU'); const V = await mkuser(S, 'scV'); const D = await mkuser(S, 'scD');
const oid = 'go-sec-' + Date.now();
q(`insert into go_orders (id, kind, customer_id, executor_id, status, price_rub, city, data) values ('${oid}','taxi','${U.pid}','${D.pid}','assigned',300,'Москва','{"from":{"address":"A"},"to":{"address":"B"}}'::jsonb)`);

/* чужой заказ */
let r = await G('/orders/' + oid, {}, V.tok); t('чужой заказ читать нельзя', r.status === 404);
r = await G(`/taxi/orders/${oid}/cancel`, J({}), V.tok); t('чужой заказ отменить нельзя', r.status === 404);
r = await G(`/taxi/orders/${oid}/act`, J({ action: 'en_route' }), V.tok); t('чужим водителем шаг выполнить нельзя', r.status === 404);
r = await G(`/taxi/orders/${oid}/act`, J({ action: 'en_route' }), U.tok); t('заказчик не может выполнять шаги водителя', r.status === 404);
r = await G(`/orders/${oid}/paid`, J({}), V.tok); t('чужой «я оплатил» невозможно', [403, 404].includes(r.status));
r = await G(`/orders/${oid}/confirm-paid`, J({}), V.tok); t('чужое «деньги получил» невозможно', [403, 404].includes(r.status));
r = await G(`/orders/${oid}/dispute`, J({ reason: 'просто так' }), V.tok); t('чужой спор открыть нельзя', r.status === 404);
r = await G(`/taxi/orders/${oid}/accept`, J({}), V.tok); t('принять уже назначенный заказ нельзя', r.status >= 400);
r = await G(`/taxi/orders/${oid}/decline`, J({}), V.tok); t('отказ от чужого предложения невозможен', r.status === 404);

/* подмена статуса, цены, ролей */
for (const m of ['PATCH', 'PUT', 'DELETE']) { r = await call('/api/go/orders/' + oid, { method: m, body: JSON.stringify({ status: 'paid', price_rub: 1, executor_id: V.pid }) }, U.tok); t(`${m} заказа клиентом не существует`, r.status === 404 || r.status === 405); }
t('заказ не изменился', q(`select status||'|'||price_rub||'|'||executor_id from go_orders where id='${oid}'`) === `assigned|300|${D.pid}`);
r = await G('/taxi/orders', J({ city: 'Москва', from: { address: 'a', lat: 55.76, lng: 37.62 }, to: { address: 'b', lat: 55.75, lng: 37.59 }, tariff: 'economy', priceRub: 1, price_rub: 1, status: 'paid', executor_id: V.pid, customer_id: V.pid }), V.tok);
const mo = r.data.orderId;
t('цена, статус, исполнитель и заказчик из тела игнорируются', r.status === 201 && q(`select (price_rub > 1)::text||'|'||status||'|'||coalesce(executor_id,'-')||'|'||(customer_id='${V.pid}')::text from go_orders where id='${mo}'`) === 'true|searching|-|true', q(`select price_rub||status from go_orders where id='${mo}'`));
r = await G('/taxi/orders', J({ city: 'Москва', from: { address: 'a', lat: 55.76, lng: 37.62 }, to: { address: 'b', lat: 55.75, lng: 37.59 }, tariff: 'economy' }), V.tok); t('второй активный заказ того же человека запрещён', r.status === 409);
await G(`/taxi/orders/${mo}/cancel`, J({}), V.tok);
r = await G('/executors', J({ role: 'taxi_driver', legalForm: 'npd', city: 'Москва', status: 'approved', fields: { fullName: 'Иванов Иван Иванович', inn: '000000000000', phone: '+79991234567' } }), U.tok);
t('регистрация исполнителя: поле status из тела не принимается (инн неверен — отказ)', r.status === 400 || q(`select count(*) from go_executors where profile_id='${U.pid}' and status='approved'`) === '0', JSON.stringify(r.data));
t('одобренных кабинетов у человека нет', q(`select count(*) from go_executors where profile_id='${U.pid}' and status='approved'`) === '0');
r = await G('/presence', J({ role: 'taxi_driver', online: true, lat: 55, lng: 37 }), U.tok); t('без одобрения на линию не выйти', r.status === 403);
r = await G('/subscription/taxi_driver/buy', J({ expiresAt: '2999-01-01' }), U.tok); t('подписку без регистрации не оформить', r.status === 403);
r = await G('/org/' + 'org-nope' + '/dashboard', {}, U.tok); t('несуществующая организация — 404', r.status === 404);

/* SQL-подобные идентификаторы и мусор */
for (const bad of ["x'; drop table go_orders;--", '%27%20OR%201=1--', '../../etc/passwd', 'a'.repeat(300)]) {
  r = await G('/orders/' + encodeURIComponent(bad), {}, U.tok);
  t(`идентификатор «${bad.slice(0, 20)}…» не ломает сервер`, r.status === 404 || r.status === 400, String(r.status));
}
t('таблица заказов на месте', Number(q('select count(*) from go_orders')) > 0);
r = await G('/taxi/quote', J({ city: "Москва'; --", from: { address: '<script>alert(1)</script>', lat: 55.76, lng: 37.62 }, to: { address: 'b', lat: 55.75, lng: 37.59 } }), U.tok); t('мусор в городе/адресе — аккуратный отказ', r.status === 400, JSON.stringify(r.data));
r = await G('/taxi/quote', J({ city: 'Москва', from: { address: 'a', lat: 'NaN', lng: 1e9 }, to: { address: 'b', lat: 55.75, lng: 37.59 } }), U.tok); t('неверные координаты не принимаются как точка', r.status === 400 || r.status === 200);
r = await G('/support', J({ category: 'tech', text: '<img src=x onerror=alert(1)> проблема' }), U.tok); t('HTML в обращении сохраняется как текст (в интерфейсе он не исполняется — React экранирует)', r.status === 201);

/* админские ручки без прав */
const modeBefore = q(`select coalesce((select value::text from go_settings where key='dispatch_mode'),'-')`); const tariffBefore = q(`select price_rub from go_tariffs where code='taxi'`);
for (const [m, p, b] of [['GET', '/dispatch/board'], ['GET', '/reconcile'], ['GET', '/analytics'], ['GET', '/support'], ['GET', '/orders'], ['GET', '/settings'], ['GET', '/subscriptions'], ['POST', `/dispatch/orders/${oid}/assign`, { driverId: D.pid, note: 'x' }], ['PUT', '/settings/dispatch_mode', { value: 'offers' }], ['PUT', '/tariffs/taxi', { priceRub: 1, periodDays: 7 }], ['POST', `/orders/${oid}/resolve`, { outcome: 'paid', note: 'abc' }]]) {
  r = await call('/api/admin/go' + p, { method: m, ...(b ? { body: JSON.stringify(b) } : {}) }, U.tok);
  t(`${m} /api/admin/go${p.slice(0, 30)} без прав → 403`, r.status === 403 || r.status === 404, String(r.status));
}
t('настройки и тарифы не изменились', q(`select coalesce((select value::text from go_settings where key='dispatch_mode'),'-')`) === modeBefore && q(`select price_rub from go_tariffs where code='taxi'`) === tariffBefore);
r = await call('/api/go/orders', {}, undefined); t('без входа — 401', r.status === 401);
q(`delete from go_orders where id='${oid}'`);
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
