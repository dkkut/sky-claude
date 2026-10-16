// SkyKassa: платежи, проверка, зачисление, коды, возвраты, партнёры, безопасность.
//   Сервер нужно запустить с: SKYKASSA_PARTNER_FAKE_SECRET=0123456789abcdef0123 SKYKASSA_PARTNER_FAKE_MERCHANT=m-1 BLOX_ALLOW_PRIVATE=1
//   (. env.sh; node scripts/audit/skykassa-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = process.env.SKYKASSA_PARTNER_FAKE_SECRET || '0123456789abcdef0123';
const j = (o) => JSON.stringify(o ?? {});
const post = (p, b, tok) => call(p, { method: 'POST', body: j(b) }, tok);
const put = (p, b, tok) => call(p, { method: 'PUT', body: j(b) }, tok);
const del = (p, b, tok) => call(p, { method: 'DELETE', body: j(b) }, tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
// код подтверждения личности (почта) для админа
const stepUp = async (u, path = '/api/admin/skykassa/settings-step-up') => {
  const r = await post(path, {}, u.tok);
  if (r.status !== 200) return null;
  await sleep(1200);
  return codeOf(u.email);
};

// ── Поддельный партнёр (протокол hmac-v1) ──
const pay = new Map(); let seq = 0; const seenSig = { bad: 0 };
const sign = (ts, body) => crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
const srv = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const good = req.headers['x-signature'] === sign(req.headers['x-timestamp'], raw);
    if (!good) { seenSig.bad += 1; res.writeHead(401); return res.end('{}'); }
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/ping') return send({ ok: true });
    if (req.method === 'POST' && req.url === '/payments') {
      const b = JSON.parse(raw); const id = `P${++seq}`;
      pay.set(id, { status: 'pending', amount: b.amount, currency: b.currency, order: b.order_id });
      return send({ payment_id: id, pay_url: `http://127.0.0.1:9944/pay/${id}` });
    }
    const m = /^\/payments\/(P\d+)$/.exec(req.url);
    if (m && pay.has(m[1])) return send(pay.get(m[1]));
    res.writeHead(404); res.end('{}');
  });
});
await new Promise((r) => srv.listen(9944, '127.0.0.1', r));
const hook = (partner, ev, { secret = SECRET, ts = Math.floor(Date.now() / 1000), sig } = {}) => {
  const body = j(ev);
  return call(`/api/skykassa/webhook/${partner}`, { method: 'POST', body, headers: { 'x-timestamp': String(ts), 'x-signature': sig ?? crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex') } });
};

// ── Люди ──
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'kkown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const staff = await mkuser(S, 'kkstaff'); q(`update profiles set is_admin=true, admin_role='skykassa_staff' where id='${staff.pid}'`);
const staff2 = await mkuser(S, 'kkstaff2'); q(`update profiles set is_admin=true, admin_role='skykassa_staff' where id='${staff2.pid}'`);
const cfg = await mkuser(S, 'kkcfg'); q(`update profiles set is_admin=true, admin_role='skykassa_admin' where id='${cfg.pid}'`);
const u1 = await mkuser(S, 'kku1'); const u2 = await mkuser(S, 'kku2');
q(`delete from skykassa_settings`); q(`delete from skykassa_webhooks`); q(`delete from skykassa_payments where kind='partner'`); q(`delete from skykassa_partners`); q(`delete from skykassa_requisites`); q(`delete from skykassa_methods where id not in ('skm-account','skm-transfer')`);
q(`update skykassa_methods set enabled=false`);
const bal = async (u) => (await call('/api/wallet', {}, u.tok)).data.balance ?? (await call('/api/wallet', {}, u.tok)).data.account?.balance;
const A = '/api/admin/skykassa';

// ── 1. Права и пустая касса ──
let r = await call('/api/skykassa/config', {}, u1.tok);
t('настройки платформы видны человеку', r.status === 200 && r.data.paused === false && r.data.minAmount >= 1);
r = await call('/api/skykassa/options?amount=500&destination=balance', {}, u1.tok);
t('без реквизитов способы не показываются', r.status === 200 && r.data.direct.length === 0);
t('человеку админка SkyKassa закрыта', (await call(`${A}/payments`, {}, u1.tok)).status === 403 && (await call(`${A}/overview`, {}, u1.tok)).status === 403);
t('сотрудник проверки не видит настройки', (await call(`${A}/overview`, {}, staff.tok)).status === 403);
t('без входа — 401', (await call('/api/skykassa/config')).status === 401);

// ── 2. Реквизиты: подтверждение личности, проверка, история ──
const reqBody = { methodId: 'skm-account', recipient: 'ООО Тест Получатель', bank: 'Тест-банк', idKind: 'account', identifier: '40702810900000000001', purpose: 'Пополнение Sky, заявка {number}', primary: true, enabled: true };
r = await post(`${A}/requisites`, reqBody, cfg.tok);
t('реквизит без кода подтверждения — отказ', r.data.error === 'step_up_required', JSON.stringify(r.data));
let code = await stepUp(cfg);
t('код подтверждения выдан', Boolean(code));
r = await post(`${A}/requisites`, { ...reqBody, identifier: '1234', stepUpCode: code }, cfg.tok);
t('неверный номер счёта отклоняется', r.data.error === 'bad_account');
code = await stepUp(cfg);
r = await post(`${A}/requisites`, { ...reqBody, stepUpCode: code }, cfg.tok);
t('реквизит создан после подтверждения', r.status === 200 && r.data.id, JSON.stringify(r.data));
const req1 = r.data.id;
t('код подтверждения одноразовый', (await post(`${A}/requisites`, { ...reqBody, stepUpCode: code }, cfg.tok)).data.error === 'step_up_required');
code = await stepUp(cfg);
r = await put(`${A}/methods/skm-account`, { enabled: true, min: 100, max: 50000, stepUpCode: code }, cfg.tok);
t('способ «Расчётный счёт» включён', r.status === 200, JSON.stringify(r.data));
t('номер счёта в базе зашифрован', !q(`select identifier_sealed from skykassa_requisites where id='${req1}'`).includes('40702810900000000001'));
r = await call(`${A}/overview`, {}, cfg.tok);
t('настройщик видит способы и реквизиты', r.status === 200 && r.data.requisites.some((x) => x.id === req1 && x.identifier === '40702810900000000001'));
code = await stepUp(cfg);
r = await post(`${A}/methods`, { title: 'СБП', kind: 'transfer', min: 100, max: 30000, enabled: true, senderFields: [{ key: 'bank', label: 'Банк отправителя', type: 'text', required: true }], stepUpCode: code }, cfg.tok);
t('новый способ создан из админки', r.status === 200 && r.data.id);
const m2 = r.data.id;
code = await stepUp(cfg);
r = await post(`${A}/methods`, { title: 'Карта', senderFields: [{ key: 'pin', label: 'PIN-код', type: 'text' }], stepUpCode: code }, cfg.tok);
t('поле «PIN» в данных отправителя запрещено', r.data.error === 'bad_field' && r.data.field === 'senderFields');
code = await stepUp(cfg);
r = await post(`${A}/requisites`, { methodId: m2, recipient: 'Иван Получатель', idKind: 'phone', identifier: '8 (900) 123-45-67', enabled: true, primary: true, stepUpCode: code }, cfg.tok);
t('реквизит-телефон нормализован', r.status === 200, JSON.stringify(r.data));
const req2 = r.data.id;

// ── 3. Параметры платёжной сессии ──
r = await call('/api/skykassa/options?amount=500&destination=balance&app=web', {}, u1.tok);
t('способы показываются при наличии реквизитов', r.data.direct.length === 2, JSON.stringify(r.data.direct));
r = await call('/api/skykassa/options?amount=60000&destination=balance', {}, u1.tok);
t('способ вне границ суммы скрыт', !r.data.direct.some((m) => m.id === 'skm-account'));
for (const a of [0, -5, 1.5, 'abc', 99, 1e9, null]) {
  const x = await post('/api/skykassa/payments', { amount: a, destination: 'balance' }, u1.tok);
  if (x.status === 200) t(`сумма ${a} принята?!`, false);
}
t('неверные суммы отклоняются', (await post('/api/skykassa/payments', { amount: 1.5 }, u1.tok)).data.error === 'bad_amount' && (await post('/api/skykassa/payments', { amount: -5 }, u1.tok)).status === 400);
t('неверное назначение отклоняется', (await post('/api/skykassa/payments', { amount: 500, destination: 'wallet2' }, u1.tok)).data.error === 'bad_destination');

// ── 4. Прямая оплата: от создания до отправки ──
const idem = `idem${Date.now()}abcd`;
r = await post('/api/skykassa/payments', { amount: 500, destination: 'balance', app: 'android', idemKey: idem, userId: 'someone-else', currency: 'USD' }, u1.tok);
t('платёж создан сервером', r.status === 200 && r.data.payment.status === 'created' && r.data.payment.amount === 500 && r.data.payment.currency === 'RUB' && r.data.payment.app === 'android', JSON.stringify(r.data).slice(0, 200));
const P1 = r.data.payment.id; const NUM1 = r.data.payment.number;
t('номер заявки в формате SK-XXXXXXXX', /^SK-[2-9A-HJ-NP-Z]{8}$/.test(NUM1));
t('владелец — из токена, не из тела', q(`select user_id from skykassa_payments where id='${P1}'`) === u1.pid);
r = await post('/api/skykassa/payments', { amount: 500, destination: 'balance', idemKey: idem }, u1.tok);
t('повтор с тем же ключом возвращает тот же платёж', r.data.payment.id === P1 && r.data.duplicate === true);
t('чужой платёж не виден', (await call(`/api/skykassa/payments/${P1}`, {}, u2.tok)).status === 404);
t('чужой платёж нельзя выбрать/отправить/отменить', (await post(`/api/skykassa/payments/${P1}/choose`, { mode: 'direct', methodId: 'skm-account' }, u2.tok)).status === 404
  && (await post(`/api/skykassa/payments/${P1}/report`, { amount: 500 }, u2.tok)).status === 404 && (await post(`/api/skykassa/payments/${P1}/cancel`, {}, u2.tok)).status === 404);
t('нельзя «перевести» до выбора способа', (await post(`/api/skykassa/payments/${P1}/report`, { amount: 500 }, u1.tok)).data.error === 'bad_state');
r = await post(`/api/skykassa/payments/${P1}/choose`, { mode: 'direct', methodId: 'skm-account' }, u1.tok);
const pv = r.data.payment;
t('выбран способ: показаны реквизиты и точная сумма', r.status === 200 && pv.status === 'awaiting_payment' && pv.requisites.identifier === '40702810900000000001'
  && pv.requisites.amount === 500 && pv.requisites.purpose.includes(NUM1) && pv.requisites.recipient === 'ООО Тест Получатель', JSON.stringify(pv.requisites));
t('нельзя выбрать несуществующий способ', (await post(`/api/skykassa/payments/${P1}/choose`, { mode: 'direct', methodId: 'nope' }, u1.tok)).data.error === 'method_unavailable');

// Реквизит меняется — платёж хранит то, что было показано
code = await stepUp(cfg);
await put(`${A}/requisites/${req1}`, { identifier: '40702810900000000002', recipient: 'ООО Новое Имя', stepUpCode: code }, cfg.tok);
r = await call(`/api/skykassa/payments/${P1}`, {}, u1.tok);
t('реквизиты в платеже заморожены', r.data.payment.requisites.identifier === '40702810900000000001' && r.data.payment.requisites.recipient === 'ООО Тест Получатель');
r = await call(`${A}/requisites/${req1}/history`, {}, cfg.tok);
t('история реквизита ведётся, без полных номеров', r.data.items.length === 2 && !JSON.stringify(r.data).includes('40702810900000000002'), JSON.stringify(r.data).slice(0, 200));

// ── 5. Данные отправителя ──
const sp = `/api/skykassa/payments/${P1}/sender`;
t('без данных отправителя «Перевод совершён» недоступен', (await post(`/api/skykassa/payments/${P1}/report`, { amount: 500 }, u1.tok)).data.error === 'sender_required');
for (const [name, b, err] of [
  ['одно слово вместо ФИО', { fio: 'Иван', idKind: 'card', idNumber: '4111111111111111' }, 'bad_fio'],
  ['цифры в ФИО', { fio: 'Иван 123', idKind: 'card', idNumber: '4111111111111111' }, 'bad_fio'],
  ['карта не проходит проверку', { fio: 'Иван Иванов', idKind: 'card', idNumber: '4111111111111112' }, 'bad_card'],
  ['в карту вписан CVV', { fio: 'Иван Иванов', idKind: 'card', idNumber: '4111 1111 1111 1111 cvv 123' }, 'bad_card'],
  ['телефон с буквами', { fio: 'Иван Иванов', idKind: 'phone', idNumber: 'abc' }, 'bad_phone'],
  ['счёт неверной длины', { fio: 'Иван Иванов', idKind: 'account', idNumber: '123' }, 'bad_account'],
  ['неизвестный тип', { fio: 'Иван Иванов', idKind: 'pin', idNumber: '1234' }, 'bad_kind'],
]) { const x = await post(sp, b, u1.tok); t(`отправитель: ${name}`, x.data.error === err, JSON.stringify(x.data)); }
r = await post(sp, { fio: '  Иван   Иванов ', idKind: 'card', idNumber: '4111-1111-1111-1111' }, u1.tok);
t('данные отправителя сохранены и замаскированы', r.status === 200 && r.data.payment.sender.fio === 'Иван Иванов' && r.data.payment.sender.idMasked === '•••• 1111'
  && !JSON.stringify(r.data).includes('4111111111111111'));
t('номер отправителя в базе зашифрован', !q(`select data_sealed from skykassa_sender where payment_id='${P1}'`).includes('4111111111111111'));
t('без подтверждения данных отправить нельзя', (await post(`/api/skykassa/payments/${P1}/report`, { amount: 500 }, u1.tok)).data.error === 'sender_not_confirmed');
r = await post(sp, { fio: 'Иван Иванов', idKind: 'card', idNumber: '4111111111111111', confirmed: true }, u1.tok);
t('данные подтверждены', r.status === 200 && r.data.payment.sender.confirmed === true);
t('сумма в «Перевод совершён» сверяется', (await post(`/api/skykassa/payments/${P1}/report`, { amount: 499 }, u1.tok)).data.error === 'amount_mismatch');
const rep = await Promise.all([post(`/api/skykassa/payments/${P1}/report`, { amount: 500 }, u1.tok), post(`/api/skykassa/payments/${P1}/report`, { amount: 500 }, u1.tok), post(`/api/skykassa/payments/${P1}/report`, { amount: 500 }, u1.tok)]);
t('двойной клик: один переход, остальные — повтор', rep.every((x) => x.status === 200) && rep.filter((x) => x.data.duplicate).length === 2 && rep.every((x) => x.data.payment.status === 'awaiting_review'), JSON.stringify(rep.map((x) => x.data.payment?.status ?? x.data)));
t('в журнале ровно один переход в «Ожидает проверки»', q(`select count(*) from skykassa_status_log where payment_id='${P1}' and to_status='awaiting_review'`) === '1');
t('после отправки правка только через запись об изменении', (await post(sp, { fio: 'Пётр Петров', idKind: 'card', idNumber: '4111111111111111' }, u1.tok)).data.error === 'use_change');
r = await post(`/api/skykassa/payments/${P1}/sender-change`, { fio: 'Иван Иванович Иванов', idKind: 'card', idNumber: '5555555555554444' }, u1.tok);
t('изменение без причины отклоняется', r.data.error === 'reason_required');
r = await post(`/api/skykassa/payments/${P1}/sender-change`, { reason: 'Перевожу с другой карты', fio: 'Иван Иванович Иванов', idKind: 'card', idNumber: '5555555555554444' }, u1.tok);
t('изменение записано отдельной записью', r.status === 200 && q(`select count(*) from skykassa_sender_changes where payment_id='${P1}'`) === '1');

// ── 6. Сотрудники ──
t('очередь видна сотруднику', (await call(`${A}/payments?status=awaiting_review`, {}, staff.tok)).data.items.some((x) => x.id === P1));
t('человеку очередь закрыта', (await call(`${A}/payments`, {}, u2.tok)).status === 403);
const act = (u, id, action, b = {}) => post(`${A}/payments/${id}/act`, { action, ...b }, u.tok);
t('сотрудник не подтверждает деньги', (await act(staff, P1, 'owner_confirm')).data.error === 'owner_only');
t('нельзя передать владельцу, не взяв в работу', (await act(staff, P1, 'forward', { note: 'ок' })).data.error === 'bad_state');
t('взять в работу', (await act(staff, P1, 'take')).status === 200);
t('платёж в работе у сотрудника человек отменить не может', (await post(`/api/skykassa/payments/${P1}/cancel`, {}, u1.tok)).data.error === 'cannot_cancel');
t('чужую работу второй сотрудник не передаёт', (await act(staff2, P1, 'forward', { note: 'ок' })).data.error === 'bad_state');
r = await call(`${A}/payments/${P1}`, {}, staff.tok);
t('сотрудник видит данные отправителя целиком, с историей изменений', r.data.payment.sender.idNumber === '5555555555554444' && r.data.payment.sender.submitted.idNumber === '4111111111111111' && r.data.payment.sender.changes.length === 1);
t('просмотр данных отправителя записан в журнал', Number(q(`select count(*) from admin_log where type='skykassa_view_sender'`)) >= 1);
t('реквизиты получателя у сотрудника замаскированы', !JSON.stringify(r.data.payment.requisites).includes('40702810900000000001'));
t('человек не видит чужих служебных данных', !JSON.stringify((await call(`/api/skykassa/payments/${P1}`, {}, u1.tok)).data).match(/reviewer|review_note|reviewerId/));
t('нельзя отклонить без причины', (await act(staff, P1, 'reject', {})).data.error === 'reason_required');
r = await act(staff, P1, 'request_info', { message: 'Пришлите, пожалуйста, время перевода' });
t('запрос сведений: статус «Требуются дополнительные сведения»', r.data.status === 'need_info');
t('пока ждём ответ, платёж не отправить владельцу', (await act(staff, P1, 'forward', { note: 'x' })).data.error === 'bad_state');
r = await post(`/api/skykassa/payments/${P1}/reply`, { body: 'Перевёл в 12:05 по Москве' }, u1.tok);
t('человек ответил — снова «На проверке»', r.data.payment.status === 'in_review' && r.data.payment.messages.length === 2);
t('передать владельцу', (await act(staff, P1, 'forward', { note: 'Сумма и отправитель совпали' })).data.status === 'awaiting_owner');

// ── 7. Владелец ──
t('без кода владельцу тоже нельзя', (await act(own, P1, 'owner_confirm')).data.error === 'step_up_required');
code = await stepUp(own, `${A}/step-up`);
t('чужой код не принимается', (await act(own, P1, 'owner_confirm', { stepUpCode: '000000' })).data.error === 'step_up_invalid');
t('сотрудник не получает код владельца', (await post(`${A}/step-up`, {}, staff.tok)).data.error === 'owner_only');
const b0 = await bal(u1);
r = await act(own, P1, 'owner_confirm', { stepUpCode: code, note: 'Проверено' });
t('владелец подтвердил → «Успешно завершён»', r.status === 200 && r.data.status === 'completed', JSON.stringify(r.data));
t('баланс вырос ровно на сумму', (await bal(u1)) === b0 + 500, `${b0} → ${await bal(u1)}`);
t('операция в журнале кошелька', q(`select count(*) from wallet_transactions where user_id='${u1.pid}' and type='skykassa_topup' and amount=500 and ref='skykassa:${P1}'`) === '1');
t('повторное подтверждение не зачисляет', (await act(own, P1, 'owner_confirm', { stepUpCode: code })).status !== 200 && (await bal(u1)) === b0 + 500);
try { q(`insert into skykassa_credits (payment_id,user_id,amount,destination,wallet_ref) values ('${P1}','${u1.pid}',500,'balance','x')`); t('второе зачисление по платежу невозможно в базе', false); } catch { t('второе зачисление по платежу невозможно в базе', true); }
r = await call(`/api/skykassa/payments/${P1}`, {}, u1.tok);
t('карточка платежа: дата, баланс после, статус', r.data.payment.status === 'completed' && r.data.payment.balanceAfter === b0 + 500 && r.data.payment.creditedAt);
t('реквизиты после завершения скрыты', r.data.payment.requisites.identifier.startsWith('•'));
const chain = q(`select string_agg(to_status, '>' order by seq) from skykassa_status_log where payment_id='${P1}'`);
t('журнал статусов: полная цепочка', chain.includes('created>awaiting_payment>user_reported>awaiting_review>in_review>need_info>in_review>awaiting_owner>confirmed>crediting>completed'), chain);
t('человек получил ровно одно уведомление о зачислении', q(`select count(*) from gift_notifications where user_id='${u1.pid}' and kind='skykassa' and ref_id='${P1}:completed'`) === '1');
const notes = q(`select string_agg(title||' '||body, ' | ') from gift_notifications where kind='skykassa'`);
t('в уведомлениях нет полных номеров карт и счетов', !/4111111111111111|5555555555554444|40702810900000000001/.test(notes));
t('владелец и сотрудники получали уведомления по заявке', Number(q(`select count(*) from gift_notifications where user_id in ('${staff.pid}','${own.pid}') and kind='skykassa'`)) >= 1);

// ── 8. Отклонение, отмена, срок ──
const mk = async (u, amount = 300, dest = 'balance', method = 'skm-account') => {
  const c = await post('/api/skykassa/payments', { amount, destination: dest }, u.tok);
  const id = c.data.payment.id;
  await post(`/api/skykassa/payments/${id}/choose`, { mode: 'direct', methodId: method }, u.tok);
  return id;
};
const sendIt = async (u, id, extra = {}) => {
  await post(`/api/skykassa/payments/${id}/sender`, { fio: 'Мария Петрова', idKind: 'phone', idNumber: '+7 900 000-11-22', confirmed: true, ...extra }, u.tok);
  return post(`/api/skykassa/payments/${id}/report`, { amount: Number(q(`select amount from skykassa_payments where id='${id}'`)) }, u.tok);
};
let P2 = await mk(u2);
t('отмена до перевода', (await post(`/api/skykassa/payments/${P2}/cancel`, { reason: 'передумал' }, u2.tok)).data.payment.status === 'cancelled_user');
t('отменённый платёж нельзя отправить', (await sendIt(u2, P2)).data.error === 'bad_state');
t('повторная отмена безопасна', (await post(`/api/skykassa/payments/${P2}/cancel`, {}, u2.tok)).status === 200);
t('завершённый платёж отменить нельзя', (await post(`/api/skykassa/payments/${P1}/cancel`, {}, u1.tok)).data.error === 'cannot_cancel');
P2 = await mk(u2);
await sendIt(u2, P2);
t('сотрудник не проверяет свой платёж', (await (async () => { q(`update profiles set is_admin=true, admin_role='skykassa_staff' where id='${u2.pid}'`); const x = await act(u2, P2, 'take'); q(`update profiles set is_admin=false, admin_role=null where id='${u2.pid}'`); return x; })()).data.error === 'self_review');
await act(staff, P2, 'take');
r = await act(staff, P2, 'reject', { reason: 'Поступление не найдено' });
t('отклонение с причиной', r.data.status === 'rejected');
r = await call(`/api/skykassa/payments/${P2}`, {}, u2.tok);
t('человек видит причину отказа и кнопку поддержки', r.data.payment.rejectReason === 'Поступление не найдено');
r = await post(`/api/skykassa/payments/${P2}/support`, {}, u2.tok);
t('обращение в поддержку по платежу создано и привязано', r.status === 200 && r.data.ticketId && q(`select ticket_id from skykassa_payments where id='${P2}'`) === r.data.ticketId);
t('повторное обращение возвращает то же', (await post(`/api/skykassa/payments/${P2}/support`, {}, u2.tok)).data.existing === true);
t('отклонённый платёж нельзя подтвердить', (await act(own, P2, 'owner_confirm', { stepUpCode: '123456' })).data.error === 'bad_state');

P2 = await mk(u2, 400);
q(`update skykassa_payments set expires_at = now() - interval '1 minute' where id='${P2}'`);
r = await call(`/api/skykassa/payments/${P2}`, {}, u2.tok);
t('просроченный платёж → «Истёк срок действия»', r.data.payment.status === 'expired');
t('просроченный платёж не отправить', (await sendIt(u2, P2)).data.error === 'bad_state');
P2 = await mk(u2, 400);
q(`update skykassa_payments set expires_at = now() - interval '1 minute' where id='${P2}'`);
t('отправка просроченного отклоняется', (await post(`/api/skykassa/payments/${P2}/report`, { amount: 400 }, u2.tok)).data.error === 'expired' && q(`select status from skykassa_payments where id='${P2}'`) === 'expired');
t('лимит открытых платежей', await (async () => { let last; for (let i = 0; i < 7; i++) last = await post('/api/skykassa/payments', { amount: 300 }, u2.tok); return last.data.error === 'too_many_open'; })());
q(`update skykassa_payments set status='cancelled_user' where user_id='${u2.pid}' and status in ('created','awaiting_payment')`);

// ── 9. Код пополнения ──
let PC = await mk(u1, 700, 'balance'); void PC;
r = await post('/api/skykassa/payments', { amount: 700, destination: 'code' }, u1.tok);
const PCODE = r.data.payment.id;
await post(`/api/skykassa/payments/${PCODE}/choose`, { mode: 'direct', methodId: 'skm-account' }, u1.tok);
await sendIt(u1, PCODE); await act(staff, PCODE, 'take'); await act(staff, PCODE, 'forward', { note: 'ок' });
const b1 = await bal(u1);
code = await stepUp(own, `${A}/step-up`);
r = await act(own, PCODE, 'owner_confirm', { stepUpCode: code });
t('оплата «в код»: платёж завершён', r.data.status === 'completed');
t('при выпуске кода баланс не меняется', (await bal(u1)) === b1);
r = await call(`/api/skykassa/payments/${PCODE}`, {}, u1.tok);
const kc = r.data.payment.code;
t('код выпущен и виден владельцу платежа', kc && /^SKY-/.test(kc.value) && kc.used === false && kc.expiresAt, JSON.stringify(kc));
t('код не показывается сотруднику', !JSON.stringify((await call(`${A}/payments/${PCODE}`, {}, staff.tok)).data).includes(kc.value));
t('код в базе только хешем', !q(`select string_agg(code_hash,',') from sky_codes where id='${q(`select code_id from skykassa_payments where id='${PCODE}'`)}'`).includes(kc.value.replace(/-/g, '')));
r = await post('/api/codes/redeem', { code: kc.value }, u2.tok);
t('код активируется на сумму платежа', r.status === 200, JSON.stringify(r.data).slice(0, 160));
t('повторная активация невозможна', (await post('/api/codes/redeem', { code: kc.value }, u1.tok)).status !== 200);
t('после активации код скрыт, помечен использованным', (await call(`/api/skykassa/payments/${PCODE}`, {}, u1.tok)).data.payment.code.used === true);

// ── 10. Возвраты ──
r = await post(`/api/skykassa/payments/${P1}/refund`, { reason: 'ой' }, u1.tok);
t('возврат без причины отклоняется', r.data.error === 'reason_required');
r = await post(`/api/skykassa/payments/${P1}/refund`, { reason: 'Перевёл по ошибке', amount: 200 }, u1.tok);
t('запрос частичного возврата', r.status === 200 && r.data.refundId);
const RF1 = r.data.refundId;
t('статус «Возврат запрошен»', (await call(`/api/skykassa/payments/${P1}`, {}, u1.tok)).data.payment.status === 'refund_requested');
t('второй возврат пока открыт — нельзя', (await post(`/api/skykassa/payments/${P1}/refund`, { reason: 'ещё раз пожалуйста' }, u1.tok)).data.error === 'bad_state');
t('сотрудник не проводит возврат', (await post(`${A}/payments/${P1}/refunds/${RF1}/process`, {}, staff.tok)).data.error === 'owner_only');
t('возврат требует подтверждения владельца', (await post(`${A}/payments/${P1}/refunds/${RF1}/process`, {}, own.tok)).data.error === 'step_up_required');
code = await stepUp(own, `${A}/step-up`);
const b2 = await bal(u1);
r = await post(`${A}/payments/${P1}/refunds/${RF1}/process`, { stepUpCode: code }, own.tok);
t('возврат принят в обработку, баланс уменьшен ровно на сумму', r.data.status === 'refund_processing' && (await bal(u1)) === b2 - 200, JSON.stringify(r.data));
code = await stepUp(own, `${A}/step-up`);
r = await post(`${A}/payments/${P1}/refunds/${RF1}/finish`, { stepUpCode: code }, own.tok);
t('частичный возврат → «Возвращён частично»', r.data.status === 'refunded_partial');
t('повторное «выполнено» не списывает', (await post(`${A}/payments/${P1}/refunds/${RF1}/finish`, { stepUpCode: code }, own.tok)).status !== 200 && (await bal(u1)) === b2 - 200);
t('нельзя вернуть больше остатка', (await post(`/api/skykassa/payments/${P1}/refund`, { reason: 'Верните остаток все', amount: 301 }, u1.tok)).data.error === 'bad_amount');
r = await post(`/api/skykassa/payments/${P1}/refund`, { reason: 'Верните остаток все' }, u1.tok);
const RF2 = r.data.refundId;
code = await stepUp(own, `${A}/step-up`);
await post(`${A}/payments/${P1}/refunds/${RF2}/process`, { stepUpCode: code }, own.tok);
code = await stepUp(own, `${A}/step-up`);
r = await post(`${A}/payments/${P1}/refunds/${RF2}/finish`, { stepUpCode: code }, own.tok);
t('остаток возвращён → «Возвращён полностью»', r.data.status === 'refunded_full');
t('вернули ровно сумму платежа', Number(q(`select sum(amount) from skykassa_refunds where payment_id='${P1}' and status='done'`)) === 500);
t('полностью возвращённый платёж нельзя вернуть снова', (await post(`/api/skykassa/payments/${P1}/refund`, { reason: 'Ещё разочек' }, u1.tok)).data.error === 'bad_state');
// возврат при нехватке денег
r = await post(`/api/skykassa/payments/${PCODE}/refund`, { reason: 'Передумал, возврат' }, u1.tok);
t('возврат платежа с уже использованным кодом невозможен', r.data.error === 'code_already_used');
const PX = await mk(u2, 300); await sendIt(u2, PX); await act(staff, PX, 'take'); await act(staff, PX, 'forward', { note: 'ok' });
code = await stepUp(own, `${A}/step-up`); await act(own, PX, 'owner_confirm', { stepUpCode: code });
q(`update wallet_accounts set balance = 0 where user_id='${u2.pid}'`);
r = await post(`/api/skykassa/payments/${PX}/refund`, { reason: 'Потратил, но верните' }, u2.tok);
code = await stepUp(own, `${A}/step-up`);
r = await post(`${A}/payments/${PX}/refunds/${r.data.refundId}/process`, { stepUpCode: code }, own.tok);
t('нет средств для возврата — отказ, баланс не уходит в минус', r.data.error === 'refund_insufficient_funds' && (await bal(u2)) === 0);
const rfx = q(`select id from skykassa_refunds where payment_id='${PX}'`);
r = await post(`${A}/payments/${PX}/refunds/${rfx}/decline`, { reason: 'Средства уже потрачены' }, own.tok);
t('владелец отклонил возврат → платёж снова «Успешно завершён»', r.data.status === 'completed');

// ── 11. Партнёры ──
const ghost = { id: 'ghost', title: 'Не подключённый', baseUrl: 'http://127.0.0.1:9944', enabled: true, min: 100, max: 10000, feePercent: 2 };
code = await stepUp(cfg); r = await post(`${A}/partners`, { ...ghost, stepUpCode: code }, cfg.tok);
t('партнёр заведён из админки', r.status === 200, JSON.stringify(r.data));
r = await call('/api/skykassa/options?amount=1000&destination=balance', {}, u1.tok);
const gp = r.data.partners.find((p) => p.id === 'ghost');
t('неподключённый партнёр показан как «не подключён», недоступен', gp && gp.available === false && gp.status === 'not_connected', JSON.stringify(gp));
let PG = (await post('/api/skykassa/payments', { amount: 1000 }, u1.tok)).data.payment.id;
t('выбрать неподключённого партнёра нельзя', (await post(`/api/skykassa/payments/${PG}/choose`, { mode: 'partner', partnerId: 'ghost' }, u1.tok)).data.error === 'partner_not_connected');
code = await stepUp(cfg); r = await post(`${A}/partners`, { id: 'fake', title: 'Тестовый партнёр', baseUrl: 'http://127.0.0.1:9944', enabled: true, min: 100, max: 10000, feePercent: 3, feeFixed: 10, methods: ['Карта', 'СБП'], stepUpCode: code }, cfg.tok);
r = await call(`${A}/overview`, {}, cfg.tok);
const fp = r.data.partners.find((p) => p.id === 'fake');
t('статус подключения реальный: секреты на сервере заданы', fp.connected === true && fp.secretsMissing.length === 0 && !JSON.stringify(r.data).includes(SECRET), JSON.stringify(fp));
r = await post(`${A}/partners/fake/check`, {}, cfg.tok);
t('проверка связи с партнёром проходит (подписанный запрос)', r.data.ok === true && seenSig.bad === 0, JSON.stringify(r.data));
r = await post(`${A}/partners/ghost/check`, {}, cfg.tok);
t('проверка неподключённого честно сообщает об отсутствии связи', r.data.ok === false);
r = await call('/api/skykassa/options?amount=1000&destination=balance', {}, u1.tok);
const fo = r.data.partners.find((p) => p.id === 'fake');
t('итоговая сумма с комиссией известна до перехода', fo.available && fo.fee === 40 && fo.total === 1040, JSON.stringify(fo));
r = await post(`/api/skykassa/payments/${PG}/choose`, { mode: 'partner', partnerId: 'fake' }, u1.tok);
const pp = r.data.payment;
t('создан платёж у партнёра: адрес оплаты, сумма с комиссией', r.status === 200 && pp.status === 'awaiting_payment' && pp.kind === 'partner' && pp.total === 1040 && pp.fee === 40 && pp.partnerUrl?.includes('/pay/P'), JSON.stringify(r.data).slice(0, 300));
const ref = q(`select partner_ref from skykassa_payments where id='${PG}'`);
t('партнёру ушла полная сумма и номер нашего платежа', pay.get(ref).amount === 1040 && pay.get(ref).order === PG);
t('партнёрский платёж нельзя «отметить переведённым» вручную', (await post(`/api/skykassa/payments/${PG}/report`, { amount: 1000 }, u1.tok)).data.error === 'bad_state');
t('партнёрский платёж после создания не отменить локально', (await post(`/api/skykassa/payments/${PG}/cancel`, {}, u1.tok)).data.error === 'cannot_cancel');
const bp = await bal(u1);
t('вебхук с неверной подписью отклонён', (await hook('fake', { event_id: 'e1', payment_id: ref, order_id: PG, status: 'paid' }, { secret: 'x'.repeat(24) })).status === 401);
t('вебхук с устаревшей меткой времени отклонён', (await hook('fake', { event_id: 'e1', payment_id: ref, order_id: PG, status: 'paid' }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status === 401);
t('вебхук к неизвестному партнёру — 404', (await hook('nobody', { event_id: 'e1' })).status === 404);
t('вебхук к неподключённому партнёру — 503', (await hook('ghost', { event_id: 'e1' })).status === 503);
r = await hook('fake', { event_id: 'e-forged', payment_id: ref, order_id: PG, status: 'paid' });
t('подделка «оплачено» без подтверждения у партнёра ничего не зачисляет', r.status === 200 && (await bal(u1)) === bp && q(`select status from skykassa_payments where id='${PG}'`) === 'awaiting_payment');
pay.get(ref).status = 'paid';
r = await call(`/api/skykassa/payments/${PG}?refresh=1`, {}, u1.tok);
t('возврат на сайт: статус проверяется на сервере у партнёра, зачисление', r.data.payment.status === 'completed' && (await bal(u1)) === bp + 1000, JSON.stringify(r.data.payment.status));
t('зачислена сумма заявки, без комиссии партнёра', q(`select amount from skykassa_credits where payment_id='${PG}'`) === '1000');
r = await hook('fake', { event_id: 'e2', payment_id: ref, order_id: PG, status: 'paid' });
t('повторное событие не зачисляет второй раз', r.status === 200 && (await bal(u1)) === bp + 1000);
r = await hook('fake', { event_id: 'e2', payment_id: ref, order_id: PG, status: 'paid' });
t('дубликат события распознан', r.data.duplicate === true);
// оплата прошла вебхуком
q(`update skykassa_payments set status='cancelled_user' where user_id='${u1.pid}' and status in ('created','awaiting_payment') and partner_ref is null`);
const PG2 = (await post('/api/skykassa/payments', { amount: 2000 }, u1.tok)).data.payment.id;
await post(`/api/skykassa/payments/${PG2}/choose`, { mode: 'partner', partnerId: 'fake' }, u1.tok);
const ref2 = q(`select partner_ref from skykassa_payments where id='${PG2}'`);
pay.get(ref2).status = 'paid';
const bq = await bal(u1);
r = await hook('fake', { event_id: 'e3', payment_id: ref2, order_id: PG2, status: 'paid' });
t('вебхук + подтверждение у партнёра → зачисление', r.status === 200 && (await bal(u1)) === bq + 2000 && q(`select status from skykassa_payments where id='${PG2}'`) === 'completed');
// несовпадение суммы
const PG3 = (await post('/api/skykassa/payments', { amount: 1500 }, u1.tok)).data.payment.id;
await post(`/api/skykassa/payments/${PG3}/choose`, { mode: 'partner', partnerId: 'fake' }, u1.tok);
const ref3 = q(`select partner_ref from skykassa_payments where id='${PG3}'`);
pay.get(ref3).status = 'paid'; pay.get(ref3).amount = 1;
const bq3 = await bal(u1);
await hook('fake', { event_id: 'e4', payment_id: ref3, order_id: PG3, status: 'paid' });
t('сумма у партнёра не совпала → «Ошибка обработки», деньги не зачислены', q(`select status from skykassa_payments where id='${PG3}'`) === 'error' && (await bal(u1)) === bq3);
// отмена у партнёра
const PG4 = (await post('/api/skykassa/payments', { amount: 1200 }, u1.tok)).data.payment.id;
await post(`/api/skykassa/payments/${PG4}/choose`, { mode: 'partner', partnerId: 'fake' }, u1.tok);
const ref4 = q(`select partner_ref from skykassa_payments where id='${PG4}'`);
pay.get(ref4).status = 'cancelled';
await hook('fake', { event_id: 'e5', payment_id: ref4, order_id: PG4, status: 'cancelled' });
t('отказ партнёра → «Отменён системой»', q(`select status from skykassa_payments where id='${PG4}'`) === 'cancelled_system');
// возврат со стороны партнёра
pay.get(ref2).status = 'refunded';
await hook('fake', { event_id: 'e6', payment_id: ref2, order_id: PG2, status: 'refunded' });
t('возврат у партнёра → «Возврат запрошен» (деньги не списаны автоматически)', q(`select status from skykassa_payments where id='${PG2}'`) === 'refund_requested' && (await bal(u1)) === bq + 2000);
// владелец повторяет зачисление после ошибки: сумма всё ещё неверна → снова ошибка, не зачисление
code = await stepUp(own, `${A}/step-up`);
r = await act(own, PG3, 'owner_reject', { reason: 'Сумма у партнёра не совпала, разбираемся' });
t('владелец закрыл платёж с ошибкой отклонением', r.data.status === 'rejected');
// вебхук отключённого партнёра
code = await stepUp(cfg); await put(`${A}/partners/fake`, { enabled: false }, cfg.tok);
t('выключить партнёра можно без кода (остановка безопасна)', q(`select enabled from skykassa_partners where id='fake'`) === 'f');
t('вебхук отключённого партнёра не принимается', (await hook('fake', { event_id: 'e7', payment_id: ref, order_id: PG, status: 'paid' })).status === 404);
r = await call('/api/skykassa/options?amount=1000&destination=balance', {}, u1.tok);
t('отключённый партнёр не показывается', !r.data.partners.some((p) => p.id === 'fake'));

// ── 12. Пауза и приложения ──
t('настройки без права — отказ', (await put(`${A}/settings`, { paused: true }, staff.tok)).status === 403);
r = await put(`${A}/settings`, { paused: true, pauseMessage: 'Технические работы кассы' }, cfg.tok);
t('приём платежей приостановлен', r.status === 200);
r = await post('/api/skykassa/payments', { amount: 300 }, u1.tok);
t('новые платежи при паузе не создаются, сообщение видно', r.status === 423 && r.data.message === 'Технические работы кассы');
t('пауза видна в настройках платформы', (await call('/api/skykassa/config', {}, u1.tok)).data.paused === true);
await put(`${A}/settings`, { paused: false, apps: { windows: false } }, cfg.tok);
t('приложение отключено для оплаты', (await post('/api/skykassa/payments', { amount: 300, app: 'windows' }, u1.tok)).data.error === 'app_disabled' && (await post('/api/skykassa/payments', { amount: 300, app: 'web' }, u1.tok)).status === 200);
t('границы сумм настраиваются', (await put(`${A}/settings`, { minAmount: 5000, maxAmount: 1000 }, cfg.tok)).data.error === 'bad_field');
await put(`${A}/settings`, { apps: { windows: true } }, cfg.tok);
q(`update skykassa_payments set status='cancelled_user' where user_id='${u1.pid}' and status in ('created','awaiting_payment')`);

// ── 13. Безопасность ──
for (const bad of ["x' OR '1'='1", '../../etc/passwd', '%00', 'a'.repeat(300)]) {
  const x = await call(`/api/skykassa/payments/${encodeURIComponent(bad)}`, {}, u1.tok);
  if (x.status === 500) t(`id «${bad.slice(0, 12)}» дал 500`, false);
}
t('служебные идентификаторы не ломают сервер', (await call(`/api/skykassa/payments/${encodeURIComponent("x' OR '1'='1")}`, {}, u1.tok)).status < 500);
r = await post('/api/skykassa/payments', { amount: 300, destination: 'balance', idemKey: '<script>alert(1)</script>' }, u1.tok);
t('ключ идемпотентности проверяется', r.data.error === 'bad_idem');
r = await post(`/api/skykassa/payments/${P1}/reply`, { body: '<img src=x onerror=alert(1)>' }, u1.tok);
t('ответ в закрытом состоянии отклонён', r.status === 409);
t('история человека содержит только его платежи', (await call('/api/skykassa/payments', {}, u2.tok)).data.items.every((x) => q(`select user_id from skykassa_payments where id='${x.id}'`) === u2.pid));
t('в ответах API нет секретов партнёров', !(await call(`${A}/overview`, {}, cfg.tok)).text.includes(SECRET));
t('действия записаны в журнал администрации', Number(q(`select count(*) from admin_log where type like 'skykassa%'`)) >= 15);
t('журнал: подтверждение владельца есть', Number(q(`select count(*) from admin_log where type='skykassa_owner_confirm'`)) >= 2);
r = await del(`${A}/requisites/${req2}`, {}, cfg.tok);
t('удаление реквизита требует кода', r.data.error === 'step_up_required');
code = await stepUp(cfg); r = await del(`${A}/requisites/${req2}`, { stepUpCode: code }, cfg.tok);
t('реквизит удалён без потери истории', r.status === 200 && q(`select count(*) from skykassa_requisites where id='${req2}' and deleted_at is not null`) === '1');
t('все 19 статусов имеют подписи', (await call(`${A}/status-labels`, {}, staff.tok)).data.labels && Object.keys((await call(`${A}/status-labels`, {}, staff.tok)).data.labels).length === 19);
t('ни одного недопустимого перехода в журнале', q(`select count(*) from skykassa_status_log where from_status='completed' and to_status not in ('refund_requested')`) === '0');
t('кошелёк: ни одного отрицательного баланса', q(`select count(*) from wallet_accounts where balance < 0`) === '0');

srv.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
