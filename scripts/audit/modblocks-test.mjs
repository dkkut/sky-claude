// Блокировка вкладок отдельным людям и заявка на вывод остатка (server/modblocks.mjs, routes/modblocks.mjs, шлюз в server.mjs).
// API: OWNER_USERNAME=mbowner ADMIN_GATE=off ADMIN_TOKEN=off. Запуск: node scripts/audit/modblocks-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 300) : JSON.stringify(x).slice(0, 300)); } };
const get = (p, u) => call(p, {}, u.tok);
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u.tok);
const del = (p, u) => call(p, { method: 'DELETE' }, u.tok);

q(`update admin_lockdown set active=false`);
q(`update profiles set username='old'||substr(id,1,8) where lower(username)='mbowner'`);
const OWN = await mkuser(S, 'mbOwn'); q(`update profiles set username='mbowner' where id='${OWN.pid}'`);
const ADM = await mkuser(S, 'mbAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${ADM.pid}'`);
const FIN = await mkuser(S, 'mbFin'); q(`update profiles set is_admin=true, admin_role='finance_admin' where id='${FIN.pid}'`);
const U1 = await mkuser(S, 'mbU1'); const U2 = await mkuser(S, 'mbU2');
const uname = (u) => q(`select username from profiles where id='${u.pid}'`);
const un1 = uname(U1);
const setBal = (u, n) => q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', ${n}, 0) on conflict (user_id) do update set balance=${n}`);
const bal = (u) => Number(q(`select balance from wallet_accounts where user_id='${u.pid}'`) || 0);

let r = await post('/api/admin/module-blocks', { username: un1, modules: ['market'], reason: 'тест' }, U2);
t('обычный человек блокировать не может', r.status === 403);
r = await get('/api/admin/module-blocks', U2); t('обычный человек список не видит', r.status === 403);
r = await post('/api/admin/module-blocks', { username: un1, modules: ['market'] }, ADM); t('без причины — 400', r.status === 400 && r.data.error === 'reason_required');
r = await post('/api/admin/module-blocks', { username: un1, modules: ['nonsense'], reason: 'тест' }, ADM); t('неизвестный модуль — 400', r.status === 400);
r = await post('/api/admin/module-blocks', { username: 'nobody_xyz', modules: ['market'], reason: 'тест' }, ADM); t('нет такого человека — 404', r.status === 404);
r = await post('/api/admin/module-blocks', { username: 'mbowner', modules: ['market'], reason: 'тест' }, ADM); t('владельца заблокировать нельзя', r.status === 403 && r.data.error === 'owner_protected');
r = await post('/api/admin/module-blocks', { username: q(`select username from profiles where id='${ADM.pid}'`), modules: ['market'], reason: 'тест' }, ADM); t('себя заблокировать нельзя', r.status === 400 && r.data.error === 'self_block');

r = await post('/api/admin/module-blocks', { username: `@${un1}`, modules: ['market', 'music'], reason: 'нарушение правил', showReason: false }, ADM);
t('блокировка двух вкладок', r.status === 200 && r.data.blocked === 2, r.data);
await new Promise((x) => setTimeout(x, 4300));
r = await get('/api/market/config', U1); t('market закрыт на сервере (403 module_blocked)', r.status === 403 && r.data.error === 'module_blocked' && r.data.module === 'market', r.data);
r = await get('/api/music/home', U1); t('music закрыт на сервере', r.status === 403 && r.data.error === 'module_blocked');
r = await get('/api/market/config', U2); t('другого человека блокировка не касается', r.data?.error !== 'module_blocked');
r = await get('/api/tickets/catalog', U1); t('незаблокированный модуль у него работает', r.data?.error !== 'module_blocked');
r = await get('/api/me/module-blocks', U1); t('человек видит свои блокировки', r.status === 200 && 'market' in r.data.blocks && 'music' in r.data.blocks && !r.data.blocks.market.reason, r.data);
r = await get('/api/me/module-blocks', U2); t('у незаблокированного пусто', r.status === 200 && Object.keys(r.data.blocks).length === 0);

r = await post('/api/admin/module-blocks', { username: un1, modules: ['market'], reason: 'другая причина', showReason: true }, ADM);
r = await get('/api/me/module-blocks', U1); t('причина показывается, когда разрешено', r.data.blocks.market?.reason === 'другая причина' && !r.data.blocks.music.reason, r.data);
r = await get(`/api/admin/module-blocks?q=${un1}`, ADM); t('админ видит блокировки человека', r.status === 200 && r.data.blocks.length === 2, r.data);

/* вывод остатка */
r = await post('/api/withdraw', { details: 'Сбербанк 2202 0000 0000 0000' }, U2); t('не заблокированному вывод не нужен (403)', r.status === 403 && r.data.error === 'not_blocked');
r = await post('/api/withdraw', { details: 'Сбербанк 2202 0000 0000 0000' }, U1); t('нулевой баланс — 409', r.status === 409 && r.data.error === 'no_balance', r.data);
setBal(U1, 500);
r = await post('/api/withdraw', { details: 'x' }, U1); t('реквизиты обязательны', r.status === 400 && r.data.error === 'details_required');
r = await post('/api/withdraw', { details: 'карта и пин-код 1234' }, U1); t('пин/пароли в реквизитах запрещены', r.status === 400 && r.data.error === 'bad_details');
r = await post('/api/withdraw', { details: 'Сбербанк 2202 0000 0000 0000', amountRub: 9999 }, U1); t('сумма больше баланса — 400', r.status === 400 && r.data.error === 'bad_amount');
r = await post('/api/withdraw', { details: 'Сбербанк 2202 0000 0000 0000' }, U1); t('заявка создана на весь остаток', r.status === 201 && r.data.amountRub === 500, r.data);
const wid = r.data.id;
r = await post('/api/withdraw', { details: 'Сбербанк 2202 0000 0000 0000' }, U1); t('вторая открытая — 409', r.status === 409 && r.data.error === 'already_open');
r = await get('/api/me/module-blocks', U1); t('человек видит статус заявки', r.data.request?.status === 'pending' && r.data.balance === 500);
r = await get('/api/admin/withdrawals', U2); t('обычному очередь вывода недоступна', r.status === 403);
r = await get('/api/admin/withdrawals', FIN); t('финансист видит очередь с реквизитами', r.status === 200 && r.data.requests.some((x) => x.id === wid && x.details.includes('Сбербанк') && x.amountRub === 500), r.data);
t('реквизиты в базе зашифрованы', !q(`select details_enc from withdraw_requests where id='${wid}'`).includes('Сбербанк'));
r = await post(`/api/admin/withdrawals/${wid}/reject`, {}, FIN); t('отказ без причины — 400', r.status === 400 && r.data.error === 'reason_required');
r = await post(`/api/admin/withdrawals/${wid}/paid`, {}, U2); t('чужой не может провести выплату', r.status === 403);
const [p1, p2] = await Promise.all([post(`/api/admin/withdrawals/${wid}/paid`, {}, FIN), post(`/api/admin/withdrawals/${wid}/paid`, {}, FIN)]);
t('параллельные подтверждения: одно проходит', [p1, p2].filter((x) => x.status === 200).length === 1 && [p1, p2].filter((x) => x.status === 409).length === 1, [p1.data, p2.data]);
t('баланс списан ровно один раз', bal(U1) === 0, bal(U1));
t('в журнале кошелька тип withdrawal', q(`select count(*) from wallet_transactions where user_id='${U1.pid}' and type='withdrawal' and amount=-500`) === '1');
r = await post(`/api/admin/withdrawals/${wid}/reject`, { reason: 'позже' }, FIN); t('решённую повторно нельзя — 409', r.status === 409 && r.data.error === 'bad_state');

setBal(U1, 300);
r = await post('/api/withdraw', { details: 'Тинькофф +7 900 000 00 00' }, U1); const wid2 = r.data.id; t('новая заявка после выплаты', r.status === 201);
r = await del('/api/withdraw', U1); t('человек отменяет свою заявку', r.status === 200);
r = await post(`/api/admin/withdrawals/${wid2}/paid`, {}, FIN); t('отменённую нельзя провести', r.status === 409);
r = await post('/api/withdraw', { details: 'Тинькофф +7 900 000 00 00' }, U1); const wid3 = r.data.id;
setBal(U1, 100);
r = await post(`/api/admin/withdrawals/${wid3}/paid`, {}, FIN); t('на счёте меньше заявленного — отказ, баланс цел', r.status === 409 && bal(U1) === 100, r.data);
r = await post(`/api/admin/withdrawals/${wid3}/reject`, { reason: 'Данные не подходят' }, FIN); t('отказ с причиной', r.status === 200 && r.data.status === 'rejected');

r = await del(`/api/admin/module-blocks?profileId=${U1.pid}&module=market`, ADM); t('разблокировка одной вкладки', r.status === 200 && r.data.removed === 1);
await new Promise((x) => setTimeout(x, 4300));
r = await get('/api/market/config', U1); t('market снова открыт', r.data?.error !== 'module_blocked');
r = await get('/api/music/home', U1); t('music всё ещё закрыт', r.status === 403 && r.data.error === 'module_blocked');
r = await del(`/api/admin/module-blocks?profileId=${U1.pid}`, ADM); t('снять всё разом', r.status === 200);
await new Promise((x) => setTimeout(x, 4300));
r = await post('/api/withdraw', { details: 'Тинькофф +7 900 000 00 00' }, U1); t('без блокировок заявка не нужна', r.status === 403);
console.log(`\nитого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
