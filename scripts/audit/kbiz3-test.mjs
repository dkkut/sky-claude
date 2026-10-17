// SkyKassa Business, этап 3: сотрудники и роли, промокоды, отзывы, касса, аналитика.  (. env.sh; node scripts/audit/kbiz3-test.mjs <каталог с api.log>; API с KBIZ_RATE_MULT=50)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const O = await mkuser(S, 'kb3own'); const M = await mkuser(S, 'kb3mgr'); const C = await mkuser(S, 'kb3csh'); const AD = await mkuser(S, 'kb3adm'); const X = await mkuser(S, 'kb3str'); const OB = await mkuser(S, 'kb3ob');
q(`insert into wallet_accounts (user_id, balance, points) values ('${O.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const get = (u, p) => call(p, {}, u.tok);
const post = (u, p, b) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u.tok);
const put = (u, p, b) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, u.tok);
const del = (u, p) => call(p, { method: 'DELETE' }, u.tok);
const pub = (p, o = {}) => call(`/api/kbiz/public${p}`, o);
const uname = (u) => q(`select username from profiles where id='${u.pid}'`);

await post(O, '/api/kbiz/business', { name: 'Кафе «Тест3»', mode: 'both', legalType: 'selfemployed' });
await put(O, '/api/kbiz/requisites', { holder: 'Иванов Иван', method: 'phone', value: '+7 900 333-44-55', bank: 'Банк', purpose: 'Оплата', instruction: '' });
await post(O, '/api/kbiz/subscription/buy', { idemKey: 'k3' }); await post(O, '/api/kbiz/publish', { on: true });
const slug = 'k3-' + Date.now().toString(36);
const tea = (await post(O, '/api/kbiz/items', { title: 'Чай', priceRub: 100 })).data.id;
await put(O, '/api/kbiz/shop', { slug, enabled: true });

// сотрудники
t('чужой не может звать сотрудников (нет бизнеса)', (await post(X, '/api/kbiz/staff', { username: uname(M), role: 'manager' })).status === 403);
t('неверная роль отклонена', (await post(O, '/api/kbiz/staff', { username: uname(M), role: 'god' })).status === 400);
t('несуществующий @username', (await post(O, '/api/kbiz/staff', { username: 'no_such_user_zz', role: 'manager' })).status === 404);
t('себя пригласить нельзя', (await post(O, '/api/kbiz/staff', { username: uname(O), role: 'admin' })).status === 400);
await post(OB, '/api/kbiz/business', { name: 'Другой бизнес', mode: 'online', legalType: 'person' });
t('владельца другого бизнеса пригласить нельзя', (await post(O, '/api/kbiz/staff', { username: uname(OB), role: 'manager' })).status === 409);
const inv = {};
for (const [k, u, r] of [['M', M, 'manager'], ['C', C, 'cashier'], ['AD', AD, 'admin']]) { const x = await post(O, '/api/kbiz/staff', { username: uname(u), role: r }); inv[k] = x.data.id; t(`приглашение ${r}`, x.status === 200 && x.data.ok, JSON.stringify(x.data)); }
t('повторное приглашение того же человека — отказ', (await post(O, '/api/kbiz/staff', { username: uname(M), role: 'cashier' })).status === 409);
t('приглашённый видит приглашение и не имеет прав до принятия', (await get(M, '/api/kbiz/me')).data.invites?.length === 1 && (await get(M, '/api/kbiz/items')).status === 403);
t('приглашённому пришло уведомление', Number(q(`select count(*) from gift_notifications where user_id='${M.pid}' and title like 'Приглашение%'`)) === 1);
t('чужой не принимает чужое приглашение', (await post(X, `/api/kbiz/staff/${inv.M}/accept`)).status === 404);
for (const [k, u] of [['M', M], ['C', C], ['AD', AD]]) t(`принято: ${k}`, (await post(u, `/api/kbiz/staff/${inv[k]}/accept`)).status === 200);
let r = await get(M, '/api/kbiz/me');
t('сотрудник видит бизнес и роль, но не реквизиты', r.data.business?.name === 'Кафе «Тест3»' && r.data.role === 'manager' && r.data.requisites == null, JSON.stringify(r.data).slice(0, 200));
t('сотрудник не может создать свой бизнес', (await post(M, '/api/kbiz/business', { name: 'Мой', mode: 'online', legalType: 'person' })).status !== 200);

// матрица прав
const st = async (u, m, p, b) => (await (m === 'GET' ? get(u, p) : m === 'PUT' ? put(u, p, b) : post(u, p, b))).status;
t('кассир: обзор и заявки можно', await st(C, 'GET', '/api/kbiz/overview') === 200 && await st(C, 'GET', '/api/kbiz/payments') === 200);
t('кассир: каталог/заказы/счета/промокоды закрыты', (await Promise.all(['/api/kbiz/items', '/api/kbiz/orders', '/api/kbiz/invoices', '/api/kbiz/promos', '/api/kbiz/tips', '/api/kbiz/reviews'].map((p) => st(C, 'GET', p)))).every((x) => x === 403));
t('кассир: реквизиты, подписка, персонал, витрина, журнал закрыты', (await Promise.all([st(C, 'PUT', '/api/kbiz/requisites', { holder: 'Хакер', method: 'phone', value: '+7 999 999-99-99' }), st(C, 'POST', '/api/kbiz/subscription/buy', { idemKey: 'z' }), st(C, 'GET', '/api/kbiz/staff'), st(C, 'GET', '/api/kbiz/shop'), st(C, 'GET', '/api/kbiz/audit')])).every((x) => x === 403));
t('менеджер: каталог можно, реквизиты/витрина/персонал/подписка нет', await st(M, 'GET', '/api/kbiz/items') === 200 && (await Promise.all([st(M, 'PUT', '/api/kbiz/requisites', {}), st(M, 'GET', '/api/kbiz/shop'), st(M, 'POST', '/api/kbiz/staff', { username: uname(X), role: 'cashier' }), st(M, 'POST', '/api/kbiz/publish', { on: false }), st(M, 'PUT', '/api/kbiz/business', { name: 'Взлом' })])).every((x) => x === 403));
t('администратор: витрина и журнал можно, реквизиты и персонал нет', await st(AD, 'GET', '/api/kbiz/shop') === 200 && await st(AD, 'GET', '/api/kbiz/audit') === 200 && (await Promise.all([st(AD, 'PUT', '/api/kbiz/requisites', {}), st(AD, 'GET', '/api/kbiz/staff'), st(AD, 'POST', '/api/kbiz/subscription/buy', {})])).every((x) => x === 403));
t('реквизиты не изменились', q(`select count(*) from kb_audit where action like 'requisites%' and actor <> '${O.pid}' and business_id=(select id from kb_businesses where owner_id='${O.pid}')`) === '0');
t('посторонний вообще не видит кабинет', await st(X, 'GET', '/api/kbiz/payments') === 403);
t('менеджер добавляет позицию от имени бизнеса', (await post(M, '/api/kbiz/items', { title: 'Кофе', priceRub: 150 })).status === 200 && Number(q(`select count(*) from kb_items where business_id=(select id from kb_businesses where owner_id='${O.pid}') and title='Кофе'`)) === 1);
r = await get(AD, '/api/kbiz/audit');
t('в журнале действие сотрудника под его именем', r.data.audit.some((e) => e.action === 'staff_action' && e.actorName === uname(M) && /manager: POST/.test(e.detail)), JSON.stringify(r.data.audit.slice(0, 3)));
t('в журнале нет id и данных платежей в «detail» путей', !JSON.stringify(r.data.audit).match(/kbi-[0-9a-f]{8}/));

// касса
t('кассир: сумма 0 и дробная отклонены', (await post(C, '/api/kbiz/cash', { amountRub: 0 })).status === 400 && (await post(C, '/api/kbiz/cash', { amountRub: 10.5 })).status === 400);
r = await post(C, '/api/kbiz/cash', { amountRub: 350, note: 'Стол 4' });
t('кассир выставил 350 ₽', r.status === 200 && r.data.amountRub === 350 && /\/p\//.test(r.data.url) && r.data.expiresInSec === 900, JSON.stringify(r.data));
const cash = r.data;
r = await pub(`/p/${cash.publicId}`);
t('страница кассы: сумма фиксирована 350 ₽', r.data.amountRub === 350 && r.data.state === 'open', JSON.stringify(r.data).slice(0, 160));
t('срок страницы ~15 минут', Math.abs(Number(q(`select extract(epoch from (expires_at - now()))::int from kb_qr where id='${cash.id}'`)) - 900) < 10);
t('кассовые QR не засоряют список QR', !(await get(O, '/api/kbiz/qr')).data.qr.some((x) => x.id === cash.id));
t('статус кассы: ожидание', (await get(C, `/api/kbiz/cash/${cash.id}`)).data.status === 'waiting');
await pub(`/p/${cash.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 1 }) });
t('покупатель сообщил — кассир видит «reported», сумма 350', await (async () => { const x = (await get(C, `/api/kbiz/cash/${cash.id}`)).data; return x.status === 'reported' && x.amountRub === 350; })());
const cp = (await get(M, '/api/kbiz/payments')).data.payments.find((p) => p.amountRub === 350);
t('кассир не подтверждает оплату', (await post(C, `/api/kbiz/payments/${cp.id}/confirm`)).status === 403);
t('менеджер подтверждает; подтверждающий записан как он', (await post(M, `/api/kbiz/payments/${cp.id}/confirm`)).status === 200 && q(`select confirmed_by from kb_payments where id='${cp.id}'`) === M.pid);
t('кассир видит статус «confirmed»', (await get(C, `/api/kbiz/cash/${cash.id}`)).data.status === 'confirmed');
await post(M, '/api/kbiz/cash', { amountRub: 99 });
t('кассир видит только свои операции, менеджер — все', (await get(C, '/api/kbiz/cash')).data.items.length === 1 && (await get(M, '/api/kbiz/cash')).data.items.length === 2);
t('нет подписки → касса закрыта', await (async () => { q(`update kb_subscriptions set expires_at = now() - interval '1 day' where business_id=(select id from kb_businesses where owner_id='${O.pid}')`); const x = await post(C, '/api/kbiz/cash', { amountRub: 10 }); q(`update kb_subscriptions set expires_at = now() + interval '30 days' where business_id=(select id from kb_businesses where owner_id='${O.pid}')`); return x.status === 402; })());

// промокоды
t('промокод: плохой код/процент/тип', (await post(M, '/api/kbiz/promos', { code: 'a', kind: 'percent', value: 10 })).status === 400 && (await post(M, '/api/kbiz/promos', { code: 'BIG', kind: 'percent', value: 95 })).status === 400 && (await post(M, '/api/kbiz/promos', { code: 'BIG', kind: 'x', value: 5 })).status === 400);
t('срок в прошлом отклонён', (await post(M, '/api/kbiz/promos', { code: 'OLD', kind: 'fixed', value: 5, expiresAt: '2020-01-01' })).status === 400);
r = await post(M, '/api/kbiz/promos', { code: 'sale10', kind: 'percent', value: 10, minOrderRub: 150 });
t('промокод создан менеджером (код в верхнем регистре)', r.status === 200 && (await get(O, '/api/kbiz/promos')).data.promos[0].code === 'SALE10');
t('дубль кода отклонён', (await post(O, '/api/kbiz/promos', { code: 'SALE10', kind: 'fixed', value: 5 })).status === 409);
await post(O, '/api/kbiz/promos', { code: 'ONE', kind: 'fixed', value: 30, maxUses: 1 });
await post(O, '/api/kbiz/promos', { code: 'HUGE', kind: 'fixed', value: 5000 });
const ORIGIN = null;
const so = (b) => pub(`/shop/${slug}/order`, { method: 'POST', body: JSON.stringify({ contact: { name: 'Пётр', phone: '+7 911 000-11-22' }, ...b }) });
const sp = (b) => pub(`/shop/${slug}/promo`, { method: 'POST', body: JSON.stringify(b) });
t('предпросмотр: 2×100 −10% = 180', await (async () => { const x = (await sp({ items: [{ id: tea, qty: 2 }], promo: 'sale10' })).data; return x.subtotalRub === 200 && x.discountRub === 20 && x.totalRub === 180; })());
t('минимальная сумма: 1×100 < 150 — отказ', (await sp({ items: [{ id: tea, qty: 1 }], promo: 'SALE10' })).data.error === 'promo_min_order');
t('неизвестный код', (await sp({ items: [{ id: tea, qty: 2 }], promo: 'NOPE' })).data.error === 'promo_invalid');
r = await so({ items: [{ id: tea, qty: 2 }], promo: 'SALE10', total: 1 });
t('заказ с промокодом: итог 180, скидка 20 (из запроса не берётся)', r.status === 200 && r.data.totalRub === 180 && r.data.discountRub === 20 && r.data.subtotalRub === 200, JSON.stringify(r.data));
const po = r.data;
t('платёжная страница заказа на 180', (await pub(`/p/${po.payPublicId}`)).data.amountRub === 180);
t('расход промокода учтён', q(`select used from kb_promos where code='SALE10'`) === '1');
t('скидка не уводит сумму ниже 1 ₽', await (async () => { const x = await so({ items: [{ id: tea, qty: 1 }], promo: 'HUGE' }); return x.status === 200 && x.data.totalRub === 1; })());
const [r1, r2, r3] = await Promise.all([so({ items: [{ id: tea, qty: 1 }], promo: 'ONE' }), so({ items: [{ id: tea, qty: 1 }], promo: 'ONE' }), so({ items: [{ id: tea, qty: 1 }], promo: 'ONE' })]);
const okN = [r1, r2, r3].filter((x) => x.status === 200).length;
t('промокод на 1 использование: гонка из 3 заказов — ровно один', okN === 1 && q(`select used from kb_promos where code='ONE'`) === '1', `${okN} ${q(`select used from kb_promos where code='ONE'`)}`);
t('отказ без заказа: второй получил promo_exhausted', [r1, r2, r3].some((x) => x.data.error === 'promo_exhausted'));
const pid = (await get(O, '/api/kbiz/promos')).data.promos.find((p) => p.code === 'SALE10').id;
t('пауза промокода', (await post(M, `/api/kbiz/promos/${pid}/status`, { status: 'paused' })).status === 200 && (await sp({ items: [{ id: tea, qty: 2 }], promo: 'SALE10' })).data.error === 'promo_invalid');
t('кассир промокоды не меняет', (await post(C, `/api/kbiz/promos/${pid}/status`, { status: 'active' })).status === 403);

// отзывы
const rv = (id, k, b) => pub(`/shop-order/${id}/review?k=${k}`, { method: 'POST', body: JSON.stringify(b) });
t('отзыв до выполнения заказа нельзя', (await rv(po.id, po.key, { rating: 5, text: 'супер' })).data.error === 'order_not_done');
await post(M, `/api/kbiz/orders/${po.id}/confirm`); await post(M, `/api/kbiz/orders/${po.id}/done`);
t('чужой ключ — 404', (await rv(po.id, 'bad', { rating: 5 })).status === 404);
t('оценка вне 1–5 отклонена', (await rv(po.id, po.key, { rating: 6 })).status === 400 && (await rv(po.id, po.key, { rating: 0 })).status === 400);
t('статус заказа: можно оставить отзыв (reviewed=false)', (await pub(`/shop-order/${po.id}?k=${po.key}`)).data.reviewed === false);
r = await rv(po.id, po.key, { rating: 4, text: 'Вкусно <b>и быстро</b>' });
t('отзыв оставлен', r.status === 200 && r.data.ok);
t('второй отзыв на тот же заказ нельзя', (await rv(po.id, po.key, { rating: 5 })).data.error === 'already_reviewed');
r = await pub(`/shop/${slug}`);
t('на витрине: оценка 4.0, 1 отзыв, имя без фамилии', r.data.reviews.count === 1 && r.data.reviews.average === 4 && r.data.reviews.items[0].author === 'Пётр', JSON.stringify(r.data.reviews));
const rid = (await get(M, '/api/kbiz/reviews')).data.reviews[0].id;
t('ответ владельца виден на витрине', (await post(M, `/api/kbiz/reviews/${rid}`, { reply: 'Спасибо!' })).status === 200 && (await pub(`/shop/${slug}`)).data.reviews.items[0].reply === 'Спасибо!');
t('скрытый отзыв пропадает с витрины', (await post(M, `/api/kbiz/reviews/${rid}`, { status: 'hidden' })).status === 200 && (await pub(`/shop/${slug}`)).data.reviews.count === 0);
t('кассир отзывы не модерирует', (await post(C, `/api/kbiz/reviews/${rid}`, { status: 'published' })).status === 403);

// аналитика
const oap = (await get(O, '/api/kbiz/payments')).data.payments.find((p) => p.amountRub === 180);
await pub(`/p/${po.payPublicId}/report`, { method: 'POST', body: JSON.stringify({}) });
const op = (await get(O, '/api/kbiz/payments')).data.payments.find((p) => p.amountRub === 180);
await post(M, `/api/kbiz/payments/${op.id}/confirm`);
r = await get(M, '/api/kbiz/analytics?days=30'); const a = r.data.analytics;
t('аналитика: подтверждено 350 + 180 = 530 ₽, 2 оплаты, среднее 265', a && a.confirmedSumRub === 530 && a.confirmed === 2 && a.averageRub === 265, JSON.stringify(a)?.slice(0, 300));
t('аналитика: касса и заказы по видам', a.byKind.some((k) => k.kind === 'cash' && k.confirmedSumRub === 350) && a.byKind.some((k) => k.kind === 'order' && k.confirmedSumRub === 180));
t('аналитика: топ позиций и скидки', a.topItems[0]?.title === 'Чай' && a.orders.discountsRub >= 20, JSON.stringify(a.topItems));
t('аналитика: кассиру закрыта', (await get(C, '/api/kbiz/analytics')).status === 403);
t('сумма «подтверждено» не включает несогласованное', a.claimedSumRub >= a.confirmedSumRub);

// выход и удаление
t('сотрудник выходит сам, доступ пропадает', (await del(C, `/api/kbiz/staff/${inv.C}`)).status === 200 && (await get(C, '/api/kbiz/payments')).status === 403);
t('владелец убирает менеджера', (await del(O, `/api/kbiz/staff/${inv.M}`)).status === 200 && (await get(M, '/api/kbiz/items')).status === 403);
t('чужой не убирает сотрудников', (await del(X, `/api/kbiz/staff/${inv.AD}`)).status === 404 && (await get(AD, '/api/kbiz/shop')).status === 200);
t('изменение роли только владельцем', (await post(AD, `/api/kbiz/staff/${inv.AD}/role`, { role: 'admin' })).status === 403 && (await post(O, `/api/kbiz/staff/${inv.AD}/role`, { role: 'cashier' })).status === 200 && (await get(AD, '/api/kbiz/shop')).status === 403);
t('убранный может быть приглашён снова', (await post(O, '/api/kbiz/staff', { username: uname(M), role: 'cashier' })).status === 200);
console.log(`\nитого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
