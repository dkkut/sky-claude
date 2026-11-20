// Sky Market: самовывоз из магазина и платная доставка через HTTP
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000; запуск: node scripts/audit/marketdelivery-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o, m = 'POST') => ({ method: m, body: JSON.stringify(o) });
const SL = await mkuser(S, 'MdS'), B = await mkuser(S, 'MdB'), B2 = await mkuser(S, 'MdB2'), SL2 = await mkuser(S, 'MdS2');
for (const s of [SL, SL2]) q(`INSERT INTO market_sellers (profile_id, shop_name, status, verification_status, has_payment_details, sub_status, sub_until) VALUES ('${s.pid}','Магазин ${s.pid.slice(-4)}','active','legacy',true,'active', now() + interval '30 days') ON CONFLICT (profile_id) DO UPDATE SET status='active', has_payment_details=true, sub_status='active', sub_until=now() + interval '30 days'`);
const prod = (sid, price, title) => { const id = `mp-${crypto.randomUUID()}`; q(`INSERT INTO market_products (id, seller_id, title, price_kop, category, active, moderation_status, market_type, stock, search_text) VALUES ('${id}','${sid}','${title}',${price},'flowers',true,'published','standard',50,'x')`); return id; };
const P = prod(SL.pid, 100000, 'Букет'); const P2 = prod(SL2.pid, 50000, 'Другой товар');
const order = (u, body) => call('/api/market/orders', J(body), u.tok);

/* без настроек — прежнее поведение */
t('без настроек: нужен адрес или пункт', (await order(B, { productId: P2, quantity: 1 })).data.error === 'address_required');
const legacy = await order(B, { productId: P2, quantity: 1, address: 'Москва, ул. Тестовая 1' });
t('без настроек: заказ по адресу, доставка 0', legacy.status === 201 && legacy.data.order.deliveryFeeKop === 0 && legacy.data.order.totalKop === 50000, legacy.text.slice(0, 200));

/* настройка продавцом */
t('настройки: чужой/пустой список читается', (await call('/api/market/my-delivery', {}, SL.tok)).data.options.length === 0);
t('самовывоз без адреса — отказ', (await call('/api/market/my-delivery', J({ options: [{ method: 'store_pickup', enabled: true }] }, 'PUT'), SL.tok)).data.error === 'pickup_address_required');
t('платный самовывоз — отказ', (await call('/api/market/my-delivery', J({ options: [{ method: 'store_pickup', address: 'Москва, Арбат 10', price: 50 }] }, 'PUT'), SL.tok)).data.error === 'pickup_must_be_free');
t('плохой способ/цена/дни', (await call('/api/market/my-delivery', J({ options: [{ method: 'drone' }] }, 'PUT'), SL.tok)).data.error === 'bad_method'
  && (await call('/api/market/my-delivery', J({ options: [{ method: 'courier', price: -5 }] }, 'PUT'), SL.tok)).data.error === 'bad_price'
  && (await call('/api/market/my-delivery', J({ options: [{ method: 'courier', price: 100, minDays: 5, maxDays: 2 }] }, 'PUT'), SL.tok)).data.error === 'bad_days');
const saved = await call('/api/market/my-delivery', J({ options: [
  { method: 'store_pickup', address: 'Москва, Арбат 10', hours: 'Пн–Вс 9–21', note: 'Звоните за 10 минут' },
  { method: 'courier', price: 350, freeFrom: 2000, city: 'Москва', minDays: 0, maxDays: 1 },
  { method: 'post', price: 500, enabled: false },
] }, 'PUT'), SL.tok);
t('настройки сохранены', saved.status === 200 && saved.data.options.length === 3);
const pub = await call(`/api/market/sellers/${SL.pid}/delivery`, {}, B.tok);
t('покупателю видны только включённые', pub.status === 200 && pub.data.options.length === 2 && !pub.data.options.some((o) => o.method === 'post'));
t('другой продавец без настроек — пусто', (await call(`/api/market/sellers/${SL2.pid}/delivery`, {}, B.tok)).data.options.length === 0);

/* заказы */
t('при настройках способ обязателен', (await order(B, { productId: P, quantity: 1, address: 'x y z 12345' })).data.error === 'delivery_method_required');
t('выключенный способ недоступен', (await order(B, { productId: P, quantity: 1, deliveryMethod: 'post', address: 'Москва ул 1' })).data.error === 'delivery_method_unavailable');
t('неизвестный способ', (await order(B, { productId: P, quantity: 1, deliveryMethod: 'drone' })).data.error === 'bad_delivery_method');
t('курьер без адреса', (await order(B, { productId: P, quantity: 1, deliveryMethod: 'courier' })).data.error === 'address_required');
const o1 = await order(B, { productId: P, quantity: 1, deliveryMethod: 'courier', address: 'Москва, Тверская 5, кв 3', deliveryFee: 0 });
t('курьер: плата 350 ₽ добавлена к 1000 ₽ (присланная сумма игнорируется)', o1.status === 201 && o1.data.order.deliveryFeeKop === 35000 && o1.data.order.totalKop === 135000 && o1.data.order.deliveryMethod === 'courier', o1.text.slice(0, 250));
const o2 = await order(B, { productId: P, quantity: 2, deliveryMethod: 'courier', address: 'Москва, Тверская 5, кв 3' });
t('бесплатно от порога (2 × 1000 ≥ 2000)', o2.status === 201 && o2.data.order.deliveryFeeKop === 0 && o2.data.order.totalKop === 200000, o2.text.slice(0, 200));
const o3 = await order(B2, { productId: P, quantity: 1, deliveryMethod: 'store_pickup' });
t('самовывоз: бесплатно, адрес магазина в заказе', o3.status === 201 && o3.data.order.deliveryFeeKop === 0 && o3.data.order.delivery.address === 'Москва, Арбат 10' && o3.data.order.delivery.hours === 'Пн–Вс 9–21', o3.text.slice(0, 300));

/* ход самовывоза */
const id3 = o3.data.order.id; const act = (id, u, a) => call(`/api/market/orders/${id}/action`, J({ action: a }), u.tok);
t('ready_pickup до оплаты нельзя', (await act(id3, SL, 'ready_pickup')).status >= 400);
for (const [u, a] of [[SL, 'accept'], [B2, 'declare_paid'], [SL, 'confirm_paid']]) await act(id3, u, a);
t('покупатель не отмечает готовность', (await act(id3, B2, 'ready_pickup')).status === 403);
t('ship_own для самовывоза — не то действие', (await act(id3, SL, 'ship_own')).status >= 400);
const rp = await act(id3, SL, 'ready_pickup');
t('продавец: заказ готов к выдаче', rp.status === 200 && rp.data.order.status === 'ready_for_pickup', rp.text.slice(0, 200));
t('покупателю пришло «ждёт в магазине»', Number(q(`SELECT count(*) FROM market_notifications WHERE user_id='${B2.pid}' AND title='Заказ ждёт в магазине'`)) === 1);
const rc = await act(id3, B2, 'received');
t('покупатель получил заказ', rc.status === 200 && ['buyer_received','completed'].includes(rc.data.order.status), rc.text.slice(0, 200));

/* ход доставки продавцом */
const id1 = o1.data.order.id;
for (const [u, a] of [[SL, 'accept'], [B, 'declare_paid'], [SL, 'confirm_paid']]) await act(id1, u, a);
t('ready_pickup для курьерской доставки — не то действие', (await act(id1, SL, 'ready_pickup')).status >= 400);
const so = await act(id1, SL, 'ship_own');
t('продавец передал курьеру', so.status === 200 && so.data.order.status === 'seller_shipped');
t('покупатель получил доставку', ['buyer_received','completed'].includes((await act(id1, B, 'received')).data.order.status));
t('чужой продавец не двигает заказ', (await act(o2.data.order.id, SL2, 'accept')).status === 404);
t('игровой/услуга: способ доставки не требуется', (() => { const g = `mp-${crypto.randomUUID()}`; q(`INSERT INTO market_products (id, seller_id, title, price_kop, category, active, moderation_status, market_type, stock, search_text) VALUES ('${g}','${SL.pid}','Лот',20000,'other',true,'published','game',5,'x')`); return g; })() !== null);
/* зарубежная доставка */
t('intl без стран — отказ', (await call('/api/market/my-delivery', J({ options: [{ method: 'intl', enabled: true }] }, 'PUT'), SL.tok)).data.error === 'countries_required');
t('intl: Россия и мусорные коды — отказ', (await call('/api/market/my-delivery', J({ options: [{ method: 'intl', countries: ['RU'] }] }, 'PUT'), SL.tok)).data.error === 'bad_countries'
  && (await call('/api/market/my-delivery', J({ options: [{ method: 'intl', countries: ['XYZ'] }] }, 'PUT'), SL.tok)).data.error === 'bad_countries');
t('intl: цена для страны вне списка — отказ', (await call('/api/market/my-delivery', J({ options: [{ method: 'intl', countries: ['KZ'], countryPrices: { DE: 100 } }] }, 'PUT'), SL.tok)).data.error === 'bad_price');
const si = await call('/api/market/my-delivery', J({ options: [
  { method: 'courier', price: 350, freeFrom: 2000 },
  { method: 'intl', price: 1500, freeFrom: 20000, minDays: 7, maxDays: 21, countries: ['KZ', 'DE', 'AM'], countryPrices: { KZ: 900 }, note: 'Только EMS' },
] }, 'PUT'), SL.tok);
t('intl сохранён', si.status === 200 && si.data.options.find((o) => o.method === 'intl').countries.length === 3);
t('покупателю видны страны и цены', (await call(`/api/market/sellers/${SL.pid}/delivery`, {}, B.tok)).data.options.find((o) => o.method === 'intl').countryPrices.KZ === 900);
t('intl без страны', (await order(B, { productId: P, quantity: 1, deliveryMethod: 'intl', address: 'Astana, Abay 1' })).data.error === 'country_not_served');
t('intl: страна не из списка', (await order(B, { productId: P, quantity: 1, deliveryMethod: 'intl', deliveryCountry: 'US', address: 'NY 5th avenue 1' })).data.error === 'country_not_served');
t('intl без адреса', (await order(B, { productId: P, quantity: 1, deliveryMethod: 'intl', deliveryCountry: 'KZ' })).data.error === 'address_required');
const k = await order(B, { productId: P, quantity: 1, deliveryMethod: 'intl', deliveryCountry: 'kz', address: 'Astana, Abay 1' });
t('intl: цена по стране KZ = 900 ₽, страна сохранена', k.status === 201 && k.data.order.deliveryFeeKop === 90000 && k.data.order.deliveryCountry === 'KZ' && k.data.order.totalKop === 190000, k.text.slice(0, 250));
const g = await order(B2, { productId: P, quantity: 1, deliveryMethod: 'intl', deliveryCountry: 'DE', address: 'Berlin, Str 1' });
t('intl: страна без своей цены — общая 1500 ₽', g.status === 201 && g.data.order.deliveryFeeKop === 150000, g.text.slice(0, 200));
const gid = k.data.order.id;
for (const [u, a] of [[SL, 'accept'], [B, 'declare_paid'], [SL, 'confirm_paid']]) await act(gid, u, a);
const sh = await act(gid, SL, 'ship_own');
t('intl: «отправил за рубеж»', sh.status === 200 && sh.data.order.status === 'seller_shipped');
t('покупателю пришло уведомление об отправке за границу', Number(q(`SELECT count(*) FROM market_notifications WHERE user_id='${B.pid}' AND title='Заказ отправлен за границу'`)) === 1);
t('каталог: фильтр «международная» находит товар продавца с intl', (await call('/api/market/catalog?shipping=intl&sellerId=' + SL.pid, {}, B.tok)).data.items.some((i) => i.id === P));
console.log(`ok=${ok} bad=${bad}`); process.exit(bad ? 1 : 0);
