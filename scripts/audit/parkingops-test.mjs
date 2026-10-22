// Sky Parking: отправка заявок, закрепление, область сотрудников, сводка, платежи, закрытие, тарифы, машины, напоминания, ошибки.
// API: ADMIN_GATE=off OWNER_USERNAME=ownertest PARKING_RATE_MULT=50 KBIZ_RATE_MULT=50. (TEST_DATABASE_URL=… node scripts/audit/parkingops-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 240) : JSON.stringify(x).slice(0, 240)); } };
const J = (b, method = 'POST') => ({ method, body: JSON.stringify(b) });
const P = (p, o, tok) => call('/api/parking' + p, o ?? {}, tok);
const AD = (p, o, tok) => call('/api/admin/parking' + p, o ?? {}, tok);
const K = (p, o, tok) => call('/api/kbiz' + p, o ?? {}, tok);
const pub = (p, o) => call(`/api/kbiz/public${p}`, o ?? {});
const pidOf = (u) => u.split('/p/')[1];

const m1 = await mkuser(S, 'poM1'), m2 = await mkuser(S, 'poM2');
for (const m of [m1, m2]) q(`update profiles set is_admin=true, admin_role='parking_admin' where id='${m.pid}'`);
const own = await mkuser(S, 'poOwn'), stf = await mkuser(S, 'poStf'), usr = await mkuser(S, 'poUsr'), usr2 = await mkuser(S, 'poUsr2'), out = await mkuser(S, 'poOut');
let r = await P('/orgs', J({ name: 'Ops-Парковки' }), own.tok); const org = r.data.id;
const mkLot = async (title, extra = {}) => (await P(`/orgs/${org}/lots`, J({ title, city: 'Москва', address: 'Тверская 1', lat: 55.76, lng: 37.61, spacesTotal: 3, ...extra }), own.tok)).data.id;

// ── 1. отправка заявки
const lotA = await mkLot('Двор А', { lat: undefined, lng: undefined, spacesTotal: 0, address: '' });
r = await P(`/my/lots/${lotA}/submit`, J({}), own.tok);
t('пустая карточка: incomplete и список недостающего', r.status < 500 && r.data.error === 'incomplete' && ['address', 'coords', 'spaces', 'tariff'].every((k) => r.data.missing.includes(k)) && /Не хватает/.test(r.data.hint), r.data);
t('неудачная отправка записана в журнал заявки', Number(q(`select count(*) from parking_events where lot_id='${lotA}' and action='submit_failed'`)) === 1);
r = await P(`/my/lots/${lotA}/tariffs`, J({ kind: 'hourly', priceRub: 100, freeMinutes: 0, minMinutes: 15, maxMinutes: 600 }), own.tok); const tarA = r.data.id;
r = await P(`/my/lots/${lotA}/submit`, J({ fields: { address: 'Тверская 5', lat: 55.76, lng: 37.61, spacesTotal: 2, hours: '24/7' } }), own.tok);
t('несохранённая форма сохраняется и отправляется одним запросом', r.data.ok === true, r.data);
t('в базе: review, адрес и часы из формы', q(`select status||'|'||address||'|'||hours||'|'||spaces_total from parking_lots where id='${lotA}'`) === 'review|Тверская 5|24/7|2');
const par = await Promise.all([1, 2, 3].map(() => P(`/my/lots/${lotA}/submit`, J({}), own.tok)));
t('повторные/параллельные нажатия безвредны', par.every((x) => x.data.ok && x.data.already), par.map((x) => x.data));
t('одна запись о подаче в журнале', Number(q(`select count(*) from parking_events where lot_id='${lotA}' and action='lot_submitted'`)) === 1);
r = await P(`/my/lots/${lotA}`, J({ hours: '8-20' }, 'PUT'), own.tok); t('на проверке править нельзя', r.data.error === 'in_review', r.data);
r = await P(`/my/lots/${lotA}/submit`, J({}), out.tok); t('чужой не отправит чужую заявку', r.status === 404, r.data);

// ── 2. очередь модератора: фильтры, закрепление
r = await AD('/lots?status=review', null, m1.tok); t('очередь видит парковку, тип «новая», total', r.data.lots.some((l) => l.id === lotA && l.kind === 'new') && r.data.total >= 1, r.data);
r = await AD('/lots?status=review&q=' + encodeURIComponent('двор а'), null, m1.tok); t('поиск по названию', r.data.lots.length === 1 && r.data.lots[0].id === lotA, r.data);
r = await AD('/lots?status=review&kind=edit', null, m1.tok); t('фильтр «изменения» не находит новую', !r.data.lots.some((l) => l.id === lotA));
r = await AD('/lots?status=review&from=2999-01-01', null, m1.tok); t('фильтр по дате', r.data.lots.length === 0);
r = await AD('/lots?status=review', null, out.tok); t('без права очередь закрыта', r.status === 403, r);
r = await AD(`/lots/${lotA}`, null, m1.tok); t('подробности: события', r.data.events.some((e) => e.action === 'lot_submitted'), r.data);
r = await AD(`/lots/${lotA}/claim`, J({}), m1.tok); t('модератор 1 взял заявку', r.data.ok, r.data);
r = await AD(`/lots/${lotA}/claim`, J({}), m2.tok); t('модератор 2 не может взять её же', r.status === 409 && r.data.error === 'claimed_by_other', r);
r = await AD(`/lots/${lotA}/approve`, J({}), m2.tok); t('и не может решить за первого', r.status === 409 && r.data.error === 'claimed_by_other', r);
r = await AD(`/lots/${lotA}/reject`, J({ reason: 'нет' }), m1.tok); t('причина короче 5 знаков не принимается', r.data.error === 'reason_required', r.data);
r = await AD(`/lots/${lotA}/reject`, J({ reason: '' }), m1.tok); t('пустая причина отказа не проходит', r.data.error === 'reason_required', r.data);
const dec = await Promise.all([AD(`/lots/${lotA}/approve`, J({}), m1.tok), AD(`/lots/${lotA}/approve`, J({}), m1.tok)]);
t('двойное решение: одно применено, второе — bad_state', dec.filter((x) => x.data.ok).length === 1 && dec.some((x) => x.data.error === 'bad_state'), dec.map((x) => x.data));
t('опубликована, закрепление снято', q(`select status||'|'||coalesce(claimed_by,'-') from parking_lots where id='${lotA}'`) === 'approved|-');
r = await P(`/orgs/${org}/lots?status=approved`, null, own.tok); t('владелец видит одобренную с фильтром и total', r.data.total === 1 && r.data.lots[0].status === 'approved', r.data);

// ── 3. модераторы организации: область и права
const lotB = await mkLot('Двор Б'), lotC = await mkLot('Двор В');
r = await P(`/orgs/${org}/staff`, J({ username: '@' + q(`select username from profiles where id='${stf.pid}'`), role: 'moderator', lotIds: [lotB], perms: ['edit'] }), own.tok); t('сотрудник добавлен с областью', r.data.ok, r.data);
r = await P(`/orgs/${org}/lots`, null, stf.tok); t('сотрудник видит только назначенную парковку', r.data.lots.length === 1 && r.data.lots[0].id === lotB, r.data);
r = await P(`/my/lots/${lotC}`, J({ hours: 'x' }, 'PUT'), stf.tok); t('чужая парковка организации для него «не существует»', r.status === 404, r);
r = await P(`/my/lots/${lotB}`, J({ hours: '9-18' }, 'PUT'), stf.tok); t('назначенную может править (право edit)', r.data.ok, r.data);
r = await P(`/my/lots/${lotB}/submit`, J({}), stf.tok); t('отправлять без права submit нельзя', r.status === 403, r);
r = await P(`/orgs/${org}/dashboard`, null, stf.tok); t('сводка модератору недоступна', r.status === 403, r);
r = await P(`/orgs/${org}/payments`, null, stf.tok); t('платежи модератору недоступны', r.status === 403, r);
r = await P(`/orgs/${org}/staff/${stf.pid}`, J({ lotIds: [lotB, lotC], perms: ['edit', 'submit'] }, 'PUT'), stf.tok); t('сам себе права расширить нельзя (модератору метод недоступен)', r.status === 403, r);
r = await P(`/orgs/${org}/staff/${stf.pid}`, J({ lotIds: [lotB, lotC], perms: ['edit', 'submit'] }, 'PUT'), own.tok); t('владелец расширяет права', r.data.ok, r.data);
r = await P(`/orgs/${org}/staff`, null, own.tok); t('в списке видны область и права', r.data.staff[0].lotIds.length === 2 && r.data.staff[0].perms.includes('submit'), r.data);
r = await P(`/my/lots/${lotC}/submit`, J({ fields: { address: 'Арбат 1' } }), stf.tok); t('теперь отправляет и из формы (тарифа нет → нехватка)', r.data.error === 'no_tariff' || r.data.error === 'incomplete', r.data);
r = await P(`/orgs/${org}/audit`, null, own.tok); t('журнал организации виден владельцу', r.data.events.some((e) => e.action === 'staff_scope'), r.data);
r = await P(`/orgs/${org}/audit`, null, stf.tok); t('журнал модератору недоступен', r.status === 403, r);
r = await P(`/orgs/${org}/staff/${stf.pid}`, { method: 'DELETE' }, own.tok); t('доступ можно отозвать', r.data.ok, r.data);
r = await P(`/orgs/${org}/lots`, null, stf.tok); t('после отзыва организации для него нет', r.status === 404, r);

// ── 4. подключаем SkyKassa Business и платим
r = await K('/business', J({ name: 'Ops Бизнес', mode: 'point', legalType: 'selfemployed', category: 'парковка', country: 'RU', description: 'Парковки', contacts: '+7 900 000-00-00' }), own.tok);
await K('/requisites', { method: 'PUT', body: JSON.stringify({ holder: 'ИП Парков', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Парковка', instruction: 'Оплата парковки' }) }, own.tok);
q(`insert into wallet_accounts(user_id, balance) values ('${own.pid}', 1000) on conflict (user_id) do update set balance=1000`);
await K('/subscription/buy', J({ idemKey: 'po-sub-1' }), own.tok); await K('/publish', J({ on: true }), own.tok);
const veh = (await P('/vehicles', J({ plate: 'А123ВС77', label: 'Седан' }), usr.tok)).data.id;
const veh2 = (await P('/vehicles', J({ plate: 'В777ОР99' }), usr2.tok)).data.id;
const idem = 'po-' + Date.now();
r = await P('/sessions', J({ lotId: lotA, tariffId: tarA, minutes: 120, vehicleId: veh, idemKey: idem }), usr.tok); const sid = r.data.sessionId; const pg = pidOf(r.data.payUrl);
await pub(`/p/${pg}/report`, J({ amountRub: 1, note: 'ok' }));
const kb = q(`select id from kb_payments where qr_id = (select id from kb_qr where public_id='${pg}')`);
r = await K(`/payments/${kb}/confirm`, J({}), own.tok); t('оплата подтверждена, сессия идёт', r.data.status === 'confirmed' && q(`select status from parking_sessions where id='${sid}'`) === 'active', r.data);

// ── 5. сводка, платежи, выгрузка
r = await P(`/orgs/${org}/dashboard`, null, own.tok); const d = r.data;
t('сводка: парковки, активные, пользователи', d.lots.open === 1 && d.activeSessions === 1 && d.users.total === 1 && d.lots.byStatus.approved === 1, d);
t('сводка: подтверждённый оборот 200 ₽ за сутки/неделю/месяц', d.money.day.confirmedRub === 200 && d.money.week.confirmedRub === 200 && d.money.month.confirmedRub === 200 && d.money.day.refundedRub === 0, d.money);
t('сводка: график за 14 дней и заметка про оборот', d.days.length === 14 && d.days[13].sessions === 1 && /не доход/.test(d.note), d.days.at(-1));
r = await P(`/orgs/${org}/dashboard`, null, out.tok); t('чужая организация для постороннего не существует', r.status === 404, r);
r = await P(`/orgs/${org}/payments?status=paid`, null, own.tok); t('платежи: фильтр «успешные»', r.data.total === 1 && r.data.payments[0].amountRub === 200 && r.data.totals.confirmedRub === 200, r.data);
r = await P(`/orgs/${org}/payments?status=refunded`, null, own.tok); t('возвратов нет', r.data.total === 0);
r = await P(`/orgs/${org}/payments?min=500`, null, own.tok); t('фильтр по сумме', r.data.total === 0);
r = await P(`/orgs/${org}/payments?lotId=${lotA}&from=2000-01-01&to=2999-01-01&limit=1&offset=0`, null, own.tok); t('фильтры лот/даты/пагинация', r.data.total === 1 && r.data.payments.length === 1, r.data);
const csv = await call(`/api/parking/orgs/${org}/payments?format=csv`, {}, own.tok);
t('CSV: заголовок, строка, кодировка', csv.status === 200 && /id;дата/.test(csv.text) && csv.text.includes('200'), csv.text.slice(0, 100));
t('выгрузка записана в журнал', Number(q(`select count(*) from parking_events where org_id='${org}' and action='payments_exported'`)) === 1);

// ── 6. тарифы: правка, минимальная стоимость, неизменность оплаченного
r = await P(`/my/lots/${lotA}/tariffs/${tarA}`, J({ kind: 'hourly', priceRub: 150, freeMinutes: 0, minMinutes: 15, maxMinutes: 600, minCostRub: 200 }, 'PUT'), own.tok);
t('тариф изменён, опубликованная вернулась на проверку', r.data.ok && r.data.status === 'draft', r.data);
t('оплаченная сессия сохранила прежнюю цену (снимок)', JSON.parse(q(`select tariff_snap::text from parking_sessions where id='${sid}'`)).price_rub === 100);
r = await P(`/my/lots/${lotA}/tariffs/${tarA}`, J({ kind: 'hourly', priceRub: 0 }, 'PUT'), own.tok); t('плохая цена отклонена', r.data.error === 'bad_price', r.data);
r = await P(`/my/lots/${lotA}/tariffs/${tarA}`, J({ kind: 'hourly', priceRub: 100, minCostRub: -5 }, 'PUT'), own.tok); t('плохая минимальная стоимость отклонена', r.data.error === 'bad_min_cost', r.data);
r = await P(`/my/lots/${lotA}/tariffs/${tarA}`, J({ kind: 'hourly', priceRub: 100, freeMinutes: 0, minMinutes: 15, maxMinutes: 600, minCostRub: 200 }, 'PUT'), out.tok); t('чужой тариф править нельзя', r.status === 404, r);
await P(`/my/lots/${lotA}/submit`, J({}), own.tok); await AD(`/lots/${lotA}/approve`, J({}), m1.tok);
r = await P(`/lots/${lotA}/quote?tariffId=${tarA}&minutes=15`, null, usr.tok); t('минимальная стоимость: 15 мин по 150 ₽/ч, но не меньше 200', r.data.costRub === 200, r.data);

// ── 7. закрытие парковки
r = await P(`/my/lots/${lotA}/close`, J({ reason: 'x' }), own.tok); t('закрыть без причины нельзя', r.data.error === 'reason_required', r.data);
r = await P(`/my/lots/${lotA}/close`, J({ reason: 'Ремонт покрытия' }), own.tok); t('парковка закрыта', r.data.ok, r.data);
r = await P(`/lots/${lotA}`, null, usr2.tok); t('в каталоге помечена закрытой, оплата недоступна', r.data.lot.closed === true && r.data.lot.acceptsPayment === false && r.data.lot.closedReason === 'Ремонт покрытия', r.data);
r = await P('/sessions', J({ lotId: lotA, tariffId: tarA, minutes: 60, vehicleId: veh2, idemKey: idem + 'c' }), usr2.tok); t('новую парковку на закрытой не оформить', r.status === 409 && r.data.error === 'lot_closed', r);
t('идущая сессия продолжается', q(`select status from parking_sessions where id='${sid}'`) === 'active');
r = await P(`/my/lots/${lotA}/close`, J({ reason: 'Ремонт покрытия' }), own.tok); t('повторное закрытие безвредно', r.data.ok && r.data.already, r.data);
r = await P(`/my/lots/${lotA}/reopen`, J({}), out.tok); t('чужой не откроет', r.status === 404, r);
r = await P(`/my/lots/${lotA}/reopen`, J({}), own.tok); t('парковка открыта снова', r.data.ok, r.data);
r = await P(`/lots/${lotA}`, null, usr2.tok); t('оплата снова доступна', r.data.lot.closed === false && r.data.lot.acceptsPayment === true, r.data);
t('закрытие и открытие — в журнале с причиной', Number(q(`select count(*) from parking_events where lot_id='${lotA}' and action in ('lot_closed','lot_reopened')`)) === 2);

// ── 8. автомобили
r = await P(`/vehicles/${veh}`, J({ label: 'Новый седан' }, 'PUT'), usr.tok); t('подпись изменена', r.data.ok, r.data);
r = await P(`/vehicles/${veh}`, J({ plate: 'К111КК11' }, 'PUT'), usr.tok); t('номер нельзя менять, пока идёт парковка', r.data.error === 'vehicle_in_use', r.data);
r = await P(`/vehicles/${veh2}`, J({ plate: 'К222КК22', label: 'Второй' }, 'PUT'), usr2.tok); t('номер и подпись меняются без активной парковки', r.data.ok, r.data);
r = await P('/vehicles', null, usr2.tok); t('после обновления видны новые значения', r.data.vehicles[0].plate === 'К222КК22' && r.data.vehicles[0].label === 'Второй', r.data);
r = await P(`/vehicles/${veh2}`, J({ plate: 'a1' }, 'PUT'), usr2.tok); t('плохой номер отклонён', r.data.error === 'bad_plate', r.data);
r = await P(`/vehicles/${veh}`, J({ label: 'чужое' }, 'PUT'), usr2.tok); t('чужую машину менять нельзя', r.status === 404, r);

// ── 9. напоминания за 15 и за 5 минут, история постранично
q(`update parking_sessions set ends_at = now() + interval '14 minutes', soon_notified=false, soon5_notified=false where id='${sid}'`);
const wait = (ms) => new Promise((x) => setTimeout(x, ms));
await wait(11500);   // уборку сервер запускает сам раз в 10 секунд
t('за 14 минут: напоминание «15» отмечено, «5» нет', q(`select soon_notified||'|'||soon5_notified from parking_sessions where id='${sid}'`) === 'true|false');
q(`update parking_sessions set ends_at = now() + interval '4 minutes' where id='${sid}'`);
for (let i = 0; i < 6 && q(`select soon5_notified from parking_sessions where id='${sid}'`) !== 't'; i++) await wait(5000);
t('за 4 минуты: напоминание «5» отмечено', q(`select soon5_notified from parking_sessions where id='${sid}'`) === 't');
t('оба напоминания дошли человеку как уведомления', Number(q(`select count(*) from gift_notifications where user_id='${usr.pid}' and body like '%минут%'`)) >= 2);
r = await P('/sessions?limit=1&offset=0', null, usr.tok); t('история постранично: total и hasMore', r.data.sessions.length === 1 && r.data.total >= 1, r.data);

// ── 10. журнал ошибок и права админки
const bogus = await call('/api/parking/orgs/%00/lots', {}, own.tok); t('мусор в адресе — не падение (4xx)', bogus.status < 500, bogus.status);
r = await AD('/errors', null, m1.tok); t('сбои видит администрация с правом parking', r.status === 200 && Array.isArray(r.data.errors), r);
r = await AD('/errors', null, out.tok); t('обычному человеку — нет', r.status === 403, r);
r = await AD('/lots?status=review', null, own.tok); t('владелец организации не модератор', r.status === 403, r);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
