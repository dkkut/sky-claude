// Sky GO «Билеты на проезд»: продукты, покупка, оплата через SkyKassa Business, QR-токен, проверка на борту, пересадка, возврат.
// API: те же переменные, что у gotransport-test.mjs
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1:5432/skytest -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, x); } };
q('update admin_lockdown set active=false');
const OP = await mkuser(S, 'gtop'), B = await mkuser(S, 'gtbuy'), X = await mkuser(S, 'gtx'), ADM = await mkuser(S, 'gtadm'), CTL = await mkuser(S, 'gtctl');
q(`update profiles set is_admin=true, admin_role='go_places_moderator' where id='${ADM.pid}'`);
q(`insert into wallet_accounts (user_id, balance, points) values ('${OP.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const D7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['00:00', '23:59']]]));
await post(OP, '/api/kbiz/business', { name: 'Городской транспорт', mode: 'point', legalType: 'selfemployed' });
await post(OP, '/api/kbiz/place/connect', { on: true });
await put(OP, '/api/kbiz/place', { categoryId: 'transit', about: 'Автобусы и трамваи', city: 'Москва', address: 'ул. Тестовая, 2', hours: D7, phone: '+7 900 000-00-01', lat: 55.75, lng: 37.61, tz: 'Europe/Moscow' });
await me(OP, '/api/kbiz/requisites', { method: 'PUT', body: JSON.stringify({ holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' }) });
await post(OP, '/api/kbiz/subscription/buy', { idemKey: 'gt1' }); await post(OP, '/api/kbiz/publish', { on: true }); await post(OP, '/api/kbiz/place/photo', { dataUrl: png });
const sub = await post(OP, '/api/kbiz/place/submit'); const org = sub.data.place?.businessId; await post(ADM, `/api/admin/go/places/${org}/approve`);

t('категория transit в группе transport', (await me(B, '/api/go/places/categories')).data.categories.some((c) => c.id === 'transit' && c.groupId === 'transport'));
t('чужой (без бизнеса) — нет кабинета', (await me(X, '/api/kbiz/transit/products')).status === 404);
t('плохое имя продукта', (await post(OP, '/api/kbiz/transit/products', { name: 'x', kind: 'single', priceRub: 50 })).status === 400);
t('плохой вид', (await post(OP, '/api/kbiz/transit/products', { name: 'Билет', kind: 'free', priceRub: 50 })).status === 400);
t('цена 0 нельзя', (await post(OP, '/api/kbiz/transit/products', { name: 'Билет', kind: 'single', priceRub: 0 })).status === 400);
t('пакет без числа поездок', (await post(OP, '/api/kbiz/transit/products', { name: 'Пакет', kind: 'multi', priceRub: 100 })).status === 400);
const p1 = (await post(OP, '/api/kbiz/transit/products', { name: 'Разовая поездка', kind: 'single', priceRub: 55 })).data.id;
const p2 = (await post(OP, '/api/kbiz/transit/products', { name: 'Пакет 3 поездки', kind: 'multi', rides: 3, validDays: 30, priceRub: 140 })).data.id;
const p3 = (await post(OP, '/api/kbiz/transit/products', { name: 'Проездной на неделю', kind: 'period', validDays: 7, priceRub: 400 })).data.id;
t('продукты созданы', !!p1 && !!p2 && !!p3);
const cat = (await me(B, '/api/go/transit/catalog')).data.operators.find((o) => o.id === org);
t('каталог: оператор с тремя продуктами и canSell', cat?.products.length === 3 && cat.canSell === true);
t('своё не купить', (await post(OP, '/api/go/transit/buy', { productId: p1 })).status === 403);
t('чужого продукта нет', (await post(B, '/api/go/transit/buy', { productId: 'gtp-00000000-0000-0000-0000-000000000000' })).status === 404);

const buy = async (pid, idem) => post(B, '/api/go/transit/buy', { productId: pid, idemKey: idem });
const pay = async (res) => {
  q('update kb_payments set ip_hash = null');   // предел заявок с одного адреса — 5 в час на бизнес
  const pidp = res.data.payUrl.split('/p/')[1];
  await call(`/api/kbiz/public/p/${pidp}/report`, { method: 'POST', body: JSON.stringify({ note: 'перевёл', website: '' }) });
  const row = q(`select id from kb_payments where qr_id=(select qr_id from gt_tickets where id='${res.data.id}') order by created_at desc limit 1`);
  return (await post(OP, `/api/kbiz/payments/${row}/confirm`, {})).status;
};
let b1 = await buy(p1, 'k1');
t('покупка создаёт билет и страницу оплаты', b1.status === 201 && /\/p\//.test(b1.data.payUrl) && b1.data.priceRub === 55, JSON.stringify(b1.data));
t('повтор ключа — duplicate', (await buy(p1, 'k1')).data.duplicate === true);
let mine = (await me(B, '/api/go/transit/tickets')).data.tickets;
t('билет ждёт оплаты, токена нет', mine[0].status === 'awaiting_payment' && /\/p\//.test(mine[0].payUrl) && (await me(B, `/api/go/transit/tickets/${b1.data.id}/token`)).status === 409);
t('чужой не берёт токен', (await me(X, `/api/go/transit/tickets/${b1.data.id}/token`)).status === 404);
t('оплата подтверждена перевозчиком', (await pay(b1)) === 200);
await new Promise((r) => setTimeout(r, 1500));
mine = (await me(B, '/api/go/transit/tickets')).data.tickets.find((x) => x.id === b1.data.id);
t('билет активен, срок выставлен', mine.status === 'active' && !!mine.validUntil && mine.canRefund === true, JSON.stringify(mine));
t('уведомление об оплате', Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and ref_id='gtt:${b1.data.id}:active'`)) === 1);

// токен и проверка
const tk = (await me(B, `/api/go/transit/tickets/${b1.data.id}/token`)).data;
t('токен выдан', /^gtt-[0-9a-f-]{36}\.\d+\.[0-9a-f]{20}$/.test(tk.token) && tk.refreshSec >= 1 && tk.refreshSec <= 30);
t('человек не проверяет', (await post(X, '/api/kbiz/transit/validate', { token: tk.token })).status === 404);
t('мусорный токен', (await post(OP, '/api/kbiz/transit/validate', { token: 'abc' })).data.error === 'bad_token');
const w = tk.token.split('.'); 
t('подделка подписи', (await post(OP, '/api/kbiz/transit/validate', { token: `${w[0]}.${w[1]}.${'0'.repeat(20)}` })).data.error === 'bad_token');
t('устаревший токен (скриншот)', (await post(OP, '/api/kbiz/transit/validate', { token: `${w[0]}.${Number(w[1]) - 5}.${w[2]}` })).data.error === 'bad_token');
const v1 = await post(OP, '/api/kbiz/transit/validate', { token: tk.token });
t('проверка: разовый билет гасится', v1.status === 200 && v1.data.result === 'valid' && v1.data.name === 'Разовая поездка', JSON.stringify(v1.data));
t('повторная проверка — «использован»', (await post(OP, '/api/kbiz/transit/validate', { token: tk.token })).data.error === 'used');
t('использованный — токена нет', (await me(B, `/api/go/transit/tickets/${b1.data.id}/token`)).status === 409);
t('использованный не вернуть', (await post(B, `/api/go/transit/tickets/${b1.data.id}/refund`)).status === 409);

// пакет: 3 поездки, пересадка
const b2 = await buy(p2, 'k2'); await pay(b2); await new Promise((r) => setTimeout(r, 1500));
const tk2 = () => me(B, `/api/go/transit/tickets/${b2.data.id}/token`).then((r) => r.data.token);
let r2 = await post(OP, '/api/kbiz/transit/validate', { token: await tk2() });
t('пакет: первая поездка, осталось 2', r2.data.result === 'valid' && r2.data.ridesLeft === 2);
r2 = await post(OP, '/api/kbiz/transit/validate', { token: await tk2() });
t('пакет: пересадка в течение 10 минут не списывает', r2.data.result === 'recent' && r2.data.ridesLeft === 2);
q(`update gt_tickets set last_validated_at = now() - interval '20 minutes' where id='${b2.data.id}'`);
r2 = await post(OP, '/api/kbiz/transit/validate', { token: await tk2() });
t('пакет: вторая поездка', r2.data.result === 'valid' && r2.data.ridesLeft === 1);
q(`update gt_tickets set last_validated_at = now() - interval '20 minutes' where id='${b2.data.id}'`);
r2 = await post(OP, '/api/kbiz/transit/validate', { token: await tk2() });
t('пакет: последняя поездка → использован', r2.data.ridesLeft === 0 && q(`select status from gt_tickets where id='${b2.data.id}'`) === 'used');
t('уведомление, что пакет закончился', Number(q(`select count(*) from gift_notifications where user_id='${B.pid}' and ref_id='gtt:${b2.data.id}:ended'`)) === 1);

// гонка: два контролёра одновременно
const b4 = await buy(p1, 'k4'); await pay(b4); await new Promise((r) => setTimeout(r, 1500));
const tk4 = (await me(B, `/api/go/transit/tickets/${b4.data.id}/token`)).data.token;
const race = await Promise.all([post(OP, '/api/kbiz/transit/validate', { token: tk4 }), post(OP, '/api/kbiz/transit/validate', { token: tk4 }), post(OP, '/api/kbiz/transit/validate', { token: tk4 })]);
t('гонка: гасится ровно один раз', race.filter((x) => x.data.result === 'valid').length === 1 && race.filter((x) => x.data.error === 'used').length === 2, JSON.stringify(race.map((x) => x.data)));

// проездной, срок, возврат
const b3 = await buy(p3, 'k3'); await pay(b3); await new Promise((r) => setTimeout(r, 1500));
t('запрос возврата неиспользованного', (await post(B, `/api/go/transit/tickets/${b3.data.id}/refund`)).status === 200);
t('в возврате — токена нет', (await me(B, `/api/go/transit/tickets/${b3.data.id}/token`)).status === 409);
t('отказ — только с причиной', (await post(OP, `/api/kbiz/transit/tickets/${b3.data.id}/refund`, { approve: false })).status === 400);
t('отказ в возврате возвращает билет в действие', (await post(OP, `/api/kbiz/transit/tickets/${b3.data.id}/refund`, { approve: false, comment: 'Уже использовали' })).status === 200 && q(`select status from gt_tickets where id='${b3.data.id}'`) === 'active');
t('снова запрос и одобрение', (await post(B, `/api/go/transit/tickets/${b3.data.id}/refund`)).status === 200 && (await post(OP, `/api/kbiz/transit/tickets/${b3.data.id}/refund`, { approve: true })).status === 200 && q(`select status from gt_tickets where id='${b3.data.id}'`) === 'refunded');
const b5 = await buy(p3, 'k5'); await pay(b5); await new Promise((r) => setTimeout(r, 1500));
const tk5 = (await me(B, `/api/go/transit/tickets/${b5.data.id}/token`)).data.token;
q(`update gt_tickets set valid_until = now() - interval '1 minute' where id='${b5.data.id}'`);
t('просроченный проездной отвергнут', (await post(OP, '/api/kbiz/transit/validate', { token: tk5 })).data.error === 'expired');
t('в списке — «Срок истёк»', (await me(B, '/api/go/transit/tickets')).data.tickets.find((x) => x.id === b5.data.id).status === 'expired');

// отмена неоплаченного
const b6 = await buy(p1, 'k6');
t('отмена неоплаченного', (await post(B, `/api/go/transit/tickets/${b6.data.id}/cancel`)).status === 200 && (await post(B, `/api/go/transit/tickets/${b6.data.id}/cancel`)).status === 404);
// чужая организация
const X2 = await mkuser(S, 'gtop2');
await post(X2, '/api/kbiz/business', { name: 'Другой перевозчик', mode: 'point', legalType: 'selfemployed' });
await post(X2, '/api/kbiz/place/connect', { on: true }); await put(X2, '/api/kbiz/place', { categoryId: 'transit', about: 'x', city: 'Москва', address: 'ул. Иная, 1', lat: 55.7, lng: 37.6, tz: 'Europe/Moscow' });
const b7 = await buy(p1, 'k7'); await pay(b7); await new Promise((r) => setTimeout(r, 1500));
const tk7r = await me(B, `/api/go/transit/tickets/${b7.data.id}/token`); const tk7 = tk7r.data.token; if (!tk7) console.log('tk7', tk7r.status, JSON.stringify(tk7r.data), JSON.stringify(b7.data));
{ const rr = await post(X2, '/api/kbiz/transit/validate', { token: tk7 }); t('билет чужого перевозчика не принимается', rr.data.error === 'not_found', JSON.stringify(rr.data)); }
const st = (await me(OP, '/api/kbiz/transit/stats')).data;
t('статистика: проверки и продажи', st.validations30d.ok >= 5 && st.validations30d.recent === 1 && st.validations30d.rejected >= 3 && st.soldRub > 0 && st.byStatus.used >= 2, JSON.stringify(st));
t('список проданных', (await me(OP, '/api/kbiz/transit/tickets?status=used')).data.tickets.length >= 2);
t('без входа 401', (await call('/api/go/transit/tickets')).status === 401);
console.log(`gotransit-test: ${ok} ок, ${bad} ошибок`); process.exit(bad ? 1 : 0);
