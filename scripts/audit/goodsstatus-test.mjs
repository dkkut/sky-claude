// Sky Market: статус товара (где, ETA), сотрудники продавца, трек-номер
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000; запуск: node scripts/audit/goodsstatus-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o, m = 'POST') => ({ method: m, body: JSON.stringify(o) });
const SL = await mkuser(S, 'GsS', 'gss' + Date.now().toString(36)), B = await mkuser(S, 'GsB'), ST = await mkuser(S, 'GsT', 'gst' + Date.now().toString(36)), X = await mkuser(S, 'GsX');
const un = (x) => q(`SELECT username FROM profiles WHERE id='${x}'`); SL.username = un(SL.pid); ST.username = un(ST.pid); X.username = un(X.pid);
q(`INSERT INTO market_sellers (profile_id, shop_name, status, verification_status, has_payment_details, sub_status, sub_until) VALUES ('${SL.pid}','Магазин ${SL.pid.slice(-4)}','active','legacy',true,'active', now() + interval '30 days') ON CONFLICT (profile_id) DO UPDATE SET status='active', has_payment_details=true, sub_status='active', sub_until=now() + interval '30 days'`);
const pid = `mp-${crypto.randomUUID()}`; q(`INSERT INTO market_products (id, seller_id, title, price_kop, category, active, moderation_status, market_type, stock, search_text) VALUES ('${pid}','${SL.pid}','Чайник',100000,'home',true,'published','standard',50,'x')`);
const act = (id, u, a) => call(`/api/market/orders/${id}/action`, J({ action: a }), u.tok);
const o = await call('/api/market/orders', J({ productId: pid, quantity: 1, address: 'Москва, Тверская 5, кв 3' }), B.tok);
const id = o.data.order.id;
const G = (path, u, body, m) => call(`/api/market/goods-status/${path}`, m === 'DELETE' ? { method: 'DELETE' } : body === undefined ? {} : J(body, m ?? 'PUT'), u.tok);

/* до оплаты менять нельзя */
t('до оплаты статус менять нельзя', (await G(id, SL, { place: 'Склад' })).data.error === 'bad_status');
for (const [u, a] of [[SL, 'accept'], [B, 'declare_paid'], [SL, 'confirm_paid']]) await act(id, u, a);

/* доступ */
t('покупатель читает', (await G(id, B)).status === 200);
t('чужой не читает (404)', (await G(id, X)).status === 404);
t('покупатель не меняет', (await G(id, B, { place: 'У меня' })).status === 404);
t('чужой не меняет', (await G(id, X, { place: 'Склад' })).status === 404);
t('чужой не очищает', (await G(id, X, undefined, 'DELETE')).status === 404);
const empty = (await G(id, B)).data;
t('пока ничего не внесено — current пуст, канонический вид', empty.current === null && empty.eta === null && empty.verified === false && empty.canEdit === false);

/* продавец вносит */
t('пустое — отказ', (await G(id, SL, {})).data.error === 'empty');
t('дата в прошлом — отказ', (await G(id, SL, { place: 'Склад', eta: '2020-01-01' })).data.error === 'bad_date');
t('мусорная дата — отказ', (await G(id, SL, { place: 'Склад', eta: 'xx' })).data.error === 'bad_date');
t('etaTo без eta — отказ', (await G(id, SL, { place: 'Склад', etaTo: new Date(Date.now() + 5 * 864e5).toISOString() })).data.error === 'bad_date');
const eta = new Date(Date.now() + 3 * 864e5).toISOString(), etaTo = new Date(Date.now() + 5 * 864e5).toISOString();
const put = await G(id, SL, { place: 'Склад в Подольске', note: 'Упаковываем', eta, etaTo });
t('продавец внёс место и срок', put.status === 200);
const s1 = (await G(id, B)).data;
t('покупатель видит место, срок и источник «seller»', s1.current?.place === 'Склад в Подольске' && s1.current.source === 'seller' && s1.eta?.source === 'seller' && !!s1.eta.to && s1.verified === false, JSON.stringify(s1).slice(0, 300));
t('покупатель не видит адрес', !JSON.stringify(s1).includes('Тверская'));
t('история ведётся', s1.history.length === 1);
t('покупателю пришло уведомление', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${B.pid}' AND kind='market_goods_status'`)) === 1);
t('продавец canEdit', (await G(id, SL)).data.canEdit === true);

/* сотрудники */
t('сотрудники: пока пусто', (await G('staff', SL)).data.staff.length === 0);
t('нет такого пользователя', (await G('staff', SL, { username: 'nobody_here_x' }, 'POST')).data.error === 'user_not_found');
t('плохой @ник', (await G('staff', SL, { username: '!!' }, 'POST')).data.error === 'bad_username');
t('себя назначить нельзя', (await G('staff', SL, { username: SL.username }, 'POST')).data.error === 'self');
t('не продавец не назначает', (await G('staff', X, { username: ST.username }, 'POST')).data.error === 'not_seller');
t('сотрудник до назначения не видит заказ', (await G(id, ST)).status === 404);
t('назначение', (await G('staff', SL, { username: '@' + ST.username }, 'POST')).status === 200);
t('сотрудник в списке', (await G('staff', SL)).data.staff.some((p) => p.id === ST.pid));
t('сотруднику пришло уведомление', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${ST.pid}' AND kind='market_goods_staff'`)) === 1);
const q1 = (await G('queue', ST)).data.orders;
t('очередь сотрудника содержит заказ без адреса и контактов', q1.some((r) => r.id === id) && !JSON.stringify(q1).includes('Тверская'));
const s2 = await G(id, ST, { place: 'Курьерская служба, Москва', eta: new Date(Date.now() + 2 * 864e5).toISOString() });
t('сотрудник вносит статус', s2.status === 200);
const s3 = (await G(id, B)).data;
t('источник «staff», место свежее', s3.current.source === 'staff' && s3.current.place.startsWith('Курьерская') && s3.eta.source === 'staff');
t('сотрудник не назначает сотрудников', (await G('staff', ST, { username: X.username }, 'POST')).data.error === 'not_seller');
t('чужой заказ другого продавца сотруднику недоступен', (await (async () => {
  const SL2 = await mkuser(S, 'GsS2'); q(`INSERT INTO market_sellers (profile_id, shop_name, status, verification_status, has_payment_details, sub_status, sub_until) VALUES ('${SL2.pid}','М2','active','legacy',true,'active', now() + interval '30 days')`);
  const p2 = `mp-${crypto.randomUUID()}`; q(`INSERT INTO market_products (id, seller_id, title, price_kop, category, active, moderation_status, market_type, stock, search_text) VALUES ('${p2}','${SL2.pid}','Другое',50000,'home',true,'published','standard',5,'x')`);
  const o2 = await call('/api/market/orders', J({ productId: p2, quantity: 1, address: 'Москва, ул. Тестовая 1' }), B.tok);
  for (const [u, a] of [[SL2, 'accept'], [B, 'declare_paid'], [SL2, 'confirm_paid']]) await act(o2.data.order.id, u, a);
  return G(o2.data.order.id, ST, { place: 'Чужое' });
})()).status === 404);

/* трек-номер: свежее событие службы выигрывает у ручного места */
q(`INSERT INTO parcel_tracking (order_id, provider, number, set_by) VALUES ('${id}','cdek','1234567890','${SL.pid}') ON CONFLICT (order_id) DO NOTHING`);
const s4 = (await G(id, B)).data;
t('с треком отдаётся tracking и не падает без подключения службы', s4.tracking?.number === '1234567890' && (s4.parcel === null || typeof s4.parcel === 'object'));
t('без данных службы остаётся ручное место', s4.current?.source === 'staff');

/* отправление Sky Market как запасной источник */
t('очистка статуса', (await G(id, ST, undefined, 'DELETE')).status === 200 && (await G(id, B)).data.manual === null);

/* снятие сотрудника */
t('снять сотрудника', (await G(`staff/${ST.pid}`, SL, undefined, 'DELETE')).status === 200);
t('снятый не меняет', (await G(id, ST, { place: 'Снова' })).status === 404);
t('снятый не читает', (await G(id, ST)).status === 404);

/* закрытый заказ */
q(`UPDATE market_orders SET status='completed' WHERE id='${id}'`);
t('после закрытия менять нельзя', (await G(id, SL, { place: 'Склад' })).data.error === 'bad_status');
t('плохой id заказа', (await G('mo-xxx', SL)).status === 404);
console.log(`goodsstatus: ok=${ok} bad=${bad}`); process.exit(bad ? 1 : 0);
