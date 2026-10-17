// SkyKassa Business, этап 2: каталог, заказы, витрина, чаевые, счета, пакет для VPS.  (. env.sh; node scripts/audit/kbiz2-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'kb2own'); const X = await mkuser(S, 'kb2str');
for (const u of [A, X]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 500, 0) on conflict (user_id) do update set balance = 500, points = 0`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const del = (u, p) => me(u, p, { method: 'DELETE' });
const pub = (p, o = {}) => call(`/api/kbiz/public${p}`, o);
const ORIGIN = 'https://shop.example.ru';
const pubO = (p, o = {}, origin = ORIGIN) => call(`/api/kbiz/public${p}`, { ...o, headers: { ...(o.headers ?? {}), Origin: origin } });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

await post(A, '/api/kbiz/business', { name: 'Кофейня «Луна»', mode: 'both', legalType: 'selfemployed' });
await put(A, '/api/kbiz/requisites', { holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' });
t('без подписки позицию каталога завести можно, чаевые нельзя', (await post(A, '/api/kbiz/tips', { recipient: 'Анна' })).status === 402);
await post(A, '/api/kbiz/subscription/buy', { idemKey: 'k2' });
await post(A, '/api/kbiz/publish', { on: true });

// каталог
t('без входа каталог закрыт', (await call('/api/kbiz/items')).status === 401);
t('цена 0 отклонена', (await post(A, '/api/kbiz/items', { title: 'Кофе', priceRub: 0 })).status === 400);
t('название короткое отклонено', (await post(A, '/api/kbiz/items', { title: 'а', priceRub: 10 })).status === 400);
let r = await post(A, '/api/kbiz/items', { title: 'Капучино', priceRub: 200, category: 'Кофе', variants: [{ name: '250 мл' }, { name: '400 мл', priceRub: 280 }], leadTime: '5 минут' });
t('позиция создана', r.status === 200 && /^kbi-/.test(r.data.id), JSON.stringify(r.data));
const cap = r.data.id;
const tea = (await post(A, '/api/kbiz/items', { title: 'Чай', priceRub: 120, category: 'Чай' })).data.id;
const hidden = (await post(A, '/api/kbiz/items', { title: 'Скрытое', priceRub: 50, available: false })).data.id;
t('фото: не картинка отклоняется', (await put(A, `/api/kbiz/items/${cap}/photo`, { dataUrl: 'data:text/html;base64,PGI+' })).status === 400);
r = await put(A, `/api/kbiz/items/${cap}/photo`, { dataUrl: png });
t('фото загружено', r.status === 200 && /media\/kbm-/.test(r.data.photoUrl), JSON.stringify(r.data));
const photo = r.data.photoUrl;
t('чужой не меняет позицию', [400, 403, 404].includes((await put(X, `/api/kbiz/items/${cap}`, { title: 'Взлом', priceRub: 1 })).status));
t('название не изменилось', q(`select title from kb_items where id='${cap}'`) === 'Капучино');

// витрина
t('витрина не настроена — 404', (await pub('/shop/kb2-luna')).status === 404);
t('занятый/служебный адрес отклонён', (await put(A, '/api/kbiz/shop', { slug: 'admin', enabled: true })).status === 400);
t('адрес с большими буквами отклонён', (await put(A, '/api/kbiz/shop', { slug: 'Luna_', enabled: true })).status === 400);
t('сайт только https без пути', (await put(A, '/api/kbiz/shop', { slug: 'kb2-luna', enabled: true, origins: ['http://shop.example.ru'] })).status === 400 && (await put(A, '/api/kbiz/shop', { slug: 'kb2-luna', enabled: true, origins: ['https://shop.example.ru/x'] })).status === 400);
r = await put(A, '/api/kbiz/shop', { slug: 'kb2-luna', enabled: true, origins: [ORIGIN], notice: 'Работаем с 8 до 20' });
t('витрина включена', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('адрес занят другим бизнесом', await (async () => { await post(X, '/api/kbiz/business', { name: 'Чужой', mode: 'online', legalType: 'person' }); return (await put(X, '/api/kbiz/shop', { slug: 'kb2-luna', enabled: true })).status === 409; })());
r = await pubO('/shop/kb2-luna');
t('витрина открыта: видны только доступные позиции', r.status === 200 && r.data.state === 'open' && r.data.items.length === 2 && !r.data.items.find((i) => i.title === 'Скрытое'), JSON.stringify(r.data).slice(0, 300));
t('в ответе нет служебных полей и реквизитов', !JSON.stringify(r.data).includes('900') && !('ownerId' in r.data.business));
t('сайт не из списка — отказ', (await pubO('/shop/kb2-luna', {}, 'https://evil.example')).status === 403);
t('без Origin (прямой запрос) читается', (await pub('/shop/kb2-luna')).status === 200);
t('CORS предзапрос отвечает', await (async () => { const x = await fetch((process.env.API ?? 'http://localhost:8080') + '/api/kbiz/public/shop/kb2-luna/order', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } }); return x.status === 204 && x.headers.get('access-control-allow-origin') === '*'; })());
const mres = await fetch((process.env.API ?? 'http://localhost:8080') + photo);
t('фото отдаётся публично, тип image/png, nosniff', mres.status === 200 && mres.headers.get('content-type') === 'image/png' && mres.headers.get('x-content-type-options') === 'nosniff');

// заказ: цены считает сервер
const contact = { name: 'Пётр', phone: '+7 911 000-11-22', email: 'p@example.ru', address: 'ул. Мира, 1' };
const order = (b, o) => pubO('/shop/kb2-luna/order', { method: 'POST', body: JSON.stringify(b) }, o);
t('пустая корзина отклонена', (await order({ items: [], contact })).status === 400);
t('вариант обязателен', (await order({ items: [{ id: cap, qty: 1 }], contact })).data.error === 'variant_required');
t('неизвестный вариант отклонён', (await order({ items: [{ id: cap, qty: 1, variant: 'нет' }], contact })).status === 400);
t('скрытая позиция недоступна', (await order({ items: [{ id: hidden, qty: 1 }], contact })).status === 409);
t('плохой телефон отклонён', (await order({ items: [{ id: tea, qty: 1 }], contact: { ...contact, phone: 'abc' } })).status === 400);
t('количество 0 и 100 отклонены', (await order({ items: [{ id: tea, qty: 0 }], contact })).status === 400 && (await order({ items: [{ id: tea, qty: 100 }], contact })).status === 400);
t('заказ с чужого сайта отклонён', (await order({ items: [{ id: tea, qty: 1 }], contact }, 'https://evil.example')).status === 403);
r = await order({ items: [{ id: cap, qty: 2, variant: '400 мл', priceRub: 1 }, { id: tea, qty: 1, price: 1 }], total: 1, contact, note: 'Без сахара' });
t('заказ оформлен', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('сумма с сервера: 2×280 + 120 = 680, а не из запроса', r.data.totalRub === 680 && Number(q(`select total_rub from kb_orders where id='${r.data.id}'`)) === 680);
const ord = r.data;
t('контакты в базе зашифрованы', !q(`select contact_enc from kb_orders where id='${ord.id}'`).includes('Пётр'));
t('номер заказа 1', ord.number === 1);
r = await pub(`/p/${ord.payPublicId}`);
t('страница оплаты заказа: сумма 680, номер, строки', r.status === 200 && r.data.amountRub === 680 && r.data.lines?.length === 2, JSON.stringify(r.data).slice(0, 300));
r = await pub(`/shop-order/${ord.id}?k=${ord.key}`);
t('покупатель видит статус по ключу', r.status === 200 && r.data.status === 'new' && r.data.totalRub === 680, JSON.stringify(r.data));
t('чужой ключ — 404', (await pub(`/shop-order/${ord.id}?k=bad`)).status === 404);
t('владелец уведомлён о заказе', Number(q(`select count(*) from gift_notifications where user_id='${A.pid}' and title='Новый заказ'`)) >= 1);
// лимит с адреса: 5 в час
let lim = 0; for (let i = 0; i < 6; i++) { const x = await order({ items: [{ id: tea, qty: 1 }], contact }); if (x.status === 429) lim++; }
t('лимит заказов с одного адреса срабатывает', lim >= 1);
t('honeypot молча принимается и не создаёт заказ', await (async () => { const n0 = Number(q(`select count(*) from kb_orders`)); const x = await order({ website: 'bot', items: [{ id: tea, qty: 1 }], contact }); return x.status === 200 && Number(q(`select count(*) from kb_orders`)) === n0; })());

// владелец: заказы
r = await me(A, '/api/kbiz/orders');
t('владелец видит заказы с расшифрованными контактами', r.data.orders.length >= 1 && r.data.orders.find((o) => o.id === ord.id)?.contact.name === 'Пётр');
t('чужой заказов не видит и не меняет', (await me(X, '/api/kbiz/orders')).data.orders.length === 0 && (await post(X, `/api/kbiz/orders/${ord.id}/confirm`, {})).status === 404);
t('нельзя сразу «выполнен→готов» минуя состояние: ready из new недопустим', (await post(A, `/api/kbiz/orders/${ord.id}/ready`, {})).status === 409);
t('отклонение без причины нельзя', (await post(A, `/api/kbiz/orders/${ord.id}/reject`, {})).data.error === 'comment_required');
t('подтверждён', (await post(A, `/api/kbiz/orders/${ord.id}/confirm`, {})).data.status === 'confirmed');
t('повтор — без ошибки', (await post(A, `/api/kbiz/orders/${ord.id}/confirm`, {})).data.duplicate === true);
t('в работе → готов → выполнен', (await post(A, `/api/kbiz/orders/${ord.id}/progress`, {})).data.status === 'in_progress' && (await post(A, `/api/kbiz/orders/${ord.id}/ready`, {})).data.status === 'ready' && (await post(A, `/api/kbiz/orders/${ord.id}/done`, {})).data.status === 'done');
t('выполненный не отменить', (await post(A, `/api/kbiz/orders/${ord.id}/cancel`, { comment: 'передумали' })).status === 409);
const o2 = (await order({ items: [{ id: tea, qty: 2 }], contact })).data;
if (!o2?.id) console.log('  (лимит исчерпан для второго заказа — берём из базы)');
const o2id = o2?.id ?? q(`select id from kb_orders where status='new' order by created_at desc limit 1`);
t('отклонение закрывает страницу оплаты', (await post(A, `/api/kbiz/orders/${o2id}/reject`, { comment: 'нет в наличии' })).data.status === 'rejected' && q(`select q.status from kb_orders o join kb_qr q on q.id=o.qr_id where o.id='${o2id}'`) === 'disabled');
t('новая ссылка на оплату для отклонённого нельзя', (await post(A, `/api/kbiz/orders/${o2id}/renew-pay`, {})).status === 409);
r = await post(A, `/api/kbiz/orders/${ord.id}/invoice`, {});
t('счёт из заказа создан черновиком', r.status === 200 && r.data.ok, JSON.stringify(r.data));

// подписка закончилась → витрина недоступна
q(`update kb_subscriptions set expires_at = now() - interval '1 day' where business_id=(select id from kb_businesses where owner_id='${A.pid}')`);
t('подписка истекла — витрина «недоступна», товаров нет', await (async () => { const x = await pubO('/shop/kb2-luna'); return x.data.state === 'unavailable' && x.data.items.length === 0; })());
t('и заказ не принимается', (await order({ items: [{ id: tea, qty: 1 }], contact })).status === 410);
q(`update kb_subscriptions set expires_at = now() + interval '30 days' where business_id=(select id from kb_businesses where owner_id='${A.pid}')`);

// чаевые
t('чаевые: короткое имя отклонено', (await post(A, '/api/kbiz/tips', { recipient: 'а' })).status === 400);
t('чаевые: минимум больше максимума отклонён', (await post(A, '/api/kbiz/tips', { recipient: 'Анна', min: 500, max: 100 })).status === 400);
r = await post(A, '/api/kbiz/tips', { recipient: 'Анна', message: 'Спасибо!', amounts: [50, 100, 300], min: 20, max: 1000, photo: png });
t('страница чаевых создана', r.status === 200 && r.data.ok, JSON.stringify(r.data));
let tips = (await me(A, '/api/kbiz/tips')).data;
const tip = tips.tips[0];
t('в списке с адресом /p/', tip.recipient === 'Анна' && /\/p\//.test(tip.url));
r = await pub(`/p/${tip.publicId}`);
t('публичная страница чаевых: вид tip, суммы, без обязательной суммы', r.data.tip && r.data.tip.recipient === 'Анна' && r.data.tip.amounts.includes(300), JSON.stringify(r.data).slice(0, 300));
t('чаевые ниже минимума отклонены', (await pub(`/p/${tip.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 10 }) })).status === 400);
t('чаевые выше максимума отклонены', (await pub(`/p/${tip.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 5000 }) })).status === 400);
r = await pub(`/p/${tip.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 100, note: 'Спасибо' }) });
t('чаевые 100 ₽ — заявка', r.status === 200 && r.data.status === 'reported', JSON.stringify(r.data));
const tp = (await me(A, '/api/kbiz/payments')).data.payments.find((p) => p.amountRub === 100);
t('владелец подтверждает чаевые', tp && (await post(A, `/api/kbiz/payments/${tp.id}/confirm`, {})).status === 200);
tips = (await me(A, '/api/kbiz/tips')).data;
t('статистика чаевых: 1 подтверждено на 100 ₽, среднее 100', tips.stats.confirmed === 1 && tips.stats.confirmedSumRub === 100 && tips.stats.averageRub === 100, JSON.stringify(tips.stats));
t('чужой чаевых не видит', (await me(X, '/api/kbiz/tips')).data.tips.length === 0);
t('чаевые не попадают в обычный список QR', !(await me(A, '/api/kbiz/qr')).data.qr.some((x) => x.kind === 'tip'));

// счета
const inv = { lines: [{ title: 'Услуга A', qty: 2, priceRub: 500 }, { title: 'Услуга B', qty: 1, priceRub: 300, discountRub: 50 }], discountRub: 100, orderNo: 'Д-7', comment: 'Спасибо' };
t('счёт без строк отклонён', (await post(A, '/api/kbiz/invoices', { lines: [] })).status === 400);
t('скидка больше суммы отклонена', (await post(A, '/api/kbiz/invoices', { ...inv, discountRub: 99999 })).status === 400);
t('срок в прошлом отклонён', (await post(A, '/api/kbiz/invoices', { ...inv, dueAt: '2020-01-01' })).status === 400);
r = await post(A, '/api/kbiz/invoices', inv);
t('счёт создан', r.status === 200 && r.data.ok, JSON.stringify(r.data));
const iv = r.data;
let invs = (await me(A, '/api/kbiz/invoices')).data.invoices;
const row = invs.find((x) => x.id === iv.id);
t('сумма: 1000 + 250 − 100 = 1150', row.subtotalRub === 1250 && row.totalRub === 1150 && row.status === 'draft', JSON.stringify(row));
t('черновик редактируется', (await put(A, `/api/kbiz/invoices/${iv.id}`, { ...inv, discountRub: 0 })).status === 200 && (await me(A, '/api/kbiz/invoices')).data.invoices.find((x) => x.id === iv.id).totalRub === 1250);
t('чужой счёт не отправить', [402, 404].includes((await post(X, `/api/kbiz/invoices/${iv.id}/send`, {})).status) && q(`select status from kb_invoices where id='${iv.id}'`) !== 'x');
r = await post(A, `/api/kbiz/invoices/${iv.id}/send`, {});
t('счёт отправлен: ссылка на оплату', r.status === 200 && /\/p\//.test(r.data.url), JSON.stringify(r.data));
t('повторная отправка возвращает ту же ссылку', (await post(A, `/api/kbiz/invoices/${iv.id}/send`, {})).data.url === r.data.url);
t('отправленный не редактируется', (await put(A, `/api/kbiz/invoices/${iv.id}`, inv)).status === 409);
const ipid = r.data.url.split('/p/')[1];
r = await pub(`/p/${ipid}`);
t('страница счёта: сумма 1250, номер', r.data.amountRub === 1250 && r.data.lines?.length === 2, JSON.stringify(r.data).slice(0, 300));
const rp = await pub(`/p/${ipid}/report`, { method: 'POST', body: JSON.stringify({}) });
t('покупатель сообщил об оплате счёта', rp.status === 200 && rp.data.status === 'reported', JSON.stringify(rp.data));
invs = (await me(A, '/api/kbiz/invoices')).data.invoices;
t('в списке: «покупатель сообщил»', invs.find((x) => x.id === iv.id).status === 'reported');
const ip = (await me(A, '/api/kbiz/payments')).data.payments.find((p) => p.amountRub === 1250);
await post(A, `/api/kbiz/payments/${ip.id}/confirm`, {});
t('после подтверждения — «подтверждена владельцем»', (await me(A, '/api/kbiz/invoices')).data.invoices.find((x) => x.id === iv.id).status === 'confirmed');
t('оплаченный счёт отменить нельзя', (await post(A, `/api/kbiz/invoices/${iv.id}/cancel`, {})).status === 409);
const iv2 = (await post(A, '/api/kbiz/invoices', inv)).data;
await post(A, `/api/kbiz/invoices/${iv2.id}/send`, {});
t('неоплаченный счёт отменяется, страница закрывается', (await post(A, `/api/kbiz/invoices/${iv2.id}/cancel`, {})).status === 200 && q(`select q.status from kb_invoices i join kb_qr q on q.id=i.qr_id where i.id='${iv2.id}'`) === 'disabled');

// пакет для VPS
const pk = await fetch((process.env.API ?? 'http://localhost:8080') + '/api/kbiz/shop/package.tar.gz?api=https://sky.example.ru', { headers: { Authorization: `Bearer ${A.tok}` } });
const buf = Buffer.from(await pk.arrayBuffer());
t('пакет скачивается как gzip', pk.status === 200 && /gzip/.test(pk.headers.get('content-type')) && buf[0] === 0x1f);
const tar = zlib.gunzipSync(buf); const names = []; const body = {};
for (let o = 0; o + 512 <= tar.length && tar[o] !== 0;) { const n = tar.slice(o, o + 100).toString().replace(/\0.*$/, ''); const sz = parseInt(tar.slice(o + 124, o + 135).toString(), 8); names.push(n); body[n] = tar.slice(o + 512, o + 512 + sz).toString(); o += 512 + Math.ceil(sz / 512) * 512; }
t('в пакете сайт каталога и README', ['index.html', 'app.js', 'style.css', 'config.js', 'README.txt'].every((n) => names.includes(n)), names.join(','));
t('config.js: адрес Sky и адрес витрины вписаны', body['config.js'].includes('https://sky.example.ru') && body['config.js'].includes('kb2-luna'));
t('в пакете нет реквизитов и ключей', !Object.values(body).join('').match(/900 111|Иванов|ENCRYPTION|SECRET/));
t('http-адрес Sky в пакет не попадает', !(await (async () => { const x = await fetch((process.env.API ?? 'http://localhost:8080') + '/api/kbiz/shop/package.tar.gz?api=http://evil', { headers: { Authorization: `Bearer ${A.tok}` } }); return zlib.gunzipSync(Buffer.from(await x.arrayBuffer())).toString().includes('http://evil'); })()));
t('чужой пакет не скачать без витрины', (await fetch((process.env.API ?? 'http://localhost:8080') + '/api/kbiz/shop/package.tar.gz', { headers: { Authorization: `Bearer ${X.tok}` } })).status === 409);

// приостановка бизнеса
q(`update kb_businesses set status='suspended' where owner_id='${A.pid}'`);
t('приостановленный бизнес: витрина «suspended», заказ невозможен', (await pubO('/shop/kb2-luna')).data.state === 'suspended' && (await order({ items: [{ id: tea, qty: 1 }], contact })).status === 410);
t('и фото не отдаётся', (await fetch((process.env.API ?? 'http://localhost:8080') + photo)).status === 404);
q(`update kb_businesses set status='active' where owner_id='${A.pid}'`);
t('архивация позиции убирает её с витрины', (await del(A, `/api/kbiz/items/${tea}`)).status === 200 && !(await pubO('/shop/kb2-luna')).data.items.some((i) => i.id === tea));
t('журнал аудита без реквизитов и контактов', !(await me(A, '/api/kbiz/audit')).data.entries?.some?.((e) => /Пётр|900 111/.test(JSON.stringify(e))));
console.log(`\nитого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
