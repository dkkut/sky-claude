// Sky GO «Организации», этап 3: доступ сотрудников бизнеса к разделу «Sky GO», задаток за запись через страницу оплаты.
// API: ADMIN_GATE=off GOPLACES_RATE_MULT=50 KBIZ_RATE_MULT=50   (node scripts/audit/goplaces3-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'g3own'), B = await mkuser(S, 'g3buy'), C = await mkuser(S, 'g3two'), MG = await mkuser(S, 'g3mgr'), AD = await mkuser(S, 'g3adm'), CS = await mkuser(S, 'g3csh'), MOD = await mkuser(S, 'g3mod');
q(`update profiles set is_admin=true, admin_role='go_places_moderator' where id='${MOD.pid}'`);
for (const u of [A, B, C]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const D7 = (a, b) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[a, b]]]));
const uname = (u) => q(`select username from profiles where id='${u.pid}'`);

await post(A, '/api/kbiz/business', { name: 'Студия «Лофт»', mode: 'point', legalType: 'selfemployed' });
await post(A, '/api/kbiz/place/connect', { on: true });
await put(A, '/api/kbiz/place', { categoryId: 'beauty', about: 'Студия', city: 'Москва', address: 'ул. Тестовая, 3', hours: D7('00:00', '23:59'), phone: '+7 900 000-00-03', lat: 55.75, lng: 37.61 });
await me(A, '/api/kbiz/requisites', { method: 'PUT', body: JSON.stringify({ holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' }) });
await post(A, '/api/kbiz/subscription/buy', { idemKey: 'g31' }); await post(A, '/api/kbiz/publish', { on: true });
await post(A, '/api/kbiz/place/photo', { dataUrl: png });
const svc = await post(A, '/api/kbiz/items', { title: 'Фотосессия', priceRub: 3000, kind: 'service', durationMin: 60, capacity: 1, depositRub: 500 });
const free = await post(A, '/api/kbiz/items', { title: 'Консультация', priceRub: 100, kind: 'service', durationMin: 30, capacity: 1 });
let r = await post(A, '/api/kbiz/place/submit'); const bid = r.data.place?.businessId;
await post(MOD, `/api/admin/go/places/${bid}/approve`);
await put(A, '/api/kbiz/place/booking', { enabled: true, stepMin: 60, horizonDays: 14, leadMin: 0 });
t('задаток сохранён и не больше цены', q(`select deposit_rub from kb_items where id='${svc.data.id}'`) === '500' && (await post(A, '/api/kbiz/items', { title: 'Дёшево', priceRub: 100, kind: 'service', durationMin: 30, depositRub: 900 })).status === 200 && q(`select deposit_rub from kb_items where title='Дёшево' and business_id='${bid}'`) === '100');
t('отрицательный задаток отвергнут', (await post(A, '/api/kbiz/items', { title: 'X', priceRub: 100, kind: 'service', durationMin: 30, depositRub: -5 })).status === 400);

// ─── сотрудники
const inv = {};
for (const [k, u, role] of [['mg', MG, 'manager'], ['ad', AD, 'admin'], ['cs', CS, 'cashier']]) { const x = await post(A, '/api/kbiz/staff', { username: uname(u), role }); inv[k] = x.data.id; await post(u, `/api/kbiz/staff/${x.data.id}/accept`); }
t('сотрудники приглашены и приняли', Object.keys(inv).length === 3 && q(`select count(*) from kb_staff where business_id='${bid}' and status='active'`) === '3');
t('кассиру раздел «Sky GO» закрыт', (await me(CS, '/api/kbiz/place')).status === 403 && (await me(CS, '/api/kbiz/place/bookings')).status === 403);
t('посторонний не видит раздел', (await me(C, '/api/kbiz/place')).status === 404);
t('менеджер читает карточку, записи, отзывы, статистику', (await me(MG, '/api/kbiz/place')).status === 200 && (await me(MG, '/api/kbiz/place/bookings')).status === 200 && (await me(MG, '/api/kbiz/place/reviews')).status === 200 && (await me(MG, '/api/kbiz/place/stats')).status === 200);
t('менеджер не правит карточку, расписание и фото', (await put(MG, '/api/kbiz/place', { about: 'Взлом' })).status === 403 && (await put(MG, '/api/kbiz/place/booking', { enabled: false })).status === 403 && (await post(MG, '/api/kbiz/place/photo', { dataUrl: png })).status === 403);
t('менеджер не подключает и не отключает', (await post(MG, '/api/kbiz/place/connect', { on: false })).status === 403);
t('администратор правит карточку и расписание', (await put(AD, '/api/kbiz/place', { about: 'Студия света' })).status === 200 && (await put(AD, '/api/kbiz/place/booking', { stepMin: 60 })).status === 200);
t('но подключать/отключать — только владелец', (await post(AD, '/api/kbiz/place/connect', { on: false })).status === 403);
t('правка администратора возвращает карточку в черновик (проверяемое поле)', (await me(A, '/api/kbiz/place')).data.place.status === 'draft');
await post(AD, '/api/kbiz/place/submit'); await post(MOD, `/api/admin/go/places/${bid}/approve`);
t('действия сотрудников пишутся в журнал бизнеса', Number(q(`select count(*) from kb_audit where business_id='${bid}' and action='staff_action' and actor in ('${MG.pid}','${AD.pid}')`)) >= 3);

// ─── задаток
const day = (await me(B, `/api/go/places/${bid}/book`)).data.today; const d3 = new Date(Date.parse(day + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
const sl = (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${d3}`)).data.slots;
t('в списке услуг виден задаток', (await me(B, `/api/go/places/${bid}/book`)).data.services.find((s) => s.id === svc.data.id)?.depositRub === 500);
const ct = { name: 'Пётр', phone: '+7 911 000-11-22' };
const bk = (u, it, start, x = {}) => post(u, `/api/go/places/${bid}/book`, { itemId: it, start, contact: ct, ...x });
r = await bk(B, svc.data.id, sl[5].start, { idemKey: 'dp1' });
t('запись с задатком ждёт оплаты, есть ссылка', r.status === 201 && r.data.status === 'awaiting_payment' && r.data.depositRub === 500 && /\/p\//.test(r.data.payUrl ?? ''), JSON.stringify(r.data));
const b1 = r.data.id;
t('страница оплаты на сумму задатка', q(`select amount_rub from kb_qr where id=(select qr_id from gop_bookings where id='${b1}')`) === '500');
t('слот держится за ожидающим оплаты', (await bk(C, svc.data.id, sl[5].start)).data.error === 'slot_taken');
t('владельцу о записи без задатка не сообщали', Number(q(`select count(*) from gift_notifications where ref_id='gopb:${b1}:new'`)) === 0);
t('покупатель видит «ждёт задатка» и ссылку', (await me(B, '/api/go/places/bookings')).data.bookings.find((x) => x.id === b1)?.payUrl?.includes('/p/'));
const pid = q(`select public_id from kb_qr where id=(select qr_id from gop_bookings where id='${b1}')`);
await call(`/api/kbiz/public/p/${pid}/report`, { method: 'POST', body: JSON.stringify({ payerName: 'Пётр', amountRub: 500 }) });
const payId = q(`select id from kb_payments where qr_id=(select qr_id from gop_bookings where id='${b1}') order by created_at desc limit 1`);
t('заявка «я перевёл» принята', Boolean(payId));
t('менеджер подтверждает поступление', (await post(MG, `/api/kbiz/payments/${payId}/confirm`, {})).status === 200);
await new Promise((r2) => setTimeout(r2, 1500));
t('после подтверждения задатка запись ждёт решения организации', q(`select status from gop_bookings where id='${b1}'`) === 'requested');
t('владельцу пришло уведомление о записи (один раз)', Number(q(`select count(*) from gift_notifications where ref_id='gopb:${b1}:new'`)) === 1);
t('покупателю — о получении задатка', Number(q(`select count(*) from gift_notifications where ref_id='gopb:${b1}:paid'`)) === 1);
// просроченный неоплаченный задаток освобождает слот
r = await bk(C, svc.data.id, sl[7].start);
t('вторая запись с задатком', r.data.status === 'awaiting_payment');
q(`update gop_bookings set pay_deadline = now() - interval '1 minute' where id='${r.data.id}'`);
t('просроченный неоплаченный слот снова свободен', (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${d3}`)).data.slots.some((s) => s.start === sl[7].start));
t('и запись отменена', q(`select status from gop_bookings where id='${r.data.id}'`) === 'cancelled');
// отмена покупателем ожидающей оплаты
r = await bk(B, svc.data.id, sl[9].start); const b3 = r.data.id;
t('отмена записи до оплаты задатка', (await post(B, `/api/go/places/bookings/${b3}/cancel`)).data.status === 'cancelled');
t('страница оплаты закрыта', q(`select status from kb_qr where id=(select qr_id from gop_bookings where id='${b3}')`) === 'disabled');
// без задатка — как раньше
r = await bk(B, free.data.id, (await me(B, `/api/go/places/${bid}/slots?itemId=${free.data.id}&date=${d3}`)).data.slots[2].start);
t('услуга без задатка — сразу заявка', r.data.status === 'requested' && !r.data.payUrl);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
