// Sky GO этап 6: таблица состояний, котировки (фиксация цены), распределение заказов такси предложениями, ручное назначение, метрики.
// Запуск: API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000 (. env.sh; node scripts/audit/go-dispatch-test.mjs <каталог с api.log>)
// Нужны города/тарифы такси в настройках Sky GO (их создаёт go-test.mjs; здесь при отсутствии задаются сами).
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { transitionAllowed, nextStates, terminal, hasMachine } from '../../server/gostate.mjs';
import { tariffVersion, fingerprint } from '../../server/gopricing.mjs';
import { scoreOf } from '../../server/godispatch.mjs';
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

/* ═══ Таблица состояний (без сервера) ═══ */
t('машина состояний есть у такси и доставки, нет у еды/жилья', hasMachine('taxi') && hasMachine('delivery') && !hasMachine('food') && !hasMachine('stay'));
t('такси: допустимый путь searching→assigned→en_route→arrived→in_ride→awaiting_payment→payment_reported→paid',
  ['assigned', 'en_route', 'arrived', 'in_ride', 'awaiting_payment', 'payment_reported', 'paid'].every((to, i, a) => transitionAllowed('taxi', i ? a[i - 1] : 'searching', to)));
t('такси: нельзя перепрыгнуть searching→in_ride, assigned→paid, in_ride→cancelled', !transitionAllowed('taxi', 'searching', 'in_ride') && !transitionAllowed('taxi', 'assigned', 'paid') && !transitionAllowed('taxi', 'in_ride', 'cancelled'));
t('такси: из paid и cancelled выхода нет', terminal('taxi', 'paid') && terminal('taxi', 'cancelled') && nextStates('taxi', 'paid').length === 0);
t('любой незавершённый заказ можно оспорить, завершённый — нет', transitionAllowed('taxi', 'assigned', 'dispute') && !transitionAllowed('taxi', 'paid', 'dispute') && transitionAllowed('delivery', 'delivering', 'dispute'));
t('спор решает только в paid/cancelled', transitionAllowed('delivery', 'dispute', 'paid') && transitionAllowed('delivery', 'dispute', 'cancelled') && !transitionAllowed('delivery', 'dispute', 'searching'));
t('доставка: путь по порядку, с пропуском нельзя', transitionAllowed('delivery', 'at_pickup', 'picked_up') && !transitionAllowed('delivery', 'assigned', 'picked_up') && !transitionAllowed('delivery', 'picked_up', 'cancelled'));
t('повтор того же статуса — не переход', transitionAllowed('taxi', 'assigned', 'assigned'));
t('версия тарифа стабильна и чувствительна к цифрам', tariffVersion({ a: { base: 1, perKm: 2 } }) === tariffVersion({ a: { perKm: 2, base: 1 } }) && tariffVersion({ a: { base: 1 } }) !== tariffVersion({ a: { base: 2 } }));
t('отпечаток условий зависит от точек', fingerprint('taxi', 'М', { lat: 55, lng: 37 }, { lat: 55.1, lng: 37 }) !== fingerprint('taxi', 'М', { lat: 55, lng: 37 }, { lat: 55.2, lng: 37 }));
t('балл: ближе и дольше простаивал — лучше', scoreOf({ km: 1, misses: 0, idleMin: 30 }) < scoreOf({ km: 2, misses: 0, idleMin: 30 }) && scoreOf({ km: 3, misses: 0, idleMin: 30 }) < scoreOf({ km: 3, misses: 2, idleMin: 30 }));

/* ═══ Участники ═══ */
const mk = (tag) => mkuser(S, tag);
const A = await mk('gdAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const AF = await mk('gdDisp'); q(`update profiles set is_admin=true, admin_role='go_admin' where id='${AF.pid}'`);   // диспетчер: право go, без go_finance
const C = await mk('gdCust'); const C2 = await mk('gdCust2'); const C3 = await mk('gdCust3'); const X = await mk('gdStranger');
const D1 = await mk('gdD1'); const D2 = await mk('gdD2'); const D3 = await mk('gdD3'); const D4 = await mk('gdD4');
const drivers = [D1, D2, D3, D4];
for (const d of drivers) q(`update profiles set date_of_birth='1990-05-05' where id='${d.pid}'`);

// Города и тарифы (если go-test не задавал)
let cfg = await G('/config', {}, C.tok);
if (!cfg.data.cities?.includes(CITY)) await ADM('/settings/cities', PUT([CITY]), A.tok);
if (!Object.keys(cfg.data.taxiTariffs ?? {}).length) await ADM('/settings/taxi_tariffs', PUT({ economy: { title: 'Эконом', base: 80, perKm: 14, perMin: 4, min: 150 } }), A.tok);
cfg = await G('/config', {}, C.tok);
const TARIFF = Object.keys(cfg.data.taxiTariffs)[0];

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const gen = (len, fn) => { for (let i = 0; i < 100000; i += 1) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } throw new Error('gen'); };
const { validInn } = await import('../../server/sellerrules.mjs');
const driverSetup = async (u, plate, lat, lng) => {
  const inn = gen(12, (s) => validInn(s, { length: 12 }));
  let r = await G('/executors', J({ role: 'taxi_driver', legalForm: 'npd', city: CITY, fields: { fullName: 'Иванов Иван Иванович', inn, phone: '+79991234567' },
    extra: { carMake: 'Kia', carModel: 'Rio', carColor: 'белый', plate, licenseNumber: '7700123456', carYear: 2019, carClass: 'economy' } }), u.tok);
  const id = r.data.id;
  for (const kind of ['driver_license', 'vehicle_registration']) await call(`/api/go/executors/${id}/docs?kind=${kind}`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, u.tok);
  await G(`/executors/${id}/submit`, J({}), u.tok);
  await call(`/api/admin/go/applications/${id}/decide`, J({ action: 'approve', note: '' }), A.tok);
  q(`insert into wallet_accounts(user_id,balance) values ('${u.pid}',300) on conflict (user_id) do update set balance = wallet_accounts.balance + 300`);
  await G('/subscription/taxi_driver/buy', J({}), u.tok);
  await G('/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: '4111111111111111', holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест-банк' }) }, u.tok);
  r = await G('/presence', J({ role: 'taxi_driver', online: true, lat, lng }), u.tok);
  return r.status === 200;
};
// от точки подачи (55.760, 37.620): D1 ≈ 0,2 км, D2 ≈ 3 км, D3 ≈ 7 км, D4 ≈ 70 км (за радиусом)
t('водители допущены и на линии', (await Promise.all([
  driverSetup(D1, 'А111АА77', 55.7615, 37.6215), driverSetup(D2, 'А222АА77', 55.786, 37.64), driverSetup(D3, 'А333АА77', 55.82, 37.68), driverSetup(D4, 'А444АА77', 56.4, 37.9)])).every(Boolean));

const FROM = { address: 'Тверская 1', lat: 55.76, lng: 37.62 }; const TO = { address: 'Арбат 10', lat: 55.75, lng: 37.59 };
const body = (extra = {}) => ({ city: CITY, from: FROM, to: TO, tariff: TARIFF, ...extra });

/* ═══ Котировки: цена фиксируется ═══ */
let r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok);
const qt = r.data;
t('котировка: id, срок, версия тарифа, валюта, состав цены', r.status === 200 && /^gq-/.test(qt.quoteId) && qt.expiresAt && qt.tariffVersion?.length === 12 && qt.currency === 'RUB'
  && qt.offers[0].breakdown?.totalRub === qt.offers[0].priceRub, JSON.stringify(r.data).slice(0, 200));
const price0 = qt.offers.find((o) => o.code === TARIFF).priceRub;
r = await G('/taxi/orders', J(body({ quoteId: qt.quoteId, idemKey: `gd-${Date.now()}-1` })), C.tok);
const o1 = r.data.orderId;
t('заказ по котировке создан с той же ценой', r.status === 201 && r.data.priceRub === price0, JSON.stringify(r.data));
const pr = JSON.parse(q(`select pricing::text from go_orders where id='${o1}'`));
t('снимок расчёта в заказе: версия, id котировки, сумма, валюта, состав', pr.tariffVersion === qt.tariffVersion && pr.quoteId === qt.quoteId && pr.priceRub === price0 && pr.currency === 'RUB' && pr.breakdown?.totalRub === price0, JSON.stringify(pr));
await G(`/taxi/orders/${o1}/cancel`, J({}), C.tok);
r = await G('/taxi/orders', J(body({ quoteId: qt.quoteId })), C.tok);
t('котировка одноразовая: повторно — quote_used', r.status === 409 && r.data.error === 'quote_used', JSON.stringify(r.data));
r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok);
r = await G('/taxi/orders', J(body({ quoteId: r.data.quoteId })), X.tok);
t('чужая котировка не годится', r.status === 404 && r.data.error === 'quote_not_found', JSON.stringify(r.data));
r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok);
const qOther = r.data.quoteId;
r = await G('/taxi/orders', J(body({ quoteId: qOther, to: { address: 'Другой', lat: 55.7, lng: 37.5 } })), C.tok);
t('условия изменились (другой пункт назначения) — котировка не подходит', r.status === 409 && r.data.error === 'quote_mismatch', JSON.stringify(r.data));
q(`update go_quotes set expires_at = now() - interval '1 second' where id='${qOther}'`);
r = await G('/taxi/orders', J(body({ quoteId: qOther })), C.tok);
t('котировка просрочена — quote_expired и свежая котировка', r.status === 409 && r.data.error === 'quote_expired' && r.data.quote?.quoteId && r.data.quote.quoteId !== qOther, JSON.stringify(r.data).slice(0, 160));
// администрация меняет тариф между расчётом и заказом
r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok);
const qOld = r.data.quoteId; const oldTariffs = cfg.data.taxiTariffs;
const bumped = Object.fromEntries(Object.entries(oldTariffs).map(([k, v]) => [k, { ...v, base: v.base + 25 }]));
r = await ADM('/settings/taxi_tariffs', PUT(bumped), AF.tok);
t('диспетчер (без go_finance) тариф менять не может', r.status === 403, JSON.stringify(r.data));
r = await ADM('/settings/taxi_tariffs', PUT(bumped), A.tok);
t('тариф изменён администратором', r.status === 200, JSON.stringify(r.data));
await sleep(16000);   // кэш настроек 15 с
r = await G('/taxi/orders', J(body({ quoteId: qOld })), C.tok);
t('тариф изменился после расчёта — price_changed + свежая котировка с новой версией', r.status === 409 && r.data.error === 'price_changed' && r.data.quote?.quoteId && r.data.quote.tariffVersion !== qt.tariffVersion, JSON.stringify(r.data).slice(0, 200));
t('при отказе заказ не создан', Number(q(`select count(*) from go_orders where customer_id='${C.pid}' and status='searching'`)) === 0);
r = await G('/taxi/orders', J(body({ quoteId: r.data.quote?.quoteId })), C.tok);
t('с подтверждённой новой котировкой заказ создаётся', r.status === 201, JSON.stringify(r.data));
const oPriced = r.data.orderId;
await G(`/taxi/orders/${oPriced}/cancel`, J({}), C.tok);
await ADM('/settings/taxi_tariffs', PUT(oldTariffs), A.tok); await sleep(16000);
r = await G('/taxi/orders', J(body()), C.tok);
t('без котировки (старый клиент) заказ создаётся по текущей цене и тоже со снимком', r.status === 201 && JSON.parse(q(`select pricing::text from go_orders where id='${r.data.orderId}'`)).tariffVersion === qt.tariffVersion, JSON.stringify(r.data));
await G(`/taxi/orders/${r.data.orderId}/cancel`, J({}), C.tok);

/* ═══ Распределение предложениями ═══ */
// Остатки прошлых прогонов (водители других тестов на линии) не должны мешать: на линии остаются только D1–D4.
q(`update go_presence set online = false where profile_id not in ('${D1.pid}','${D2.pid}','${D3.pid}','${D4.pid}')`);
r = await ADM('/settings/dispatch_mode', PUT('offers'), AF.tok); t('режим распределения меняет только go_finance', r.status === 403);
for (const [k, v] of [['dispatch_mode', 'offers'], ['dispatch_offer_sec', 10], ['dispatch_max_offers', 3], ['dispatch_search_timeout_min', 20]]) { r = await ADM(`/settings/${k}`, PUT(v), A.tok); if (r.status !== 200) t(`настройка ${k}`, false, JSON.stringify(r.data)); }
r = await ADM('/settings/dispatch_offer_sec', PUT(3), A.tok); t('срок предложения вне 10–120 с отклонён', r.status === 400);
await sleep(16000);

r = await G('/taxi/orders', J(body({ idemKey: `gd-${Date.now()}-2` })), C.tok);
const oA = r.data.orderId;
await sleep(400);
let offers = q(`select driver_id||':'||status from go_order_offers where order_id='${oA}' order by id`).split('\n');
t('предложен ближайшему водителю (D1), остальным — нет', offers.length === 1 && offers[0] === `${D1.pid}:offered`, offers.join(','));
r = await G('/taxi/available', {}, D1.tok);
t('D1 видит заказ и срок предложения', r.status === 200 && r.data.orders.some((o) => o.id === oA && o.offer?.secondsLeft > 0), JSON.stringify(r.data).slice(0, 160));
r = await G('/taxi/available', {}, D2.tok);
t('D2 заказ не видит (предложен не ему)', r.status === 200 && !r.data.orders.some((o) => o.id === oA), JSON.stringify(r.data).slice(0, 160));
r = await G(`/taxi/orders/${oA}/accept`, J({}), D2.tok);
t('D2 принять чужое предложение не может', r.status === 409 && r.data.error === 'not_offered', JSON.stringify(r.data));
r = await G(`/taxi/orders/${oA}/decline`, J({}), D2.tok);
t('D2 отказаться от несуществующего предложения не может', r.status === 404 && r.data.error === 'no_offer', JSON.stringify(r.data));
r = await G(`/taxi/orders/${oA}/decline`, J({}), D1.tok);
t('D1 отказался', r.status === 200);
await sleep(400);
offers = q(`select driver_id||':'||status from go_order_offers where order_id='${oA}' order by id`).split('\n');
t('отказ → следующий по баллу (D2); D1 повторно не предлагается', offers.length === 2 && offers[1] === `${D2.pid}:offered` && offers[0] === `${D1.pid}:declined`, offers.join(','));
r = await G('/taxi/available', {}, D1.tok);
t('D1 после отказа заказ не видит', !r.data.orders.some((o) => o.id === oA), JSON.stringify(r.data).slice(0, 120));
// D2 не отвечает: срок 10 с + уборка раз в 10 с; ждём, пока появится предложение D3, и действуем сразу (оно живёт 10 с)
for (let i = 0; i < 70; i += 1) { if (Number(q(`select count(*) from go_order_offers where order_id='${oA}' and status='offered' and driver_id='${D3.pid}'`)) === 1) break; await sleep(500); }
offers = q(`select driver_id||':'||status from go_order_offers where order_id='${oA}' order by id`).split('\n');
t('D2 не ответил → предложение истекло, следующему (D3)', offers.length === 3 && offers[1] === `${D2.pid}:expired` && offers[2] === `${D3.pid}:offered`, offers.join(','));
r = await G(`/taxi/orders/${oA}/accept`, J({}), D2.tok);
t('истёкшее предложение принять нельзя', r.status === 409 && ['not_offered', 'offer_expired'].includes(r.data.error), JSON.stringify(r.data));
t('D4 за радиусом предложение не получал', Number(q(`select count(*) from go_order_offers where order_id='${oA}' and driver_id='${D4.pid}'`)) === 0);
// два одновременных принятия предложения: ровно одно
const race = await Promise.all([G(`/taxi/orders/${oA}/accept`, J({}), D3.tok), G(`/taxi/orders/${oA}/accept`, J({}), D3.tok)]);
t('двойное нажатие: одно принято, второе отклонено', race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 409).length === 1, race.map((x) => x.status + (x.data.error ?? '')).join(','));
const row = q(`select status||'|'||executor_id from go_orders where id='${oA}'`);
t('заказ назначен ровно D3', row === `assigned|${D3.pid}`, row);
t('предложение помечено принятым, других открытых нет', q(`select count(*) from go_order_offers where order_id='${oA}' and status='accepted'`) === '1' && q(`select count(*) from go_order_offers where order_id='${oA}' and status='offered'`) === '0');
r = await G('/taxi/orders/' + oA + '/act', J({ action: 'release' }), D3.tok);
t('водитель отказался до поездки → поиск продолжается', r.status === 200);
await sleep(600);
offers = q(`select driver_id||':'||status from go_order_offers where order_id='${oA}' order by id`).split('\n');
t('после отказа попытки исчерпаны (3 из 3) → заказ уходит в общий пул, отказавшемуся не предлагается', offers.length === 3 && q(`select dispatch_state from go_orders where id='${oA}'`) === 'pool' && q(`select status from go_orders where id='${oA}'`) === 'searching', offers.join(','));

/* журнал решений, диспетчерский экран, метрики */
r = await ADM(`/dispatch/orders/${oA}/log`, {}, AF.tok);
t('журнал распределения: предложения со счётом и причинами', r.status === 200 && r.data.offers.length >= 3 && r.data.offers[0].reasons.km >= 0 && r.data.log.some((l) => l.event === 'offer') && r.data.log.some((l) => l.event === 'offer_accepted'), JSON.stringify(r.data).slice(0, 200));
r = await ADM(`/dispatch/orders/${oA}/log`, {}, X.tok);
t('журнал распределения закрыт для обычных людей', r.status === 403);
r = await ADM('/dispatch/board', {}, AF.tok);
t('диспетчерский экран: заказы, режим, водители на линии', r.status === 200 && r.data.mode === 'offers' && r.data.orders.some((o) => o.id === oA) && r.data.onlineDrivers[CITY] >= 3, JSON.stringify(r.data).slice(0, 200));
r = await ADM('/dispatch/board', {}, X.tok); t('диспетчерский экран закрыт для обычных людей', r.status === 403);
r = await ADM('/dispatch/metrics?hours=24', {}, AF.tok);
t('метрики: предложения по статусам, доля принятых, время ответа', r.status === 200 && r.data.offers.total >= 4 && r.data.offers.accepted >= 1 && r.data.offers.declined >= 1 && r.data.offers.expired >= 1 && r.data.offers.acceptRate >= 0 && r.data.orders.created >= 1, JSON.stringify(r.data));

/* отмена заказчиком гасит предложения */
await G(`/taxi/orders/${oA}/cancel`, J({}), C.tok);
t('отмена заказчиком отзывает открытые предложения', q(`select count(*) from go_order_offers where order_id='${oA}' and status='offered'`) === '0');

/* свежесть положения: связь потеряна → не кандидат */
q(`update go_presence set updated_at = now() - interval '20 minutes' where profile_id in ('${D1.pid}','${D2.pid}','${D3.pid}')`);
r = await G('/taxi/orders', J(body({ idemKey: `gd-${Date.now()}-3` })), C2.tok);
const oB = r.data.orderId; await sleep(400);
t('все допустимые водители потеряли связь → кандидатов нет, заказ уходит в общий пул', q(`select dispatch_state from go_orders where id='${oB}'`) === 'pool' && q(`select count(*) from go_order_offers where order_id='${oB}'`) === '0', q(`select dispatch_state from go_orders where id='${oB}'`));
q(`update go_presence set updated_at = now() where profile_id in ('${D1.pid}','${D2.pid}','${D3.pid}')`);
r = await G('/taxi/available', {}, D2.tok);
t('из пула заказ виден водителям города', r.data.orders.some((o) => o.id === oB));

/* ручное назначение */
r = await ADM(`/dispatch/orders/${oB}/assign`, J({ driverId: D2.pid, note: 'проверка' }), X.tok); t('ручное назначение — только сотрудник с правом go', r.status === 403);
r = await ADM(`/dispatch/orders/${oB}/assign`, J({ driverId: D2.pid }), AF.tok); t('ручное назначение требует причину', r.status === 400 && r.data.error === 'note_required', JSON.stringify(r.data));
r = await ADM(`/dispatch/orders/${oB}/assign`, J({ driverId: X.pid, note: 'не водитель' }), AF.tok); t('назначить не-водителя нельзя', r.status === 400 && String(r.data.error).startsWith('driver_'), JSON.stringify(r.data));
q(`update go_presence set online = false where profile_id = '${D2.pid}'`);
r = await ADM(`/dispatch/orders/${oB}/assign`, J({ driverId: D2.pid, note: 'вне линии' }), AF.tok); t('водителя не на линии назначить нельзя', r.status === 400 && r.data.error === 'driver_offline', JSON.stringify(r.data));
q(`update go_presence set online = true where profile_id = '${D2.pid}'`);
r = await ADM(`/dispatch/orders/${oB}/assign`, J({ driverId: D2.pid, note: 'клиент позвонил' }), AF.tok);
t('диспетчер назначил водителя', r.status === 200, JSON.stringify(r.data));
t('заказ назначен, статус записан в историю с причиной', q(`select status||'|'||executor_id from go_orders where id='${oB}'`) === `assigned|${D2.pid}` && q(`select count(*) from go_order_events where order_id='${oB}' and to_status='assigned' and note like '%клиент позвонил%'`) === '1');
r = await ADM(`/dispatch/orders/${oB}/assign`, J({ driverId: D1.pid, note: 'повтор' }), AF.tok); t('занятый заказ повторно назначить нельзя', r.status === 409 && r.data.error === 'bad_state', JSON.stringify(r.data));
r = await G('/taxi/orders/' + oB + '/accept', J({}), D1.tok); t('и принять его другой водитель не может', r.status === 409, JSON.stringify(r.data));
r = await G('/orders/' + oB, {}, C2.tok); t('заказчик видит назначенного водителя', r.status === 200 && r.data.order.status === 'assigned');
r = await G('/taxi/orders', J(body({ idemKey: `gd-${Date.now()}-4` })), C3.tok);
const oC = r.data.orderId; await sleep(400);
r = await ADM(`/dispatch/orders/${oC}/assign`, J({ driverId: D2.pid, note: 'занят' }), AF.tok); t('занятого водителя назначить нельзя', r.status === 409 && r.data.error === 'driver_busy', JSON.stringify(r.data));

/* пользователь не может сам менять статус / цену */
r = await call('/api/go/taxi/orders/' + oB, { method: 'PATCH', body: JSON.stringify({ status: 'paid', price_rub: 1 }) }, C2.tok);
t('PATCH статуса и цены клиентом невозможен', r.status === 404);
r = await G('/taxi/orders/' + oB + '/act', J({ action: 'complete' }), C2.tok); t('заказчик не может выполнять шаги водителя', r.status === 404);
t('цена и статус в базе не тронуты', q(`select status||'|'||(price_rub>1) from go_orders where id='${oB}'`) === 'assigned|true');

/* тайм-аут поиска: нет водителей слишком долго → отмена и уведомление */
q(`update go_orders set created_at = now() - interval '30 minutes' where id='${oC}'`);
await sleep(13000);
t('поиск дольше срока → заказ отменён «нет водителей»', q(`select status||'|'||cancel_reason from go_orders where id='${oC}'`) === 'cancelled|no_drivers', q(`select status||'|'||cancel_reason from go_orders where id='${oC}'`));
t('в истории заказа запись о причине', Number(q(`select count(*) from go_order_events where order_id='${oC}' and to_status='cancelled'`)) === 1);

/* ═══ Курьеры: котировка доставки и предложения ═══ */
const K1 = await mk('gdK1'); const K2 = await mk('gdK2'); const CD = await mk('gdCustD'); const CD2 = await mk('gdCustD2');
for (const u of [K1, K2]) q(`update profiles set date_of_birth='1990-05-05' where id='${u.pid}'`);
const courierSetup = async (u, lat, lng, transport = 'bike') => {
  const inn = gen(12, (s) => validInn(s, { length: 12 }));
  let r = await G('/executors', J({ role: 'courier', legalForm: 'npd', city: CITY, fields: { fullName: 'Иванов Иван Иванович', inn, phone: '+79991234567' }, extra: { transport } }), u.tok);
  const id = r.data.id;
  await call(`/api/go/executors/${id}/docs?kind=id_doc`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, u.tok);
  await G(`/executors/${id}/submit`, J({}), u.tok);
  await call(`/api/admin/go/applications/${id}/decide`, J({ action: 'approve', note: '' }), A.tok);
  q(`insert into wallet_accounts(user_id,balance) values ('${u.pid}',300) on conflict (user_id) do update set balance = wallet_accounts.balance + 300`);
  await G('/subscription/courier/buy', J({}), u.tok);
  await G('/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: '4111111111111111', holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест-банк' }) }, u.tok);
  r = await G('/presence', J({ role: 'courier', online: true, lat, lng }), u.tok);
  return r.status === 200;
};
t('курьеры допущены и на линии', (await Promise.all([courierSetup(K1, 55.7605, 37.6205), courierSetup(K2, 55.79, 37.65)])).every(Boolean));
q(`update go_presence set online = false where role = 'courier' and profile_id not in ('${K1.pid}','${K2.pid}')`);
const dBody = (extra = {}) => ({ scenario: 'p2p', city: CITY, from: FROM, to: TO, size: 's', parcel: { description: 'Документы', weightKg: 1, size: 's' },
  sender: { name: 'Отправитель', phone: '+79990000001' }, recipient: { name: 'Получатель', phone: '+79990000002' }, ...extra });
r = await G('/delivery/quote', J(dBody()), CD.tok);
const dq = r.data;
t('котировка доставки: id, срок, версия, цены по размерам', r.status === 200 && /^gq-/.test(dq.quoteId) && dq.expiresAt && dq.tariffVersion?.length === 12 && dq.prices.s > 0 && dq.prices.m >= dq.prices.s, JSON.stringify(r.data).slice(0, 200));
r = await G('/delivery/orders', J(dBody({ quoteId: dq.quoteId })), CD.tok);
const dOrd = r.data.orderId;
t('заказ доставки по котировке создан по той же цене, снимок сохранён', r.status === 201 && r.data.priceRub === dq.prices.s && JSON.parse(q(`select pricing::text from go_orders where id='${dOrd}'`)).quoteId === dq.quoteId, JSON.stringify(r.data));
await sleep(500);
const dOffers = q(`select driver_id||':'||status from go_order_offers where order_id='${dOrd}' order by id`).split('\n');
t('доставка предложена ближайшему курьеру (K1)', dOffers.length === 1 && dOffers[0] === `${K1.pid}:offered`, dOffers.join(','));
r = await G('/delivery/available', {}, K2.tok); t('K2 заказ не видит', !r.data.orders.some((o) => o.id === dOrd));
r = await G('/delivery/available', {}, K1.tok); t('K1 видит заказ с отсчётом', r.data.orders.some((o) => o.id === dOrd && o.offer?.secondsLeft > 0));
r = await G(`/delivery/orders/${dOrd}/accept`, J({}), K2.tok); t('K2 принять чужое предложение не может', r.status === 409 && r.data.error === 'not_offered', JSON.stringify(r.data));
r = await G(`/delivery/orders/${dOrd}/accept`, J({}), K1.tok); t('K1 принял предложение', r.status === 200, JSON.stringify(r.data));
t('заказ доставки назначен K1', q(`select status||'|'||executor_id from go_orders where id='${dOrd}'`) === `assigned|${K1.pid}`);
r = await G('/delivery/orders/' + dOrd + '/cancel', J({}), CD.tok); t('заказчик отменил', r.status === 200);
r = await G('/delivery/quote', J(dBody()), CD2.tok); const dq2 = r.data.quoteId;
const dt = (await G('/config', {}, CD2.tok)).data;
r = await ADM('/settings/delivery_tariff', PUT({ ...((await ADM('/settings', {}, A.tok)).data.settings.delivery_tariff), base: ((await ADM('/settings', {}, A.tok)).data.settings.delivery_tariff.base ?? 0) + 30 }), A.tok);
t('тариф доставки изменён', r.status === 200, JSON.stringify(r.data));
await sleep(16000);
r = await G('/delivery/orders', J(dBody({ quoteId: dq2 })), CD2.tok);
t('тариф доставки изменился после расчёта — price_changed и свежая котировка', r.status === 409 && r.data.error === 'price_changed' && r.data.quote?.quoteId && r.data.quote.tariffVersion !== dq.tariffVersion, JSON.stringify(r.data).slice(0, 200));
t('заказ при этом не создан', Number(q(`select count(*) from go_orders where customer_id='${CD2.pid}'`)) === 0);
r = await G('/delivery/orders', J(dBody({ quoteId: r.data.quote?.quoteId })), CD2.tok);
t('с новой котировкой доставка создаётся', r.status === 201, JSON.stringify(r.data));
const dOrd2 = r.data.orderId; await sleep(500);
r = await G(`/delivery/orders/${dOrd2}/cancel`, J({}), CD2.tok);
t('отмена доставки гасит предложения', r.status === 200 && q(`select count(*) from go_order_offers where order_id='${dOrd2}' and status='offered'`) === '0');
// грузовой заказ: курьеру на велосипеде не предлагается
r = await G('/delivery/quote', J(dBody({ scenario: 'cargo', body: 's', loaders: 0 })), CD2.tok);
r = await G('/delivery/orders', J(dBody({ scenario: 'cargo', body: 's', loaders: 0, quoteId: r.data.quoteId })), CD2.tok);
const cOrd = r.data.orderId; await sleep(500);
t('грузовой заказ не предложен курьерам без грузового транспорта (уходит в пул)', q(`select count(*) from go_order_offers where order_id='${cOrd}'`) === '0' && q(`select dispatch_state from go_orders where id='${cOrd}'`) === 'pool', q(`select dispatch_state from go_orders where id='${cOrd}'`));
await G(`/delivery/orders/${cOrd}/cancel`, J({}), CD2.tok);

/* возвращаем настройки */
for (const [k, v] of [['dispatch_mode', 'pool'], ['dispatch_offer_sec', 25], ['dispatch_max_offers', 5]]) await ADM(`/settings/${k}`, PUT(v), A.tok);
await G(`/taxi/orders/${oB}/cancel`, J({}), C2.tok);
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
