// SkyKassa Business, этап 1.  (. env.sh; node scripts/audit/kbiz-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'kbown'); const X = await mkuser(S, 'kbstr'); const P = await mkuser(S, 'kbprime'); const NP = await mkuser(S, 'kbplain');
for (const u of [A, X, P, NP]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 500, 0) on conflict (user_id) do update set balance = 500, points = 0`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const pub = (p, o = {}) => call(`/api/kbiz/public${p}`, o);

// 1. подключение бизнеса
t('без входа кабинет закрыт', (await call('/api/kbiz/me')).status === 401);
let r = await me(A, '/api/kbiz/me');
t('сначала бизнеса нет, подписка 89 ₽ / 30 дн.', r.data.business === null && r.data.subscription.priceRub === 89 && r.data.subscription.periodDays === 30, JSON.stringify(r.data));
t('слишком короткое название отклонено', (await post(A, '/api/kbiz/business', { name: 'a', mode: 'both', legalType: 'person' })).status === 400);
t('неверный режим отклонён', (await post(A, '/api/kbiz/business', { name: 'Кофейня', mode: 'x', legalType: 'person' })).status === 400);
t('сайт только https', (await post(A, '/api/kbiz/business', { name: 'Кофейня', mode: 'both', legalType: 'person', website: 'http://x.ru' })).status === 400);
r = await post(A, '/api/kbiz/business', { name: 'Кофейня «Луна»', mode: 'point', legalType: 'selfemployed', category: 'кафе', country: 'RU', description: 'Кофе и выпечка', contacts: '+7 900 000-00-00' });
t('бизнес подключён (режим «реальная точка»)', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('второй бизнес у того же владельца нельзя', (await post(A, '/api/kbiz/business', { name: 'Ещё', mode: 'both', legalType: 'person' })).status === 409);
r = await me(A, '/api/kbiz/me');
t('статус деятельности не называется подтверждённым', r.data.business.legalVerified === false && r.data.business.legalType === 'selfemployed' && r.data.business.status === 'draft');

// 2. реквизиты
const req = { holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата заказа', instruction: 'Укажите номер заказа' };
t('реквизиты с «CVV» в тексте отклонены', (await put(A, '/api/kbiz/requisites', { ...req, instruction: 'Напишите CVV карты' })).data.error === 'secret_words');
t('карта с лишними символами отклонена', (await put(A, '/api/kbiz/requisites', { ...req, method: 'card', value: '1234 5678 9012 3456 12/30' })).status === 400);
t('опубликовать без реквизитов нельзя', (await post(A, '/api/kbiz/publish', { on: true })).data.error === 'requisites_required');
r = await put(A, '/api/kbiz/requisites', req);
t('реквизиты сохранены', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('реквизиты в базе зашифрованы', !q(`select data_enc from kb_requisites limit 1`).includes('Иванов'));
t('чужой не видит реквизиты в «/me»', (await me(X, '/api/kbiz/me')).data.requisites == null);

// 3. подписка 89 ₽
t('без подписки QR создать нельзя (402)', (await post(A, '/api/kbiz/qr', { title: 'Кофе', amountRub: 150 })).status === 402);
r = await post(A, '/api/kbiz/subscription/buy', { idemKey: 'k1' });
t('подписка оплачена с кошелька', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('списано ровно 89 ₽', Number(q(`select balance from wallet_accounts where user_id='${A.pid}'`)) === 411);
await post(A, '/api/kbiz/subscription/buy', { idemKey: 'k1' });
t('повтор ключа не списывает второй раз', Number(q(`select balance from wallet_accounts where user_id='${A.pid}'`)) === 411 && Number(q(`select count(*) from kb_subscriptions`)) >= 1);
r = await me(A, '/api/kbiz/subscription');
t('статус «активна», срок ~30 дней', r.data.subscription.status === 'active' && Math.abs((new Date(r.data.subscription.expiresAt) - Date.now()) / 86400000 - 30) < 0.1, JSON.stringify(r.data.subscription));
t('нехватка денег — отказ без подписки', await (async () => { q(`update wallet_accounts set balance = 10 where user_id='${X.pid}'`); await post(X, '/api/kbiz/business', { name: 'Чужой', mode: 'online', legalType: 'person' }); const x = await post(X, '/api/kbiz/subscription/buy', { idemKey: 'z' }); return x.status === 402; })());

// 4. QR и страница
r = await post(A, '/api/kbiz/publish', { on: true });
t('бизнес опубликован', r.data.status === 'active');
r = await post(A, '/api/kbiz/qr', { title: 'Кофе', amountRub: 150, orderNo: 'A-1' });
t('QR фиксированной суммы создан', r.status === 200 && r.data.qr.amountRub === 150 && /\/p\/[a-z0-9]{12,}$/.test(r.data.qr.url), JSON.stringify(r.data));
const fixed = r.data.qr;
t('сумма 0 и дробная отклоняются', (await post(A, '/api/kbiz/qr', { title: 'x1', amountRub: 0 })).status === 400 && (await post(A, '/api/kbiz/qr', { title: 'x2', amountRub: 10.5 })).status === 400);
r = await post(A, '/api/kbiz/qr/permanent', {});
t('постоянный QR создан, второй нельзя', r.status === 200 && r.data.qr.kind === 'permanent' && (await post(A, '/api/kbiz/qr/permanent', {})).status === 409);
const perm = r.data.qr;
// 5. покупатель без регистрации
r = await pub(`/p/${fixed.publicId}`);
t('страница открывается без входа и показывает реквизиты', r.status === 200 && r.data.state === 'open' && r.data.amountRub === 150 && r.data.requisites.value.includes('900'), JSON.stringify(r.data).slice(0, 200));
t('несуществующая страница — 404', (await pub('/p/aaaaaaaaaaaa')).status === 404);
t('открытия считаются уникально (одним адресом — один раз в сутки)', (await pub(`/p/${fixed.publicId}`), Number((await me(A, '/api/kbiz/qr')).data.qr.find((x) => x.id === fixed.id).opens) === 1));
// 6. заявка покупателя
r = await pub(`/p/${fixed.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 1, note: 'Оплатил с карты', status: 'confirmed' }) });
t('покупатель сообщил об оплате: статус «reported», сумма — с сервера (150), не из запроса', r.status === 200 && r.data.status === 'reported', JSON.stringify(r.data));
const pay1 = r.data;
t('в базе сумма 150 и статус reported', q(`select amount_rub || ':' || status from kb_payments where id='${pay1.id}'`) === '150:reported');
t('покупатель видит статус по ключу, без ключа — нет', (await pub(`/status/${pay1.id}?k=${pay1.statusKey}`)).data.status === 'reported' && (await pub(`/status/${pay1.id}?k=wrong`)).status === 404);
r = await pub(`/p/${perm.publicId}/report`, { method: 'POST', body: JSON.stringify({}) });
t('в постоянном QR без суммы — отказ', r.status === 400 && r.data.error === 'bad_amount');
r = await pub(`/p/${perm.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 700, note: 'свободная' }) });
t('свободная сумма принята', r.status === 200);
// 7. владелец
r = await me(A, '/api/kbiz/payments');
t('владелец видит обе заявки', r.data.payments.length === 2);
t('владелец уведомлён о заявке', Number(q(`select count(*) from gift_notifications where user_id='${A.pid}' and kind='kassa_biz' and title like 'Покупатель%'`)) >= 2);
t('чужой не видит заявки и не меняет статус', (await me(X, '/api/kbiz/payments')).data.payments.length === 0 && (await post(X, `/api/kbiz/payments/${pay1.id}/confirm`, {})).status === 404);
t('покупатель не может подтвердить через кабинет (нет входа)', (await call(`/api/kbiz/payments/${pay1.id}/confirm`, { method: 'POST', body: '{}' })).status === 401);
t('«нет оплаты» без комментария нельзя', (await post(A, `/api/kbiz/payments/${pay1.id}/not_found`, {})).data.error === 'comment_required');
t('до подтверждения «возврат» невозможен', (await post(A, `/api/kbiz/payments/${pay1.id}/refund`, { comment: 'проверка' })).data.error === 'bad_state');
r = await post(A, `/api/kbiz/payments/${pay1.id}/take`, {}); t('взять на проверку', r.data.status === 'pending_check');
r = await post(A, `/api/kbiz/payments/${pay1.id}/confirm`, {}); t('владелец подтвердил получение', r.data.status === 'confirmed');
r = await post(A, `/api/kbiz/payments/${pay1.id}/confirm`, {}); t('повтор подтверждения — без второй записи', r.data.duplicate === true && Number(q(`select count(*) from kb_payment_log where payment_id='${pay1.id}' and to_status='confirmed'`)) === 1);
t('buyer статус теперь «confirmed»', (await pub(`/status/${pay1.id}?k=${pay1.statusKey}`)).data.status === 'confirmed');
r = await me(A, '/api/kbiz/overview');
t('аналитика: заявлено и подтверждено — раздельно, интеграция = 0', r.data.stats.confirmedByOwnerSumRub === 150 && r.data.stats.claimedSumRub === 850 && r.data.stats.confirmedByIntegrationSumRub === 0, JSON.stringify(r.data));
t('журнал платежа пишет кто и что', (await me(A, `/api/kbiz/payments/${pay1.id}/log`)).data.log.length >= 3);
// выгрузка
const csv = await call('/api/kbiz/export.csv', {}, A.tok);
t('CSV-выгрузка доступна владельцу', csv.status === 200 && csv.text.includes('Оплата подтверждена владельцем'));
// 8. реквизиты изменены — журнал и уведомление
await put(A, '/api/kbiz/requisites', { ...req, value: '+7 900 999-88-77' });
r = await me(A, '/api/kbiz/audit');
t('аудит содержит смену реквизитов, но не сами реквизиты', r.data.audit.some((a) => a.action === 'requisites_changed') && !JSON.stringify(r.data).includes('999-88'));
t('владелец уведомлён о смене реквизитов', Number(q(`select count(*) from gift_notifications where user_id='${A.pid}' and title like '%изменены реквизиты%'`)) === 1);
t('страница сразу показывает новые реквизиты', (await pub(`/p/${fixed.publicId}`)).data.requisites.value.includes('999'));
// 9. отключение QR
r = await post(A, `/api/kbiz/qr/${fixed.id}/status`, { status: 'disabled' });
t('отключённый QR не принимает заявки', r.status === 200 && (await pub(`/p/${fixed.publicId}/report`, { method: 'POST', body: '{}' })).status === 410);
t('чужой не может отключить чужой QR', (await post(X, `/api/kbiz/qr/${perm.id}/status`, { status: 'disabled' })).status === 404);
// 10. истечение подписки — данные не удаляются
q(`update kb_subscriptions set expires_at = now() - interval '1 day' where business_id = (select id from kb_businesses where owner_id='${A.pid}')`);
r = await me(A, '/api/kbiz/me');
t('подписка истекла: статус «expired», бизнес и реквизиты на месте', r.data.subscription.status === 'expired' && r.data.business && r.data.requisites.holder === 'Иванов Иван');
t('новый QR создать нельзя', (await post(A, '/api/kbiz/qr', { title: 'Новый' })).status === 402);
t('заявки и выгрузка по-прежнему доступны', (await me(A, '/api/kbiz/payments')).data.payments.length === 2 && (await call('/api/kbiz/export.csv', {}, A.tok)).status === 200);
r = await pub(`/p/${perm.publicId}`);
t('страница оплаты при истёкшей подписке — «недоступна», реквизиты не отдаются', r.data.state === 'unavailable' && !r.data.requisites);
t('заявки покупателей при истёкшей подписке не принимаются', (await pub(`/p/${perm.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 5 }) })).status === 410);
await post(A, '/api/kbiz/subscription/buy', { idemKey: 'k2' });
t('продление возвращает работу', (await pub(`/p/${perm.publicId}`)).data.state === 'open');
// 11. приостановка администрацией
q(`update kb_businesses set status='suspended', suspended_reason='тест' where owner_id='${A.pid}'`);
t('приостановленный бизнес: страница недоступна, история цела', (await pub(`/p/${perm.publicId}`)).data.state === 'suspended' && (await me(A, '/api/kbiz/payments')).data.payments.length === 2);
t('приостановленному нельзя менять реквизиты и публиковать', (await put(A, '/api/kbiz/requisites', req)).data.error === 'suspended' && (await post(A, '/api/kbiz/publish', {})).data.error === 'suspended');
q(`update kb_businesses set status='active' where owner_id='${A.pid}'`);

// 12. массовые заявки
let lim = 0; for (let i = 0; i < 8; i++) { const x = await pub(`/p/${perm.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 5 }) }); if (x.status === 429) lim++; }
t('массовые фиктивные заявки ограничиваются (429)', lim > 0, String(lim));
t('ловушка для ботов не создаёт заявку', await (async () => { const n = Number(q(`select count(*) from kb_payments`)); await pub(`/p/${perm.publicId}/report`, { method: 'POST', body: JSON.stringify({ amountRub: 5, website: 'spam.ru' }) }); return Number(q(`select count(*) from kb_payments`)) === n; })());

// 13. сканер QR и кэшбэк Prime
q(`insert into prime_subscriptions (id, profile_id, status, plan, expires_at) values ('prime-kb-${P.pid}', '${P.pid}', 'active', 'standard', now() + interval '30 days')`);
t('чужой текст из QR не открывается', (await post(P, '/api/kbiz/scan', { text: 'https://evil.example/p/aaaaaaaaaaaa' })).data.error === 'not_skykassa_qr' || (await post(P, '/api/kbiz/scan', { text: 'hello' })).data.error === 'not_skykassa_qr');
t('сканирование без входа закрыто', (await call('/api/kbiz/scan', { method: 'POST', body: '{}' })).status === 401);
r = await post(P, '/api/kbiz/scan', { text: perm.url });
t('Prime: сканирование открывает страницу, правила нет — баллов нет', r.status === 200 && r.data.prime === true && r.data.state === 'open' && r.data.granted.length === 0, JSON.stringify(r.data));
q(`delete from cashback_rules where trigger='kassa_scan'`);
q(`insert into cashback_rules (id, title, trigger, kind, percent, fixed_points, min_amount_rub, max_points_event, per_user_day_events, per_user_month_points, prime_only, hold_days, status) values ('cbr-kb-1', 'Сканирование QR', 'kassa_scan', 'fixed', 0, 7, 0, 50, 3, 100, true, 0, 'active')`);
await new Promise((x) => setTimeout(x, 11000));      // кэш правил — 10 с
r = await post(P, '/api/kbiz/scan', { text: perm.url });
t('Prime: правило есть — +7 баллов', r.data.granted.length === 1 && r.data.granted[0].points === 7, JSON.stringify(r.data));
t('баллы на кошельке', Number(q(`select points from wallet_accounts where user_id='${P.pid}'`)) === 7);
r = await post(P, '/api/kbiz/scan', { text: perm.url });
t('повторное сканирование того же бизнеса в тот же день — без второго кэшбэка', r.data.granted.length === 0 && Number(q(`select points from wallet_accounts where user_id='${P.pid}'`)) === 7);
r = await post(NP, '/api/kbiz/scan', { text: perm.url });
t('без Prime — страница открывается, баллов нет', r.status === 200 && r.data.prime === false && r.data.granted.length === 0 && Number(q(`select points from wallet_accounts where user_id='${NP.pid}'`)) === 0);
r = await post(A, '/api/kbiz/scan', { text: perm.url });
t('владелец сканирует свой QR — кэшбэка нет', r.data.granted.length === 0);
q(`delete from cashback_rules where id='cbr-kb-1'`);
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
