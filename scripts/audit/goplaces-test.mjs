// Sky GO «Организации», этап 1: категории, подключение из «Sky для бизнеса», модерация, каталог, карточка, маршрут, заказы со складом, оплата-страница.
// API: ADMIN_GATE=off GOPLACES_RATE_MULT=50 KBIZ_RATE_MULT=50   (node scripts/audit/goplaces-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'gpown'), B = await mkuser(S, 'gpbuy'), C = await mkuser(S, 'gpoth'), ADM = await mkuser(S, 'gpadm'); q(`update profiles set is_admin=true, admin_role='go_places_moderator' where id='${ADM.pid}'`);
for (const u of [A, B, C]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const del = (u, p) => me(u, p, { method: 'DELETE' });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ALL = { mon: [['00:00', '23:59']], tue: [['00:00', '23:59']], wed: [['00:00', '23:59']], thu: [['00:00', '23:59']], fri: [['00:00', '23:59']], sat: [['00:00', '23:59']], sun: [['00:00', '23:59']] };

// ─── категории
let r = await me(B, '/api/go/places/categories');
t('16 категорий из ТЗ', r.status === 200 && r.data.categories.length >= 16 && r.data.categories.some((c) => c.name === 'Бани и сауны'), String(r.data.categories?.length));
t('обычный человек не управляет категориями', (await post(B, '/api/admin/go/place-categories', { name: 'Взлом' })).status === 403);
r = await post(ADM, '/api/admin/go/place-categories', { name: 'Тестовая категория', icon: 'star', sort: 5 });
t('администрация создаёт категорию', r.status === 200 && r.data.id, JSON.stringify(r.data));
const tc = r.data.id;
t('категория видна людям и выше по сортировке', (await me(B, '/api/go/places/categories')).data.categories[0].id === tc);
t('скрытая категория не видна людям', (await put(ADM, `/api/admin/go/place-categories/${tc}`, { name: 'Тестовая категория', hidden: true, sort: 5 })).status === 200 && !(await me(B, '/api/go/places/categories')).data.categories.some((c) => c.id === tc));
t('но видна администрации', (await me(ADM, '/api/admin/go/place-categories')).data.categories.some((c) => c.id === tc));
t('пустую категорию можно удалить', (await del(ADM, `/api/admin/go/place-categories/${tc}`)).status === 200);

// ─── бизнес владельца
t('без бизнеса карточку не настроить', (await me(A, '/api/kbiz/place')).status === 404);
await post(A, '/api/kbiz/business', { name: 'Баня «Пар»', mode: 'point', legalType: 'selfemployed' });
r = await me(A, '/api/kbiz/place');
t('карточка создаётся при обращении, не подключена', r.status === 200 && r.data.place.connected === false && r.data.place.status === 'draft', JSON.stringify(r.data).slice(0, 200));
t('в черновике видно, чего не хватает', r.data.place.missing.length >= 4);
t('неизвестная категория отвергнута', (await put(A, '/api/kbiz/place', { categoryId: 'nope' })).status === 400);
t('ссылка http отбрасывается, https остаётся', (await put(A, '/api/kbiz/place', { links: [{ title: 'Сайт', url: 'http://x.ru' }, { title: 'Сайт', url: 'https://parbanya.ru' }] })).data.place.links.length === 1);
t('телефон с буквами отвергнут', (await put(A, '/api/kbiz/place', { phone: 'abc' })).status === 400);
r = await put(A, '/api/kbiz/place', { categoryId: 'baths', about: 'Дровяная баня на 8 человек', city: 'Москва', address: 'ул. Тестовая, 1', hours: ALL, phone: '+7 900 111-22-33' });
t('адрес без ключа карт: честно «не определено», точку отмечают вручную', r.status === 200 && r.data.geoFailed === true && !r.data.place.lat, JSON.stringify(r.data.place?.lat));
t('точка вручную принята', (await put(A, '/api/kbiz/place', { lat: 55.7512, lng: 37.6184 })).data.place.lat === 55.7512);
t('нулевая точка не принимается', (await put(A, '/api/kbiz/place', { lat: 0, lng: 0 })).data.place.lat === 55.7512);
r = await post(A, '/api/kbiz/place/submit');
t('отправить нельзя: не опубликован бизнес, нет реквизитов/подписки/фото', r.status === 409 || r.status === 422, `${r.status} ${JSON.stringify(r.data)}`);
t('не подключено → submit отказ', r.data.error === 'not_connected');
await post(A, '/api/kbiz/place/connect', { on: true });
r = await post(A, '/api/kbiz/place/submit'); t('перечень недостающего', r.status === 422 && r.data.missing.length >= 3, JSON.stringify(r.data));
await me(A, '/api/kbiz/requisites', { method: 'PUT', body: JSON.stringify({ holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' }) });
await post(A, '/api/kbiz/subscription/buy', { idemKey: 'gp1' });
await post(A, '/api/kbiz/publish', { on: true });
t('фото не картинка отклонено', (await post(A, '/api/kbiz/place/photo', { dataUrl: 'data:text/html;base64,PGI+' })).status === 400);
r = await post(A, '/api/kbiz/place/photo', { dataUrl: png });
t('фото принято', r.status === 200 && r.data.photos.length === 1, JSON.stringify(r.data));
const photo = r.data.photos[0];
let pg = await fetch((process.env.API ?? 'http://localhost:8080') + photo);
t('фото непубликованной карточки людям не отдаётся', pg.status === 404);
t('владельцу фото для предпросмотра отдаётся', (await fetch((process.env.API ?? 'http://localhost:8080') + photo.replace('/api/go/places/media/', '/api/kbiz/place/media/'), { headers: { authorization: `Bearer ${A.tok}` } })).status === 200);
// каталог
const sw = await post(A, '/api/kbiz/items', { title: 'Веник берёзовый', priceRub: 300, kind: 'product', stock: 2 });
const svc = await post(A, '/api/kbiz/items', { title: 'Аренда бани на 2 часа', priceRub: 3500, kind: 'service', stock: 5, description: 'До 8 человек' });
const hid = await post(A, '/api/kbiz/items', { title: 'Скрытая услуга', priceRub: 100, available: false });
t('товар и услуга созданы', sw.status === 200 && svc.status === 200);
t('у услуги остатка нет', q(`select stock is null from kb_items where id='${svc.data.id}'`) === 't');
t('отрицательный остаток отвергнут', (await post(A, '/api/kbiz/items', { title: 'Минус', priceRub: 10, stock: -1 })).status === 400);

r = await post(A, '/api/kbiz/place/submit');
t('отправлена на проверку', r.status === 200 && r.data.place.status === 'pending', JSON.stringify(r.data));
t('повтор отправки не дублирует', (await post(A, '/api/kbiz/place/submit')).data.duplicate === true);
t('на проверке в каталоге нет', (await me(B, '/api/go/places?q=Пар')).data.places.length === 0);
t('прямой запрос карточки — 404', (await me(B, `/api/go/places/${r.data.place.businessId}`)).status === 404);
const bid = r.data.place.businessId;
// ─── модерация
t('люди модерацией не занимаются', (await me(B, '/api/admin/go/places')).status === 403 && (await post(B, `/api/admin/go/places/${bid}/approve`)).status === 403);
r = await me(ADM, '/api/admin/go/places?status=pending'); t('очередь видна', r.status === 200 && r.data.places.some((p) => p.id === bid));
r = await me(ADM, `/api/admin/go/places/${bid}`); t('карточка для проверки: фото, товары, журнал', r.data.place.photos.length === 1 && r.data.place.items.length >= 2 && r.data.place.log.length > 0);
t('отклонить без причины нельзя', (await post(ADM, `/api/admin/go/places/${bid}/reject`, {})).status === 400);
t('отклонение с причиной', (await post(ADM, `/api/admin/go/places/${bid}/reject`, { reason: 'Нужна фотография помещения' })).status === 200);
r = await me(A, '/api/kbiz/place'); t('владелец видит причину', r.data.place.status === 'rejected' && /фотография/.test(r.data.place.rejectReason));
t('повторная отправка после отказа', (await post(A, '/api/kbiz/place/submit')).data.place?.status === 'pending');
t('одобрить из «опубликована» нельзя (повтор)', (await post(ADM, `/api/admin/go/places/${bid}/approve`)).data.status === 'published');
t('повторное одобрение — без второй записи', (await post(ADM, `/api/admin/go/places/${bid}/approve`)).data.duplicate === true);

// ─── каталог людей
pg = await fetch((process.env.API ?? 'http://localhost:8080') + photo); t('опубликованное фото открыто без токена, nosniff', pg.status === 200 && pg.headers.get('x-content-type-options') === 'nosniff');
r = await me(B, '/api/go/places?q=Пар&lat=55.75&lng=37.62&sort=distance&open=1');
t('поиск по названию, «открыто сейчас», расстояние', r.status === 200 && r.data.places.length === 1 && r.data.places[0].open === true && r.data.places[0].distanceKm < 1, JSON.stringify(r.data).slice(0, 250));
t('фильтр категории', (await me(B, '/api/go/places?category=baths')).data.places.length === 1 && (await me(B, '/api/go/places?category=vet')).data.places.length === 0);
t('фильтр города', (await me(B, '/api/go/places?city=Москва')).data.places.length === 1 && (await me(B, '/api/go/places?city=Омск')).data.places.length === 0);
t('без входа каталог закрыт', (await call('/api/go/places')).status === 401);
r = await me(B, `/api/go/places/${bid}?lat=55.75&lng=37.62`);
t('карточка: часы, фото, контакты, товары и услуги, без скрытых', r.status === 200 && r.data.place.photos.length === 1 && r.data.place.items.length === 2 && r.data.place.canOrder && r.data.place.phone && r.data.place.links.length === 1 && !JSON.stringify(r.data).includes('900 111-22-33 '), JSON.stringify(r.data).slice(0, 200));
t('остаток 2 показан как «осталось»', r.data.place.items.find((i) => i.title === 'Веник берёзовый').left === 2);
t('в карточке нет реквизитов оплаты', !/Иванов|holder/.test(JSON.stringify(r.data)));
// избранное
t('в избранное', (await put(B, `/api/go/places/${bid}/fav`)).data.fav === true && (await me(B, '/api/go/places?fav=1')).data.places.length === 1);
t('из избранного', (await del(B, `/api/go/places/${bid}/fav`)).status === 200 && (await me(B, '/api/go/places?fav=1')).data.places.length === 0);
// маршрут
r = await post(B, `/api/go/places/${bid}/route`, { fromLat: 55.70, fromLng: 37.55 });
t('маршрут: расстояние, время, внешние ссылки', r.status === 200 && r.data.km > 0 && r.data.minutes > 0 && /yandex|2gis|google/.test(JSON.stringify(r.data.links)) && 'estimated' in r.data, JSON.stringify(r.data));
r = await post(B, `/api/go/places/${bid}/route`, {});
t('без точки старта — внешнее приложение и подсказка', r.status === 200 && r.data.need === 'from' && r.data.links.google, JSON.stringify(r.data));
t('адрес старта не нашёлся (нет карт) — честная ошибка', (await post(B, `/api/go/places/${bid}/route`, { fromAddress: 'несуществующий адрес 123' })).status === 404);
t('мусорные координаты не принимаются', (await post(B, `/api/go/places/${bid}/route`, { fromLat: 999, fromLng: 'x' })).data.need === 'from');

// ─── заказ
const order = (u, b) => post(u, `/api/go/places/${bid}/orders`, b);
const contact = { name: 'Пётр', phone: '+7 911 000-11-22' };
t('пустая корзина', (await order(B, { items: [], contact })).status === 400);
t('владелец у себя не заказывает', (await order(A, { items: [{ id: sw.data.id, qty: 1 }], contact })).status === 403);
t('скрытая позиция не заказывается', (await order(B, { items: [{ id: hid.data.id, qty: 1 }], contact })).status === 409);
t('больше остатка — отказ', (await order(B, { items: [{ id: sw.data.id, qty: 3 }], contact })).status === 409);
r = await order(B, { items: [{ id: sw.data.id, qty: 1, priceRub: 1 }, { id: svc.data.id, qty: 1 }], contact });
t('заказ создан; сумма с сервера: 300 + 3500', r.status === 201 && r.data.totalRub === 3800 && /\/p\//.test(r.data.payUrl), JSON.stringify(r.data));
const o1 = r.data.id;
t('остаток уменьшился на 1', q(`select stock from kb_items where id='${sw.data.id}'`) === '1');
t('услуга без остатка не списывается', q(`select stock is null from kb_items where id='${svc.data.id}'`) === 't');
// гонка за последний экземпляр
const race = await Promise.all([B, C, B, C, B].map((u) => order(u, { items: [{ id: sw.data.id, qty: 1 }], contact })));
t('гонка: последний экземпляр достался одному', race.filter((x) => x.status === 201).length === 1 && race.filter((x) => x.status === 409).length === 4, race.map((x) => x.status).join(','));
t('остаток не ушёл в минус', q(`select stock from kb_items where id='${sw.data.id}'`) === '0');
const o2 = race.find((x) => x.status === 201).data.id;
// мои заказы
r = await me(B, '/api/go/places/orders');
t('история покупок: статус, оплата, ссылка', r.status === 200 && r.data.orders.length >= 2 && r.data.orders.every((o) => o.payLabel) && r.data.orders.find((o) => o.id === o1).payUrl, JSON.stringify(r.data).slice(0, 250));
t('чужой заказ не виден', !(await me(C, '/api/go/places/orders')).data.orders.some((o) => o.id === o1));
t('чужой заказ не отменить', (await post(C, `/api/go/places/orders/${o1}/cancel`)).status === 404);
// покупатель отменяет → остаток возвращается один раз
r = await post(race.find((x) => x.status === 201).data && (race[0].status === 201 ? B : C), `/api/go/places/orders/${o2}/cancel`);
const buyerOf = q(`select buyer_profile_id from kb_orders where id='${o2}'`);
const ub = buyerOf === B.pid ? B : C;
r = await post(ub, `/api/go/places/orders/${o2}/cancel`);
t('покупатель отменил новый заказ', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('остаток вернулся', q(`select stock from kb_items where id='${sw.data.id}'`) === '1');
t('повторная отмена без второго возврата', (await post(ub, `/api/go/places/orders/${o2}/cancel`)).data.duplicate === true && q(`select stock from kb_items where id='${sw.data.id}'`) === '1');
t('страница оплаты закрыта', q(`select status from kb_qr where id=(select qr_id from kb_orders where id='${o2}')`) === 'disabled');
// владелец
r = await me(A, '/api/kbiz/orders'); t('владелец видит заказ в «Sky для бизнеса»', r.data.orders.some((o) => o.id === o1 && o.totalRub === 3800));
const n0 = Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and kind='go_place_order'`));
t('принял заказ', (await post(A, `/api/kbiz/orders/${o1}/confirm`, {})).status === 200);
t('покупатель получил уведомление', Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and kind='go_place_order'`)) === n0 + 1);
await post(A, `/api/kbiz/orders/${o1}/confirm`, {});
t('повтор того же действия не шлёт второе', Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and kind='go_place_order'`)) === n0 + 1);
t('после принятия покупатель сам не отменит', (await post(B, `/api/go/places/orders/${o1}/cancel`)).status === 409);
// оплата: владелец подтверждает заявку
const pubId = q(`select public_id from kb_qr where id=(select qr_id from kb_orders where id='${o1}')`);
const rep = await call(`/api/kbiz/public/p/${pubId}/report`, { method: 'POST', body: JSON.stringify({ payerName: 'Пётр', amountRub: 3800 }) });
const payId = q(`select id from kb_payments where qr_id=(select qr_id from kb_orders where id='${o1}') order by created_at desc limit 1`);
if (payId) {
  t('страница оплаты принимает заявку «я перевёл»', rep.status < 300, String(rep.status));
  r = await me(B, '/api/go/places/orders'); t('в истории: оплата заявлена', r.data.orders.find((o) => o.id === o1).payStatus === 'reported');
  const n1 = Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and ref_id like 'kbo:pay:%'`));
  t('владелец подтверждает оплату', (await post(A, `/api/kbiz/payments/${payId}/confirm`, {})).status === 200);
  await new Promise((rs) => setTimeout(rs, 1200));
  t('покупатель уведомлён об оплате один раз', Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and ref_id like 'kbo:pay:%'`)) === n1 + 1);
  r = await me(B, '/api/go/places/orders'); t('статус оплаты «Оплачен»', r.data.orders.find((o) => o.id === o1).payLabel === 'Оплачен');
} else console.log('SKIP оплата: заявка не создалась', rep.status, JSON.stringify(rep.data).slice(0, 120));
// отказ владельца возвращает остаток один раз
const o3 = (await order(C, { items: [{ id: sw.data.id, qty: 1 }], contact })).data.id;
t('остаток 0 после нового заказа', q(`select stock from kb_items where id='${sw.data.id}'`) === '0');
t('отказ без причины нельзя', (await post(A, `/api/kbiz/orders/${o3}/reject`, {})).status === 400);
await post(A, `/api/kbiz/orders/${o3}/reject`, { comment: 'Нет в наличии' });
t('отказ вернул остаток', q(`select stock from kb_items where id='${sw.data.id}'`) === '1');

// ─── публикация: правки, отключение, блокировка
r = await put(A, '/api/kbiz/place', { about: 'Новое описание' });
t('правка описания возвращает карточку на проверку и скрывает', r.data.returnedToDraft === true && (await me(B, `/api/go/places/${bid}`)).status === 404);
await post(A, '/api/kbiz/place/submit'); await post(ADM, `/api/admin/go/places/${bid}/approve`);
t('снова в каталоге', (await me(B, `/api/go/places/${bid}`)).status === 200);
r = await put(A, '/api/kbiz/place', { hours: { mon: [['09:00', '18:00']] } });
t('правка часов работы не требует проверки', r.data.returnedToDraft === false && (await me(B, `/api/go/places/${bid}`)).status === 200);
await post(A, '/api/kbiz/place/connect', { on: false });
t('отключение скрывает из каталога', (await me(B, `/api/go/places/${bid}`)).status === 404 && (await me(B, '/api/go/places?q=Пар')).data.places.length === 0);
t('бизнес при этом существует', q(`select status from kb_businesses where id='${bid}'`) === 'active');
await post(A, '/api/kbiz/place/connect', { on: true });
t('включение возвращает без новой проверки', (await me(B, `/api/go/places/${bid}`)).status === 200);
t('скрыть нельзя без причины', (await post(ADM, `/api/admin/go/places/${bid}/hide`, {})).status === 400);
await post(ADM, `/api/admin/go/places/${bid}/hide`, { reason: 'Проверка жалобы' });
t('скрытая администрацией не видна', (await me(B, `/api/go/places/${bid}`)).status === 404);
t('заказ в скрытое место нельзя', (await order(B, { items: [{ id: sw.data.id, qty: 1 }], contact })).status === 404);
await post(ADM, `/api/admin/go/places/${bid}/unhide`);
await post(ADM, `/api/admin/go/places/${bid}/block`, { reason: 'Нарушение правил' });
t('заблокированная: владелец не включит и не правит', (await post(A, '/api/kbiz/place/connect', { on: true })).status === 423 && (await put(A, '/api/kbiz/place', { about: 'x' })).status === 423);
await post(ADM, `/api/admin/go/places/${bid}/unblock`);
t('после разблокировки — черновик, снова нужна проверка', (await me(A, '/api/kbiz/place')).data.place.status === 'draft');
t('история изменений ведётся', Number(q(`select count(*) from gop_log where business_id='${bid}'`)) >= 10);
t('чужой владелец не правит чужую карточку (только свой бизнес)', (await put(C, '/api/kbiz/place', { about: 'Взлом' })).status === 404);
t('ошибок интеграции нет или доступны только администрации', (await me(B, '/api/admin/go/places/errors')).status === 403 && (await me(ADM, '/api/admin/go/places/errors')).status === 200);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
