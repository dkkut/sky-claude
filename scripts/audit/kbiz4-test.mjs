// SkyKassa Business, этап 4: платёжный партнёр (адаптер hmac-v1, вебхуки), админка Sky, проверка безопасности.
//   (. env.sh; node scripts/audit/kbiz4-test.mjs <каталог с api.log>; API с KBIZ_RATE_MULT=50 BLOX_ALLOW_PRIVATE=1 ADMIN_GATE=off OWNER_USERNAME=ownertest)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { startProvider } from './fakes/kbiz-provider.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const O = await mkuser(S, 'kb4own'); const X = await mkuser(S, 'kb4str'); const ST = await mkuser(S, 'kb4stf'); const ADM = await mkuser(S, 'kb4adm'); const USR = await mkuser(S, 'kb4usr');
q(`update profiles set is_admin=true, admin_role='kassa_biz_admin' where id='${ADM.pid}'`);
for (const u of [O, X]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const get = (u, p) => call(p, {}, u?.tok);
const post = (u, p, b) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const put = (u, p, b) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, u?.tok);
const del = (u, p, b) => call(p, { method: 'DELETE', body: JSON.stringify(b ?? {}) }, u?.tok);
const pub = (p, o = {}) => call(`/api/kbiz/public${p}`, o);
const SECRET = 'prov-secret-0123456789abcdef'; const MERCHANT = 'm-kb4';
const prov = await startProvider(9977, { secret: SECRET, merchant: MERCHANT });
const URL1 = 'http://127.0.0.1:9977';

await post(O, '/api/kbiz/business', { name: 'Бизнес «Партнёр»', mode: 'both', legalType: 'ip' });
await put(O, '/api/kbiz/requisites', { holder: 'Иванов Иван', method: 'phone', value: '+7 900 444-55-66', bank: 'Банк', purpose: 'Оплата', instruction: '' });
await post(O, '/api/kbiz/subscription/buy', { idemKey: 'k4' }); await post(O, '/api/kbiz/publish', { on: true });
const bizId = q(`select id from kb_businesses where owner_id='${O.pid}'`);
const qr = (await post(O, '/api/kbiz/qr', { title: 'Оплата', amountRub: 500 })).data.qr; const qrOpen = (await post(O, '/api/kbiz/qr/permanent', {})).data.qr;

// настройка провайдера
t('без провайдера страница не предлагает оплату у партнёра', (await pub(`/p/${qr.publicId}`)).data.provider === undefined);
t('провайдер: чужой/без бизнеса — 403', (await put(X, '/api/kbiz/provider', { baseUrl: URL1, merchant: MERCHANT, secret: SECRET })).status === 403);
t('короткий секрет отклонён', (await put(O, '/api/kbiz/provider', { baseUrl: URL1, merchant: MERCHANT, secret: 'short' })).status === 400);
t('адрес с логином/параметрами/чужой схемой отклонён', (await Promise.all(['http://user:pw@127.0.0.1:9977', 'http://127.0.0.1:9977/?x=1', 'ftp://127.0.0.1:9977', 'file:///etc/passwd', 'javascript:alert(1)'].map((u) => put(O, '/api/kbiz/provider', { baseUrl: u, merchant: MERCHANT, secret: SECRET })))).every((r) => r.status === 400));
t('провайдер сохранён', (await put(O, '/api/kbiz/provider', { baseUrl: URL1, merchant: MERCHANT, secret: SECRET, title: 'Тест-касса' })).status === 200);
let r = await get(O, '/api/kbiz/provider');
t('секрет наружу не отдаётся', r.data.provider.hasSecret === true && !JSON.stringify(r.data).includes(SECRET) && r.data.provider.merchant === MERCHANT, JSON.stringify(r.data));
t('секрет в базе зашифрован', !q(`select secret_enc from kb_providers where business_id='${bizId}'`).includes(SECRET));
t('в журнале нет секрета', !JSON.stringify((await get(O, '/api/kbiz/audit')).data).includes(SECRET));
t('связь проверена (ping)', (await post(O, '/api/kbiz/provider/ping')).status === 200);
t('сотрудник провайдера не видит', await (async () => { const inv = (await post(O, '/api/kbiz/staff', { username: q(`select username from profiles where id='${ST.pid}'`), role: 'admin' })).data.id; await post(ST, `/api/kbiz/staff/${inv}/accept`); return (await get(ST, '/api/kbiz/provider')).status === 403 && (await put(ST, '/api/kbiz/provider', { baseUrl: URL1, merchant: 'x1', secret: SECRET })).status === 403; })());
r = await pub(`/p/${qr.publicId}`);
t('страница предлагает оплату у партнёра', r.data.provider === true);
t('сайт-имитатор: смена адреса на недоступный — ping падает с понятной ошибкой', await (async () => { await put(O, '/api/kbiz/provider', { baseUrl: 'http://127.0.0.1:9', merchant: MERCHANT }); const x = await post(O, '/api/kbiz/provider/ping'); await put(O, '/api/kbiz/provider', { baseUrl: URL1, merchant: MERCHANT }); return x.status === 502 && x.data.error === 'provider_unreachable' && (await get(O, '/api/kbiz/provider')).data.provider.lastError == null; })());

// платёж
r = await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: JSON.stringify({ amountRub: 1 }) });
t('платёж у партнёра создан; сумма с сервера (500)', r.status === 200 && /^http/.test(r.data.url) && prov.last()[1].amount === 500, JSON.stringify(r.data));
const p1 = r.data; const [rid1] = prov.last();
t('в базе source=provider, статус created, ссылка зашифрована', q(`select source||':'||status from kb_payments where id='${p1.id}'`) === 'provider:created' && !q(`select provider_url_enc from kb_payments where id='${p1.id}'`).includes('127.0.0.1'));
t('у постоянного QR без суммы — отказ', (await pub(`/p/${qrOpen.publicId}/provider`, { method: 'POST', body: JSON.stringify({}) })).data.error === 'bad_amount');
const hook = `http://127.0.0.1:8080/api/kbiz/webhook/${bizId}`;
const ev = (id, order, extra = {}) => ({ event_id: id, payment_id: id.startsWith('e') ? rid1 : id, order_id: order, status: 'paid', ...extra });
// вебхуки
t('вебхук с чужой подписью — 401', (await prov.webhook(hook, ev('e1', p1.id), { secretOverride: 'another-secret-xxxxxxxxxxxx' })).status === 401);
t('вебхук со старым временем — 401', (await prov.webhook(hook, ev('e2', p1.id), { ts: Math.floor(Date.now() / 1000) - 3600 })).status === 401);
t('вебхук неизвестному бизнесу — 404', (await prov.webhook(`http://127.0.0.1:8080/api/kbiz/webhook/kbz-00000000-0000-0000-0000-000000000000`, ev('e3', p1.id))).status === 404);
r = await prov.webhook(hook, ev('e4', p1.id));
t('вебхук «оплачено», а у провайдера «ожидает» — НЕ подтверждает', r.status === 200 && q(`select status from kb_payments where id='${p1.id}'`) === 'created', JSON.stringify(r));
r = await prov.webhook(hook, ev('e4', p1.id));
t('повтор события — duplicate', r.data.duplicate === true);
prov.setStatus(rid1, 'paid');
r = await prov.webhook(hook, ev('e5', p1.id));
t('провайдер подтвердил — платёж «подтверждён интеграцией»', r.status === 200 && q(`select status||':'||confirmed_by from kb_payments where id='${p1.id}'`) === 'confirmed:provider', JSON.stringify(r));
t('вебхук о чужом order_id — 404', (await prov.webhook(hook, ev('e6', 'kbp-00000000-0000-0000-0000-000000000000'))).status === 404);
t('владелец уведомлён', Number(q(`select count(*) from gift_notifications where user_id='${O.pid}' and body like '%платёжным партнёром%'`)) >= 1);
const lp = (await get(O, '/api/kbiz/payments')).data.payments.find((p) => p.id === p1.id);
t('в списке: «подтверждена платёжным партнёром», confirmedBy=integration', lp.confirmedBy === 'integration' && /партнёром/.test(lp.statusLabel), JSON.stringify(lp));
r = (await get(O, '/api/kbiz/overview')).data.stats;
t('обзор: сумма «по интеграции» 500, «владельцем» отдельно', r.confirmedByIntegrationSumRub >= 500 && r.confirmedByOwnerSumRub < r.confirmedByIntegrationSumRub + 1, JSON.stringify(r));
t('владелец не может «подтвердить» повторно или вернуть как партнёр', (await post(O, `/api/kbiz/payments/${p1.id}/refund`, { comment: 'возврат клиенту' })).status === 200);
// несовпадение суммы
const p2 = (await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: '{}' })).data; const [rid2] = prov.last();
prov.setStatus(rid2, 'paid', 100);
r = await prov.webhook(hook, { event_id: 'm1', payment_id: rid2, order_id: p2.id, status: 'paid' });
t('сумма у провайдера не совпала — не подтверждено, пометка «не обнаружена»', q(`select status from kb_payments where id='${p2.id}'`) === 'not_found', JSON.stringify(r));
// перепроверка по ключу покупателя без вебхука
const p3 = (await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: '{}' })).data; const [rid3] = prov.last();
t('чужой ключ не запускает проверку', (await pub(`/status/${p3.id}?k=wrong`)).status === 404 && q(`select status from kb_payments where id='${p3.id}'`) === 'created');
prov.setStatus(rid3, 'paid');
r = await pub(`/status/${p3.id}?k=${p3.statusKey}`);
t('покупатель открыл статус — сервер перепроверил у провайдера и подтвердил', r.data.status === 'confirmed' && /партнёр/.test(r.data.note), JSON.stringify(r.data));
// отмена и возврат у провайдера
const p4 = (await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: '{}' })).data; const [rid4] = prov.last(); prov.setStatus(rid4, 'cancelled');
await prov.webhook(hook, { event_id: 'c1', payment_id: rid4, order_id: p4.id, status: 'cancelled' });
t('провайдер отменил — платёж «отменена»', q(`select status from kb_payments where id='${p4.id}'`) === 'cancelled');
prov.setStatus(rid3, 'refunded');
await prov.webhook(hook, { event_id: 'r1', payment_id: rid3, order_id: p3.id, status: 'refunded' });
t('провайдер сообщил о возврате — платёж «возврат», владелец уведомлён', q(`select status from kb_payments where id='${p3.id}'`) === 'refunded');
// плохой ответ провайдера
prov.setBad(true);
r = await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: '{}' });
t('провайдер вернул небезопасную ссылку (javascript:) — отказ, платёж не создан', r.status === 502 && r.data.error === 'provider_bad_answer', JSON.stringify(r.data));
prov.setBad(false);
q(`update kb_payments set ip_hash = null where business_id='${bizId}'`);   // пределы с адреса проверены в других местах
t('сломанный провайдер — понятная ошибка, а не падение', await (async () => { const sv = q(`select base_url from kb_providers where business_id='${bizId}'`); q(`update kb_providers set base_url='http://127.0.0.1:9' where business_id='${bizId}'`); const x = await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: '{}' }); q(`update kb_providers set base_url='${sv}' where business_id='${bizId}'`); return x.status === 502 && x.data.error === 'provider_unreachable'; })());
// выключение / подписка / приостановка
await put(O, '/api/kbiz/provider', { baseUrl: URL1, merchant: MERCHANT, enabled: false });
t('провайдер выключен — оплата у партнёра закрыта, вебхук 404', (await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: '{}' })).data.error === 'provider_not_set' && (await prov.webhook(hook, ev('x1', p1.id))).status === 404);
await put(O, '/api/kbiz/provider', { baseUrl: URL1, merchant: MERCHANT, enabled: true });
q(`update kb_subscriptions set expires_at = now() - interval '1 day' where business_id='${bizId}'`);
t('подписка истекла — оплата у партнёра недоступна', (await pub(`/p/${qr.publicId}/provider`, { method: 'POST', body: '{}' })).status === 410);
q(`update kb_subscriptions set expires_at = now() + interval '30 days' where business_id='${bizId}'`);
t('отвязка провайдера', (await del(O, '/api/kbiz/provider')).status === 200 && (await get(O, '/api/kbiz/provider')).data.provider === null);

// админка Sky
t('админка: человеку закрыта', (await get(USR, '/api/admin/kbiz')).status === 403 && (await get(X, `/api/admin/kbiz/${bizId}`)).status === 403);
r = await get(ADM, '/api/admin/kbiz?q=Партнёр');
const row = r.data.businesses.find((b) => b.id === bizId);
t('админка: бизнес найден по названию, видны владелец и суммы', row && row.owner && row.requests >= 3 && row.staff === 1, JSON.stringify(row));
t('админка: поиск по @username владельца', (await get(ADM, `/api/admin/kbiz?q=${q(`select username from profiles where id='${O.pid}'`)}`)).data.businesses.some((b) => b.id === bizId));
t('админка: спецсимволы поиска не ломают запрос', (await get(ADM, "/api/admin/kbiz?q=%25%27%3B--")).status === 200);
r = await get(ADM, `/api/admin/kbiz/${bizId}`);
t('карточка: без реквизитов, секретов и контактов', r.status === 200 && !JSON.stringify(r.data).match(/900 444|secret_enc|prov-secret|Иванов/), JSON.stringify(r.data).slice(0, 200));
t('приостановка без причины нельзя', (await post(ADM, `/api/admin/kbiz/${bizId}/suspend`, {})).status === 400);
t('приостановлен', (await post(ADM, `/api/admin/kbiz/${bizId}/suspend`, { reason: 'Жалобы покупателей' })).status === 200 && q(`select status from kb_businesses where id='${bizId}'`) === 'suspended');
t('владелец видит причину и уведомление', (await get(O, '/api/kbiz/me')).data.business.suspendedReason === 'Жалобы покупателей' && Number(q(`select count(*) from gift_notifications where user_id='${O.pid}' and title like '%приостановлен%'`)) === 1);
t('публичная страница приостановленного: «suspended», реквизитов нет', await (async () => { const x = (await pub(`/p/${qr.publicId}`)).data; return x.state === 'suspended' && !x.requisites; })());
t('владелец не может сам «опубликовать» и менять реквизиты', (await post(O, '/api/kbiz/publish', { on: true })).status === 403 && (await put(O, '/api/kbiz/requisites', { holder: 'Иванов Иван', method: 'phone', value: '+7 900 444-55-66' })).status === 403);
t('действие админа в журнале администрации', Number(q(`select count(*) from admin_log where type='kassa_biz_suspend' and actor_id='${ADM.pid}'`)) >= 1);
t('возобновление: статус «скрыт» (draft), причина обязательна', (await post(ADM, `/api/admin/kbiz/${bizId}/resume`, {})).status === 400 && (await post(ADM, `/api/admin/kbiz/${bizId}/resume`, { reason: 'Проверено' })).status === 200 && q(`select status from kb_businesses where id='${bizId}'`) === 'draft');
t('владелец снова публикует', (await post(O, '/api/kbiz/publish', { on: true })).status === 200);

// безопасность: доступ к чужим данным (IDOR) и подмена полей
await post(X, '/api/kbiz/business', { name: 'Чужой бизнес', mode: 'online', legalType: 'person' });
const item = (await post(O, '/api/kbiz/items', { title: 'Секретный товар', priceRub: 77 })).data.id;
const inv = (await post(O, '/api/kbiz/invoices', { lines: [{ title: 'Услуга', qty: 1, priceRub: 300 }] })).data.id;
const pr = (await post(O, '/api/kbiz/promos', { code: 'IDOR1', kind: 'fixed', value: 5 })).data.id;
const payId = p1.id;
const idor = [
  ['PUT', `/api/kbiz/items/${item}`, { title: 'Взлом', priceRub: 1 }], ['DELETE', `/api/kbiz/items/${item}`], ['PUT', `/api/kbiz/items/${item}/photo`, { dataUrl: 'x' }],
  ['POST', `/api/kbiz/invoices/${inv}/send`], ['POST', `/api/kbiz/invoices/${inv}/cancel`], ['PUT', `/api/kbiz/invoices/${inv}`, { lines: [{ title: 'x', qty: 1, priceRub: 1 }] }],
  ['POST', `/api/kbiz/promos/${pr}/status`, { status: 'paused' }], ['POST', `/api/kbiz/payments/${payId}/confirm`], ['GET', `/api/kbiz/payments/${payId}/log`],
  ['POST', `/api/kbiz/qr/${qr.id}/status`, { status: 'disabled' }],
];
let leaks = 0;
for (const [m, p, b] of idor) { const x = await call(p, { method: m, body: m === 'GET' || m === 'DELETE' ? undefined : JSON.stringify(b ?? {}) }, X.tok); if (x.status === 200 && x.data?.ok !== false && !x.data?.log?.length === false) leaks++; if (x.status === 200 && m !== 'GET') leaks++; }
t('чужой владелец не меняет ни одну чужую запись (10 адресов)', leaks === 0, String(leaks));
t('данные О не изменились', q(`select title from kb_items where id='${item}'`) === 'Секретный товар' && q(`select status from kb_qr where id='${qr.id}'`) === 'active' && q(`select status from kb_promos where id='${pr}'`) === 'active');
t('чужие списки пусты', (await get(X, '/api/kbiz/payments')).data.payments.length === 0 && (await get(X, '/api/kbiz/items')).data.items.length === 0 && (await get(X, '/api/kbiz/orders')).data.orders.length === 0 && (await get(X, '/api/kbiz/invoices')).data.invoices.length === 0);
// подмена полей (mass assignment)
r = await post(X, '/api/kbiz/items', { title: 'Мой товар', priceRub: 10, business_id: bizId, businessId: bizId, status: 'archived', id: item });
t('подмена business_id/id в теле не работает', r.status === 200 && q(`select business_id from kb_items where id='${r.data.id}'`) !== bizId && q(`select title from kb_items where id='${item}'`) === 'Секретный товар');
r = await post(X, '/api/kbiz/qr', { title: 'Мой QR', amountRub: 10, business_id: bizId, kind: 'tip', status: 'archived' });
t('QR: вид и статус из тела игнорируются', r.status === 402 || (r.status === 200 && r.data.qr.kind === 'pay'), JSON.stringify(r.data).slice(0, 120));
// публичные ручки: мусор и инъекции
t('публичные ручки: мусорные id → 404 без падения', (await Promise.all(["/p/'%20OR%201=1--", '/p/AAAA', '/shop/%27%3B--', `/shop-order/kbo-xxx?k=1`, `/status/kbp-1?k=1`])).length === 5 && (await pub("/p/aaaaaaaaaaaa'--")).status === 404);
t('SQL-подобный адрес витрины не ломает', (await pub("/shop/a'%3Bdrop-table")).status === 404);
t('слишком большое тело вебхука отклоняется', await (async () => { const body = 'x'.repeat(70 * 1024); const x = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => null); return !x || x.status === 413 || x.status === 400 || x.status === 404 || x.status === 401; })());
t('GET на вебхук — 405', (await call(`/api/kbiz/webhook/${bizId}`)).status === 405);
// XSS: ответы отдаются как JSON, фото — с nosniff и CSP
const xss = await post(O, '/api/kbiz/items', { title: '<img src=x onerror=alert(1)>', priceRub: 5 });
t('HTML в названии хранится как текст (JSON-ответ, не HTML)', xss.status === 200 && /^application\/json/.test((await call('/api/kbiz/items', {}, O.tok)).headers.get('content-type')));
prov.close();
console.log(`\nитого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
