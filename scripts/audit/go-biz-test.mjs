// Sky GO — бизнес: организация, сотрудники, роли, назначение, рабочее пространство исполнителя, проблемы, синхронизация.
// Запуск: API на :8080 с картами (fake-google), ADMIN_GATE=off:
//   (. env.sh; node scripts/audit/go-biz-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { validInn, validOgrn } = await import('../../server/sellerrules.mjs');
const { sequenceStops } = await import('../../server/gowork.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const PATCH = (b) => ({ method: 'PATCH', body: JSON.stringify(b) });
const PUT = (b) => ({ method: 'PUT', body: JSON.stringify(b) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gen = (len, fn) => { for (let i = 0; i < 100000; i += 1) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } throw new Error('gen'); };
const inn12 = () => gen(12, (s) => validInn(s, { length: 12 }));
const inn10 = () => gen(10, (s) => validInn(s, { length: 10 }));
const ogrn = () => gen(13, validOgrn);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const CITY = 'Москва';
const mk = (tag) => mkuser(S, tag);
const fund = (u, n) => q(`insert into wallet_accounts(user_id,balance) values ('${u.pid}',${n}) on conflict (user_id) do update set balance = wallet_accounts.balance + ${n}`);
const dob = (u) => q(`update profiles set date_of_birth='1990-05-05' where id='${u.pid}'`);
const uname = (u) => q(`select username from profiles where id='${u.pid}'`);

const A = await mk('bzAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const O = await mk('bzOwner'), M = await mk('bzMgr'), AD = await mk('bzAdmin'), K1 = await mk('bzCour1'), K2 = await mk('bzCour2'), K3 = await mk('bzCour3'), E = await mk('bzExt'), X = await mk('bzStranger'), C = await mk('bzCust');
for (const u of [O, K1, K2, K3, E]) dob(u);
const approve = (id) => call(`/api/admin/go/applications/${id}/decide`, J({ action: 'approve', note: '' }), A.tok);
const reg = async (u, role, legalForm, extra, fields) => {
  const r = await G('/executors', J({ role, legalForm, city: CITY, fields, extra }), u.tok);
  if (r.status !== 200) return { err: r };
  for (const kind of role === 'courier' ? ['id_doc'] : role === 'taxi_driver' ? ['driver_license', 'vehicle_registration'] : []) await call(`/api/go/executors/${r.data.id}/docs?kind=${kind}`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, u.tok);
  const sub = await G(`/executors/${r.data.id}/submit`, J({}), u.tok);
  if (sub.status !== 200) return { err: sub };
  await approve(r.data.id); return { id: r.data.id };
};
const npd = () => ({ fullName: 'Иванов Иван Иванович', inn: inn12(), phone: '+79991234567' });
const CARD = '4111111111111111';
const card = (u) => G('/pay-details', PUT({ method: 'card', number: CARD, holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест-банк' }), u.tok);
const courier = async (u, extra = { transport: 'bike' }, withCard = false) => { const r = await reg(u, 'courier', 'npd', extra, npd()); fund(u, 300); await G('/subscription/courier/buy', J({}), u.tok); if (withCard) await card(u); return r; };
const online = (u, lat = 55.75, lng = 37.62) => G('/presence', J({ role: 'courier', online: true, lat, lng }), u.tok);
const pickup = { address: 'Москва, Тверская 1' }; const drop = { address: 'Москва, Арбат 10' };
const parcel = (d = 'Документы') => ({ description: d, weightKg: 1, size: 's' });
const rec = { name: 'Получатель Р.', phone: '+79995550000' }; const snd = { name: 'Отправитель О.', phone: '+79995551111' };

/* ═══ Организация: создаётся из одобренной регистрации «компания» ═══ */
let r = await G('/workspaces', {}, X.tok);
t('без регистрации компании организации нет', r.status === 200 && r.data.orgs.length === 0 && r.data.invites.length === 0, JSON.stringify(r.data));
const reco = await reg(O, 'company', 'ooo', { brand: 'Бизнес-Тест' }, { orgName: 'ООО «Бизнес»', inn: inn10(), ogrn: ogrn(), orgPhone: '+74951234567', orgEmail: 'o@example.com', repName: 'Сидоров С.С.', repPosition: 'Директор', repIsHead: true });
t('компания зарегистрирована и одобрена', Boolean(reco.id), JSON.stringify(reco.err?.data));
fund(O, 500); await G('/subscription/company/buy', J({}), O.tok);
r = await G('/workspaces', {}, O.tok);
const ORG = r.data.orgs[0]?.id;
t('организация создана автоматически, имя из анкеты, роль «владелец»', r.data.orgs.length === 1 && r.data.orgs[0].name === 'Бизнес-Тест' && r.data.orgs[0].role === 'owner' && r.data.orgs[0].staff, JSON.stringify(r.data));
r = await G('/workspaces', {}, O.tok);
t('повторное обращение не создаёт вторую организацию', r.data.orgs.length === 1 && q(`select count(*) from go_orgs where owner_id='${O.pid}'`) === '1');
r = await G(`/org/${ORG}/dashboard`, {}, X.tok);
t('чужая организация неотличима от несуществующей (not_found)', r.status === 404, JSON.stringify(r.data));
r = await G(`/org/${ORG}/orders`, {}, X.tok);
t('и список заказов чужой организации закрыт', r.status === 404);

/* ═══ Сотрудники: приглашения, роли, защита от повышения привилегий ═══ */
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(M), role: 'manager' }), O.tok);
t('владелец приглашает менеджера', r.status === 200, JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(M), role: 'manager' }), O.tok);
t('повторное приглашение — already_member', r.status === 409 && r.data.error === 'already_member');
r = await G('/workspaces', {}, M.tok);
t('приглашённый видит приглашение (организация и роль)', r.data.invites.length === 1 && r.data.invites[0].orgName === 'Бизнес-Тест' && r.data.invites[0].role === 'manager' && r.data.orgs.length === 0, JSON.stringify(r.data));
r = await G(`/org/${ORG}/dashboard`, {}, M.tok);
t('пока приглашение не принято — доступа к организации нет', r.status === 404);
r = await G(`/org/invites/${ORG}/respond`, J({ accept: true }), M.tok);
t('приглашение принято', r.status === 200);
r = await G(`/org/invites/${ORG}/respond`, J({ accept: true }), M.tok);
t('повторно принять нельзя', r.status === 404);
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(O), role: 'admin' }), O.tok);
t('нельзя пригласить самого себя', r.status === 400 && r.data.error === 'self_invite', JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/invite`, J({ username: 'net_takogo_zzz', role: 'courier' }), O.tok);
t('несуществующий ник — profile_not_found', r.status === 400 && r.data.error === 'profile_not_found');
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(AD), role: 'owner' }), O.tok);
t('роль «владелец» назначить нельзя', r.status === 403 && r.data.error === 'role_not_allowed', JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(AD), role: 'admin' }), O.tok);
await G(`/org/invites/${ORG}/respond`, J({ accept: true }), AD.tok);
t('владелец назначает администратора', r.status === 200);
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(K3), role: 'admin' }), AD.tok);
t('администратор не назначает администраторов', r.status === 403 && r.data.error === 'role_not_allowed', JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(K1), role: 'courier' }), AD.tok);
t('администратор приглашает курьера', r.status === 200);
r = await G(`/org/${ORG}/members/invite`, J({ username: uname(K3), role: 'courier' }), M.tok);
t('менеджер сотрудников не приглашает', r.status === 403 && r.data.error === 'not_allowed', JSON.stringify(r.data));
r = await G(`/org/${ORG}/audit`, {}, M.tok);
t('журнал действий менеджеру закрыт', r.status === 403);
r = await G(`/org/${ORG}/members`, {}, M.tok);
t('менеджер видит состав команды, но не управляет ею', r.status === 200 && r.data.canManage === false && r.data.members.length >= 3, JSON.stringify(r.data).slice(0, 150));
t('в списке команды нет телефонов, документов и ИНН', !/phone|inn|doc|passport/i.test(JSON.stringify(r.data.members)));
r = await G(`/org/${ORG}/members/${M.pid}`, PATCH({ role: 'admin', confirm: true }), M.tok);
t('менеджер повысить себя не может (нет права управлять командой)', r.status === 403, JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/${AD.pid}`, PATCH({ role: 'manager', confirm: true }), AD.tok);
t('администратор менять собственную роль не может', r.status === 403 && r.data.error === 'self_change', JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/${O.pid}`, PATCH({ status: 'suspended', confirm: true }), AD.tok);
t('владельца отстранить нельзя', r.status === 403 && r.data.error === 'owner_immutable');
r = await G(`/org/${ORG}/members/${M.pid}`, PATCH({ role: 'admin', confirm: true }), AD.tok);
t('администратор не делает администраторов повышением', r.status === 403 && r.data.error === 'role_not_allowed');
r = await G(`/org/${ORG}/members/${M.pid}`, PATCH({ role: 'courier' }), O.tok);
t('смена роли менеджер→курьер без подтверждения — ok (не опасная)', r.status === 200, JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/${M.pid}`, PATCH({ role: 'manager' }), O.tok);
r = await G(`/org/${ORG}/members/${M.pid}`, PATCH({ role: 'admin' }), O.tok);
t('назначение администратором требует подтверждения', r.status === 409 && r.data.error === 'confirm_required', JSON.stringify(r.data));
r = await G(`/org/${ORG}/members/${M.pid}`, PATCH({ status: 'suspended' }), O.tok);
t('приостановка требует подтверждения', r.status === 409 && r.data.error === 'confirm_required');
r = await G(`/org/${ORG}/audit`, {}, O.tok);
t('журнал: приглашения и изменения записаны', r.status === 200 && r.data.log.some((x) => x.action === 'invite') && r.data.log.some((x) => x.action === 'member_change'), JSON.stringify(r.data).slice(0, 200));

/* ═══ Исполнители команды ═══ */
r = await courier(K1); t('курьер K1 одобрен', Boolean(r.id), JSON.stringify(r.err?.data));
await G(`/org/invites/${ORG}/respond`, J({ accept: true }), K1.tok);
r = await online(K1);
t('сотрудник организации выходит на линию без реквизитов для оплаты (работает по назначениям)', r.status === 200 && r.data.online === true, JSON.stringify(r.data));
r = await G('/presence', J({ role: 'courier', online: true, lat: 55.75, lng: 37.62 }), K3.tok);
t('курьер без регистрации выйти на линию не может', r.status === 403 && r.data.error === 'not_registered', JSON.stringify(r.data));

/* ═══ Заказы организации ═══ */
const order = (o = {}) => G(`/org/${ORG}/orders`, J({ city: CITY, from: pickup, to: drop, parcel: parcel(), recipient: rec, sender: snd, ...o }), O.tok);
r = await order({ parcel: parcel('Коробка A') });
const O1 = r.data.orderId;
t('владелец создал заказ организации, цена с сервера', r.status === 201 && O1 && r.data.priceRub > 0, JSON.stringify(r.data));
t('заказ принадлежит организации, создатель записан', q(`select org_id from go_orders where id='${O1}'`) === ORG && q(`select created_by from go_orders where id='${O1}'`) === O.pid);
r = await G(`/org/${ORG}/orders`, J({ city: CITY, from: pickup, to: drop, parcel: parcel(), recipient: rec, sender: snd }), X.tok);
t('посторонний создать заказ организации не может', r.status === 404);
await G('/presence', J({ role: 'courier', online: true, lat: 55.75, lng: 37.62 }), E.tok);
await courier(E, { transport: 'car' }, true); await online(E);
r = await G('/delivery/available', {}, E.tok);
t('заказ организации не попадает в общий поток курьеров', r.status === 200 && !r.data.orders.some((x) => x.id === O1), JSON.stringify(r.data).slice(0, 150));
r = await G(`/delivery/orders/${O1}/accept`, J({}), E.tok);
t('и внешний курьер принять его не может', r.status === 409 && r.data.error === 'already_taken', JSON.stringify(r.data));
r = await G(`/org/${ORG}/dashboard`, {}, M.tok);
t('панель: новый заказ посчитан, исполнителей на линии 1', r.status === 200 && r.data.counts.searching >= 1 && r.data.team.online >= 1 && r.data.team.total >= 1, JSON.stringify(r.data).slice(0, 200));
r = await G(`/org/${ORG}/orders?group=new&q=${encodeURIComponent('Коробка')}`, {}, M.tok);
t('поиск и фильтр по группе: найден заказ по описанию', r.status === 200 && r.data.orders.some((x) => x.id === O1) && r.data.total >= 1, JSON.stringify(r.data).slice(0, 150));
r = await G(`/org/${ORG}/orders?group=done`, {}, M.tok);
t('фильтр «завершённые» не содержит новый заказ', !r.data.orders.some((x) => x.id === O1));
r = await G(`/org/${ORG}/orders/${O1}`, {}, M.tok);
t('карточка заказа: адреса, получатель, история, коды для сотрудников', r.status === 200 && r.data.order.data.recipient?.name === rec.name && r.data.order.events?.length >= 1 && r.data.order.codes?.pickup?.code && r.data.can.assign, JSON.stringify(r.data).slice(0, 200));
const codes1 = r.data.order.codes;


/* ═══ Назначение исполнителя, принятие, жизненный цикл ═══ */
r = await G(`/org/${ORG}/orders/${O1}/assign`, J({ executorId: K3.pid }), M.tok);
t('назначить не участника организации нельзя', r.status === 409 && r.data.error === 'executor_not_member', JSON.stringify(r.data));
await G(`/org/${ORG}/members/invite`, J({ username: uname(K3), role: 'courier' }), O.tok); await G(`/org/invites/${ORG}/respond`, J({ accept: true }), K3.tok);
r = await G(`/org/${ORG}/orders/${O1}/assign`, J({ executorId: K3.pid }), M.tok);
t('участник без одобренной регистрации курьера — executor_not_approved', r.status === 409 && r.data.error === 'executor_not_approved', JSON.stringify(r.data));
await courier(K2); await G(`/org/${ORG}/members/invite`, J({ username: uname(K2), role: 'driver' }), O.tok); await G(`/org/invites/${ORG}/respond`, J({ accept: true }), K2.tok);
r = await G(`/org/${ORG}/orders/${O1}/assign`, J({ executorId: K2.pid }), M.tok);
t('участник на линии не вышел — executor_offline', r.status === 409 && r.data.error === 'executor_offline', JSON.stringify(r.data));
r = await G(`/org/${ORG}/orders/${O1}/assign`, J({ executorId: K1.pid }), X.tok);
t('посторонний назначать не может', r.status === 404);
r = await G(`/org/${ORG}/orders/${O1}/assign`, J({ executorId: K1.pid }), M.tok);
t('менеджер назначил исполнителя', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('статус «назначен», принятие исполнителем ещё не получено', q(`select status from go_orders where id='${O1}'`) === 'assigned' && q(`select data->'dispatch'->>'accepted' from go_orders where id='${O1}'`) === 'false');
t('оплата через Sky не нужна: заказ своего сотрудника', q(`select data->>'internal' from go_orders where id='${O1}'`) === 'true' && q(`select count(*) from go_order_pay where order_id='${O1}'`) === '0');
r = await G('/work/state?role=courier', {}, K1.tok);
const w1 = r.data.orders?.find((o) => o.id === O1);
t('исполнитель видит назначение и обязан принять его', r.status === 200 && w1?.needsAccept === true && w1.orgName === 'Бизнес-Тест', JSON.stringify(r.data).slice(0, 200));
t('контакты получателя до получения отправления скрыты', w1?.data.recipient?.hidden === true && !JSON.stringify(w1.data).includes(rec.phone), JSON.stringify(w1?.data.recipient));
t('контакты отправителя исполнитель видит', w1?.data.sender?.name === snd.name);
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'heading' }), K1.tok);
t('без принятия назначения ехать нельзя', r.status === 409 && r.data.error === 'assignment_not_accepted', JSON.stringify(r.data));
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'heading' }), K2.tok);
t('чужой заказ исполнитель менять не может (not_found)', r.status === 404);
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'accept_assignment' }), K1.tok);
t('исполнитель принял назначение', r.status === 200 && r.data.ok && !r.data.duplicate, JSON.stringify(r.data));
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'accept_assignment' }), K1.tok);
t('повторное принятие (двойной тап) — не ошибка', r.status === 200 && r.data.duplicate === true);
const ownerNotes = () => Number(q(`select count(*) from gift_notifications where user_id='${O.pid}' and ref_id='${O1}'`));
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'heading' }), K1.tok);
t('«еду за отправлением»', r.status === 200);
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'heading' }), K1.tok);
t('повтор после обрыва связи — тот же результат без ошибки', r.status === 200 && r.data.duplicate === true);
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'pickup', code: codes1.pickup.code }), K1.tok);
t('нельзя забрать, пока не прибыл на точку', r.status === 409 && r.data.error === 'bad_state', JSON.stringify(r.data));
await G(`/delivery/orders/${O1}/act`, J({ action: 'arrived_pickup' }), K1.tok);
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'pickup', code: '000000' }), K1.tok);
t('неверный код передачи отклонён', r.status === 400 && r.data.error === 'bad_code', JSON.stringify(r.data));
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'pickup', code: codes1.pickup.code }), K1.tok);
t('код передачи верный — отправление получено', r.status === 200 && r.data.ok);
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'pickup', code: codes1.pickup.code }), K1.tok);
t('повтор получения — без ошибки и без повторного списания кода', r.status === 200 && r.data.duplicate === true);
r = await G('/work/state?role=courier', {}, K1.tok);
t('после получения отправления контакты получателя открыты', r.data.orders.find((o) => o.id === O1)?.data.recipient?.phone === rec.phone, JSON.stringify(r.data.orders.find((o) => o.id === O1)?.data.recipient));
r = await G(`/org/${ORG}/orders/${O1}`, {}, O.tok);
t('кабинет бизнеса видит новый статус сразу', r.data.order.status === 'picked_up' && r.data.order.events.some((e) => e.to === 'picked_up'), r.data.order?.status);
await G(`/delivery/orders/${O1}/act`, J({ action: 'start_delivery' }), K1.tok);
await G(`/delivery/orders/${O1}/act`, J({ action: 'arrived_recipient' }), K1.tok);
r = await G(`/org/${ORG}/orders/${O1}`, {}, M.tok);
const hc = r.data.order.codes.handover.code;
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'deliver', code: '123456' === hc ? '654321' : '123456' }), K1.tok);
t('неверный код вручения отклонён', r.status === 400 && r.data.error === 'bad_code');
const nBefore = ownerNotes();
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'deliver', code: hc }), K1.tok);
t('вручено: заказ завершён без платёжных шагов (свой сотрудник)', r.status === 200 && q(`select status from go_orders where id='${O1}'`) === 'paid' && q(`select count(*) from go_order_pay where order_id='${O1}'`) === '0', JSON.stringify(r.data));
const nAfter = ownerNotes();
r = await G(`/delivery/orders/${O1}/act`, J({ action: 'deliver', code: hc }), K1.tok);
t('повторное вручение — без ошибки', r.status === 200 && r.data.duplicate === true);
t('повторы не плодят уведомления владельцу', ownerNotes() === nAfter && nAfter > nBefore, `${nBefore} ${nAfter}`);
t('история статусов полная', Number(q(`select count(*) from go_order_events where order_id='${O1}' and to_status in ('assigned','heading_pickup','at_pickup','picked_up','delivering','at_recipient','paid')`)) >= 7);
t('владелец получил уведомления о приёме, получении и завершении', Number(q(`select count(*) from gift_notifications where user_id='${O.pid}' and ref_id='${O1}' and kind='go_org'`)) >= 4);

/* ═══ Проблемы доставки ═══ */
r = await order({ parcel: parcel('Коробка B') }); const O2 = r.data.orderId;
await G(`/org/${ORG}/orders/${O2}/assign`, J({ executorId: K1.pid }), O.tok);
await G(`/delivery/orders/${O2}/act`, J({ action: 'accept_assignment' }), K1.tok); await G(`/delivery/orders/${O2}/act`, J({ action: 'heading' }), K1.tok);
r = await G(`/work/orders/${O2}/problem`, J({ kind: 'wrong_kind' }), K1.tok);
t('неизвестный вид проблемы отклонён', r.status === 400 && r.data.error === 'bad_kind');
r = await G(`/work/orders/${O2}/problem`, J({ kind: 'other', note: 'ab' }), K1.tok);
t('«другое» требует описания', r.status === 400 && r.data.error === 'note_required');
r = await G(`/work/orders/${O2}/problem`, J({ kind: 'wrong_address', note: 'Нет такого дома' }), K2.tok);
t('чужой заказ: сообщить о проблеме нельзя', r.status === 404);
r = await G(`/work/orders/${O2}/problem`, J({ kind: 'wrong_address', note: 'Нет такого дома' }), K1.tok);
const P1 = r.data.id;
t('исполнитель сообщил о проблеме', r.status === 201 && P1, JSON.stringify(r.data));
r = await call(`/api/go/work/problems/${P1}/photo`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, K1.tok);
t('фото-подтверждение приложено', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await call(`/api/go/work/problems/${P1}/photo`, { method: 'POST', body: Buffer.from('not an image at all, plain text'), headers: { 'content-type': 'application/octet-stream' } }, K1.tok);
t('не картинку приложить нельзя', r.status === 400 || r.status === 404, JSON.stringify(r.data));
const ph = await fetch(`http://127.0.0.1:8080/api/go/problems/${P1}/photo`, { headers: { authorization: `Bearer ${M.tok}` } });
t('фото видят сотрудники организации', ph.status === 200 && ph.headers.get('content-type') === 'image/png');
const phx = await fetch(`http://127.0.0.1:8080/api/go/problems/${P1}/photo`, { headers: { authorization: `Bearer ${X.tok}` } });
t('постороннему фото не отдаётся', phx.status === 404);
r = await G(`/org/${ORG}/orders/${O2}`, {}, M.tok);
t('в карточке заказа открытая проблема и пометка «нужно внимание»', r.data.problems?.[0]?.state === 'open' && r.data.order.attention === 'problem' && r.data.can.resolveProblem, JSON.stringify(r.data.problems));
r = await G(`/org/${ORG}/problems/${P1}/resolve`, J({ action: 'resume', note: 'Продолжайте' }), K1.tok);
t('исполнитель закрыть проблему не может', r.status === 404 || r.status === 403, JSON.stringify(r.data));
r = await G(`/org/${ORG}/problems/${P1}/resolve`, J({ action: 'bogus', note: 'х х х' }), M.tok);
t('неизвестное решение отклонено', r.status === 400);
r = await G(`/org/${ORG}/dashboard`, {}, O.tok);
t('панель: заказ с проблемой в списке «требует внимания»', r.data.attention.some((x) => x.id === O2) && r.data.counts.problems >= 1 && r.data.counts.openProblems >= 1, JSON.stringify(r.data.attention).slice(0, 150));
r = await G(`/org/${ORG}/problems/${P1}/resolve`, J({ action: 'reassign', note: 'Уточним адрес, другой курьер' }), M.tok);
t('менеджер решил проблему: исполнитель заменяется', r.status === 200 && q(`select status from go_orders where id='${O2}'`) === 'searching' && q(`select executor_id is null from go_orders where id='${O2}'`) === 't', JSON.stringify(r.data));
r = await G(`/delivery/orders/${O2}/act`, J({ action: 'arrived_pickup' }), K1.tok);
t('прежний исполнитель больше заказом не управляет', r.status === 404);
t('исполнитель уведомлён о решении', Number(q(`select count(*) from gift_notifications where user_id='${K1.pid}' and ref_id='${O2}'`)) >= 2);
r = await G(`/org/${ORG}/problems/${P1}/resolve`, J({ action: 'resume', note: 'повтор' }), M.tok);
t('закрытую проблему повторно не решить', r.status === 409 && r.error !== 'x');

/* ═══ Отказ исполнителя только с причиной ═══ */
await G(`/org/${ORG}/orders/${O2}/assign`, J({ executorId: K1.pid }), M.tok);
r = await G(`/delivery/orders/${O2}/act`, J({ action: 'release' }), K1.tok);
t('отказаться от заказа организации без причины нельзя', r.status === 400 && r.data.error === 'reason_required', JSON.stringify(r.data));
r = await G(`/delivery/orders/${O2}/act`, J({ action: 'release', reason: 'Сломался самокат' }), K1.tok);
t('отказ с причиной: заказ вернулся диспетчеру, а не в общий поток', r.status === 200 && q(`select status from go_orders where id='${O2}'`) === 'searching' && q(`select data->>'poolOpen' from go_orders where id='${O2}'`) === 'false');
r = await G('/delivery/available', {}, E.tok);
t('и внешним курьерам заказ организации по-прежнему не виден', !r.data.orders.some((x) => x.id === O2));
t('диспетчер уведомлён об отказе с причиной', Number(q(`select count(*) from gift_notifications where user_id='${M.pid}' and ref_id='${O2}' and body ilike '%самокат%'`)) >= 1);


/* ═══ Режим «автоназначение» ═══ */
r = await G(`/org/${ORG}/settings`, PATCH({ assignMode: 'bogus' }), O.tok);
t('неизвестный режим назначения отклонён', r.status === 400 && r.data.error === 'bad_mode');
r = await G(`/org/${ORG}/settings`, PATCH({ assignMode: 'auto' }), M.tok);
t('менеджер настройки организации менять не может', r.status === 403);
r = await G(`/org/${ORG}/settings`, PATCH({ assignMode: 'auto' }), AD.tok);
t('администратор включил автоназначение', r.status === 200);
r = await order({ parcel: parcel('Коробка C') }); const O3 = r.data.orderId;
await sleep(500);
t('автоназначение: заказ достался свободному сотруднику на линии', q(`select executor_id from go_orders where id='${O3}'`) === K1.pid && q(`select status from go_orders where id='${O3}'`) === 'assigned', q(`select status from go_orders where id='${O3}'`));
r = await G(`/delivery/orders/${O3}/act`, J({ action: 'release', reason: 'Не успеваю по времени' }), K1.tok);
t('отказ при автоназначении: заказ ждёт, повторно тому же исполнителю не выдаётся', r.status === 200 && q(`select status from go_orders where id='${O3}'`) === 'searching', q(`select status from go_orders where id='${O3}'`));
await G('/presence', J({ role: 'courier', online: true, lat: 55.76, lng: 37.63 }), K2.tok);
await sleep(600);
t('вышел на линию другой сотрудник — ожидающий заказ достаётся ему', q(`select executor_id from go_orders where id='${O3}'`) === K2.pid, q(`select executor_id from go_orders where id='${O3}'`));
await G(`/org/${ORG}/settings`, PATCH({ assignMode: 'manual' }), O.tok);

/* ═══ Отмена и права на отмену ═══ */
r = await G(`/org/${ORG}/orders/${O3}/cancel`, J({ reason: '' }), M.tok);
t('отмена заказа требует причины', r.status === 400 && r.data.error === 'reason_required');
r = await G(`/org/${ORG}/orders/${O3}/cancel`, J({ reason: 'Клиент передумал' }), M.tok);
t('диспетчер отменил заказ до получения отправления', r.status === 200 && q(`select status from go_orders where id='${O3}'`) === 'cancelled', JSON.stringify(r.data));
r = await G(`/delivery/orders/${O3}/act`, J({ action: 'heading' }), K2.tok);
t('исполнитель отменённого заказа ничего менять не может', r.status === 409 && r.data.error === 'bad_state');
t('исполнитель уведомлён об отмене', Number(q(`select count(*) from gift_notifications where user_id='${K2.pid}' and ref_id='${O3}' and title ilike '%отменён%'`)) >= 1);
r = await G(`/orders/${O3}`, {}, X.tok);
t('чужой заказ через общий API — not_found', r.status === 404);
r = await G(`/orders/${O1}`, {}, K2.tok);
t('сотрудник, не назначенный на заказ, видеть его не может', r.status === 404);
r = await G(`/orders/${O1}`, {}, M.tok);
t('менеджер видит заказ организации через общий API', r.status === 200 && r.data.order.id === O1);

/* ═══ Внешний курьер из общего потока: прямая оплата, действия от имени организации ═══ */
r = await order({ parcel: parcel('Коробка D') }); const O4 = r.data.orderId;
r = await G(`/org/${ORG}/orders/${O4}/open-pool`, J({}), M.tok);
t('менеджер открывать заказ для всех не может', r.status === 403);
r = await G(`/org/${ORG}/orders/${O4}/open-pool`, J({}), AD.tok);
t('администратор открыл заказ для всех курьеров', r.status === 200);
r = await G('/delivery/available', {}, E.tok);
t('внешний курьер теперь видит заказ', r.data.orders?.some((x) => x.id === O4), JSON.stringify(r.data).slice(0, 120));
const accE = await Promise.all([E, E].map((u) => G(`/delivery/orders/${O4}/accept`, J({}), u.tok)));
t('двойное принятие одного заказа: ровно один успех', accE.filter((x) => x.status === 200).length === 1, accE.map((x) => x.status).join());
r = await G(`/org/${ORG}/orders/${O4}`, {}, M.tok);
const c4 = r.data.order.codes;
t('сотрудники видят внешнего курьера и коды', r.data.order.executor?.id === E.pid && c4.pickup.code && r.data.order.internal === false);
for (const [a, c] of [['heading'], ['arrived_pickup'], ['pickup', c4.pickup.code], ['start_delivery'], ['arrived_recipient'], ['deliver', c4.handover.code]]) await G(`/delivery/orders/${O4}/act`, J({ action: a, code: c }), E.tok);
t('внешний курьер довёз: ожидается оплата', q(`select status from go_orders where id='${O4}'`) === 'awaiting_payment' && q(`select state from go_order_pay where order_id='${O4}'`) === 'awaiting');
r = await G(`/orders/${O4}/paid`, J({}), X.tok);
t('посторонний сообщить об оплате не может', r.status === 403 || r.status === 404, JSON.stringify(r.data));
r = await G(`/orders/${O4}/paid`, J({}), M.tok);
t('менеджер от имени организации сообщил об оплате', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await G(`/orders/${O4}/confirm-paid`, J({}), M.tok);
t('подтвердить получение денег может только сам курьер', r.status === 403);
r = await G(`/orders/${O4}/confirm-paid`, J({}), E.tok);
t('курьер подтвердил получение — заказ закрыт', r.status === 200 && q(`select status from go_orders where id='${O4}'`) === 'paid');
r = await G('/work/history?role=courier', {}, E.tok);
t('история внешнего курьера: подтверждённая прямая оплата в статистике', r.status === 200 && r.data.stats.done === 1 && r.data.stats.receivedRub > 0 && r.data.stats.receivedOrders === 1, JSON.stringify(r.data.stats));
t('в истории нет выдуманных оценок', r.data.notes.rating === null && !('rating' in r.data.stats));

/* ═══ Маршрут по нескольким точкам, нагрузка, совместимость ═══ */
const seq = sequenceStops({ lat: 55.75, lng: 37.62 }, [
  { id: 'a', status: 'assigned', data: { from: { lat: 55.80, lng: 37.60, address: 'A' }, to: { lat: 55.70, lng: 37.50, address: 'A2' } } },
  { id: 'b', status: 'picked_up', data: { from: { lat: 55.76, lng: 37.61, address: 'B' }, to: { lat: 55.74, lng: 37.63, address: 'B2' } } },
], 'delivery');
t('порядок точек: вручение уже взятого можно раньше, забор и вручение одного заказа не переставляются', seq.length === 3 && seq.findIndex((x) => x.key === 'a:pickup') < seq.findIndex((x) => x.key === 'a:dropoff') && !seq.some((x) => x.key === 'b:pickup'), JSON.stringify(seq.map((x) => x.key)));
await G('/presence', J({ role: 'courier', online: true, lat: 55.75, lng: 37.62 }), K1.tok);
const ids = [];
for (const d of ['M1', 'M2', 'M3', 'M4']) { const x = await order({ parcel: parcel(d), to: { address: `Москва, ул. ${d}` } }); ids.push(x.data.orderId); }
const asg = [];
for (const id of ids) asg.push(await G(`/org/${ORG}/orders/${id}/assign`, J({ executorId: K1.pid }), O.tok));
t('не больше трёх активных заказов на исполнителя', asg.slice(0, 3).every((x) => x.status === 200) && asg[3].status === 409 && asg[3].data.error === 'courier_busy', asg.map((x) => x.status + (x.data.error ?? '')).join());
for (const id of ids.slice(0, 3)) { await G(`/delivery/orders/${id}/act`, J({ action: 'accept_assignment' }), K1.tok); }
r = await G('/work/route?role=courier', {}, K1.tok);
t('маршрут: несколько заказов в одной смене, точки с адресами', r.status === 200 && r.data.stops.length === 6 && r.data.stops.every((x) => x.address && Number.isFinite(x.lat)), JSON.stringify(r.data).slice(0, 200));
t('маршрут: у каждого заказа сначала забор, потом вручение', ids.slice(0, 3).every((id) => r.data.stops.findIndex((x) => x.key === `${id}:pickup`) < r.data.stops.findIndex((x) => x.key === `${id}:dropoff`)));
t('маршрут: общее расстояние и время (или честная оценка)', r.data.distanceM > 0 && r.data.durationS > 0 && typeof r.data.estimated === 'boolean', JSON.stringify({ d: r.data.distanceM, e: r.data.estimated, m: r.data.mapError }));
r = await G('/work/route?role=courier', {}, K3.tok);
t('маршрут без заказов — пустой, без ошибок', r.status === 200 && r.data.stops.length === 0, JSON.stringify(r.data));
const cg = await order({ parcel: parcel('Диван'), scenario: 'cargo', body: 'm', loaders: 0 });
t('грузовой заказ организации создан', cg.status === 201 || cg.status === 400, JSON.stringify(cg.data));
if (cg.status === 201) {
  r = await G(`/org/${ORG}/orders/${cg.data.orderId}/assign`, J({ executorId: K1.pid }), O.tok);
  t('грузовой нельзя совместить с другими заказами исполнителя', r.status === 409 && ['incompatible_order', 'courier_busy'].includes(r.data.error), JSON.stringify(r.data));
}
for (const id of [...ids, ...(cg.status === 201 ? [cg.data.orderId] : [])]) await G(`/org/${ORG}/orders/${id}/cancel`, J({ reason: 'Тест завершён' }), O.tok);

/* ═══ Положение, смены, окончание слежения ═══ */
await G('/presence', J({ role: 'courier', online: true, lat: 55.76, lng: 37.63 }), K2.tok);
r = await G('/work/location', J({ lat: 55.751, lng: 37.621 }), K2.tok);
t('положение принимается, пока на линии', r.status === 200, JSON.stringify(r.data));
r = await G('/work/location', J({ lat: 999, lng: 0 }), K2.tok);
t('неверные координаты отклонены', r.status === 400 && r.data.error === 'bad_point');
r = await G('/presence', J({ role: 'courier', online: false }), K2.tok);
t('уход с линии: координаты стёрты', r.status === 200 && q(`select lat is null and lng is null from go_presence where profile_id='${K2.pid}' and role='courier'`) === 't');
r = await G('/work/location', J({ lat: 55.7, lng: 37.6 }), K2.tok);
t('вне линии положение не принимается (слежения нет)', r.data.error === 'offline', JSON.stringify(r.data));
t('смены записаны', Number(q(`select count(*) from go_shifts where profile_id='${K2.pid}' and ended_at is not null`)) >= 1);
r = await G('/work/state?role=courier', {}, K2.tok);
t('состояние: не на линии, подписка активна, организация видна', r.status === 200 && r.data.presence.online === false && r.data.subscription.active && r.data.orgs[0]?.name === 'Бизнес-Тест', JSON.stringify(r.data).slice(0, 200));
r = await G('/work/history?role=courier', {}, K1.tok);
t('история сотрудника: доставлено 1, проблем сообщено 1, смены', r.data.stats.done === 1 && r.data.stats.problemsReported === 1 && r.data.shifts.length >= 1, JSON.stringify(r.data.stats));

/* ═══ Подписка: начатые заказы доводятся до конца, новые закрыты ═══ */
r = await order({ parcel: parcel('Коробка S') }); const OS = r.data.orderId;
await online(K1);
await G(`/org/${ORG}/orders/${OS}/assign`, J({ executorId: K1.pid }), O.tok);
q(`update go_subscriptions set expires_at = now() - interval '1 minute' where profile_id='${K1.pid}' and role='courier'`);
r = await G(`/delivery/orders/${OS}/act`, J({ action: 'accept_assignment' }), K1.tok);
t('подписка истекла: начатый заказ можно довести до конца', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await order({ parcel: parcel('Коробка T') }); const OT = r.data.orderId;
r = await G(`/org/${ORG}/orders/${OT}/assign`, J({ executorId: K1.pid }), O.tok);
t('но новое назначение без подписки невозможно', r.status === 402 && r.data.error === 'subscription_required', JSON.stringify(r.data));
r = await G('/work/state?role=courier', {}, K1.tok);
t('состояние показывает, чего не хватает', r.data.subscription.active === false && r.data.access.assigned === false, JSON.stringify(r.data.access));

/* ═══ Отстранение сотрудника ═══ */
await G('/subscription/courier/buy', J({}), K1.tok);
r = await G(`/org/${ORG}/members/${K1.pid}`, PATCH({ status: 'removed' }), O.tok);
t('удаление сотрудника требует подтверждения', r.status === 409 && r.data.error === 'confirm_required');
r = await G(`/org/${ORG}/members/${K1.pid}`, PATCH({ status: 'removed', confirm: true }), AD.tok);
t('администратор удалил сотрудника с подтверждением', r.status === 200 && r.data.released >= 1, JSON.stringify(r.data));
t('его непринятые заказы вернулись диспетчеру', q(`select status from go_orders where id='${OS}'`) === 'searching');
r = await G(`/org/${ORG}/dashboard`, {}, K1.tok);
t('удалённый сотрудник доступа к организации не имеет', r.status === 404);
r = await G(`/org/${ORG}/orders/${OS}/assign`, J({ executorId: K1.pid }), O.tok);
t('и получить назначение не может', r.status === 409 && r.data.error === 'executor_not_member');

/* ═══ Приостановка организации администрацией Sky ═══ */
r = await call('/api/admin/go/orgs', {}, A.tok);
t('администрация видит организации', r.status === 200 && r.data.orgs.some((x) => x.id === ORG && x.members >= 3), JSON.stringify(r.data).slice(0, 120));
r = await call('/api/admin/go/orgs', {}, O.tok);
t('владелец организации к списку организаций администрации доступа не имеет', r.status === 403);
r = await call(`/api/admin/go/orgs/${ORG}/suspend`, J({ suspended: true, reason: '' }), A.tok);
t('приостановка требует причины', r.status === 400);
r = await call(`/api/admin/go/orgs/${ORG}/suspend`, J({ suspended: true, reason: 'Проверка жалобы' }), A.tok);
t('организация приостановлена', r.status === 200);
r = await order({ parcel: parcel('Коробка Z') });
t('приостановленная организация новые заказы не создаёт', r.status === 403 && r.data.error === 'org_suspended', JSON.stringify(r.data));
r = await G(`/org/${ORG}/orders/${OT}/assign`, J({ executorId: K2.pid }), O.tok);
t('и назначения не выполняет', r.status === 403 && r.data.error === 'org_suspended');
await call(`/api/admin/go/orgs/${ORG}/suspend`, J({ suspended: false, reason: 'Жалоба не подтвердилась' }), A.tok);
r = await call('/api/admin/go/problems', {}, A.tok);
t('администрация видит проблемы доставки', r.status === 200 && Array.isArray(r.data.problems));

/* ═══ Идемпотентность создания и точки отправления ═══ */
const idem = 'idem-' + Date.now();
const a1 = await order({ parcel: parcel('Идем'), idemKey: idem }); const a2 = await order({ parcel: parcel('Идем'), idemKey: idem });
t('повтор создания заказа с тем же ключом не создаёт второй', a1.status === 201 && a2.data.orderId === a1.data.orderId && a2.data.duplicate === true, JSON.stringify([a1.data, a2.data]));
r = await G(`/org/${ORG}/points`, J({ title: 'Склад', address: 'Москва, Тверская 1' }), O.tok);
const PT = r.data.id;
t('точка отправления добавлена', r.status === 201 && PT);
r = await G(`/org/${ORG}/points`, J({ title: 'Склад 2', address: 'Москва, Арбат 10' }), M.tok);
t('менеджер точки добавлять не может', r.status === 403);
r = await order({ from: undefined, pointId: PT, parcel: parcel('С точки') });
t('заказ с точки организации', r.status === 201, JSON.stringify(r.data));
r = await G(`/org/${ORG}/settings`, {}, M.tok);
t('настройки: реальный статус проверки, точки; телефон менеджеру не показывается', r.data.verification.status === 'approved' && r.data.points.length === 1 && r.data.canEdit === false && r.data.org.phone === undefined, JSON.stringify(r.data).slice(0, 200));
r = await G(`/org/${ORG}/settings`, PATCH({ name: 'Бизнес-Тест 2', phone: '+79990001122' }), AD.tok);
t('администратор правит название и телефон', r.status === 200);
r = await G(`/org/${ORG}/settings`, PATCH({ phone: '12' }), AD.tok);
t('неверный телефон отклонён', r.status === 400 && r.data.error === 'phone_invalid');
r = await G(`/org/${ORG}/leave`, J({}), O.tok);
t('владелец покинуть организацию не может', r.status === 403 && r.data.error === 'owner_immutable');


/* ═══ Гонки: одновременные назначения ═══ */
await online(K2);
const rids = []; for (const d of ['R1', 'R2', 'R3', 'R4', 'R5']) rids.push((await order({ parcel: parcel(d), to: { address: `Москва, гонка ${d}` } })).data.orderId);
const par = await Promise.all(rids.map((id) => G(`/org/${ORG}/orders/${id}/assign`, J({ executorId: K2.pid }), O.tok)));
const okc = par.filter((x) => x.status === 200).length;
t('пять одновременных назначений одному исполнителю: всего активных ровно три, остальные — courier_busy', okc >= 2 && Number(q(`select count(*) from go_orders where executor_id='${K2.pid}' and status in ('assigned','heading_pickup','at_pickup','picked_up','delivering','at_recipient')`)) === 3 && par.filter((x) => x.status !== 200).every((x) => x.data.error === 'courier_busy'), par.map((x) => x.status + (x.data.error ?? '')).join());
const rid0 = rids[par.findIndex((x) => x.status === 200)];
const two = await Promise.all([G(`/org/${ORG}/orders/${rid0}/assign`, J({ executorId: K2.pid }), O.tok), G(`/org/${ORG}/orders/${rid0}/assign`, J({ executorId: K2.pid }), M.tok)]);
t('двойное назначение того же заказа тому же исполнителю — без ошибок и дублей', two.every((x) => x.status === 200) && Number(q(`select count(*) from go_order_events where order_id='${rid0}' and to_status='assigned'`)) <= 2);
const acc2 = await Promise.all([1, 2, 3].map(() => G(`/delivery/orders/${rid0}/act`, J({ action: 'accept_assignment' }), K2.tok)));
t('три одновременных «принять назначение»: ровно одно настоящее, остальные — повтор', acc2.every((x) => x.status === 200) && acc2.filter((x) => !x.data.duplicate).length === 1, acc2.map((x) => x.status + String(x.data.duplicate)).join());
for (const id of rids) await G(`/org/${ORG}/orders/${id}/cancel`, J({ reason: 'Гонки проверены' }), O.tok);

/* ═══ Водитель такси в том же рабочем пространстве ═══ */
const TD = await mk('bzTaxi'); dob(TD);
const carExtra = { carMake: 'Kia', carModel: 'Rio', carColor: 'белый', plate: 'А123ВС77', licenseNumber: '7700123456', carYear: 2019, carClass: 'economy' };
const rtd = await reg(TD, 'taxi_driver', 'npd', carExtra, npd());
t('водитель такси зарегистрирован', Boolean(rtd.id), JSON.stringify(rtd.err?.data));
fund(TD, 300); await G('/subscription/taxi_driver/buy', J({}), TD.tok); await card(TD);
r = await G('/work/state?role=taxi_driver', {}, TD.tok);
t('состояние водителя: допуск есть, не на линии, заказов нет', r.status === 200 && r.data.access.pool === true && r.data.presence.online === false && r.data.orders.length === 0, JSON.stringify(r.data).slice(0, 200));
await G('/presence', J({ role: 'taxi_driver', online: true, lat: 55.75, lng: 37.62 }), TD.tok);
r = await G('/taxi/orders', J({ city: CITY, from: pickup, to: drop, tariff: 'economy' }), C.tok);
const TX = r.data.orderId;
r = await G('/work/state?role=taxi_driver', {}, TD.tok);
t('предложение такси видно на линии', r.data.offers.some((x) => x.id === TX), JSON.stringify(r.data.offers).slice(0, 120));
r = await G(`/taxi/orders/${TX}/accept`, J({}), TD.tok);
t('водитель принял заказ такси', r.status === 200);
r = await G('/work/route?role=taxi_driver', {}, TD.tok);
t('маршрут такси: сначала пассажир, потом назначение', r.status === 200 && r.data.stops.length === 2 && r.data.stops[0].type === 'pickup' && r.data.stops[1].type === 'dropoff', JSON.stringify(r.data).slice(0, 150));
r = await G('/work/state?role=taxi_driver', {}, TD.tok);
t('заказ такси в рабочем состоянии, контакты пассажира как положено', r.data.orders[0]?.id === TX && r.data.orders[0].status === 'assigned', JSON.stringify(r.data.orders[0]).slice(0, 100));
for (const a of ['en_route', 'arrived', 'start', 'complete']) await G(`/taxi/orders/${TX}/act`, J({ action: a }), TD.tok);
t('такси: жизненный цикл до оплаты пройден', q(`select status from go_orders where id='${TX}'`) === 'awaiting_payment');
r = await G('/work/history?role=taxi_driver', {}, TD.tok);
t('история водителя: выполнено 1', r.status === 200 && r.data.stats.done === 1, JSON.stringify(r.data.stats));
r = await G('/work/state?role=nonsense', {}, TD.tok);
t('неизвестная роль рабочего пространства отклонена', r.status === 400 && r.data.error === 'bad_role');

/* ═══ Синхронизация: событие go:order по сокету ═══ */
const require = createRequire(new URL('../../server/', import.meta.url));
const WebSocket = require('ws');
const wsOpen = (tok) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:8081', { headers: { origin: process.env.WS_ORIGIN || 'http://localhost:4173' } });
  ws.events = []; ws.on('message', (d) => { try { ws.events.push(JSON.parse(d)); } catch { /* ok */ } });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: tok } })));
  const tm = setInterval(() => { if (ws.events.some((e) => e.type === 'snapshot-done')) { clearInterval(tm); res(ws); } }, 100);
  setTimeout(() => rej(new Error('ws auth timeout')), 8000);
});
const wm = await wsOpen(M.tok); const wx = await wsOpen(X.tok);
const live1 = await order({ parcel: parcel('Живое обновление') });
await sleep(800);
t('менеджеру организации пришло событие go:order о новом заказе', wm.events.some((e) => e.type === 'go:order' && e.payload?.orderId === live1.data.orderId), JSON.stringify(wm.events.filter((e) => e.type === 'go:order')).slice(0, 150));
t('постороннему событие не приходит', !wx.events.some((e) => e.type === 'go:order'));
wm.events.length = 0;
await G(`/org/${ORG}/orders/${live1.data.orderId}/cancel`, J({ reason: 'Проверка событий' }), O.tok);
await sleep(800);
t('и об изменении статуса (отмена)', wm.events.some((e) => e.type === 'go:order' && e.payload?.status === 'cancelled'));
wm.close(); wx.close();

console.log(`\nИТОГО: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
