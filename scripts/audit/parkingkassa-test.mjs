// Sky Parking: оплата через SkyKassa Business на реквизиты организации (server/parkingpay.mjs + kbiz.mjs).
// API: ADMIN_GATE=off OWNER_USERNAME=ownertest PARKING_RATE_MULT=50 KBIZ_RATE_MULT=50. (TEST_DATABASE_URL=… node scripts/audit/parkingkassa-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 240) : JSON.stringify(x).slice(0, 240)); } };
const J = (b, method = 'POST') => ({ method, body: JSON.stringify(b) });
const P = (p, o, tok) => call('/api/parking' + p, o ?? {}, tok);
const AD = (p, o, tok) => call('/api/admin/parking' + p, o ?? {}, tok);
const K = (p, o, tok) => call('/api/kbiz' + p, o ?? {}, tok);
const pub = (p, o) => call(`/api/kbiz/public${p}`, o ?? {});
const bal = (u) => Number(q(`select balance from wallet_accounts where user_id='${u.pid}'`) || 0);
const fund = (u, n) => q(`insert into wallet_accounts(user_id, balance) values ('${u.pid}', ${n}) on conflict (user_id) do update set balance=${n}`);
const pidOf = (url) => url.split('/p/')[1];

const mod = await mkuser(S, 'pkMod'); q(`update profiles set is_admin=true, admin_role='parking_admin' where id='${mod.pid}'`);
const own = await mkuser(S, 'pkOwn'), usr = await mkuser(S, 'pkUsr'), usr2 = await mkuser(S, 'pkUsr2');
let r = await P('/orgs', J({ name: 'Паркинг-Касса' }), own.tok); const org = r.data.id;
r = await P(`/orgs/${org}/lots`, J({ title: 'Двор касса', city: 'Москва', address: 'Тверская 1', lat: 55.76, lng: 37.61, spacesTotal: 2 }), own.tok); const lot = r.data.id;
r = await P(`/my/lots/${lot}/tariffs`, J({ kind: 'hourly', priceRub: 100, freeMinutes: 0, minMinutes: 15, maxMinutes: 600 }), own.tok); const tar = r.data.id;
await P(`/my/lots/${lot}/submit`, J({}), own.tok); await AD(`/lots/${lot}/approve`, J({}), mod.tok);
r = await P('/vehicles', J({ plate: 'А123ВС77' }), usr.tok); const veh = r.data.id;
r = await P('/vehicles', J({ plate: 'В777ОР99' }), usr2.tok); const veh2 = r.data.id;
fund(usr, 1000); fund(usr2, 1000); fund(own, 1000);

// 1. организация без SkyKassa не принимает оплату
r = await P(`/lots/${lot}`, null, usr.tok); t('парковка в каталоге: приём оплаты выключен', r.data.lot.acceptsPayment === false, r.data);
const idem = 'idem-' + Date.now();
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: veh, idemKey: idem }), usr.tok);
t('без SkyKassa у организации — отказ lot_not_accepting_payments', r.status >= 400 && r.data.error === 'lot_not_accepting_payments', r.data);
t('в БД ничего не создано', q(`select count(*) from parking_sessions where profile_id='${usr.pid}'`) === '0');

// 2. организация подключает SkyKassa Business
r = await K('/business', J({ name: 'Паркинг Плюс', mode: 'point', legalType: 'selfemployed', category: 'парковка', country: 'RU', description: 'Парковки', contacts: '+7 900 000-00-00' }), own.tok); t('бизнес подключён', r.data.ok, r.data);
await K('/requisites', { method: 'PUT', body: JSON.stringify({ holder: 'ИП Парков', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Парковка', instruction: 'Оплата парковки' }) }, own.tok);
await K('/subscription/buy', J({ idemKey: 'pk-sub-1' }), own.tok);
r = await K('/publish', J({ on: true }), own.tok); t('бизнес опубликован', r.status === 200, r.data);
r = await P(`/lots/${lot}`, null, usr.tok); t('теперь парковка принимает оплату', r.data.lot.acceptsPayment === true, r.data);

// 3. старт: ожидание оплаты, деньги кошелька не тронуты
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: veh }), usr.tok); t('без ключа идемпотентности отказ', r.data.error === 'idem_required');
const b0 = bal(usr);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: veh, idemKey: idem }), usr.tok);
t('старт: ждёт оплаты, ссылка на страницу оплаты', r.status === 201 && r.data.pending === true && r.data.amountRub === 200 && /\/p\/[a-z0-9]{12,}$/.test(r.data.payUrl), r.data);
const sid = r.data.sessionId, payId = r.data.paymentId, pageId = pidOf(r.data.payUrl);
t('кошелёк не тронут', bal(usr) === b0);
const par = await Promise.all([1, 2, 3].map(() => P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: veh, idemKey: idem }), usr.tok)));
t('параллельный повтор: одна сессия и та же ссылка', new Set(par.map((x) => x.data.sessionId)).size === 1 && par.every((x) => x.data.payUrl && pidOf(x.data.payUrl) === pageId) && q(`select count(*) from parking_sessions where profile_id='${usr.pid}'`) === '1', par.map((x) => x.data));
r = await P('/sessions', null, usr.tok); const ses = r.data.sessions[0];
t('сессия «ждёт оплаты», не активна, есть срок и ссылка', ses.status === 'awaiting_payment' && ses.secondsLeft === 0 && !!ses.payBy && ses.payments[0].status === 'pending' && !!ses.payments[0].payUrl, ses);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: veh, idemKey: idem + 'b' }), usr.tok); t('на той же машине вторая сессия нельзя', r.data.error === 'vehicle_in_use', r.data);
r = await pub(`/p/${pageId}`);
t('страница оплаты: сумма 200 и реквизиты организации', r.status === 200 && r.data.state === 'open' && r.data.amountRub === 200 && r.data.requisites?.value?.includes('900'), r.data);
r = await P('/sessions', null, usr2.tok); t('чужие сессии не видны', r.data.sessions.length === 0);

// 4. «Я перевёл» не включает сессию; подтверждает только организация
r = await pub(`/p/${pageId}/report`, J({ amountRub: 1, note: 'перевёл' })); t('человек сообщил о переводе', r.status === 200 && r.data.ok, r.data);
const kbPay = q(`select id from kb_payments where qr_id = (select id from kb_qr where public_id='${pageId}')`);
r = await P('/sessions', null, usr.tok); t('после «Я перевёл» сессия всё ещё ждёт организацию', r.data.sessions[0].status === 'awaiting_payment');
r = await K(`/payments/${kbPay}/confirm`, J({}), usr.tok); t('плательщик не подтверждает за организацию', r.status >= 400, r.data);
r = await K(`/payments/${kbPay}/confirm`, J({}), usr2.tok); t('посторонний не подтверждает', r.status >= 400, r.data);
r = await K('/payments', null, own.tok); t('организация видит заявку «Парковка…» на 200 ₽', r.data.payments.some((p) => p.id === kbPay && p.amountRub === 200), r.data);
r = await K(`/payments/${kbPay}/confirm`, J({}), own.tok); t('организация подтвердила поступление', r.data.status === 'confirmed', r.data);
r = await P('/sessions', null, usr.tok); const act = r.data.sessions[0];
t('сессия включилась: активна на 2 часа, оплачено 200', act.status === 'active' && act.secondsLeft > 7100 && act.paidRub === 200 && act.payments[0].status === 'paid', act);
r = await K(`/payments/${kbPay}/confirm`, J({}), own.tok); t('повторное подтверждение безопасно', r.data.duplicate === true || r.data.status === 'confirmed', r.data);
t('сессия не продлилась от повторного подтверждения', Number((await P('/sessions', null, usr.tok)).data.sessions[0].secondsLeft) < 7200);
t('кошелёк плательщика по-прежнему не тронут', bal(usr) === b0);

// 5. вместимость учитывает ожидающих оплату
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: veh2, idemKey: idem + 'c' }), usr2.tok); t('вторая машина: ждёт оплаты', r.data.pending === true, r.data); const sid2 = r.data.sessionId;
const usr3 = await mkuser(S, 'pkUsr3'); r = await P('/vehicles', J({ plate: 'С555СС55' }), usr3.tok); const veh3 = r.data.id;
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: veh3, idemKey: idem + 'd' }), usr3.tok); t('мест нет: активная + ожидающая занимают оба', r.data.error === 'lot_full', r.data);

// 6. не дождались оплаты — сессия и страница закрываются; «Я перевёл» держит сессию
q(`update parking_sessions set pay_deadline = now() - interval '1 minute' where id='${sid2}'`);
q(`update kb_qr set expires_at = now() - interval '1 minute' where id = (select kb_qr_id from parking_payments where session_id='${sid2}')`);
r = await P('/sessions', null, usr2.tok);
t('срок оплаты вышел: сессия отменена', r.data.sessions[0].status === 'cancelled' && r.data.sessions[0].payments[0].status === 'cancelled', r.data.sessions[0]);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: veh2, idemKey: idem + 'e' }), usr2.tok); t('после отмены можно начать заново', r.data.pending === true, r.data); const sid3 = r.data.sessionId; const page3 = pidOf(r.data.payUrl);
await pub(`/p/${page3}/report`, J({ amountRub: 1, note: 'перевёл' }));
q(`update parking_sessions set pay_deadline = now() - interval '1 minute' where id='${sid3}'`);
r = await P('/sessions', null, usr2.tok); t('сообщил о переводе — сессия ждёт решение организации, не отменяется', r.data.sessions[0].status === 'awaiting_payment', r.data.sessions[0]);
const kb3 = q(`select id from kb_payments where qr_id = (select id from kb_qr where public_id='${page3}')`);
r = await K(`/payments/${kb3}/cancel`, J({ comment: 'Перевода не было' }), own.tok); t('организация отклонила оплату', r.data.status === 'cancelled', r.data);
r = await P('/sessions', null, usr2.tok); t('отклонённая оплата отменяет сессию', r.data.sessions[0].status === 'cancelled', r.data.sessions[0]);

// 7. продление через кассу
r = await P(`/sessions/${sid}/extend-quote?minutes=60`, null, usr.tok); t('котировка продления 100', r.data.costRub === 100, r.data);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 60, idemKey: idem + 'x1' }), usr2.tok); t('чужую сессию не продлить', r.status === 404, r.data);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 60, idemKey: idem + 'x1' }), usr.tok); t('продление ждёт оплаты', r.data.pending === true && r.data.amountRub === 100 && !!r.data.payUrl, r.data); const extPage = pidOf(r.data.payUrl);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 60, idemKey: idem + 'x2' }), usr.tok); t('пока продление не оплачено, второе нельзя', r.data.error === 'payment_pending', r.data);
const left0 = (await P('/sessions', null, usr.tok)).data.sessions[0].secondsLeft;
await pub(`/p/${extPage}/report`, J({ amountRub: 1, note: 'перевёл' }));
const kbExt = q(`select id from kb_payments where qr_id = (select id from kb_qr where public_id='${extPage}')`);
await K(`/payments/${kbExt}/confirm`, J({}), own.tok);
const after = (await P('/sessions', null, usr.tok)).data.sessions[0];
t('подтверждённое продление добавило час', after.secondsLeft > left0 + 3500 && after.paidRub === 300, { left0, after: after.secondsLeft, paid: after.paidRub });

// 8. возврат: Sky деньги не возвращает — это согласие организации
const kassaPay = after.payments.find((p) => p.kind === 'start').id;
r = await P(`/payments/${kassaPay}/refund`, J({ reason: 'Уехал сразу' }), usr.tok); t('запрос на возврат создан', r.data.ok, r.data);
const refundId = q(`select id from parking_refunds where payment_id='${kassaPay}'`);
const bOwn = bal(own), bUsr = bal(usr);
r = await P(`/refunds/${refundId}/approve`, J({ note: 'Согласовано, переведу сам' }), own.tok); t('организация одобрила возврат', r.data.ok, r.data);
t('деньги кошелька НЕ созданы и не списаны', bal(usr) === bUsr && bal(own) === bOwn, { usr: [bUsr, bal(usr)], own: [bOwn, bal(own)] });
t('оплата в SkyKassa помечена возвращённой', q(`select status from kb_payments where id='${kbPay}'`) === 'refunded');
t('платёж парковки — возвращён', q(`select status from parking_payments where id='${kassaPay}'`) === 'refunded');

console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
