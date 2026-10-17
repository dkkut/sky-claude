// Sky GO этап 11: обращения по заказам (общий тикет Sky + привязка к заказу), настройки уведомлений.
// Запуск: API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000, и `. env.sh` (тест импортирует server/gosupport.mjs).
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { groupOf, pushAllowed } from '../../server/gosupport.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });

t('группы уведомлений', groupOf('taxi', 'o:assigned:x') === 'orders' && groupOf('taxi', 'o:offer:1') === 'offers' && groupOf('delivery', 'o:manual:x') === 'offers' && groupOf('payment') === 'payments' && groupOf('subscription') === 'payments' && groupOf('dispute') === 'critical' && groupOf('support') === 'support');
const A = await mkuser(S, 'spAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const AF = await mkuser(S, 'spDisp'); q(`update profiles set is_admin=true, admin_role='go_admin' where id='${AF.pid}'`);
const C = await mkuser(S, 'spCust'); const D = await mkuser(S, 'spDrv'); const X = await mkuser(S, 'spStr');
const oid = 'go-sup-' + Date.now();
q(`insert into go_orders (id, kind, customer_id, executor_id, status, price_rub, city, data) values ('${oid}','taxi','${C.pid}','${D.pid}','in_ride',200,'Москва','{}'::jsonb)`);

let r = await G('/support', J({ category: 'нет', text: 'проблема с поездкой' }), C.tok); t('неизвестная категория отклонена', r.status === 400 && r.data.error === 'bad_category');
r = await G('/support', J({ category: 'ride', text: 'ой' }), C.tok); t('короткий текст отклонён', r.status === 400 && r.data.error === 'text_required');
r = await G('/support', J({ category: 'ride', orderId: oid, text: 'Водитель поехал не туда' }), X.tok); t('чужой заказ: сообщить нельзя (not_found)', r.status === 404, JSON.stringify(r.data));
r = await G('/support', J({ category: 'ride', orderId: oid, text: 'Водитель поехал не туда' }), C.tok);
const tk = r.data.ticketId;
t('заказчик создал обращение по своему заказу', r.status === 201 && /^tk-/.test(tk), JSON.stringify(r.data));
r = await G('/support', J({ category: 'customer', orderId: oid, text: 'Пассажир ведёт себя странно' }), D.tok); t('исполнитель тоже может сообщить о заказе', r.status === 201);
r = await G('/support', J({ category: 'safety', text: 'Мне угрожали во время поездки' }), C.tok); const safe = r.data.ticketId; t('безопасность — без привязки к заказу тоже можно', r.status === 201);
r = await G('/support', {}, C.tok);
t('«мои обращения»: только свои, с категориями и статусом', r.status === 200 && r.data.tickets.length === 2 && r.data.tickets.every((x) => x.status === 'open' && x.label) && !r.data.tickets.some((x) => x.ticketId === undefined), JSON.stringify(r.data).slice(0, 200));
r = await G('/support/' + tk, {}, C.tok); t('обращение читает автор (текст и заказ внутри)', r.status === 200 && r.data.ticket.id === tk, JSON.stringify(r.data).slice(0, 150));
r = await G('/support/' + tk, {}, X.tok); t('чужое обращение читать нельзя', r.status === 404);
r = await G('/support/' + tk, {}, D.tok); t('даже другая сторона заказа чужое обращение не видит', r.status === 404);
r = await call('/api/admin/go/support', {}, X.tok); t('список для сотрудников закрыт для обычных людей', r.status === 403);
r = await call('/api/admin/go/support', {}, AF.tok);
t('сотрудник (право go) видит обращения; безопасность — первой', r.status === 200 && r.data.tickets[0].category === 'safety' && r.data.tickets.some((x) => x.ticketId === tk && x.orderId === oid && x.orderKind === 'taxi' && x.orderStatus === 'in_ride'), JSON.stringify(r.data).slice(0, 250));
r = await call('/api/admin/go/support?category=ride', {}, AF.tok); t('фильтр по категории', r.data.tickets.every((x) => x.category === 'ride') && r.data.tickets.length >= 1);
t('привязка к заказу сохранена в базе', q(`select order_id from go_support_links where ticket_id='${tk}'`) === oid);
t('в общей очереди поддержки это обычный тикет', q(`select count(*) from support_tickets where id='${tk}'`) === '1');

/* уведомления */
r = await G('/notify-prefs', {}, C.tok); t('по умолчанию все пуши включены', r.status === 200 && Object.values(r.data.push).every((v) => v === true) && Object.keys(r.data.push).length === 4, JSON.stringify(r.data.push));
r = await G('/notify-prefs', { method: 'PUT', body: JSON.stringify({ push: { orders: false, offers: 'нет', bogus: false } }) }, C.tok);
t('отключена только группа «статусы заказов»; мусор игнорируется', r.data.push.orders === false && r.data.push.offers === true && r.data.push.payments === true && !('bogus' in r.data.push), JSON.stringify(r.data.push));
t('пуш статусов заказа этому человеку не уходит', (await pushAllowed(C.pid, 'taxi', 'o:assigned:x')) === false);
t('пуш оплаты уходит', (await pushAllowed(C.pid, 'payment', null)) === true);
t('споры отключить нельзя', (await pushAllowed(C.pid, 'dispute', null)) === true);
t('настройки другого человека не затронуты', (await pushAllowed(D.pid, 'taxi', 'o:assigned:x')) === true);
r = await G('/notify-prefs', { method: 'PUT', body: JSON.stringify({ push: { orders: true } }) }, C.tok); t('включается обратно', r.data.push.orders === true);
q(`delete from go_orders where id='${oid}'`);
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
