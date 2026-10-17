// Sky GO: заказ такси «на потом». API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000 (. env.sh; node scripts/audit/go-schedule-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { transitionAllowed } from '../../server/gostate.mjs';
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
const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();

t('таблица: scheduled → searching (система) и → cancelled, но не сразу в assigned', transitionAllowed('taxi', 'scheduled', 'searching') && transitionAllowed('taxi', 'scheduled', 'cancelled') && !transitionAllowed('taxi', 'scheduled', 'assigned'));

const A = await mkuser(S, 'scAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const C = await mkuser(S, 'scCust'); const X = await mkuser(S, 'scOther');
let cfg = await G('/config', {}, C.tok);
if (!cfg.data.cities?.includes(CITY)) await ADM('/settings/cities', PUT([CITY]), A.tok);
if (!Object.keys(cfg.data.taxiTariffs ?? {}).length) await ADM('/settings/taxi_tariffs', PUT({ economy: { title: 'Эконом', base: 80, perKm: 14, perMin: 4, min: 150 } }), A.tok);
const FROM = { address: 'Тверская 1', lat: 55.76, lng: 37.62 }; const TO = { address: 'Арбат 10', lat: 55.75, lng: 37.59 };
const body = (extra = {}) => ({ city: CITY, from: FROM, to: TO, tariff: 'economy', ...extra });

let r = await G('/taxi/orders', J(body({ scheduledAt: 'не дата' })), C.tok); t('мусор вместо времени отклонён', r.status === 400 && r.data.error === 'bad_schedule', JSON.stringify(r.data));
r = await G('/taxi/orders', J(body({ scheduledAt: inMin(5) })), C.tok); t('слишком скоро (раньше минимума) отклонено', r.status === 400 && r.data.error === 'schedule_too_soon', JSON.stringify(r.data));
r = await G('/taxi/orders', J(body({ scheduledAt: inMin(60 * 24 * 40) })), C.tok); t('слишком далеко отклонено', r.status === 400 && r.data.error === 'schedule_too_far', JSON.stringify(r.data));
r = await G('/taxi/orders', J(body({ scheduledAt: inMin(-60) })), C.tok); t('в прошлом отклонено', r.status === 400, JSON.stringify(r.data));
t('отказы не создали заказов', q(`select count(*) from go_orders where customer_id='${C.pid}'`) === '0');

r = await G('/taxi/orders', J(body({ scheduledAt: inMin(180) })), C.tok);
const id = r.data.orderId;
t('заказ «на потом» создан: статус scheduled, время и цена сохранены', r.status === 201 && q(`select status||'|'||(scheduled_at is not null)||'|'||(price_rub>0) from go_orders where id='${id}'`) === 'scheduled|true|true', JSON.stringify(r.data));
t('до наступления времени поиска нет (нет предложений и водителя)', q(`select count(*) from go_order_offers where order_id='${id}'`) === '0' && q(`select coalesce(executor_id,'-') from go_orders where id='${id}'`) === '-');
r = await G('/taxi/orders', J(body()), C.tok); t('запланированный заказ не мешает заказать такси сейчас', r.status === 201, JSON.stringify(r.data));
const nowId = r.data.orderId; await G(`/taxi/orders/${nowId}/cancel`, J({}), C.tok);
r = await G('/taxi/orders', J(body({ scheduledAt: inMin(190) })), C.tok); t('два заказа на близкое время (<30 мин) — конфликт', r.status === 409 && r.data.error === 'schedule_conflict', JSON.stringify(r.data));
r = await G('/taxi/orders', J(body({ scheduledAt: inMin(300) })), C.tok); const id2 = r.data.orderId; t('на другое время — можно', r.status === 201, JSON.stringify(r.data));

// лимит числа
await ADM('/settings/schedule', PUT({ minMin: 30, maxDays: 7, leadMin: 20, maxOrders: 2 }), A.tok);
r = await ADM('/settings/schedule', PUT({ minMin: 30, maxDays: 7, leadMin: 40, maxOrders: 2 }), A.tok); t('lead не меньше минимума отклонён', r.status === 400, JSON.stringify(r.data));
await sleep(16000);
r = await G('/taxi/orders', J(body({ scheduledAt: inMin(600) })), C.tok); t('больше разрешённого числа запланированных нельзя', r.status === 409 && r.data.error === 'too_many_scheduled', JSON.stringify(r.data));

// чужой не видит/не отменяет
r = await G(`/taxi/orders/${id}/cancel`, J({}), X.tok); t('чужой заказ отменить нельзя', r.status === 404 || r.status === 403, JSON.stringify(r.data));
r = await G('/orders', {}, C.tok); const mine = (r.data.orders ?? r.data).find?.((o) => o.id === id); t('заказ виден в списке заказчика со статусом scheduled', mine?.status === 'scheduled', JSON.stringify(r.data).slice(0, 200));

// отмена до начала
r = await G(`/taxi/orders/${id2}/cancel`, J({}), C.tok); t('отмена запланированного заказа до начала поиска', r.status === 200 && q(`select status from go_orders where id='${id2}'`) === 'cancelled', JSON.stringify(r.data));

// запуск поиска по времени: сдвигаем время в базе на «через 10 минут» (внутри lead=20) и ждём таймер
q(`update go_orders set scheduled_at = now() + interval '10 minutes' where id='${id}'`);
let st = 'scheduled';
for (let i = 0; i < 20 && st === 'scheduled'; i += 1) { await sleep(1500); st = q(`select status from go_orders where id='${id}'`); }
t('за lead минут до времени поиск начался сам', st === 'searching', st);
t('поиск стартовал с момента запуска (search_started_at)', q(`select search_started_at is not null from go_orders where id='${id}'`) === 't');
t('пассажир уведомлён ровно один раз', q(`select count(*) from go_notified where key like '%${id}:sched-start'`) === '1');
await sleep(11000);
t('повторные проходы не дублируют старт (событий searching ровно одно после scheduled)', q(`select count(*) from go_order_events where order_id='${id}' and to_status='searching'`) === '1', q(`select count(*) from go_order_events where order_id='${id}'`));
r = await G(`/taxi/orders/${id}/cancel`, J({}), C.tok); t('после старта поиска отмена работает по обычным правилам', r.status === 200);

console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
