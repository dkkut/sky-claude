// Sky GO этап 9: единая проверка допуска (все причины), идемпотентность подписки, сверка финансовых статусов, права.
// Запуск: API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000 (. env.sh; node scripts/audit/go-access-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { validInn } = await import('../../server/sellerrules.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const gen = (len, fn) => { for (let i = 0; i < 100000; i += 1) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } throw new Error('gen'); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const CITY = 'Москва';
const A = await mkuser(S, 'acAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const AF = await mkuser(S, 'acDisp'); q(`update profiles set is_admin=true, admin_role='go_admin' where id='${AF.pid}'`);
const D = await mkuser(S, 'acDrv'); const X = await mkuser(S, 'acStr');
q(`update profiles set date_of_birth='1990-05-05' where id='${D.pid}'`);

let r = await G('/access/taxi_driver', {}, D.tok);
t('без регистрации: одна причина not_registered + подписка + реквизиты', r.status === 200 && r.data.allowed === false && r.data.reasons.map((x) => x.code).join() === 'not_registered,subscription_required,pay_details_required', JSON.stringify(r.data));
r = await G('/access/nobody', {}, D.tok); t('неизвестная роль не принимается', r.status === 404 || r.status === 400);
const inn = gen(12, (s) => validInn(s, { length: 12 }));
r = await G('/executors', J({ role: 'taxi_driver', legalForm: 'npd', city: CITY, fields: { fullName: 'Иванов Иван Иванович', inn, phone: '+79991234567' }, extra: { carMake: 'Kia', carModel: 'Rio', carColor: 'белый', plate: 'А555АА77', licenseNumber: '7700123456', carYear: 2019, carClass: 'economy' } }), D.tok);
const id = r.data.id;
for (const kind of ['driver_license', 'vehicle_registration']) await call(`/api/go/executors/${id}/docs?kind=${kind}`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, D.tok);
await G(`/executors/${id}/submit`, J({}), D.tok);
r = await G('/access/taxi_driver', {}, D.tok);
t('заявка на проверке: причина not_approved со статусом', r.data.reasons[0].code === 'not_approved' && ['submitted', 'in_review'].includes(r.data.reasons[0].status), JSON.stringify(r.data.reasons));
await call(`/api/admin/go/applications/${id}/decide`, J({ action: 'approve', note: '' }), A.tok);
r = await G('/access/taxi_driver', {}, D.tok);
t('одобрен: остались подписка и реквизиты', r.data.reasons.map((x) => x.code).join() === 'subscription_required,pay_details_required', JSON.stringify(r.data.reasons));
// клиент не может назначить себе подписку
r = await G('/subscription/taxi_driver/buy', J({ expiresAt: '2999-01-01', priceRub: 0, paid: true }), D.tok);
t('без денег подписка не активируется, поля клиента игнорируются', r.status === 402 && r.data.error === 'insufficient_funds', JSON.stringify(r.data));
t('подписки в базе нет', q(`select count(*) from go_subscriptions where profile_id='${D.pid}'`) === '0');
q(`insert into wallet_accounts(user_id,balance) values ('${D.pid}',300) on conflict (user_id) do update set balance = wallet_accounts.balance + 300`);
const key = `acc-${Date.now()}`;
const par = await Promise.all([G('/subscription/taxi_driver/buy', J({ idemKey: key }), D.tok), G('/subscription/taxi_driver/buy', J({ idemKey: key }), D.tok), G('/subscription/taxi_driver/buy', J({ idemKey: key }), D.tok)]);
t('три одновременных платежа с одним ключом: успех у всех, но списание одно', par.every((x) => x.status === 200) && q(`select count(*) from go_subscriptions where profile_id='${D.pid}'`) === '1' && q(`select count(*) from wallet_transactions where user_id='${D.pid}' and type='go_sub'`) === '1', par.map((x) => x.status + (x.data.error ?? '')).join());
const price = Number(q(`select price_rub from go_tariffs where code='taxi'`));
t('баланс уменьшился ровно на тариф', Number(q(`select balance from wallet_accounts where user_id='${D.pid}'`)) === 300 - price, String(price));
r = await G('/access/taxi_driver', {}, D.tok);
t('подписка есть: осталась только причина реквизитов, срок указан', r.data.reasons.map((x) => x.code).join() === 'pay_details_required' && r.data.subscription.active && r.data.subscription.expiresAt, JSON.stringify(r.data));
await G('/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: '4111111111111111', holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест-банк' }) }, D.tok);
r = await G('/access/taxi_driver', {}, D.tok); t('все условия выполнены — допуск открыт', r.data.allowed === true && r.data.reasons.length === 0);
q(`update go_executors set status='suspended', review_note='проверка' where id='${id}'`);
r = await G('/access/taxi_driver', {}, D.tok); t('приостановлен администрацией — причина и пояснение', r.data.allowed === false && r.data.reasons[0].code === 'not_approved' && r.data.reasons[0].status === 'suspended' && r.data.reasons[0].note === 'проверка', JSON.stringify(r.data.reasons));
r = await G('/presence', J({ role: 'taxi_driver', online: true, lat: 55.76, lng: 37.62 }), D.tok); t('приостановленный на линию выйти не может', r.status === 403, JSON.stringify(r.data));
q(`update go_executors set status='approved' where id='${id}'`);
r = await G('/access/taxi_driver', {}, X.tok); t('чужой человек видит только своё состояние (not_registered)', r.data.reasons[0].code === 'not_registered');

/* сверка */
r = await call('/api/admin/go/reconcile', {}, X.tok); t('сверка закрыта для обычных людей', r.status === 403);
r = await call('/api/admin/go/reconcile', {}, AF.tok);
t('сверка: восемь проверок, чтение, без персональных данных', r.status === 200 && r.data.checks.length === 8 && r.data.checks.every((c) => typeof c.count === 'number' || c.error) && !/@|\+7/.test(JSON.stringify(r.data)), JSON.stringify(r.data).slice(0, 300));
const sub0 = r.data.checks.find((c) => c.code === 'subscription_without_charge');
t('честная подписка расхождений не даёт', !(sub0.sample ?? []).some((sid) => q(`select profile_id from go_subscriptions where id='${sid}'`) === D.pid));
// искусственные расхождения
const oid = 'go-recon-' + Date.now();
q(`insert into go_orders (id, kind, customer_id, executor_id, status, price_rub, city, data, completed_at) values ('${oid}','taxi','${X.pid}','${D.pid}','paid',100,'${CITY}','{}'::jsonb, now() - interval '1 hour')`);
const sid = 'gsub-recon-' + Date.now();
q(`insert into go_subscriptions (id, profile_id, role, tariff_code, price_rub, started_at, expires_at, payment_ref, created_at) values ('${sid}','${X.pid}','taxi_driver','taxi',69, now(), now() + interval '7 days', 'recon', now() - interval '1 hour')`);
r = await call('/api/admin/go/reconcile', {}, A.tok);
const c1 = r.data.checks.find((c) => c.code === 'paid_without_confirmed_payment'); const c2 = r.data.checks.find((c) => c.code === 'subscription_without_charge');
t('сверка нашла «оплачен без подтверждения»', c1.sample.includes(oid) && r.data.ok === false, JSON.stringify(c1));
t('сверка нашла подписку без списания', c2.sample.includes(sid), JSON.stringify(c2));
q(`delete from go_orders where id='${oid}'`); q(`delete from go_subscriptions where id='${sid}'`);

/* изменения тарифов подписки — только go_finance и в журнал */
r = await call('/api/admin/go/tariffs/taxi', { method: 'PUT', body: JSON.stringify({ priceRub: 70, periodDays: 7 }) }, AF.tok); t('тариф подписки диспетчер менять не может', r.status === 403);
r = await call('/api/admin/go/tariffs/taxi', { method: 'PUT', body: JSON.stringify({ priceRub: 70, periodDays: 7 }) }, A.tok); t('администратор финансов меняет', r.status === 200);
t('изменение в журнале администрации', Number(q(`select count(*) from admin_log where target_id='taxi' and type='go_tariff'`) || 0) >= 1);
await call('/api/admin/go/tariffs/taxi', { method: 'PUT', body: JSON.stringify({ priceRub: 69, periodDays: 7 }) }, A.tok);
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
