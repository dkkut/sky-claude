// Sky GO: регистрация исполнителей, подписки, такси, доставка, еда, авиабилеты, заправки, безопасность.
// Запуск: нужны API на :8080 с картами (fake-google), поставщиками из scripts/audit/fakes/go-fakes.mjs и ADMIN_GATE=off.
//   (. env.sh; node scripts/audit/go-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { validInn, validOgrn, validOgrnip } = await import('../../server/sellerrules.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 200) : JSON.stringify(x).slice(0, 200)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });

const gen = (len, fn) => { for (let i = 0; i < 100000; i += 1) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } throw new Error('gen'); };
const inn12 = () => gen(12, (s) => validInn(s, { length: 12 }));
const inn10 = () => gen(10, (s) => validInn(s, { length: 10 }));
const ogrn = () => gen(13, validOgrn);
const ogrnip = () => gen(15, validOgrnip);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const U = Date.now().toString(36);

const mk = async (tag) => mkuser(S, tag);
const wallet = (u) => Number(q(`select coalesce(balance,0) from wallet_accounts where user_id='${u.pid}'`) || 0);
const fund = (u, n) => q(`insert into wallet_accounts(user_id,balance) values ('${u.pid}',${n}) on conflict (user_id) do update set balance = wallet_accounts.balance + ${n}`);
const dob = (u, y = 1990) => q(`update profiles set date_of_birth='${y}-05-05' where id='${u.pid}'`);

const A = await mk('goAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const AF = await mk('goFin'); q(`update profiles set is_admin=true, admin_role='go_admin' where id='${AF.pid}'`);   // право go, без go_finance
const C = await mk('goCust'); const X = await mk('goStranger'); const C2 = await mk('goCust2');
const D = await mk('goDrv'); const D2 = await mk('goDrv2'); const K = await mk('goCour'); const K2 = await mk('goCour2'); const SL = await mk('goSeller'); const CO = await mk('goComp');
for (const u of [D, D2, K, K2]) dob(u);
const Y = await mk('goYoung'); dob(Y, new Date().getFullYear() - 16);

const CITY = 'Москва';
const form = { npd: () => ({ fullName: 'Иванов Иван Иванович', inn: inn12(), phone: '+79991234567' }),
  ip: () => ({ fullName: 'Петров Пётр Петрович', inn: inn12(), ogrnip: ogrnip(), phone: '+79990000001', email: 'ip@example.com' }),
  ooo: () => ({ orgName: 'ООО «Тест»', inn: inn10(), ogrn: ogrn(), orgPhone: '+74951234567', orgEmail: 'o@example.com', repName: 'Сидоров С.С.', repPosition: 'Директор', repIsHead: true }) };

/** Регистрация исполнителя целиком: черновик → документы → отправка → одобрение администратором. */
const register = async (u, role, legalForm, extra = {}, docs = []) => {
  let r = await G('/executors', J({ role, legalForm, city: CITY, fields: form[legalForm](), extra }), u.tok);
  if (r.status !== 200) return { r };
  const id = r.data.id;
  for (const kind of docs) await call(`/api/go/executors/${id}/docs?kind=${kind}`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, u.tok);
  const sub = await G(`/executors/${id}/submit`, J({}), u.tok);
  return { id, sub };
};
const approve = async (id) => call(`/api/admin/go/applications/${id}/decide`, J({ action: 'approve', note: '' }), A.tok);
const payDetails = (u) => G('/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: '4276380012345678'.replace(/./g, (c, i) => c), holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест-банк' }) }, u.tok);
const CARD = '4111111111111111';
const setCard = (u) => G('/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: CARD, holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест-банк' }) }, u.tok);

/* ═══ Регистрация ═══ */
let r = await G('/config', {}, C.tok);
t('конфиг: города и тарифы', r.status === 200 && r.data.cities.includes(CITY) && r.data.tariffs.tariffs.length === 3, JSON.stringify(r.data).slice(0, 100));
const prices = Object.fromEntries(r.data.tariffs.tariffs.map((x) => [x.code, x.priceRub]));
t('цены тарифов: общая 139, такси 69, курьер 49, 7 дней', prices.general === 139 && prices.taxi === 69 && prices.courier === 49 && r.data.tariffs.tariffs.every((x) => x.periodDays === 7), JSON.stringify(prices));
t('привязка кабинет→тариф', r.data.tariffs.roleTariff.taxi_driver === 'taxi' && r.data.tariffs.roleTariff.courier === 'courier' && r.data.tariffs.roleTariff.food_seller === 'general');

r = await G('/executors', J({ role: 'taxi_driver', legalForm: 'npd', city: CITY, fields: { fullName: 'Иванов Иван', inn: '123456789012', phone: '+79991234567' } }), D.tok);
t('НПД: неверная контрольная сумма ИНН отклонена', r.status === 400 && r.data.error === 'invalid_fields', JSON.stringify(r.data));
r = await G('/executors', J({ role: 'nobody', legalForm: 'npd' }), D.tok);
t('неизвестная роль отклонена', r.status === 400);
r = await G('/executors', J({ role: 'taxi_driver', legalForm: 'npd', city: 'Нигдеград', fields: form.npd() }), D.tok);
t('город вне списка отклонён', r.status === 400 && r.data.error === 'bad_city');

const carExtra = { carMake: 'Kia', carModel: 'Rio', carColor: 'белый', plate: 'А123ВС77', licenseNumber: '7700123456', carYear: 2019, carClass: 'economy' };
let rg = await register(D, 'taxi_driver', 'npd', carExtra, []);
t('отправка без документов отклонена', rg.sub.status === 400 && rg.sub.data.error === 'docs_missing', JSON.stringify(rg.sub.data));
r = await call(`/api/go/executors/${rg.id}/docs?kind=driver_license`, { method: 'POST', body: Buffer.from('это не документ, просто текст длиннее шестнадцати'), headers: { 'content-type': 'application/octet-stream' } }, D.tok);
t('документ не из списка типов отклонён', r.status === 400 && r.data.error === 'unsupported_type', JSON.stringify(r.data));
r = await call(`/api/go/executors/${rg.id}/docs?kind=driver_license`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, X.tok);
t('чужой заявке документ не прикрепить', r.status === 404);
for (const k of ['driver_license', 'vehicle_registration']) await call(`/api/go/executors/${rg.id}/docs?kind=${k}`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, D.tok);
q(`update profiles set date_of_birth=null where id='${D.pid}'`);
r = await G(`/executors/${rg.id}/submit`, J({}), D.tok);
t('без даты рождения отправка закрыта', r.status === 400 && r.data.error === 'dob_required', JSON.stringify(r.data));
dob(D);
r = await G(`/executors/${rg.id}/submit`, J({}), D.tok);
t('отправка с документами и датой рождения', r.status === 200 && r.data.status === 'submitted', JSON.stringify(r.data));
r = await G(`/executors/${rg.id}/submit`, J({}), D.tok);
t('повторно отправить нельзя', r.status === 409, JSON.stringify(r.data));
const young = await G('/executors', J({ role: 'courier', legalForm: 'npd', city: CITY, fields: form.npd(), extra: { transport: 'foot' } }), Y.tok);
await call(`/api/go/executors/${young.data.id}/docs?kind=id_doc`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, Y.tok);
r = await G(`/executors/${young.data.id}/submit`, J({}), Y.tok);
t('младше 18 — отказ', r.status === 400 && r.data.error === 'too_young', JSON.stringify(r.data));

/* До одобрения — нельзя ничего */
r = await G('/subscription/taxi_driver/buy', J({}), D.tok);
t('до одобрения подписку не купить', r.status === 403 && r.data.error === 'not_approved', JSON.stringify(r.data));
r = await G('/presence', J({ role: 'taxi_driver', online: true }), D.tok);
t('до одобрения на линию не выйти', r.status === 403, JSON.stringify(r.data));
r = await G('/taxi/available', {}, D.tok);
t('до одобрения заказов не видно', r.status === 403);
r = await G('/taxi/available', {}, X.tok);
t('чужому (не исполнителю) заказов не видно', r.status === 403 && r.data.error === 'not_registered');

/* Админ */
r = await call('/api/admin/go/applications', {}, C.tok);
t('очередь заявок закрыта для обычных людей', r.status === 403);
r = await call('/api/admin/go/applications', {}, A.tok);
t('очередь заявок: заявка водителя', r.status === 200 && r.data.items.some((x) => x.id === rg.id && x.status === 'submitted'), JSON.stringify(r.data).slice(0, 150));
r = await call(`/api/admin/go/applications/${rg.id}`, {}, A.tok);
t('карточка: сведения и честная пометка «реестры не сверялись»', r.status === 200 && r.data.executor.checks.registryChecked === false && r.data.executor.fields.inn && r.data.executor.docs.length === 2, JSON.stringify(r.data).slice(0, 150));
const docId = r.data.executor.docs[0].id;
r = await call(`/api/admin/go/docs/${docId}`, {}, C.tok);
t('документ обычному человеку не отдаётся', r.status === 403);
r = await fetch('http://127.0.0.1:8080/api/admin/go/docs/' + docId, { headers: { authorization: `Bearer ${A.tok}` } });
t('документ проверяющему: тип и байты, без кэша', r.status === 200 && r.headers.get('content-type') === 'image/png' && r.headers.get('cache-control') === 'no-store' && (await r.arrayBuffer()).byteLength === PNG.length);
t('просмотр документа записан в журнал', Number(q(`select count(*) from go_log where action='exec_doc_view' and actor_id='${A.pid}'`)) >= 1);
r = await call(`/api/admin/go/applications/${rg.id}/decide`, J({ action: 'reject', note: '' }), A.tok);
t('отказ без причины невозможен', r.status === 400 && r.data.error === 'note_required');
r = await call(`/api/admin/go/applications/${rg.id}/decide`, J({ action: 'needs_info', note: 'Нужен чёткий скан СТС' }), A.tok);
t('запрос сведений', r.status === 200 && r.data.status === 'needs_info', JSON.stringify(r.data));
t('заявитель получил уведомление', Number(q(`select count(*) from gift_notifications where user_id='${D.pid}' and kind='go_application'`)) >= 1);
r = await G('/executors', J({ role: 'taxi_driver', legalForm: 'npd', city: CITY, fields: form.npd(), extra: carExtra }), D.tok);
t('после запроса сведений заявку можно поправить', r.status === 200 && r.data.id === rg.id, JSON.stringify(r.data));
r = await G(`/executors/${rg.id}/submit`, J({}), D.tok);
t('и отправить повторно', r.status === 200);
r = await call(`/api/admin/go/applications/${rg.id}/decide`, J({ action: 'approve' }), AF.tok);
t('одобрение (право go)', r.status === 200 && r.data.status === 'approved', JSON.stringify(r.data));
r = await call(`/api/admin/go/applications/${rg.id}/decide`, J({ action: 'approve' }), A.tok);
t('повторное одобрение — переход невозможен', r.status === 409, JSON.stringify(r.data));

/* ═══ Подписки ═══ */
r = await G('/subscription/taxi_driver/buy', J({ idemKey: 'k1' }), D.tok);
t('нет денег — 402, подписки нет', r.status === 402 && r.data.error === 'insufficient_funds', JSON.stringify(r.data));
fund(D, 500);
r = await G('/subscription/taxi_driver/buy', J({ idemKey: 'k1' }), D.tok);
t('водитель: списано ровно 69 ₽', r.status === 200 && wallet(D) === 431, `${r.status} ${wallet(D)}`);
const exp1 = new Date(r.data.expiresAt).getTime();
t('срок — 7 суток', Math.abs(exp1 - Date.now() - 7 * 86400000) < 60000);
r = await G('/subscription/taxi_driver/buy', J({ idemKey: 'k1' }), D.tok);
t('повтор того же запроса не списывает дважды', r.status === 200 && wallet(D) === 431 && r.data.duplicate === true, `${wallet(D)}`);
r = await G('/subscription/taxi_driver/buy', J({ idemKey: 'k2' }), D.tok);
t('продление идёт от даты окончания (+7 дней)', r.status === 200 && wallet(D) === 362 && Math.abs(new Date(r.data.expiresAt).getTime() - exp1 - 7 * 86400000) < 1000, `${wallet(D)} ${r.data.expiresAt}`);
const par = await Promise.all([1, 2, 3].map((i) => G('/subscription/taxi_driver/buy', J({ idemKey: 'par' + i }), D.tok)));
t('параллельные оплаты: каждая списана ровно один раз', par.every((x) => x.status === 200) && wallet(D) === 362 - 3 * 69, String(wallet(D)));
q(`update wallet_accounts set balance = balance - 0 where user_id='${D.pid}'`);
t('списание записано в историю кошелька', Number(q(`select count(*) from wallet_transactions where user_id='${D.pid}' and type='go_sub'`)) === 5);
r = await G('/subscription/courier/buy', J({}), D.tok);
t('кабинет курьера без регистрации не купить', r.status === 403 && r.data.error === 'not_registered');

/* Реквизиты */
r = await G('/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: '1234567890123456', holder: 'Тест' }) }, D.tok);
t('карта с неверной контрольной суммой отклонена', r.status === 400 && r.data.error === 'bad_card', JSON.stringify(r.data));
r = await G('/presence', J({ role: 'taxi_driver', online: true, lat: 55.7, lng: 37.6 }), D.tok);
t('без реквизитов на линию не выйти', r.status === 400 && r.data.error === 'pay_details_required', JSON.stringify(r.data));
r = await setCard(D);
t('реквизиты сохранены', r.status === 200);
r = await G('/pay-details', {}, D.tok);
t('номер карты маскируется при чтении', r.data.details.number.endsWith('1111') && !r.data.details.number.includes('4111'), JSON.stringify(r.data));

/* ═══ Такси ═══ */
const pickup = { address: 'Москва, Тверская 1' }; const drop = { address: 'Москва, Арбат 10' };
r = await G('/taxi/quote', J({ city: CITY, from: pickup, to: pickup }), C.tok);
t('одна и та же точка — отказ', r.status === 400, JSON.stringify(r.data));
r = await G('/taxi/quote', J({ city: CITY, from: pickup, to: { address: 'нигде, на краю земли' } }), C.tok);
t('адрес не найден — честная ошибка, без выдуманных координат', r.status === 400 && /address_not_found/.test(r.data.error), JSON.stringify(r.data));
r = await G('/taxi/quote', J({ city: CITY, from: pickup, to: drop }), C.tok);
t('расчёт: тарифы с ценой с сервера', r.status === 200 && r.data.offers.length === 3 && r.data.offers.every((o) => o.priceRub > 0), JSON.stringify(r.data).slice(0, 200));
const econ = r.data.offers.find((o) => o.code === 'economy').priceRub;
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'economy', priceRub: 1, price: 1, idemKey: 'ord-' + U }), C.tok);
t('заказ: присланная клиентом цена игнорируется', r.status === 201 && r.data.priceRub === econ, JSON.stringify(r.data));
const taxiId = r.data.orderId;
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'economy', idemKey: 'ord-' + U }), C.tok);
t('повтор запроса не создаёт второй заказ', r.data.orderId === taxiId && r.data.duplicate === true, JSON.stringify(r.data));
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'economy', idemKey: 'other' }), C.tok);
t('второй активный заказ такси запрещён', r.status === 409 && r.data.error === 'active_order_exists');
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'нет-такого' }), C2.tok);
t('неизвестный тариф отклонён', r.status === 400 && r.data.error === 'bad_tariff');

r = await G('/taxi/available', {}, D.tok);
t('водитель не на линии заказов не видит', r.status === 400 && r.data.error === 'offline', JSON.stringify(r.data));
r = await G('/presence', J({ role: 'taxi_driver', online: true, lat: 55.75, lng: 37.62 }), D.tok);
t('водитель вышел на линию', r.status === 200 && r.data.online === true, JSON.stringify(r.data));
r = await G('/taxi/available', {}, D.tok);
const avail = r.data.orders?.find((o) => o.id === taxiId);
t('заказ виден водителю: адреса и цена, без данных заказчика', avail && avail.priceRub === econ && !('customer' in avail) && !('data' in avail), JSON.stringify(r.data).slice(0, 200));
r = await G(`/taxi/orders/${taxiId}/accept`, J({}), X.tok);
t('посторонний принять не может', r.status === 403);

/* второй водитель (гонка) */
const rg2 = await register(D2, 'taxi_driver', 'ip', { ...carExtra, plate: 'В777ОО77' }, ['driver_license', 'vehicle_registration']);
await approve(rg2.id); fund(D2, 100); await G('/subscription/taxi_driver/buy', J({}), D2.tok); await setCard(D2);
await G('/presence', J({ role: 'taxi_driver', online: true, lat: 55.76, lng: 37.62 }), D2.tok);
const race = await Promise.all([G(`/taxi/orders/${taxiId}/accept`, J({}), D.tok), G(`/taxi/orders/${taxiId}/accept`, J({}), D2.tok)]);
t('гонка принятия: ровно один победитель', race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 409).length === 1, race.map((x) => x.status).join(','));
const winner = race[0].status === 200 ? D : D2; const loser = winner === D ? D2 : D;
r = await G(`/taxi/orders/${taxiId}/act`, J({ action: 'start' }), winner.tok);
t('шаги по порядку: сразу «начать поездку» нельзя', r.status === 409 && r.data.error === 'bad_state', JSON.stringify(r.data));
r = await G(`/taxi/orders/${taxiId}/act`, J({ action: 'en_route' }), loser.tok);
t('чужой водитель шаги выполнять не может', r.status === 404);
for (const a of ['en_route', 'arrived', 'start']) { r = await G(`/taxi/orders/${taxiId}/act`, J({ action: a }), winner.tok); }
t('водитель: едет → прибыл → поездка началась', r.status === 200, JSON.stringify(r.data));
r = await G(`/orders/${taxiId}`, {}, C.tok);
t('заказчик видит водителя и автомобиль в заказе', r.status === 200 && r.data.order.status === 'in_ride' && r.data.order.executor?.username, JSON.stringify(r.data).slice(0, 150));
t('история статусов записана', r.data.order.events.map((e) => e.to).join(',').includes('searching,assigned,en_route,arrived,in_ride'), r.data.order.events.map((e) => e.to).join(','));
r = await G(`/orders/${taxiId}`, {}, X.tok);
t('чужой заказ неотличим от несуществующего (404)', r.status === 404);
r = await G(`/orders/${taxiId}/paid`, J({}), C.tok);
t('до завершения поездки «оплатил» нельзя', r.status === 403);
r = await G(`/taxi/orders/${taxiId}/act`, J({ action: 'complete' }), winner.tok);
t('поездка завершена → ожидается оплата', r.status === 200);
r = await G(`/orders/${taxiId}`, {}, C.tok);
t('пассажир видит реквизиты водителя и сумму', r.data.order.status === 'awaiting_payment' && r.data.order.pay.amountRub === econ && r.data.order.pay.details?.number === CARD, JSON.stringify(r.data.order.pay));
r = await G(`/orders/${taxiId}`, {}, winner.tok);
t('водитель реквизиты (как плательщику) в заказе не получает', r.data.order.pay && !r.data.order.pay.details);
r = await G(`/orders/${taxiId}/confirm-paid`, J({}), winner.tok);
t('водитель не может подтвердить оплату за пассажира', r.status === 400 && r.data.error === 'not_reported', JSON.stringify(r.data));
r = await G(`/orders/${taxiId}/paid`, J({}), winner.tok);
t('водитель не может «оплатить» за пассажира', r.status === 403);
r = await G(`/orders/${taxiId}/paid`, J({}), X.tok);
t('посторонний оплату не отмечает', r.status === 403);
r = await G(`/orders/${taxiId}/confirm-paid`, J({}), C.tok);
t('пассажир не подтверждает получение за водителя', r.status === 403);
r = await G(`/orders/${taxiId}/paid`, J({}), C.tok);
t('пассажир сообщил об оплате', r.status === 200);
r = await G(`/orders/${taxiId}/paid`, J({}), C.tok);
t('повторное «оплатил» невозможно', r.status === 409);
r = await G(`/orders/${taxiId}/confirm-paid`, J({}), winner.tok);
t('водитель подтвердил получение → оплачено', r.status === 200 && r.data.status === 'paid', JSON.stringify(r.data));
r = await G(`/orders/${taxiId}`, {}, C.tok);
t('после подтверждения реквизиты скрыты', r.data.order.status === 'paid' && !r.data.order.pay.details);
r = await G('/orders?status=history', {}, C.tok);
t('история заказов', r.data.orders.some((o) => o.id === taxiId));
r = await G('/stats/taxi_driver', {}, winner.tok);
t('статистика водителя из настоящих заказов', r.data.done === 1 && r.data.earnedRub === econ, JSON.stringify(r.data));

/* отмена и отказ водителя */
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'comfort' }), C.tok);
const t2 = r.data.orderId;
await G('/presence', J({ role: 'taxi_driver', online: true }), winner.tok);
await G(`/taxi/orders/${t2}/accept`, J({}), winner.tok);
r = await G(`/taxi/orders/${t2}/act`, J({ action: 'release' }), winner.tok);
r = await G(`/orders/${t2}`, {}, C.tok);
t('отказ водителя — заказ снова ищет водителя', r.data.order.status === 'searching' && r.data.order.executor === null, JSON.stringify(r.data.order.status));
r = await G(`/taxi/orders/${t2}/cancel`, J({ reason: 'передумал' }), X.tok);
t('чужой заказ отменить нельзя', r.status === 404);
r = await G(`/taxi/orders/${t2}/cancel`, J({ reason: 'передумал' }), C.tok);
t('пассажир отменил', r.status === 200);
r = await G(`/taxi/orders/${t2}/cancel`, J({}), C.tok);
t('отменённый второй раз не отменить', r.status === 409);

/* спор */
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'economy' }), C2.tok);
const t3 = r.data.orderId;
await G(`/taxi/orders/${t3}/accept`, J({}), winner.tok);
r = await G(`/orders/${t3}/dispute`, J({ reason: 'ок' }), C2.tok);
t('спор без внятной причины отклонён', r.status === 400);
r = await G(`/orders/${t3}/dispute`, J({ reason: 'Водитель требует доплату вне заказа' }), C2.tok);
t('спор открыт', r.status === 200);
r = await call(`/api/admin/go/orders/${t3}/resolve`, J({ outcome: 'cancelled', note: 'Отмена по спору' }), C.tok);
t('решение по спору — только администрация', r.status === 403);
r = await call(`/api/admin/go/orders/${t3}/resolve`, J({ outcome: 'cancelled', note: 'Отмена по спору' }), A.tok);
t('администрация закрыла спор', r.status === 200);
r = await call(`/api/admin/go/orders/${t3}`, {}, A.tok);
t('администрация видит заказ и историю', r.status === 200 && r.data.order.events.some((e) => e.to === 'dispute'));

/* ═══ Подписка истекает: новые заказы закрыты, история и принятое — нет ═══ */
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'economy' }), C.tok);
const t4 = r.data.orderId;
await G('/presence', J({ role: 'taxi_driver', online: true }), winner.tok);
await G(`/taxi/orders/${t4}/accept`, J({}), winner.tok);
q(`update go_subscriptions set expires_at = now() - interval '1 hour' where profile_id='${winner.pid}' and role='taxi_driver'`);
r = await G('/taxi/available', {}, winner.tok);
t('подписка истекла: новые заказы закрыты', r.status === 402 && r.data.error === 'subscription_required' && r.data.expired === true, JSON.stringify(r.data));
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'economy' }), C2.tok);
const t5 = r.data.orderId;
r = await G(`/taxi/orders/${t5}/accept`, J({}), winner.tok);
t('и принять нельзя', r.status === 402);
r = await G(`/taxi/orders/${t4}/act`, J({ action: 'en_route' }), winner.tok);
t('но по уже принятому заказу работа продолжается', r.status === 200, JSON.stringify(r.data));
r = await G('/orders?side=executor&status=history', {}, winner.tok);
t('история заказов исполнителя доступна', r.status === 200 && r.data.orders.length >= 1);
r = await G('/subscription/taxi_driver', {}, winner.tok);
t('состояние подписки: истекла, есть история продлений', r.data.subscription.expired === true && r.data.history.length >= 1);
r = await G('/presence', J({ role: 'taxi_driver', online: true }), winner.tok);
t('с истёкшей подпиской на линию не выйти', r.status === 402);
await G(`/taxi/orders/${t4}/cancel`, J({}), C.tok); await G(`/taxi/orders/${t5}/cancel`, J({}), C2.tok);
await G('/subscription/taxi_driver/buy', J({}), winner.tok);

/* ═══ Курьер и доставка ═══ */
const rk = await register(K, 'courier', 'npd', { transport: 'bike' }, ['id_doc']);
await approve(rk.id); fund(K, 300);
r = await G('/subscription/courier/buy', J({}), K.tok);
t('курьер: списано 49 ₽ (не 139)', r.status === 200 && wallet(K) === 251, String(wallet(K)));
await setCard(K);
await G('/presence', J({ role: 'courier', online: true, lat: 55.75, lng: 37.62 }), K.tok);
const parcel = { description: 'Документы', weightKg: 1, size: 's' };
const rec = { name: 'Получатель Р.', phone: '+79995550000' }; const snd = { name: 'Отправитель О.', phone: '+79995551111' };
r = await G('/delivery/orders', J({ scenario: 'company', city: CITY, from: pickup, to: drop, parcel, recipient: rec, sender: snd }), C.tok);
t('«компания → получатель» без одобренной компании закрыт', r.status === 400 && r.data.error === 'company_not_approved', JSON.stringify(r.data));
r = await G('/delivery/orders', J({ scenario: 'p2p', city: CITY, from: pickup, to: drop, parcel, recipient: { name: 'Р', phone: '123' }, sender: snd }), C.tok);
t('неверный телефон получателя отклонён', r.status === 400);
r = await G('/delivery/orders', J({ scenario: 'pvz', city: CITY, from: pickup, to: drop, parcel, recipient: rec }), C.tok);
t('ПВЗ → получатель: нужны сведения об отправлении', r.status === 400 && r.data.error === 'pvz_info_required', JSON.stringify(r.data));
r = await G('/delivery/orders', J({ scenario: 'food', city: CITY, from: pickup, to: drop, parcel, recipient: rec }), C.tok);
t('сценарий «еда» вручную создать нельзя', r.status === 400 && r.data.error === 'bad_scenario');
r = await G('/delivery/quote', J({ city: CITY, from: pickup, to: drop, size: 'l' }), C.tok);
const priceL = r.data.priceRub;
r = await G('/delivery/orders', J({ scenario: 'p2p', city: CITY, from: pickup, to: drop, parcel: { ...parcel, size: 'l' }, recipient: rec, sender: snd, priceRub: 1, idemKey: 'dl-' + U }), C.tok);
t('доставка: цена считается сервером (размер учтён)', r.status === 201 && r.data.priceRub === priceL, JSON.stringify(r.data));
const dId = r.data.orderId;
r = await G(`/orders/${dId}`, {}, C.tok);
t('заказчик видит два кода (передача и вручение)', r.data.order.codes?.pickup?.code?.length === 6 && r.data.order.codes?.handover?.code?.length === 6, JSON.stringify(r.data.order.codes));
const pickCode = r.data.order.codes.pickup.code; const handCode = r.data.order.codes.handover.code;
r = await G('/delivery/available', {}, K.tok);
const av = r.data.orders?.find((o) => o.id === dId);
t('курьер видит заказ без контактов получателя/отправителя', av && !JSON.stringify(av).includes('+7999555'), JSON.stringify(av).slice(0, 200));
r = await G(`/delivery/orders/${dId}/accept`, J({}), D.tok);
t('водитель такси чужой кабинет курьера не использует', r.status === 403);
r = await G(`/delivery/orders/${dId}/accept`, J({}), K.tok);
t('курьер принял заказ', r.status === 200);
r = await G(`/orders/${dId}`, {}, K.tok);
t('назначенному курьеру открылись контакты', r.data.order.data.recipient?.phone === rec.phone && r.data.order.data.sender?.phone === snd.phone);
r = await G(`/orders/${dId}`, {}, K.tok);
t('курьер коды не видит', !r.data.order.codes);
r = await G(`/delivery/orders/${dId}/act`, J({ action: 'pickup', code: pickCode }), K.tok);
t('«принято» до прибытия невозможно', r.status === 409);
await G(`/delivery/orders/${dId}/act`, J({ action: 'heading' }), K.tok);
await G(`/delivery/orders/${dId}/act`, J({ action: 'arrived_pickup' }), K.tok);
r = await G(`/delivery/orders/${dId}/act`, J({ action: 'pickup', code: '000000' }), K.tok);
t('неверный код передачи отклонён, попытки считаются', r.status === 400 && r.data.error === 'bad_code' && r.data.left === 4, JSON.stringify(r.data));
r = await G(`/delivery/orders/${dId}/act`, J({ action: 'pickup', code: pickCode }), K.tok);
t('верный код — отправление принято', r.status === 200);
r = await G(`/delivery/orders/${dId}/act`, J({ action: 'pickup', code: pickCode }), K.tok);
t('код одноразовый', r.status === 409);
await G(`/delivery/orders/${dId}/act`, J({ action: 'start_delivery' }), K.tok);
await G(`/delivery/orders/${dId}/act`, J({ action: 'arrived_recipient' }), K.tok);
for (let i = 0; i < 5; i++) r = await G(`/delivery/orders/${dId}/act`, J({ action: 'deliver', code: '11111' + i }), K.tok);
r = await G(`/delivery/orders/${dId}/act`, J({ action: 'deliver', code: handCode }), K.tok);
t('после пяти неверных попыток код заблокирован (даже верный)', r.status === 400 && r.data.error === 'code_locked', JSON.stringify(r.data));
await call('/api/go/orders/' + dId, {}, C.tok);
q(`update go_order_codes set attempts = 0 where order_id='${dId}' and purpose='handover'`);   // имитация сброса администрацией
r = await G(`/delivery/orders/${dId}/act`, J({ action: 'deliver', code: handCode }), K.tok);
t('вручение по верному коду → ожидается оплата', r.status === 200);
r = await G(`/orders/${dId}`, {}, C.tok);
t('заказчик видит реквизиты курьера', r.data.order.status === 'awaiting_payment' && r.data.order.pay.details?.number === CARD && r.data.order.pay.amountRub === priceL);
await G(`/orders/${dId}/paid`, J({}), C.tok);
r = await G(`/orders/${dId}/confirm-paid`, J({}), K.tok);
t('доставка: оплата подтверждена курьером', r.status === 200 && r.data.status === 'paid');

/* курьер: подписка кончилась посреди работы */
r = await G('/delivery/orders', J({ scenario: 'p2p', city: CITY, from: pickup, to: drop, parcel, recipient: rec, sender: snd }), C2.tok);
const d2 = r.data.orderId;
await G(`/delivery/orders/${d2}/accept`, J({}), K.tok);
q(`update go_subscriptions set expires_at = now() - interval '1 minute' where profile_id='${K.pid}' and role='courier'`);
r = await G('/delivery/orders', J({ scenario: 'p2p', city: CITY, from: pickup, to: drop, parcel, recipient: rec, sender: snd }), C2.tok);
const d3 = r.data.orderId;
r = await G(`/delivery/orders/${d3}/accept`, J({}), K.tok);
t('курьер без подписки новый заказ не принимает', r.status === 402);
r = await G(`/delivery/orders/${d2}/act`, J({ action: 'heading' }), K.tok);
t('но ведёт принятый', r.status === 200);
await G(`/delivery/orders/${d2}/act`, J({ action: 'release' }), K.tok);
await G(`/delivery/orders/${d2}/cancel`, J({}), C2.tok); await G(`/delivery/orders/${d3}/cancel`, J({}), C2.tok);
await G('/subscription/courier/buy', J({}), K.tok);

/* ═══ Компания ═══ */
const rco = await register(CO, 'company', 'ooo', { brand: 'Тест-Компания' }, []);
t('ООО: заявка отправлена (руководитель — доверенность не нужна)', rco.sub.status === 200, JSON.stringify(rco.sub.data));
await approve(rco.id); fund(CO, 200);
r = await G('/delivery/orders', J({ scenario: 'company', city: CITY, from: pickup, to: drop, parcel, recipient: rec, sender: snd, company: 'Тест-Компания' }), CO.tok);
t('компания: до оплаты кабинета (139 ₽) заказывать нельзя', r.status === 402 || r.status === 400, JSON.stringify(r.data));
r = await G('/subscription/company/buy', J({}), CO.tok);
t('компания: общая активация 139 ₽', r.status === 200 && wallet(CO) === 61, String(wallet(CO)));
r = await G('/delivery/orders', J({ scenario: 'company', city: CITY, from: pickup, to: drop, parcel, recipient: rec, sender: snd, company: 'Тест-Компания' }), CO.tok);
t('компания: доставка оформлена', r.status === 201, JSON.stringify(r.data));
await G(`/delivery/orders/${r.data.orderId}/cancel`, J({}), CO.tok);
const rco2 = await G('/executors', J({ role: 'company', legalForm: 'ooo', city: CITY, fields: { ...form.ooo(), repIsHead: false }, extra: { brand: 'Х' } }), C.tok);
r = await G(`/executors/${rco2.data.id}/submit`, J({}), C.tok);
t('ООО без руководителя: нужна доверенность', r.status === 400 && r.data.error === 'docs_missing' && r.data.missing.includes('authority_doc'), JSON.stringify(r.data));

/* ═══ Еда ═══ */
const rs = await register(SL, 'food_seller', 'ip', { placeName: 'Тест-Кафе' }, []);
await approve(rs.id); fund(SL, 300); await setCard(SL);
r = await G('/food/my/place', { method: 'PUT', body: JSON.stringify({ name: 'Тест-Кафе', address: 'Москва, Покровка 5', category: 'Кафе', hours: '10-22' }) }, SL.tok);
t('заведение создано, координаты найдены', r.status === 200 && r.data.located === true, JSON.stringify(r.data));
r = await G('/food/my/publish', J({ on: true }), SL.tok);
t('без подписки заведение не опубликовать', r.status === 402 && r.data.error === 'subscription_required', JSON.stringify(r.data));
await G('/subscription/food_seller/buy', J({}), SL.tok);
r = await G('/food/my/publish', J({ on: true }), SL.tok);
t('без меню публикация закрыта', r.data.error === 'menu_empty');
r = await G('/food/my/items', J({ name: 'Борщ', priceRub: 250, category: 'Супы' }), SL.tok);
const item1 = r.data.id;
r = await G('/food/my/items', J({ name: 'Салат', priceRub: -5 }), SL.tok);
t('отрицательная цена блюда отклонена', r.status === 400);
r = await G('/food/my/items', J({ name: 'Чай', priceRub: 80, category: 'Напитки', available: false }), SL.tok);
const item2 = r.data.id;
r = await G('/food/my/publish', J({ on: true }), SL.tok);
t('заведение опубликовано', r.status === 200 && r.data.published === true, JSON.stringify(r.data));
r = await G(`/food/places?city=${encodeURIComponent(CITY)}&q=${encodeURIComponent('тест')}`, {}, C.tok);
const place = r.data.places.find((p) => p.name === 'Тест-Кафе');
t('каталог: заведение найдено поиском', Boolean(place));
r = await G(`/food/places/${place.id}`, {}, C.tok);
t('меню заведения', r.data.items.length === 2);
const addr = { address: 'Москва, Сретенка 3' }; const recF = { name: 'Покупатель', phone: '+79997770000' };
r = await G('/food/orders', J({ placeId: place.id, items: [{ id: item2, qty: 1 }], address: addr, recipient: recF }), C.tok);
t('недоступная позиция отклонена', r.status === 400 && r.data.error === 'item_unavailable', JSON.stringify(r.data));
r = await G('/food/orders', J({ placeId: place.id, items: [{ id: item1, qty: 0 }], address: addr, recipient: recF }), C.tok);
t('количество 0 отклонено', r.status === 400);
r = await G('/food/orders', J({ placeId: place.id, items: [{ id: item1, qty: 2, priceRub: 1 }], address: addr, recipient: recF, totalRub: 5 }), SL.tok);
t('нельзя заказывать у самого себя', r.status === 400 && r.data.error === 'own_place', JSON.stringify(r.data));
r = await G('/food/orders', J({ placeId: place.id, items: [{ id: item1, qty: 2, priceRub: 1 }], address: addr, recipient: recF, totalRub: 5, comment: 'без лука' }), C.tok);
t('заказ еды: сумма с сервера (2 × 250), цена клиента игнорируется', r.status === 201 && r.data.sumRub === 500, JSON.stringify(r.data));
const fId = r.data.orderId;
r = await G(`/orders/${fId}`, {}, SL.tok);
t('продавец видит заказ (позиции и адрес)', r.data.order.data.items[0].name === 'Борщ' && r.data.order.status === 'pending');
r = await G(`/food/orders/${fId}/seller-act`, J({ action: 'cook' }), SL.tok);
t('нельзя готовить, не приняв', r.status === 409);
r = await G(`/food/orders/${fId}/seller-act`, J({ action: 'accept' }), C.tok);
t('покупатель за продавца не принимает', r.status === 404);
r = await G(`/food/orders/${fId}/seller-act`, J({ action: 'accept' }), SL.tok);
t('продавец принял', r.status === 200);
await G(`/food/orders/${fId}/seller-act`, J({ action: 'cook' }), SL.tok);
r = await G(`/food/orders/${fId}/seller-act`, J({ action: 'ready' }), SL.tok);
t('«готово» создаёт доставку курьером', r.status === 200 && r.data.deliveryId, JSON.stringify(r.data));
const fdId = r.data.deliveryId;
r = await G(`/orders/${fdId}`, {}, SL.tok);
t('продавец видит связанную доставку', r.status === 200 && r.data.order.parentId === fId);
r = await G('/delivery/available', {}, K.tok);
const fav = r.data.orders.find((o) => o.id === fdId);
t('курьер видит доставку еды, цена по тарифу еды', fav && fav.scenario === 'food' && fav.priceRub > 0, JSON.stringify(fav));
await G(`/delivery/orders/${fdId}/accept`, J({}), K.tok);
for (const a of ['heading', 'arrived_pickup']) await G(`/delivery/orders/${fdId}/act`, J({ action: a }), K.tok);
r = await G(`/delivery/orders/${fdId}/act`, J({ action: 'pickup' }), K.tok);
t('еда: передача курьеру без кода', r.status === 200);
r = await G(`/orders/${fId}`, {}, C.tok);
t('заказ еды следует за доставкой: передан курьеру', r.data.order.status === 'handed_to_courier', r.data.order.status);
await G(`/delivery/orders/${fdId}/act`, J({ action: 'start_delivery' }), K.tok);
await G(`/delivery/orders/${fdId}/act`, J({ action: 'arrived_recipient' }), K.tok);
r = await G(`/orders/${fdId}`, {}, C.tok);
const fcode = r.data.order.codes.handover.code;
r = await G(`/delivery/orders/${fdId}/act`, J({ action: 'deliver', code: fcode }), K.tok);
t('вручено покупателю', r.status === 200);
r = await G(`/orders/${fId}`, {}, C.tok);
t('еда: ожидается оплата заведению, реквизиты продавца', r.data.order.status === 'awaiting_payment' && r.data.order.pay.amountRub === 500 && r.data.order.pay.details?.number === CARD, JSON.stringify(r.data.order.pay));
await G(`/orders/${fId}/paid`, J({}), C.tok);
r = await G(`/orders/${fId}/confirm-paid`, J({}), SL.tok);
t('продавец подтвердил оплату еды', r.status === 200 && r.data.status === 'paid');
await G(`/orders/${fdId}/paid`, J({}), C.tok); r = await G(`/orders/${fdId}/confirm-paid`, J({}), K.tok);
t('курьер подтвердил оплату доставки', r.status === 200 && r.data.status === 'paid');
r = await G('/stats/food_seller', {}, SL.tok);
t('статистика продавца', r.data.done === 1 && r.data.earnedRub === 500, JSON.stringify(r.data));

/* порядок оплаты «до» (настройка) */
r = await call('/api/admin/go/settings/payment_terms', { method: 'PUT', body: JSON.stringify({ value: { taxi: 'after_ride', food: 'before', delivery: 'after' } }) }, AF.tok);
t('смена порядка оплаты без права go_finance запрещена', r.status === 403);
r = await call('/api/admin/go/settings/payment_terms', { method: 'PUT', body: JSON.stringify({ value: { taxi: 'after_ride', food: 'before', delivery: 'after' } }) }, A.tok);
t('порядок оплаты еды «до» включён', r.status === 200);
await new Promise((x) => setTimeout(x, 16000));   // кэш настроек живёт 15 с
r = await G('/food/orders', J({ placeId: place.id, items: [{ id: item1, qty: 1 }], address: addr, recipient: recF }), C.tok);
const f2 = r.data.orderId;
await G(`/food/orders/${f2}/seller-act`, J({ action: 'accept' }), SL.tok);
r = await G(`/food/orders/${f2}/seller-act`, J({ action: 'cook' }), SL.tok);
t('оплата «до»: готовить нельзя, пока оплата не подтверждена', r.status === 400 && r.data.error === 'payment_required', JSON.stringify(r.data));
await G(`/orders/${f2}/paid`, J({}), C.tok); await G(`/orders/${f2}/confirm-paid`, J({}), SL.tok);
r = await G(`/food/orders/${f2}/seller-act`, J({ action: 'cook' }), SL.tok);
t('после подтверждения оплаты готовить можно', r.status === 200, JSON.stringify(r.data));
await G(`/food/orders/${f2}/seller-act`, J({ action: 'reject', reason: 'Закончились продукты' }), SL.tok);
r = await G(`/orders/${f2}`, {}, C.tok);
t('отказ заведения с причиной', r.data.order.status === 'cancelled' && /Закончились/.test(r.data.order.cancelReason || ''), JSON.stringify(r.data.order.status));
await call('/api/admin/go/settings/payment_terms', { method: 'PUT', body: JSON.stringify({ value: { taxi: 'after_ride', food: 'after', delivery: 'after' } }) }, A.tok);

/* подписка продавца кончилась → заведение скрыто */
q(`update go_subscriptions set expires_at = now() - interval '1 minute' where profile_id='${SL.pid}' and role='food_seller'`);
r = await G(`/food/places?city=${encodeURIComponent(CITY)}`, {}, C.tok);
t('подписка продавца истекла: заведение скрыто из каталога', !r.data.places.some((p) => p.id === place.id));
r = await G('/food/orders', J({ placeId: place.id, items: [{ id: item1, qty: 1 }], address: addr, recipient: recF }), C.tok);
t('и заказать в нём нельзя', r.status === 400 && r.data.error === 'place_unavailable');
r = await G('/food/my/orders', {}, SL.tok);
t('история заказов продавца остаётся доступной', r.status === 200 && r.data.orders.length >= 2);

/* ═══ Тарифы и настройки (администрация) ═══ */
r = await call('/api/admin/go/tariffs/taxi', { method: 'PUT', body: JSON.stringify({ priceRub: 79, periodDays: 7 }) }, AF.tok);
t('тариф меняет только go_finance', r.status === 403);
r = await call('/api/admin/go/tariffs/taxi', { method: 'PUT', body: JSON.stringify({ priceRub: -1, periodDays: 7 }) }, A.tok);
t('отрицательная цена тарифа отклонена', r.status === 400);
r = await call('/api/admin/go/tariffs/taxi', { method: 'PUT', body: JSON.stringify({ priceRub: 79, periodDays: 7 }) }, A.tok);
t('тариф водителя изменён администрацией', r.status === 200);
await G('/subscription/taxi_driver/buy', J({}), winner.tok);
const before = wallet(winner);
fund(winner, 200); await G('/subscription/taxi_driver/buy', J({ idemKey: 'newprice' }), winner.tok);
t('новая цена применяется (79 ₽)', wallet(winner) === before + 200 - 79, `${wallet(winner)} ${before}`);
await call('/api/admin/go/tariffs/taxi', { method: 'PUT', body: JSON.stringify({ priceRub: 69, periodDays: 7 }) }, A.tok);
t('изменение тарифа в журнале', Number(q(`select count(*) from admin_log where type='go_tariff'`)) >= 2);
r = await call('/api/admin/go/subscriptions', {}, A.tok);
t('список подписок для администрации', r.status === 200 && r.data.items.length >= 3);
r = await call('/api/admin/go/orders?kind=taxi', {}, A.tok);
t('список заказов такси для администрации', r.status === 200 && r.data.items.some((o) => o.id === taxiId));
r = await call('/api/admin/go/integrations', {}, A.tok);
t('интеграции: карты, авиа, заправки', r.status === 200 && r.data.flights.configured && r.data.fuel.configured, JSON.stringify(r.data).slice(0, 150));
r = await call('/api/admin/go/applications/' + rs.id + '/decide', J({ action: 'suspend', note: 'Жалобы клиентов' }), A.tok);
t('приостановка допуска', r.status === 200 && r.data.status === 'suspended');
r = await G('/food/my/items', J({ name: 'Новое', priceRub: 10 }), SL.tok);
t('приостановленный меню не правит', r.status === 403 && r.data.error === 'not_approved');
await call('/api/admin/go/applications/' + rs.id + '/decide', J({ action: 'unsuspend' }), A.tok);

/* ═══ Авиабилеты ═══ */
r = await G('/flights/status', {}, C.tok);
t('авиа: поставщик подключён, бронирование внутри Sky не заявлено', r.data.configured === true && r.data.canBook === false, JSON.stringify(r.data));
r = await G('/flights/suggest?term=Мос', {}, C.tok);
t('подсказки городов', r.status === 200 && r.data.places.some((p) => p.code === 'MOW'));
const dateIn = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
r = await G('/flights/search', J({ from: 'MOW', to: 'MOW', date: dateIn }), C.tok);
t('одинаковые города отклонены', r.status === 400);
r = await G('/flights/search', J({ from: 'MOW', to: 'LED', date: '2020-01-01' }), C.tok);
t('дата в прошлом отклонена', r.status === 400 && r.data.error === 'date_in_past');
r = await G('/flights/search', J({ from: 'МОС', to: 'LED', date: dateIn }), C.tok);
t('нужен код IATA', r.status === 400 && r.data.error === 'bad_iata');
r = await G('/flights/search', J({ from: 'MOW', to: 'LED', date: dateIn, adults: 2 }), C.tok);
t('поиск: предложения поставщика, цена за двоих, пометка о кэше', r.status === 200 && r.data.offers.length === 2 && r.data.offers[0].priceRub === r.data.offers[0].perPassengerRub * 2 && r.data.cached === true && r.data.offers.every((o) => o.link.startsWith('https://www.aviasales.ru')), JSON.stringify(r.data).slice(0, 250));
const offer = r.data.offers[0];
r = await G('/flights/orders', J({ offer: { ...offer, link: 'https://evil.example.com/x' }, passengers: [{ name: 'Иван Иванов' }] }), C.tok);
t('ссылка на чужой сайт в предложении отклонена', r.status === 400 && r.data.error === 'bad_offer');
r = await G('/flights/orders', J({ offer, passengers: [] }), C.tok);
t('без пассажиров заказ не создаётся', r.status === 400);
r = await G('/flights/orders', J({ offer, passengers: [{ name: 'Иван Иванов', birthDate: '1990-01-01', docNumber: '4500123456' }] }), C.tok);
t('заказ: статус «redirected», а не «booked» — подтверждения поставщика нет', r.status === 201 && r.data.status === 'redirected' && /не подтверждает/.test(r.data.note), JSON.stringify(r.data));
const flId = r.data.orderId;
r = await G('/flights/orders', {}, C.tok);
t('мои авиазаказы; идентификатор внешнего заказа пуст', r.data.orders[0].status === 'redirected' && r.data.orders[0].externalId === null);
r = await G('/flights/orders', {}, X.tok);
t('чужих авиазаказов нет', r.data.orders.length === 0);
r = await G(`/flights/orders/${flId}/cancel`, J({}), X.tok);
t('чужой авиазаказ отменить нельзя', r.status === 409 || r.status === 400);
t('данные пассажиров лежат зашифрованными', !q(`select passengers_enc from go_flight_orders where id='${flId}'`).includes('Иванов'));

/* ═══ Заправки ═══ */
r = await G('/fuel/nearby', J({}), C.tok);
t('без геолокации и города — запрос места', r.status === 400 && r.data.error === 'location_required');
r = await G('/fuel/nearby', J({ lat: 55.75, lng: 37.62, radiusM: 4000 }), C.tok);
t('ближайшие АЗС: данные поставщика, по расстоянию', r.status === 200 && r.data.stations.length === 3 && r.data.stations[0].distanceKm <= r.data.stations[1].distanceKm, JSON.stringify(r.data).slice(0, 200));
const st1 = r.data.stations.find((s) => s.name === 'Тест-АЗС 1');
t('показано только предоставленное: виды топлива, услуги, 24/7', st1.fuels.includes('ДТ') && st1.services.includes('Магазин') && st1.always === true);
t('цен и очередей поставщика нет — не выдумываются', !('price' in st1) && st1.load.level === null && st1.load.source === 'users' && r.data.notice.includes('Цен'));
r = await G('/fuel/nearby', J({ lat: 55.75, lng: 37.62, fuel: 'ДТ' }), C.tok);
t('фильтр по топливу', r.data.stations.length === 1 && r.data.stations[0].name === 'Тест-АЗС 1');
r = await G('/fuel/report', J({ key: st1.key, level: 'high' }), C.tok);
t('сообщение о загруженности принято', r.status === 200 && r.data.load.level === 'high' && r.data.load.reports === 1, JSON.stringify(r.data));
r = await G('/fuel/report', J({ key: st1.key, level: 'low' }), C.tok);
t('повтор того же человека раньше 15 минут отклонён', r.status === 400 && r.data.error === 'report_too_soon');
r = await G('/fuel/report', J({ key: st1.key, level: 'очень' }), C2.tok);
t('неверный уровень', r.status === 400 && r.data.error === 'bad_level');
r = await G('/fuel/report', J({ key: 'osm:node999999', level: 'low' }), C2.tok);
t('неизвестная станция', r.status === 400 && r.data.error === 'station_not_found');
await G('/fuel/report', J({ key: st1.key, level: 'low' }), C2.tok);
await G('/fuel/report', J({ key: st1.key, level: 'low' }), X.tok);
r = await G('/fuel/nearby', J({ lat: 55.75, lng: 37.62, sort: 'load' }), C.tok);
t('оценка по сообщениям людей: число и время последнего', r.data.stations.find((s) => s.key === st1.key).load.reports === 3 && r.data.stations.find((s) => s.key === st1.key).load.lastAt);
const ld = r.data.stations.find((s) => s.key === st1.key).load.level;
t('сортировка по загруженности: оценка «' + ld + '» по сообщениям людей, свободные выше загруженных', ld !== 'high' ? r.data.stations[0].key === st1.key : r.data.stations[r.data.stations.length - 1].key === st1.key, r.data.stations.map((s) => s.name).join(','));
q(`update go_fuel_reports set created_at = now() - interval '4 hours' where station_key='${st1.key}'`);
r = await G('/fuel/nearby', J({ lat: 55.75, lng: 37.62 }), C.tok);
t('устаревшие (старше 3 часов) сообщения не учитываются', r.data.stations.find((s) => s.key === st1.key).load.level === null);
r = await G('/fuel/nearby', J({ lat: 85, lng: 10 }), C.tok);
t('сбой поставщика без кэша — честная ошибка', r.status === 502 && r.data.error === 'provider_error', JSON.stringify(r.data));
r = await G('/fuel/nearby', J({ lat: 55.751, lng: 37.621 }), C.tok);
t('при доступном поставщике работает снова (кэш станций)', r.status === 200 && r.data.stations.length >= 1);

/* ═══ Персональный тариф исполнителя ═══ */
r = await call('/api/admin/go/executor-tariffs', { method: 'PUT', body: JSON.stringify({ username: q(`select username from profiles where id='${D.pid}'`), role: 'taxi_driver', priceRub: 10, periodDays: 3 }) }, AF.tok);
t('персональный тариф: нужен go_finance', r.status === 403);
r = await call('/api/admin/go/executor-tariffs', { method: 'PUT', body: JSON.stringify({ username: q(`select username from profiles where id='${D.pid}'`), role: 'taxi_driver', priceRub: -5, periodDays: 3 }) }, A.tok);
t('персональный тариф: отрицательная цена отклонена', r.status === 400);
r = await call('/api/admin/go/executor-tariffs', { method: 'PUT', body: JSON.stringify({ username: q(`select username from profiles where id='${D.pid}'`), role: 'taxi_driver', priceRub: 10, periodDays: 3, note: 'Акция' }) }, A.tok);
t('персональный тариф задан администрацией', r.status === 200, JSON.stringify(r.data));
r = await G('/subscription/taxi_driver', {}, D.tok);
t('исполнитель видит персональный тариф', r.data.subscription.tariff.priceRub === 10 && r.data.subscription.tariff.personal === true && r.data.subscription.tariff.periodDays === 3, JSON.stringify(r.data.subscription.tariff));
fund(D, 100); const wb = wallet(D);
r = await G('/subscription/taxi_driver/buy', J({ idemKey: 'pers1' }), D.tok);
t('списано ровно персональные 10 ₽', r.status === 200 && wallet(D) === wb - 10, `${wallet(D)} ${wb}`);
r = await G('/subscription/taxi_driver', {}, D2.tok);
t('другой водитель остаётся на общем тарифе', r.data.subscription.tariff.priceRub === 69 && !r.data.subscription.tariff.personal);
r = await call('/api/admin/go/executor-tariffs', { method: 'PUT', body: JSON.stringify({ username: q(`select username from profiles where id='${D.pid}'`), role: 'taxi_driver', reset: true }) }, A.tok);
r = await G('/subscription/taxi_driver', {}, D.tok);
t('сброс возвращает общий тариф', r.data.subscription.tariff.priceRub === 69 && !r.data.subscription.tariff.personal);

/* ═══ Безопасность: общий обход ═══ */
const forbidden = ['/executors', '/pay-details'];
r = await call('/api/go/config');
t('без входа — 401', r.status === 401);
r = await call('/api/admin/go/overview', {}, X.tok);
t('обзор администрации обычному человеку закрыт', r.status === 403);
r = await call('/api/admin/go/overview', {}, A.tok);
t('обзор администрации', r.status === 200 && r.data.activeSubscriptions >= 3, JSON.stringify(r.data).slice(0, 150));
r = await G('/executors', {}, X.tok);
t('чужие заявки и документы человеку не видны', r.status === 200 && r.data.executors.length === 0);
r = await G('/orders?side=executor', {}, X.tok);
t('чужие заказы исполнителя не видны', r.data.orders.length === 0);
t('реквизиты зашифрованы в базе', !q(`select data_enc from go_pay_details limit 1`).includes('4111'));
t('сведения заявок зашифрованы в базе', !q(`select data_enc from go_executors limit 1`).includes('Иванов'));
t('документы зашифрованы в базе', Number(q(`select count(*) from go_executor_docs where encode(substr(data,1,8),'hex') = '89504e470d0a1a0a'`)) === 0);

console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
