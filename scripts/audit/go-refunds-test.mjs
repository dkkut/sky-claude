// Sky GO: возвраты по оплаченным заказам и отчёт получателя денег. API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000 (. env.sh; node scripts/audit/go-refunds-test.mjs <каталог с api.log>)
// Оплаченные заказы создаются прямой вставкой в базу (цепочка поездки проверена другими тестами), всё остальное — через API.
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const ADM = (path, o, tok) => call('/api/admin/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const PUT = (b) => ({ method: 'PUT', body: JSON.stringify({ value: b }) });

const A = await mkuser(S, 'rfAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const D = await mkuser(S, 'rfDisp'); q(`update profiles set is_admin=true, admin_role='go_admin' where id='${D.pid}'`);
const C = await mkuser(S, 'rfCust'); const E = await mkuser(S, 'rfExec'); const X = await mkuser(S, 'rfOther');
await ADM('/settings/refund_window_days', PUT(14), A.tok);
await new Promise((r) => setTimeout(r, 16000));   // кэш настроек 15 с
let n = 0;
const mkOrder = ({ kind = 'taxi', price = 300, status = 'paid', pay = 'confirmed', agoDays = 1, internal = false } = {}) => {
  const id = `go-rf-${Date.now()}-${n++}`;
  q(`insert into go_orders (id, kind, customer_id, executor_id, status, price_rub, city, data, completed_at, updated_at) values ('${id}','${kind}','${C.pid}','${E.pid}','${status}',${price},'Москва','${internal ? '{"internal":true}' : '{}'}'::jsonb, now() - interval '${agoDays} days', now() - interval '${agoDays} days')`);
  if (pay) q(`insert into go_order_pay (order_id, payer_id, payee_id, amount_rub, state, confirmed_at) values ('${id}','${C.pid}','${E.pid}',${price},'${pay}', now() - interval '${agoDays} days')`);
  return id;
};

/* Допустимость */
const o1 = mkOrder();
let r = await G(`/orders/${o1}/refund`, {}, C.tok); t('заказчик видит: возврат можно запросить', r.status === 200 && r.data.refund === null && r.data.eligible === true, JSON.stringify(r.data));
r = await G(`/orders/${o1}/refund`, {}, E.tok); t('исполнитель видит заказ без права запроса', r.status === 200 && r.data.refund === null && !r.data.eligible);
r = await G(`/orders/${o1}/refund`, {}, X.tok); t('посторонний возврат не видит', r.status === 404);
r = await G(`/orders/${o1}/refund`, J({ reason: 'ок' }), C.tok); t('короткая причина отклонена', r.status === 400 && r.data.error === 'reason_required');
r = await G(`/orders/${o1}/refund`, J({ reason: 'Не довезли до места', amountRub: 999 }), C.tok); t('сумма больше оплаченной отклонена', r.status === 400 && r.data.error === 'bad_amount', JSON.stringify(r.data));
r = await G(`/orders/${o1}/refund`, J({ reason: 'Не довезли до места' }), E.tok); t('исполнитель запросить возврат не может', r.status === 404);
r = await G(`/orders/${o1}/refund`, J({ reason: 'Не довезли до места' }), X.tok); t('посторонний запросить не может', r.status === 404);
const oUnpaid = mkOrder({ status: 'awaiting_payment', pay: 'awaiting' });
r = await G(`/orders/${oUnpaid}/refund`, J({ reason: 'Не довезли до места' }), C.tok); t('по неоплаченному заказу возврат невозможен', r.status === 409 && r.data.error === 'not_paid', JSON.stringify(r.data));
const oOld = mkOrder({ agoDays: 20 });
r = await G(`/orders/${oOld}/refund`, J({ reason: 'Не довезли до места' }), C.tok); t('срок запроса (14 дней) прошёл', r.status === 409 && r.data.error === 'refund_window_closed', JSON.stringify(r.data));
const oInt = mkOrder({ internal: true });
r = await G(`/orders/${oInt}/refund`, J({ reason: 'Не довезли до места' }), C.tok); t('заказ своего сотрудника (без оплаты) — возврат невозможен', r.status === 409 && r.data.error === 'no_payment', JSON.stringify(r.data));

/* Полный путь: запрос → согласие → «вернул» → подтверждение */
r = await G(`/orders/${o1}/refund`, J({ reason: 'Не довезли до места', amountRub: 120 }), C.tok); t('запрос на частичный возврат создан', r.status === 201 && r.data.ok, JSON.stringify(r.data));
r = await G(`/orders/${o1}/refund`, J({ reason: 'Ещё раз' }), C.tok); t('второй запрос по заказу невозможен', r.status === 409 && r.data.error === 'refund_exists');
r = await G(`/orders/${o1}/refund`, {}, E.tok); t('исполнитель видит запрос: 120 ₽, статус requested', r.data.refund?.status === 'requested' && r.data.refund.amountRub === 120 && r.data.refund.role === 'executor', JSON.stringify(r.data));
t('исполнителю пришло одно уведомление', q(`select count(*) from go_notified where user_id='${E.pid}' and key like '%:requested'`) === '1');
r = await G(`/orders/${o1}/refund/accept`, J({}), C.tok); t('заказчик «принять» за исполнителя не может', r.status >= 400);
r = await G(`/orders/${o1}/refund/accept`, J({}), X.tok); t('посторонний не может отвечать', r.status === 404);
r = await G(`/orders/${o1}/refund/returned`, J({}), E.tok); t('«вернул» до согласия невозможно', r.status === 409 && r.data.error === 'bad_state');
r = await G(`/orders/${o1}/refund/accept`, J({}), E.tok); t('исполнитель согласился', r.status === 200 && r.data.status === 'accepted', JSON.stringify(r.data));
r = await G(`/orders/${o1}/refund/accept`, J({}), E.tok); t('повторное согласие — bad_state, не дубль', r.status === 409);
r = await G(`/orders/${o1}/refund/confirm`, J({}), C.tok); t('подтвердить получение до «вернул» нельзя', r.status === 409);
r = await G(`/orders/${o1}/refund/returned`, J({ note: 'Перевёл по СБП' }), E.tok); t('исполнитель отметил возврат', r.status === 200 && r.data.status === 'returned');
r = await G(`/orders/${o1}/refund/confirm`, J({}), E.tok); t('исполнитель подтвердить получение за заказчика не может', r.status >= 400);
r = await G(`/orders/${o1}/refund/confirm`, J({}), C.tok); t('заказчик подтвердил получение', r.status === 200 && r.data.status === 'refunded');
r = await G(`/orders/${o1}/refund`, {}, C.tok);
t('возврат закрыт, история из 4 шагов, закрыт по времени', r.data.refund.status === 'refunded' && r.data.refund.history.length === 4 && r.data.refund.closedAt, JSON.stringify(r.data.refund));

/* Отказ → обращение к администрации */
const o2 = mkOrder({ price: 500 });
await G(`/orders/${o2}/refund`, J({ reason: 'Грязно в машине, водитель опоздал' }), C.tok);
r = await G(`/orders/${o2}/refund/reject`, J({}), E.tok); t('отказ без причины невозможен', r.status === 400 && r.data.error === 'note_required');
r = await G(`/orders/${o2}/refund/reject`, J({ note: 'Поездка выполнена полностью' }), E.tok); t('исполнитель отказал с причиной', r.status === 200 && r.data.status === 'rejected');
r = await G(`/orders/${o2}/refund/escalate`, J({}), C.tok); t('обращение без пояснения невозможно', r.status === 400 && r.data.error === 'note_required');
r = await G(`/orders/${o2}/refund/escalate`, J({ note: 'Поездка не была выполнена полностью' }), C.tok); t('заказчик передал администрации', r.status === 200 && r.data.status === 'escalated');
r = await ADM('/refunds?status=escalated', {}, D.tok); const rf = r.data.refunds?.find((x) => x.orderId === o2);
t('очередь администрации показывает спор', r.status === 200 && rf?.amountRub === 500 && rf.history.length === 3, JSON.stringify(r.data).slice(0, 200));
r = await ADM('/refunds', {}, C.tok); t('обычный человек очередь не видит', r.status === 403);
r = await ADM(`/refunds/${rf.id}/decide`, J({ outcome: 'upheld' }), D.tok); t('решение без обоснования невозможно', r.status === 400 && r.data.error === 'note_required');
r = await ADM(`/refunds/${rf.id}/decide`, J({ outcome: 'maybe', note: 'не знаю точно' }), D.tok); t('неизвестное решение отклонено', r.status === 400);
r = await ADM(`/refunds/${rf.id}/decide`, J({ outcome: 'upheld', note: 'Подтверждено перепиской и маршрутом' }), D.tok); t('администратор решил в пользу заказчика', r.status === 200, JSON.stringify(r.data));
r = await ADM(`/refunds/${rf.id}/decide`, J({ outcome: 'denied', note: 'Передумал, отказываю' }), D.tok); t('повторное решение невозможно', r.status === 409);
t('оба участника получили по одному уведомлению о решении', q(`select count(*) from go_notified where key like '${rf.id}:upheld:%'`) === '2');
r = await G(`/orders/${o2}/refund`, {}, C.tok); t('заказчик видит решение и примечание администрации', r.data.refund.status === 'upheld' && r.data.refund.adminNote.includes('перепиской'));
r = await G(`/orders/${o2}/refund/returned`, J({}), E.tok); t('после решения исполнитель отмечает возврат', r.status === 200 && r.data.status === 'returned');
r = await G(`/orders/${o2}/refund/confirm`, J({}), C.tok); t('заказчик подтверждает', r.data.status === 'refunded');

/* Отказ администрации, отзыв */
const o3 = mkOrder({ price: 200 });
await G(`/orders/${o3}/refund`, J({ reason: 'Просто так хочу вернуть' }), C.tok);
r = await G(`/orders/${o3}/refund/withdraw`, J({}), C.tok); t('заказчик отозвал запрос', r.status === 200 && r.data.status === 'withdrawn');
r = await G(`/orders/${o3}/refund/accept`, J({}), E.tok); t('на отозванный запрос ответить нельзя', r.status === 409);
const o4 = mkOrder({ price: 250 });
await G(`/orders/${o4}/refund`, J({ reason: 'Не доставили посылку' }), C.tok);
await G(`/orders/${o4}/refund/accept`, J({}), E.tok); await G(`/orders/${o4}/refund/returned`, J({}), E.tok);
r = await G(`/orders/${o4}/refund/escalate`, J({ note: 'Деньги так и не пришли на карту' }), C.tok); t('«деньги не пришли» — обращение к администрации', r.status === 200 && r.data.status === 'escalated');
r = await ADM('/refunds?status=escalated', {}, A.tok); const rf4 = r.data.refunds.find((x) => x.orderId === o4);
r = await ADM(`/refunds/${rf4.id}/decide`, J({ outcome: 'denied', note: 'Исполнитель предъявил перевод' }), A.tok); t('администрация отказала — случай закрыт', r.status === 200);
r = await G(`/orders/${o4}/refund`, {}, C.tok); t('статус denied, закрыт', r.data.refund.status === 'denied' && r.data.refund.closedAt);

/* Отчёт получателя денег */
r = await G('/earnings?days=30', {}, E.tok);
// подтверждённые оплаты исполнителя: o1 300 (вернули 120? возврат подтверждён на 120), o2 500 (возврат 500 подтверждён), o3 200, o4 250 (denied), internal не считается, old (20 дней) входит в 30
t('отчёт: заказы с подтверждённой оплатой, без «своих сотрудников»', r.status === 200 && r.data.orders === 5, JSON.stringify(r.data).slice(0, 300));
t('отчёт: получено 1550 ₽ = 300+500+200+250+300', r.data.grossRub === 1550, JSON.stringify(r.data));
t('отчёт: возвращено 620 ₽ (120 + 500), итого 930 ₽', r.data.refundedRub === 620 && r.data.netRub === 930, JSON.stringify(r.data));
t('отчёт: по дням и по видам, есть пояснение про прямую оплату', r.data.byDay.length >= 1 && r.data.byKind[0].kind === 'taxi' && /не принимает/.test(r.data.note));
r = await G('/earnings?days=7', {}, E.tok); t('за 7 дней — только свежие заказы (без 20-дневного)', r.data.orders === 4, JSON.stringify(r.data).slice(0, 200));
r = await G('/earnings?days=30', {}, C.tok); t('у плательщика отчёта о полученном нет (0)', r.data.orders === 0 && r.data.grossRub === 0);
const csv = await fetch('http://127.0.0.1:8080/api/go/earnings?days=30&format=csv', { headers: { authorization: `Bearer ${E.tok}` } });
const txt = await csv.text(); t('CSV: тип, заголовок и итоговая строка', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && txt.includes('Дата;Заказов') && txt.includes('Итого;5;1550;620;930'), txt.slice(0, 200));
r = await ADM('/settings/refund_window_days', PUT(999), A.tok); t('окно возврата вне 1–90 дней отклонено', r.status === 400);
r = await ADM('/settings/refund_window_days', PUT(30), A.tok); t('окно возврата меняется администратором', r.status === 200);
await ADM('/settings/refund_window_days', PUT(14), A.tok);

console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
