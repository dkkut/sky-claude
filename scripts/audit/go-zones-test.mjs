// Sky GO: зоны внутри города + доставка «на потом». API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000 (. env.sh; node scripts/audit/go-zones-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { transitionAllowed } from '../../server/gostate.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const ADM = (path, o, tok) => call('/api/admin/go' + path, o, tok);
const J = (b, m = 'POST') => ({ method: m, body: JSON.stringify(b) });
const PUT = (b) => ({ method: 'PUT', body: JSON.stringify({ value: b }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITY = 'Москва';
const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();

t('таблица: доставка scheduled → searching (система) и → cancelled', transitionAllowed('delivery', 'scheduled', 'searching') && transitionAllowed('delivery', 'scheduled', 'cancelled') && !transitionAllowed('delivery', 'scheduled', 'assigned'));

const A = await mkuser(S, 'znAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const D = await mkuser(S, 'znDisp'); q(`update profiles set is_admin=true, admin_role='go_admin' where id='${D.pid}'`);
const C = await mkuser(S, 'znCust'); const X = await mkuser(S, 'znOther');
const cfg0 = await G('/config', {}, C.tok);
if (!cfg0.data.cities?.includes(CITY)) await ADM('/settings/cities', PUT([CITY]), A.tok);
if (!Object.keys(cfg0.data.taxiTariffs ?? {}).length) await ADM('/settings/taxi_tariffs', PUT({ economy: { title: 'Эконом', base: 80, perKm: 14, perMin: 4, min: 150 } }), A.tok);
await ADM('/settings/delivery_tariff', PUT({ base: 100, perKm: 20, minRub: 150, foodBase: 50, foodPerKm: 10, foodMin: 100, sizeSurcharge: { s: 0, m: 50, l: 150 } }), A.tok);
q(`delete from go_zones`);
await sleep(16000);   // кэш настроек 15 с

const FROM = { address: 'Тверская 1', lat: 55.76, lng: 37.62 }; const TO = { address: 'Арбат 10', lat: 55.75, lng: 37.59 };
const tBody = (extra = {}) => ({ city: CITY, from: FROM, to: TO, tariff: 'economy', ...extra });
const dBody = (extra = {}) => ({ scenario: 'p2p', city: CITY, from: FROM, to: TO, size: 's', parcel: { description: 'Документы', weightKg: 1, size: 's' },
  sender: { name: 'Отправитель', phone: '+79990000001' }, recipient: { name: 'Получатель', phone: '+79990000002' }, ...extra });

let r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok); const base = r.data;
const basePrice = base.offers.find((o) => o.code === 'economy').priceRub;
r = await G('/delivery/quote', J(dBody()), C.tok); const dBase = r.data;

/* Права */
r = await ADM('/zones', {}, D.tok); t('диспетчер (право go) зоны видит', r.status === 200 && Array.isArray(r.data.zones));
r = await ADM('/zones', J({ city: CITY, name: 'Центр', kind: 'surcharge', lat: 55.76, lng: 37.62, radiusKm: 1, surchargeRub: 100 }), D.tok); t('диспетчер без go_finance зону создать не может', r.status === 403, JSON.stringify(r.data));
r = await ADM('/zones', {}, C.tok); t('обычный человек зоны не видит', r.status === 403);

/* Проверка полей */
const Z = { city: CITY, name: 'Тверская доплата', kind: 'surcharge', lat: 55.76, lng: 37.62, radiusKm: 1, surchargeRub: 100 };
for (const [n, patch, code] of [['пустое имя', { name: '' }, 'name_required'], ['радиус 0', { radiusKm: 0 }, 'bad_radius'], ['радиус 500 км', { radiusKm: 500 }, 'bad_radius'], ['широта 99', { lat: 99 }, 'bad_point'], ['вид «зелёная»', { kind: 'green' }, 'bad_kind'], ['доплата 0', { surchargeRub: 0 }, 'bad_surcharge'], ['доплата 99999', { surchargeRub: 99999 }, 'bad_surcharge'], ['без услуг', { services: ['bus'] }, 'bad_services']]) {
  r = await ADM('/zones', J({ ...Z, ...patch }), A.tok); t(`отклонено: ${n}`, r.status === 400 && r.data.error === code, JSON.stringify(r.data));
}
r = await ADM('/zones', J(Z), A.tok); const zid = r.data.id; t('зона создана', r.status === 200 && /^gz-/.test(zid), JSON.stringify(r.data));
t('создание записано в журнал администрации', Number(q(`select count(*) from admin_log where type='go_zone' and target_id='${zid}'`)) >= 1);
await sleep(100);

/* Доплата */
r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok); let qt = r.data;
const off = qt.offers.find((o) => o.code === 'economy');
t('такси: доплата за зону входит в цену и в состав цены', off.priceRub === basePrice + 100 && off.breakdown.zoneRub === 100 && off.breakdown.zones[0].name === 'Тверская доплата' && off.breakdown.totalRub === off.priceRub, JSON.stringify(off));
t('версия тарифа изменилась из-за зоны', qt.tariffVersion !== base.tariffVersion);
r = await G('/taxi/quote', J({ city: CITY, from: { lat: 55.9, lng: 37.9 }, to: { lat: 55.91, lng: 37.95 } }), C.tok);
t('вне зоны цена без доплаты', r.status === 200 && !r.data.offers[0].breakdown.zoneRub, JSON.stringify(r.data).slice(0, 200));
r = await G('/taxi/orders', J(tBody({ quoteId: qt.quoteId })), C.tok); const o1 = r.data.orderId;
t('заказ по котировке берёт цену с доплатой', r.status === 201 && Number(q(`select price_rub from go_orders where id='${o1}'`)) === basePrice + 100, JSON.stringify(r.data));
await G(`/taxi/orders/${o1}/cancel`, J({}), C.tok);
r = await G('/delivery/quote', J(dBody()), C.tok);
t('доставка: доплата за зону во всех размерах', r.data.prices.s === dBase.prices.s + 100 && r.data.prices.l === dBase.prices.l + 100 && r.data.zones?.[0]?.rub === 100, JSON.stringify(r.data).slice(0, 220));
const dq = r.data;

/* Зона не двойная: и подача, и назначение внутри — одна доплата */
r = await ADM(`/zones/${zid}`, J({ ...Z, radiusKm: 20 }, 'PUT'), A.tok); t('радиус изменён', r.status === 200);
await sleep(16000);
r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok);
t('подача и назначение в одной зоне — доплата одна', r.data.offers[0].breakdown.zoneRub === 100, JSON.stringify(r.data.offers[0].breakdown));

/* Услуга только «доставка» */
r = await ADM(`/zones/${zid}`, J({ ...Z, radiusKm: 20, services: ['delivery'] }, 'PUT'), A.tok);
await sleep(16000);
r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok); t('зона только для доставки такси не касается', !r.data.offers[0].breakdown.zoneRub);
r = await G('/delivery/quote', J(dBody()), C.tok); t('…а доставку касается', r.data.zones?.[0]?.rub === 100);

/* Выключение и повторное включение */
r = await ADM(`/zones/${zid}/active`, J({ active: false }), A.tok); t('зона выключена', r.status === 200);
await sleep(16000);
r = await G('/delivery/quote', J(dBody()), C.tok); t('выключенная зона не действует', !r.data.zones?.length && r.data.prices.s === dBase.prices.s);
await ADM(`/zones/${zid}/active`, J({ active: true }), A.tok);

/* Закрытая зона */
r = await ADM('/zones', J({ city: CITY, name: 'Закрытый район', kind: 'closed', lat: 55.75, lng: 37.59, radiusKm: 0.5, services: ['taxi', 'delivery'] }), A.tok); const cz = r.data.id; t('закрытая зона создана', r.status === 200, JSON.stringify(r.data));
await sleep(16000);
r = await G('/taxi/quote', J({ city: CITY, from: FROM, to: TO }), C.tok); t('такси: точка в закрытой зоне — отказ с названием', r.status >= 400 && r.data.error === 'zone_closed' && r.data.zone === 'Закрытый район', JSON.stringify(r.data));
r = await G('/taxi/orders', J(tBody()), C.tok); t('заказ в закрытую зону не создаётся', r.status >= 400 && r.data.error === 'zone_closed');
r = await G('/delivery/quote', J(dBody()), C.tok); t('доставка: закрытая зона — отказ', r.status >= 400 && r.data.error === 'zone_closed');
r = await G('/delivery/orders', J(dBody()), C.tok); t('заказ доставки в закрытую зону не создаётся', r.status >= 400 && r.data.error === 'zone_closed');
t('отказ не оставил заказов', q(`select count(*) from go_orders where customer_id='${C.pid}' and status in ('searching','scheduled')`) === '0');
r = await G('/taxi/quote', J({ city: CITY, from: { lat: 55.9, lng: 37.9 }, to: { lat: 55.91, lng: 37.95 } }), C.tok); t('точки вне закрытой зоны работают', r.status === 200);
r = await ADM(`/zones/${cz}`, { method: 'DELETE', body: '{}' }, D.tok); t('удалить зону без go_finance нельзя', r.status === 403);
r = await ADM(`/zones/${cz}`, { method: 'DELETE', body: '{}' }, A.tok); t('закрытая зона удалена', r.status === 200);
r = await ADM(`/zones/${cz}`, { method: 'DELETE', body: '{}' }, A.tok); t('повторное удаление — not_found', r.status === 404);
await ADM(`/zones/${zid}`, { method: 'DELETE', body: '{}' }, A.tok);
await sleep(16000);

/* Доставка «на потом» */
r = await G('/delivery/orders', J(dBody({ scheduledAt: 'мусор' })), C.tok); t('доставка: мусор вместо времени отклонён', r.data.error === 'bad_schedule');
r = await G('/delivery/orders', J(dBody({ scheduledAt: inMin(5) })), C.tok); t('доставка: слишком скоро', r.data.error === 'schedule_too_soon');
r = await G('/delivery/orders', J(dBody({ scheduledAt: inMin(60 * 24 * 40) })), C.tok); t('доставка: слишком далеко', r.data.error === 'schedule_too_far');
r = await G('/delivery/quote', J(dBody()), C.tok);
r = await G('/delivery/orders', J(dBody({ quoteId: r.data.quoteId, scheduledAt: inMin(180) })), C.tok); const sid = r.data.orderId;
t('доставка «на потом» создана: scheduled, время и цена сохранены, коды выданы', r.status === 201 && q(`select status||'|'||(scheduled_at is not null)||'|'||(price_rub>0) from go_orders where id='${sid}'`) === 'scheduled|true|true' && Number(q(`select count(*) from go_order_codes where order_id='${sid}'`)) === 2, JSON.stringify(r.data));
t('до наступления времени предложений курьерам нет', q(`select count(*) from go_order_offers where order_id='${sid}'`) === '0');
r = await G('/delivery/orders', J(dBody({ scheduledAt: inMin(190) })), C.tok); t('доставка: второй заказ на близкое время — конфликт', r.status === 409 && r.data.error === 'schedule_conflict', JSON.stringify(r.data));
r = await G('/delivery/orders', J(dBody()), C.tok); t('запланированная доставка не мешает заказать сейчас', r.status === 201, JSON.stringify(r.data));
await G(`/delivery/orders/${r.data.orderId}/cancel`, J({}), C.tok);
r = await G(`/delivery/orders/${sid}/cancel`, J({}), X.tok); t('чужую запланированную доставку отменить нельзя', r.status === 404 || r.status === 403);
q(`update go_orders set scheduled_at = now() + interval '10 minutes' where id='${sid}'`);
let st = 'scheduled';
for (let i = 0; i < 20 && st === 'scheduled'; i += 1) { await sleep(1500); st = q(`select status from go_orders where id='${sid}'`); }
t('за lead минут до времени поиск курьера начался сам', st === 'searching', st);
t('уведомление об одном старте', q(`select count(*) from go_notified where key like '%${sid}:sched-start'`) === '1');
r = await G(`/delivery/orders/${sid}/cancel`, J({}), C.tok); t('после старта отмена по обычным правилам', r.status === 200);
// отмена до старта
r = await G('/delivery/orders', J(dBody({ scheduledAt: inMin(400) })), C.tok); const s2 = r.data.orderId;
r = await G(`/delivery/orders/${s2}/cancel`, J({}), C.tok); t('отмена запланированной доставки до начала поиска', r.status === 200 && q(`select status from go_orders where id='${s2}'`) === 'cancelled', JSON.stringify(r.data));

console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
