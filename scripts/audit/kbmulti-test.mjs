// SkyKassa Business: несколько организаций у одного владельца, переключение, изоляция данных, сотрудники привязаны к своей организации.
// API: ADMIN_GATE=off GOPLACES_RATE_MULT=50 KBIZ_RATE_MULT=50   (node scripts/audit/kbmulti-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const O = await mkuser(S, 'mo0'), M = await mkuser(S, 'mom'), X = await mkuser(S, 'mox');
for (const u of [O]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 1000, 0) on conflict (user_id) do update set balance = 1000`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const uname = (u) => q(`select username from profiles where id='${u.pid}'`);
const pay = { holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' };

t('без бизнеса новую организацию не создать', (await post(O, '/api/kbiz/organizations', { name: 'Вторая' })).status === 403);
let r = await post(O, '/api/kbiz/business', { name: 'Первая', mode: 'point', legalType: 'selfemployed' }); const b1 = r.data.id;
t('первый бизнес создан', r.status === 200 && b1);
t('повторный POST /business по-прежнему отказ', (await post(O, '/api/kbiz/business', { name: 'Ещё', mode: 'point', legalType: 'selfemployed' })).status === 409);
await me(O, '/api/kbiz/requisites', { method: 'PUT', body: JSON.stringify(pay) }); await post(O, '/api/kbiz/subscription/buy', { idemKey: 'm1' }); await post(O, '/api/kbiz/publish', { on: true });
const i1 = await post(O, '/api/kbiz/items', { title: 'Товар первой', priceRub: 100 });
// сотрудник первой
const inv = await post(O, '/api/kbiz/staff', { username: uname(M), role: 'manager' }); await post(M, `/api/kbiz/staff/${inv.data.id}/accept`);
t('менеджер видит каталог первой', (await me(M, '/api/kbiz/items')).data.items.some((x) => x.title === 'Товар первой'));
const qr1 = await post(O, '/api/kbiz/qr', { title: 'QR первой', amountRub: 50 });
await call(`/api/kbiz/public/p/${q(`select public_id from kb_qr where id='${qr1.data.qr.id}'`)}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 50, payerName: 'Пётр' }) });
const pay1 = q(`select id from kb_payments where business_id='${b1}' order by created_at desc limit 1`);

// вторая организация
r = await post(O, '/api/kbiz/organizations', { name: 'Вторая', mode: 'both', legalType: 'ip' }); const b2 = r.data.id;
t('вторая организация создана и стала текущей', r.status === 200 && (await me(O, '/api/kbiz/me')).data.business.id === b2);
r = await me(O, '/api/kbiz/organizations');
t('список организаций: две, текущая отмечена', r.data.orgs.length === 2 && r.data.orgs.find((o) => o.id === b2).current && !r.data.orgs.find((o) => o.id === b1).current, JSON.stringify(r.data));
t('данные второй изолированы (каталог пуст)', (await me(O, '/api/kbiz/items')).data.items.length === 0);
t('подписка у каждой своя: у второй её нет (QR создать нельзя)', (await post(O, '/api/kbiz/qr', { title: 'x', amountRub: 10 })).status === 402);
await me(O, '/api/kbiz/requisites', { method: 'PUT', body: JSON.stringify(pay) }); await post(O, '/api/kbiz/subscription/buy', { idemKey: 'm2' }); await post(O, '/api/kbiz/publish', { on: true });
t('подписка куплена ровно за вторую', q(`select count(*) from kb_subscriptions where business_id='${b2}'`) === '1' && q(`select count(*) from kb_subscriptions where business_id='${b1}'`) === '1');
await post(O, '/api/kbiz/items', { title: 'Товар второй', priceRub: 200 });
const qr2 = await post(O, '/api/kbiz/qr', { title: 'QR второй', amountRub: 70 });
await call(`/api/kbiz/public/p/${q(`select public_id from kb_qr where id='${qr2.data.qr.id}'`)}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 70, payerName: 'Анна' }) });
const pay2 = q(`select id from kb_payments where business_id='${b2}' order by created_at desc limit 1`);
t('у второй своя заявка на оплату, у первой — своя', pay1 && pay2 && pay1 !== pay2);

// сотрудник первой не видит и не трогает вторую, даже когда владелец сейчас во второй
t('менеджер первой видит её каталог, а не каталог второй', (await me(M, '/api/kbiz/items')).data.items.map((x) => x.title).join() === 'Товар первой');
t('менеджер первой не подтвердит платёж второй', (await post(M, `/api/kbiz/payments/${pay2}/confirm`, {})).status === 404);
t('платёж второй остался без подтверждения', q(`select status from kb_payments where id='${pay2}'`) !== 'confirmed');
t('менеджер подтверждает платёж своей первой', (await post(M, `/api/kbiz/payments/${pay1}/confirm`, {})).status === 200);
t('менеджер не переключает и не создаёт организации', (await post(M, `/api/kbiz/organizations/${b2}/switch`)).status === 403 && (await post(M, '/api/kbiz/organizations', { name: 'Взлом', mode: 'point', legalType: 'ip' })).status === 403);
t('журнал бизнеса: действие сотрудника не приписано владельцу', q(`select count(*) from kb_audit where business_id='${b1}' and actor like 'biz:%'`) === '0');
// чужой
t('посторонний не переключится на чужую организацию', (await post(X, `/api/kbiz/organizations/${b1}/switch`)).status === 403 || (await post(X, `/api/kbiz/organizations/${b1}/switch`)).status === 404);
t('владелец не переключится на несуществующую', (await post(O, '/api/kbiz/organizations/kbz-00000000-0000-0000-0000-000000000000/switch')).status === 404);
// переключение
r = await post(O, `/api/kbiz/organizations/${b1}/switch`);
t('переключение на первую', r.status === 200 && (await me(O, '/api/kbiz/me')).data.business.id === b1);
t('каталог первой снова виден владельцу', (await me(O, '/api/kbiz/items')).data.items.map((x) => x.title).join() === 'Товар первой');
t('владелец не подтвердит платёж не текущей организации', (await post(O, `/api/kbiz/payments/${pay2}/confirm`, {})).status === 404);
// Sky GO: у каждой организации своя карточка
await post(O, '/api/kbiz/place/connect', { on: true });
t('карточка Sky GO — у текущей организации', q(`select connected from gop_places where business_id='${b1}'`) === 't' && q(`select count(*) from gop_places where business_id='${b2}' and connected`) === '0');
await post(O, `/api/kbiz/organizations/${b2}/switch`);
t('у второй карточка своя, не подключена', (await me(O, '/api/kbiz/place')).data.place.connected === false);
// предел
let last; for (let i = 3; i <= 6; i++) last = await post(O, '/api/kbiz/organizations', { name: `Орг ${i}`, mode: 'point', legalType: 'ip' });
t('больше 5 организаций нельзя', last.status === 409 && last.data.error === 'too_many_orgs' && q(`select count(*) from kb_businesses where owner_id='${O.pid}'`) === '5', JSON.stringify(last.data));
t('обычный запрос ключа fn не раскрывается снаружи (biz: в профиле не принимается)', (await call('/api/kbiz/items', {}, 'bad')).status === 401);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
