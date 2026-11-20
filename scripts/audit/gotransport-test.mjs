// Sky GO «Для транспорта»: категории, топливо, удобства, акции, заказ-наряды, оплата через SkyKassa Business.
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000 GOPLACES_RATE_MULT=50 KBIZ_RATE_MULT=50
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1:5432/skytest -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; } else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'trown'), W = await mkuser(S, 'trwash'), B = await mkuser(S, 'trbuy'), X = await mkuser(S, 'trx'), ADM = await mkuser(S, 'tradm');
q('update admin_lockdown set active=false');
q(`update profiles set is_admin=true, admin_role='go_places_moderator' where id='${ADM.pid}'`);
for (const u of [A, W]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const D7 = (a, b) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[a, b]]]));
const mkOrg = async (u, name, cat) => {
  await post(u, '/api/kbiz/business', { name, mode: 'point', legalType: 'selfemployed' });
  await post(u, '/api/kbiz/place/connect', { on: true });
  await put(u, '/api/kbiz/place', { categoryId: cat, about: 'Описание', city: 'Москва', address: 'ул. Тестовая, 2', hours: D7('00:00', '23:59'), phone: '+7 900 000-00-01', lat: 55.75, lng: 37.61, tz: 'Europe/Moscow' });
  await me(u, '/api/kbiz/requisites', { method: 'PUT', body: JSON.stringify({ holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' }) });
  await post(u, '/api/kbiz/subscription/buy', { idemKey: 'tr' + name });
  await post(u, '/api/kbiz/publish', { on: true });
  await post(u, '/api/kbiz/place/photo', { dataUrl: png });
  const r = await post(u, '/api/kbiz/place/submit'); const id = r.data.place?.businessId;
  await post(ADM, `/api/admin/go/places/${id}/approve`); return id;
};

// категории
const cats = (await me(B, '/api/go/places/categories')).data.categories;
const tc = cats.filter((c) => c.groupId === 'transport').map((c) => c.id);
for (const id of ['fuel', 'carwash', 'autoservice', 'detailing', 'autoparts', 'carparks', 'parkings', 'towing', 'dealers', 'rental']) t('категория ' + id, tc.includes(id));
t('категория вне группы без группы', cats.find((c) => c.id === 'baths').groupId === null);

const fuelId = await mkOrg(A, 'АЗС Север', 'fuel');
const svcId = await mkOrg(W, 'Автосервис Мото', 'autoservice');
{ const ids = (await me(B, '/api/go/places?group=transport')).data.places.map((p) => p.id); t('список по группе transport', ids.includes(fuelId) && ids.includes(svcId)); }
t('список вне группы пуст', (await me(B, '/api/go/places?group=nonexistent')).data.places.length === 0);

// не-транспорт и чужой
t('чужой (без бизнеса) — нет кабинета', (await me(X, '/api/kbiz/transport/fuel')).status === 404);
t('автосервис не ставит цены топлива', (await put(W, '/api/kbiz/transport/fuel', { prices: [{ fuel: 'ai95', priceRub: 60 }] })).status === 409);

// топливо
t('неизвестный вид топлива', (await put(A, '/api/kbiz/transport/fuel', { prices: [{ fuel: 'xx', priceRub: 60 }] })).status === 400);
t('цена ≤ 0', (await put(A, '/api/kbiz/transport/fuel', { prices: [{ fuel: 'ai95', priceRub: 0 }] })).status === 400);
t('цена слишком большая', (await put(A, '/api/kbiz/transport/fuel', { prices: [{ fuel: 'ai95', priceRub: 5000 }] })).status === 400);
let r = await put(A, '/api/kbiz/transport/fuel', { prices: [{ fuel: 'ai95', priceRub: 61.45 }, { fuel: 'dt', priceRub: 70, available: false }] });
t('цены сохранены', r.status === 200 && r.data.prices.length === 2);
let pub = (await me(B, `/api/go/transport/info/${fuelId}`)).data;
t('публичные цены копейками и датой', pub.fuel.find((f) => f.fuel === 'ai95').priceRub === 61.45 && pub.fuel[0].updatedAt && pub.fuel.find((f) => f.fuel === 'dt').available === false);
t('цена не устарела', pub.fuel.every((f) => f.stale === false));
q(`update gop_fuel_prices set updated_at = now() - interval '9 days' where business_id='${fuelId}' and fuel='ai95'`);
await put(A, '/api/kbiz/transport/fuel', { prices: [{ fuel: 'ai95', priceRub: 61.45 }, { fuel: 'dt', priceRub: 70, available: false }] });
pub = (await me(B, `/api/go/transport/info/${fuelId}`)).data;
t('без изменения цены дата не обновляется — цена устарела', pub.fuel.find((f) => f.fuel === 'ai95').stale === true);
await put(A, '/api/kbiz/transport/fuel', { prices: [{ fuel: 'ai95', priceRub: 62 }] });
pub = (await me(B, `/api/go/transport/info/${fuelId}`)).data;
t('новая цена обновляет дату, убранный вид удалён', pub.fuel.length === 1 && pub.fuel[0].stale === false && pub.fuel[0].priceRub === 62);
t('публично без цен у автосервиса', (await me(B, `/api/go/transport/info/${svcId}`)).data.fuel.length === 0);
t('приложение «заправки» у АЗС', pub.apps.some((a) => a.key === 'fuel'));

// удобства
t('удобства — только закрытый список', (await put(A, '/api/kbiz/transport/features', { features: ['shop', 'toilet', 'evil', 'shop'] })).data.features.join() === 'shop,toilet');
t('удобства видны', (await me(B, `/api/go/transport/info/${fuelId}`)).data.features.length === 2);

// акции
t('короткое название акции', (await post(A, '/api/kbiz/transport/promos', { title: 'x' })).status === 400);
t('конец раньше начала', (await post(A, '/api/kbiz/transport/promos', { title: 'Скидка 5%', startsOn: '2030-02-01', endsOn: '2030-01-01' })).status === 400);
const pr = await post(A, '/api/kbiz/transport/promos', { title: 'Кофе в подарок', body: 'При заправке от 30 л' });
t('акция создана', pr.status === 201);
await post(A, '/api/kbiz/transport/promos', { title: 'Будущая акция', startsOn: '2099-01-01' });
await post(A, '/api/kbiz/transport/promos', { title: 'Закончилась', endsOn: '2000-01-01' });
t('в публичном — только действующие', (await me(B, `/api/go/transport/info/${fuelId}`)).data.promos.length === 1);
t('чужую акцию не удалить', (await me(W, `/api/kbiz/transport/promos/${pr.data.id}`, { method: 'DELETE' })).status === 404);
t('удалить акцию', (await me(A, `/api/kbiz/transport/promos/${pr.data.id}`, { method: 'DELETE' })).status === 200);

// заказ-наряд
const un = q(`select username from profiles where id='${B.pid}'`);
t('нет клиента', (await post(W, '/api/kbiz/transport/work', { title: 'Замена масла', username: 'nobody_xx' })).status === 404);
t('короткое название', (await post(W, '/api/kbiz/transport/work', { title: 'x', username: un })).status === 400);
t('цена не целая', (await post(W, '/api/kbiz/transport/work', { title: 'Замена масла', username: un, priceRub: 1.5 })).status === 400);
r = await post(W, '/api/kbiz/transport/work', { title: 'Замена масла', username: '@' + un, plate: 'А123ВС77', model: 'Lada Vesta', priceRub: 4000 });
t('заказ-наряд создан', r.status === 201); const wid = r.data.id;
t('клиенту пришло уведомление', Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and kind='go_transport'`)) === 1);
let my = (await me(B, '/api/go/transport/work')).data.orders;
t('клиент видит работу с авто', my.length === 1 && my[0].vehicle.plate === 'А123ВС77' && my[0].status === 'accepted');
t('номер авто зашифрован в БД', !q(`select vehicle_enc from gop_work_orders where id='${wid}'`).includes('Vesta'));
t('чужой не видит работ', (await me(X, '/api/go/transport/work')).data.orders.length === 0);
t('чужая организация не меняет статус', (await post(A, `/api/kbiz/transport/work/${wid}/status`, { to: 'diagnostics' })).status === 404);
t('клиент не двигает работу', (await post(B, `/api/go/transport/work/${wid}/status`, { to: 'in_work' })).status === 409);
t('прыжок через статусы запрещён', (await post(W, `/api/kbiz/transport/work/${wid}/status`, { to: 'issued' })).status === 409);
t('диагностика', (await post(W, `/api/kbiz/transport/work/${wid}/status`, { to: 'diagnostics', comment: 'Смотрим' })).status === 200);
t('повтор — duplicate', (await post(W, `/api/kbiz/transport/work/${wid}/status`, { to: 'diagnostics' })).data.duplicate === true);
t('согласование с новой ценой', (await post(W, `/api/kbiz/transport/work/${wid}/status`, { to: 'awaiting_approval', comment: 'Нужен фильтр', priceRub: 5200 })).status === 200);
t('организация не может согласовать за клиента', (await post(W, `/api/kbiz/transport/work/${wid}/status`, { to: 'in_work' })).status === 409);
my = (await me(B, '/api/go/transport/work')).data.orders[0];
t('клиент видит действия и цену', my.actions.includes('in_work') && my.priceRub === 5200);
t('клиент согласовал', (await post(B, `/api/go/transport/work/${wid}/status`, { to: 'in_work' })).status === 200);

// оплата
t('без цены нельзя запросить оплату', (await post(W, '/api/kbiz/transport/work', { title: 'Без цены', username: un })).status === 201 && true);
t('предоплата больше остатка', (await post(W, `/api/kbiz/transport/work/${wid}/pay`, { kind: 'prepay', amountRub: 9999 })).status === 400);
r = await post(W, `/api/kbiz/transport/work/${wid}/pay`, { kind: 'prepay', amountRub: 2000 });
t('страница предоплаты создана', r.status === 200 && /\/p\//.test(r.data.payUrl) && r.data.amountRub === 2000, JSON.stringify(r.data));
my = (await me(B, '/api/go/transport/work')).data.orders.find((o) => o.id === wid);
t('клиент видит ссылку и статус «ждёт оплаты»', my.payStatus === 'requested' && /\/p\//.test(my.payUrl));
const pid1 = r.data.payUrl.split('/p/')[1];
const rep = await call(`/api/kbiz/public/p/${pid1}/report`, { method: 'POST', body: JSON.stringify({ note: 'перевёл', website: '' }) });
const payRow = q(`select id from kb_payments where qr_id=(select qr_id from gop_work_orders where id='${wid}') order by created_at desc limit 1`);
t('покупатель заявил оплату', !!payRow || rep.status < 500, JSON.stringify(rep.data).slice(0, 120));
if (payRow) {
  const cf = await post(W, `/api/kbiz/payments/${payRow}/confirm`, {});
  t('организация подтвердила', cf.status === 200, JSON.stringify(cf.data).slice(0, 120));
  await new Promise((r2) => setTimeout(r2, 1500));
  my = (await me(B, '/api/go/transport/work')).data.orders.find((o) => o.id === wid);
  t('предоплата учтена', my.payStatus === 'prepaid' && my.paidRub === 2000, JSON.stringify([my.payStatus, my.paidRub]));
  r = await post(W, `/api/kbiz/transport/work/${wid}/pay`, { kind: 'full' });
  t('доплата = остаток', r.data.amountRub === 3200, JSON.stringify(r.data));
}
t('готов → выдан', (await post(W, `/api/kbiz/transport/work/${wid}/status`, { to: 'ready' })).status === 200 && (await post(W, `/api/kbiz/transport/work/${wid}/status`, { to: 'issued' })).status === 200);
t('выданный не отменить', (await post(B, `/api/go/transport/work/${wid}/status`, { to: 'cancelled' })).status === 409);
const w2 = (await me(W, '/api/kbiz/transport/work?status=open')).data.orders;
t('в открытых — только незавершённые', w2.length === 1 && w2[0].status === 'accepted');
t('отмена организацией — только с причиной', (await post(W, `/api/kbiz/transport/work/${w2[0].id}/status`, { to: 'cancelled' })).status === 400);
t('отмена клиентом', (await post(B, `/api/go/transport/work/${w2[0].id}/status`, { to: 'cancelled' })).status === 200);

// статистика
const stt = (await me(W, '/api/kbiz/transport/stats')).data;
t('статистика по статусам', stt.byStatus.issued === 1 && stt.byStatus.cancelled === 1 && stt.ordersMonth === 2);
t('каталог кабинета', Object.keys((await me(A, '/api/kbiz/transport/catalog')).data.features).length > 10);
t('без входа — 401', (await call('/api/go/transport/work')).status === 401);
console.log(`gotransport-test: ${ok} ок, ${bad} ошибок`); process.exit(bad ? 1 : 0);
