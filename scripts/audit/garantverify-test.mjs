// Sky Garant: сделка с проверкой данных и обмен (server/garantverify.mjs). API с ADMIN_GATE=off.
// (TEST_DATABASE_URL=… node scripts/audit/garantverify-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const A = await mkuser(S, 'gva'), B = await mkuser(S, 'gvb'), O = await mkuser(S, 'gvo'), ADM = await mkuser(S, 'gvm');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${ADM.pid}'`);
for (const u of [A, B, O, ADM]) await call('/api/wallet', {}, u.tok);
q(`update wallet_accounts set balance=100000 where user_id='${B.pid}'`);
q(`insert into garant_subscriptions(profile_id,status,until) values ('${A.pid}','active', now() + interval '30 days'),('${B.pid}','active', now() + interval '30 days') on conflict do nothing`);
const bal = (u) => Number(q(`select balance from wallet_accounts where user_id='${u.pid}'`));
const P = (path, tok, body = {}) => call(path, { method: 'POST', body: JSON.stringify(body) }, tok);
const G = (path, tok) => call(path, {}, tok);
const st = (id) => q(`select status from garant_deals where id='${id}'`);
const DATA = { fields: [{ label: 'Логин', value: 'user-secret-login' }, { label: 'Пароль', value: 'p@ss-secret-123' }], note: 'Почта привязана' };

/* ═══ Сделка с проверкой ═══ */
let r = await P('/api/garant/verify', A.tok, { flow: 'sale', counterpartyId: B.pid, itemType: 'item', itemName: 'Аккаунт', title: 'Аккаунт игры', price: 500 });
ok(r.status === 201 && r.data.deal.status === 'awaiting_data' && r.data.deal.flow === 'sale', 'сделка создана: ждёт данные', r.text.slice(0, 120));
const S1 = r.data.deal.id;
r = await P('/api/garant/verify', A.tok, { flow: 'sale', counterpartyId: A.pid, itemType: 'item', itemName: 'x', price: 5 }); ok(r.status === 400, 'сделка с самим собой — отказ');
r = await P('/api/garant/verify', A.tok, { flow: 'sale', counterpartyId: B.pid, itemType: 'item', itemName: 'x', price: 0 }); ok(r.status === 400, 'цена 0 в сделке — отказ');
r = await P('/api/garant/verify', A.tok, { flow: 'hack', counterpartyId: B.pid, itemType: 'item', itemName: 'x', price: 5 }); ok(r.status === 400, 'неизвестный flow — отказ');
r = await P(`/api/garant/deals/${S1}/pay`, B.tok); ok(r.status >= 400 && st(S1) === 'awaiting_data', 'оплатить до данных нельзя');
r = await P(`/api/garant/deals/${S1}/data`, B.tok, { ...DATA, confirmed: true }); ok(r.status === 403, 'покупатель не передаёт данные продавца');
r = await P(`/api/garant/deals/${S1}/data`, O.tok, { ...DATA, confirmed: true }); ok(r.status === 404, 'посторонний не передаёт данные');
r = await P(`/api/garant/deals/${S1}/data`, A.tok, { ...DATA }); ok(r.status === 400 && r.data.error === 'confirm_required', 'продавец обязан подтвердить, что данные верны');
r = await P(`/api/garant/deals/${S1}/data`, A.tok, { fields: [], confirmed: true }); ok(r.status === 400, 'пустые данные — отказ');
r = await P(`/api/garant/deals/${S1}/data`, A.tok, { ...DATA, confirmed: true }); ok(r.status === 200 && r.data.deal.status === 'verifying' && r.data.deal.sellerData === 'confirmed', 'данные переданы → режим проверки', r.text.slice(0, 120));
ok(!q(`select data_enc from garant_deal_data where deal_id='${S1}'`).includes('user-secret-login'), 'данные в базе зашифрованы');
r = await P(`/api/garant/deals/${S1}/pay`, B.tok); ok(r.status === 409 && r.data.error === 'view_first' && st(S1) === 'verifying', 'оплатить, не открыв данные, нельзя');
r = await G(`/api/garant/deals/${S1}/data`, O.tok); ok(r.status === 404, 'посторонний не видит данные');
r = await G(`/api/garant/deals/${S1}/data`, A.tok); ok(r.status === 200 && r.data.mine?.fields?.[0]?.value === 'user-secret-login' && r.data.theirs === null, 'продавец видит свои данные, не чужие');
r = await G(`/api/garant/deals/${S1}/data`, B.tok); ok(r.status === 200 && r.data.theirs?.fields?.[1]?.value === 'p@ss-secret-123' && r.data.canSeeTheirs, 'покупатель в режиме проверки видит данные');
ok(Number(q(`select count(*) from garant_audit_log where deal_id='${S1}' and action='data_viewed'`)) >= 1, 'просмотр записан в журнал');
r = await P(`/api/garant/deals/${S1}/v-cancel`, A.tok); ok(r.status === 409 && st(S1) === 'verifying', 'в режиме проверки отмена закрыта (только спор/оплата)');
const b0 = bal(B), a0 = bal(A);
r = await P(`/api/garant/deals/${S1}/pay`, A.tok); ok(r.status === 403, 'продавец не может оплатить');
const [p1, p2] = await Promise.all([P(`/api/garant/deals/${S1}/pay`, B.tok), P(`/api/garant/deals/${S1}/pay`, B.tok)]);
ok([p1, p2].filter((x) => x.status === 200).length === 1 && bal(B) === b0 - 500 && st(S1) === 'paid', 'двойное нажатие «Оплатить» списывает один раз', `${p1.status}/${p2.status} ${b0}→${bal(B)}`);
ok(bal(A) === a0, 'пока не закрыто, продавец денег не получил');
r = await P(`/api/garant/deals/${S1}/close`, B.tok); ok(r.status === 403, 'покупатель не закрывает сделку');
const [c1, c2] = await Promise.all([P(`/api/garant/deals/${S1}/close`, A.tok), P(`/api/garant/deals/${S1}/close`, A.tok)]);
ok([c1, c2].filter((x) => x.status === 200).length === 1 && bal(A) === a0 + 500 && st(S1) === 'completed', 'закрытие: продавцу ровно одна выплата', `${c1.status}/${c2.status} ${a0}→${bal(A)}`);
r = await G(`/api/garant/deals/${S1}/data`, B.tok); ok(r.data.theirs?.fields?.length === 2, 'после закрытия покупатель по-прежнему видит данные');

/* ═══ Сделка: спор из режима проверки (без денег) ═══ */
r = await P('/api/garant/verify', A.tok, { flow: 'sale', counterpartyId: B.pid, itemType: 'item', itemName: 'Скин', price: 300 }); const S2 = r.data.deal.id;
await P(`/api/garant/deals/${S2}/data`, A.tok, { ...DATA, confirmed: true });
r = await P(`/api/garant/deals/${S2}/v-dispute`, B.tok, { reason: 'Пароль не подходит' }); ok(r.status === 409 && r.data.error === 'view_first', 'спор по данным — только после просмотра');
await G(`/api/garant/deals/${S2}/data`, B.tok);
r = await P(`/api/garant/deals/${S2}/v-dispute`, B.tok, { reason: 'Пароль не подходит' }); ok(r.status === 200 && st(S2) === 'disputed', 'покупатель открыл спор');
const b1 = bal(B), a1 = bal(A);
r = await P(`/api/garant/admin/deals/${S2}/resolve`, ADM.tok, { winner: 'buyer_wins', note: 'x' }); ok(r.status === 409 && bal(B) === b1, 'старое решение спора без удержанных денег не создаёт деньги');
r = await G(`/api/garant/admin/deals/${S2}/data`, O.tok); ok(r.status === 403, 'обычный пользователь не открывает данные спора');
r = await G(`/api/garant/admin/deals/${S2}/data`, ADM.tok); ok(r.status === 200 && r.data.seller?.fields?.length === 2 && r.data.views?.length >= 1, 'сотрудник видит данные и журнал просмотров');
r = await P(`/api/garant/admin/deals/${S2}/resolve-verify`, O.tok, { outcome: 'cancel', note: 'x' }); ok(r.status === 403, 'решение спора — только сотрудник');
r = await P(`/api/garant/admin/deals/${S2}/resolve-verify`, ADM.tok, { outcome: 'resume', note: 'Данные рабочие' }); ok(r.status === 200 && st(S2) === 'verifying', 'арбитр: данные в порядке — проверка продолжается');
await P(`/api/garant/deals/${S2}/pay`, B.tok);
r = await P(`/api/garant/deals/${S2}/v-dispute`, B.tok, { reason: 'Не получил доступ после оплаты' }); ok(r.status === 200 && st(S2) === 'disputed', 'спор после оплаты');
r = await P(`/api/garant/admin/deals/${S2}/resolve-verify`, ADM.tok, { outcome: 'cancel', note: 'x' }); ok(r.status === 409, 'verify-решение при удержанных деньгах закрыто (нужен прежний путь)');
r = await P(`/api/garant/admin/deals/${S2}/resolve`, ADM.tok, { winner: 'buyer_wins', note: 'Доступ не работает' }); ok(r.status === 200 && bal(B) === b1 && st(S2) === 'completed', 'спор после оплаты в пользу покупателя: возврат', `${b1}→${bal(B)}`);
ok(bal(A) === a1, 'продавец при возврате ничего не получил');

/* ═══ Обмен ═══ */
r = await P('/api/garant/verify', A.tok, { flow: 'exchange', counterpartyId: B.pid, itemType: 'skin', itemName: 'Мой скин', counterItemName: 'Ваш скин', title: 'Обмен скинами' });
ok(r.status === 201 && r.data.deal.flow === 'exchange' && r.data.deal.price === 0, 'обмен создан без цены', r.text.slice(0, 120)); const E1 = r.data.deal.id;
r = await P('/api/garant/verify', A.tok, { flow: 'exchange', counterpartyId: B.pid, itemType: 'skin', itemName: 'x' }); ok(r.status === 400, 'обмен без описания встречного — отказ');
r = await P(`/api/garant/deals/${E1}/confirm-data`, A.tok); ok(r.status === 409, 'подтвердить свои данные до их передачи нельзя');
r = await P(`/api/garant/deals/${E1}/data`, A.tok, DATA); ok(r.status === 200 && r.data.deal.status === 'awaiting_data' && r.data.deal.sellerData === 'submitted', 'A передал данные: ждём вторую сторону');
r = await P(`/api/garant/deals/${E1}/data`, A.tok, { ...DATA, note: 'исправлено' }); ok(r.status === 200, 'до подтверждения данные можно поправить');
r = await G(`/api/garant/deals/${E1}/data`, B.tok); ok(r.data.theirs === null && r.data.canSeeTheirs === false, 'до режима проверки чужих данных не видно');
r = await P(`/api/garant/deals/${E1}/data`, B.tok, { fields: [{ label: 'Ключ', value: 'KEY-777' }] }); ok(r.status === 200 && r.data.deal.status === 'confirming', 'обе стороны передали → подтверждение верности');
r = await P(`/api/garant/deals/${E1}/approve`, A.tok); ok(r.status === 409, 'одобрить до режима проверки нельзя');
r = await P(`/api/garant/deals/${E1}/confirm-data`, A.tok); ok(r.status === 200 && st(E1) === 'confirming', 'A подтвердил свои данные');
r = await P(`/api/garant/deals/${E1}/data`, A.tok, DATA); ok(r.status === 409 && r.data.error === 'data_locked', 'подтверждённые данные не правятся');
r = await P(`/api/garant/deals/${E1}/confirm-data`, A.tok); ok(r.status === 409, 'повторное подтверждение — отказ');
r = await G(`/api/garant/deals/${E1}/data`, B.tok); ok(r.data.theirs === null, 'пока B не подтвердил, A данных B/B данных A не видят');
r = await P(`/api/garant/deals/${E1}/confirm-data`, B.tok); ok(r.status === 200 && st(E1) === 'verifying', 'обе подтвердили → режим проверки');
r = await P(`/api/garant/deals/${E1}/approve`, A.tok); ok(r.status === 409 && r.data.error === 'view_first', 'одобрить вслепую нельзя');
r = await G(`/api/garant/deals/${E1}/data`, A.tok); ok(r.data.theirs?.fields?.[0]?.value === 'KEY-777', 'A видит данные B');
r = await G(`/api/garant/deals/${E1}/data`, B.tok); ok(r.data.theirs?.fields?.[1]?.value === 'p@ss-secret-123' && r.data.theirs.note === 'исправлено', 'B видит данные A (последняя версия)');
r = await P(`/api/garant/deals/${E1}/approve`, A.tok); ok(r.status === 200 && r.data.deal.status === 'verifying' && r.data.deal.sellerApproved, 'A одобрил: ждём B');
r = await P(`/api/garant/deals/${E1}/approve`, A.tok); ok(r.status === 409, 'повторное одобрение — отказ');
const [ap1, ap2] = await Promise.all([P(`/api/garant/deals/${E1}/approve`, B.tok), P(`/api/garant/deals/${E1}/approve`, B.tok)]);
ok([ap1, ap2].filter((x) => x.status === 200).length === 1 && st(E1) === 'completed', 'обе стороны одобрили → обмен завершён', `${ap1.status}/${ap2.status}`);
ok(bal(A) === a1 && bal(B) === b1, 'в обмене деньги не двигались');

// (свежие пользователи: у обычных операций предел 20 записей в минуту на человека)
const A2 = await mkuser(S, 'gv2a'), B2 = await mkuser(S, 'gv2b');
for (const u of [A2, B2]) await call('/api/wallet', {}, u.tok);
q(`insert into garant_subscriptions(profile_id,status,until) values ('${A2.pid}','active', now() + interval '30 days'),('${B2.pid}','active', now() + interval '30 days') on conflict do nothing`);
// обмен: спор, отмена до проверки
r = await P('/api/garant/verify', B2.tok, { flow: 'exchange', counterpartyId: A2.pid, itemType: 'item', itemName: 'a', counterItemName: 'b' }); const E2 = r.data.deal.id;
r = await P(`/api/garant/deals/${E2}/v-cancel`, B2.tok); ok(r.status === 200 && st(E2) === 'cancelled', 'до режима проверки сторона может отменить');
r = await P('/api/garant/verify', B2.tok, { flow: 'exchange', counterpartyId: A2.pid, itemType: 'item', itemName: 'a', counterItemName: 'b' }); const E3 = r.data.deal.id;
await P(`/api/garant/deals/${E3}/data`, B2.tok, DATA); await P(`/api/garant/deals/${E3}/data`, A2.tok, DATA);
await P(`/api/garant/deals/${E3}/confirm-data`, B2.tok); await P(`/api/garant/deals/${E3}/confirm-data`, A2.tok);
await G(`/api/garant/deals/${E3}/data`, A2.tok);
r = await P(`/api/garant/deals/${E3}/v-dispute`, A2.tok, { reason: 'Данные не соответствуют описанию' }); ok(r.status === 200 && st(E3) === 'disputed', 'обмен: спор из режима проверки');
r = await P(`/api/garant/admin/deals/${E3}/resolve-verify`, ADM.tok, { outcome: 'cancel', note: 'Данные не соответствуют' }); ok(r.status === 200 && st(E3) === 'cancelled', 'арбитр отменил обмен');
ok(bal(A2) === 0 && bal(B2) === 0, 'после споров по обмену баланс прежний');

// прежние сделки не затронуты
r = await P('/api/garant/deals', A.tok, { buyerId: B.pid, itemType: 'item', itemName: 'Test', title: 'classic', price: 50, payType: 'rubles' });
ok(r.status === 201 && r.data.deal.flow === 'classic' && r.data.deal.status === 'pending_seller', 'прежний поток создаётся как раньше');
console.log(`\n${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
