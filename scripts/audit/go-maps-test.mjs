// Sky GO Maps (этап 10): кэш маршрутов, суточный предел, отказ поставщика → оценка по прямой. Без сервера и базы.
import { makeRouteService } from '../../server/gomaps.mjs';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, JSON.stringify(x).slice(0, 200)); } };
const hav = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111;
const A = { lat: 55.76, lng: 37.62 }; const B = { lat: 55.75, lng: 37.59 };
let clock = 1_000_000; let calls = 0; let mode = 'ok'; let limit = 0;
const compute = async () => { calls += 1; if (mode === 'throw') throw new Error('boom'); if (mode === 'fail') return { error: 'provider_error' }; if (mode === 'nokey') return { error: 'maps_not_configured' }; return { ok: true, distanceM: 3200, durationS: 600 }; };
const mk = () => makeRouteService({ compute, haversineKm: hav, limitPerDay: async () => limit, now: () => clock, ttlMs: 60_000, max: 3 });

let s = mk(); let r = await s.route(A, B);
t('маршрут от поставщика: км, минуты, не оценка', r.km === 3.2 && r.min === 10 && r.estimated === false, r);
r = await s.route(A, B); t('повтор — из кэша, поставщик не вызывался', calls === 1 && r.cached === true && s.stats().cacheHits === 1);
r = await s.route({ lat: 55.760004, lng: 37.620004 }, B); t('точки в пределах ~11 м — тот же ключ кэша', calls === 1, calls);
r = await s.route({ lat: 55.77, lng: 37.62 }, B); t('другая точка — новый вызов', calls === 2);
clock += 61_000; await s.route(A, B); t('кэш истёк через TTL — новый вызов', calls === 3);
for (const lat of [56.1, 56.2, 56.3]) await s.route({ lat, lng: 37 }, B);
t('размер кэша ограничен', s.stats().cached <= 3, s.stats());

calls = 0; mode = 'fail'; s = mk(); r = await s.route(A, B);
t('сбой поставщика → оценка по прямой с пометкой, заказ не ломается', r.estimated === true && r.km > 0 && r.min >= 1 && s.stats().providerFailures === 1, r);
mode = 'throw'; s = mk(); r = await s.route(A, B); t('исключение поставщика → тоже оценка', r.estimated === true && s.stats().providerFailures === 1);
mode = 'nokey'; s = mk(); r = await s.route(A, B); t('ключ не настроен — оценка, но это не «сбой поставщика»', r.estimated === true && s.stats().providerFailures === 0, s.stats());
mode = 'fail'; await s.route(A, B); mode = 'ok'; r = await s.route(A, B);
t('оценка по прямой в кэш не попадает: после восстановления поставщика — настоящий маршрут', r.estimated === false && r.km === 3.2, r);

calls = 0; mode = 'ok'; limit = 2; s = mk();
await s.route({ lat: 50, lng: 30 }, B); await s.route({ lat: 51, lng: 30 }, B); r = await s.route({ lat: 52, lng: 30 }, B);
t('суточный предел: после 2 вызовов — оценка по прямой, поставщик не вызывается', calls === 2 && r.estimated === true && s.stats().limited === 1, s.stats());
r = await s.route({ lat: 50, lng: 30 }, B); t('при исчерпанном пределе кэшированное всё ещё отдаётся настоящим', r.estimated === false && r.cached === true);
clock += 86_400_000 * 2; r = await s.route({ lat: 53, lng: 30 }, B); t('новые сутки — предел сброшен', r.estimated === false && calls === 3, calls);
limit = 0; for (let i = 0; i < 10; i += 1) await s.route({ lat: 40 + i, lng: 30 }, B); t('предел 0 = без ограничения', s.stats().limited === 1);
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
