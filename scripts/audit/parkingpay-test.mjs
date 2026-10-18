// Sky Parking, этап B. API с ADMIN_GATE=off OWNER_USERNAME=ownertest PARKING_RATE_MULT=50
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const J = (b, method = 'POST') => ({ method, body: JSON.stringify(b) });
const P = (p, o, tok) => call('/api/parking' + p, o ?? {}, tok);
const AD = (p, o, tok) => call('/api/admin/parking' + p, o ?? {}, tok);
const bal = (u) => Number(q(`select balance from wallet_accounts where user_id='${u.pid}'`) || 0);
const fund = (u, n) => q(`insert into wallet_accounts(user_id, balance) values ('${u.pid}', ${n}) on conflict (user_id) do update set balance=${n}`);

const mod = await mkuser(S, 'pbMod'); q(`update profiles set is_admin=true, admin_role='parking_admin' where id='${mod.pid}'`);
const own = await mkuser(S, 'pbOwn'), usr = await mkuser(S, 'pbUsr'), usr2 = await mkuser(S, 'pbUsr2'), out = await mkuser(S, 'pbOut');
let r = await P('/orgs', J({ name: 'Паркинг-Тест' }), own.tok); const org = r.data.id;
r = await P(`/orgs/${org}/lots`, J({ title: 'Двор тест', city: 'Москва', address: 'Тверская 1', lat: 55.76, lng: 37.61, spacesTotal: 2 }), own.tok); const lot = r.data.id;
r = await P(`/my/lots/${lot}/tariffs`, J({ kind: 'hourly', priceRub: 100, freeMinutes: 0, minMinutes: 15, maxMinutes: 600 }), own.tok); const tar = r.data.id;
await P(`/my/lots/${lot}/submit`, J({}), own.tok);
r = await AD(`/lots/${lot}/approve`, J({}), mod.tok); t('парковка опубликована', r.data.ok, r.data);

r = await P('/vehicles', J({ plate: 'a1' }), usr.tok); t('плохой номер', r.data.error === 'bad_plate', r.data);
r = await P('/vehicles', J({ plate: 'А123ВС77' }), usr.tok); t('машина добавлена', r.status === 201, r.data); const veh = r.data.id;
r = await P('/vehicles', J({ plate: 'а123 вс-77' }), usr.tok); t('дубль номера', r.data.error === 'vehicle_exists', r.data);
r = await P('/vehicles', null, usr.tok); t('номер виден владельцу', r.data.vehicles[0].plate === 'А123ВС77', r.data);
t('номер в БД зашифрован', !q(`select plate_enc from parking_vehicles where id='${veh}'`).includes('123'));
r = await P('/vehicles', null, usr2.tok); t('чужие машины не видны', r.data.vehicles.length === 0, r.data);

const idem = 'idem-' + Date.now();
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: veh, idemKey: idem }), usr.tok); t('без денег — 402', r.status === 402 && r.data.costRub === 200, r.data);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: veh }), usr.tok); t('без ключа идемпотентности отказ', r.data.error === 'idem_required', r.data);
fund(usr, 1000);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: 'pkv-chuzhoy', idemKey: idem + 'x' }), usr.tok); t('чужая/неверная машина', r.data.error === 'vehicle_required', r.data);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 5, vehicleId: veh, idemKey: idem + 'y' }), usr.tok); t('слишком коротко', r.data.error === 'duration_too_short', r.data);
const par = await Promise.all([1, 2, 3].map(() => P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 120, vehicleId: veh, idemKey: idem }), usr.tok)));
t('параллельный повтор: одно списание', bal(usr) === 800 && par.filter((x) => x.data.ok).length === 3 && new Set(par.map((x) => x.data.sessionId)).size === 1, par.map((x) => x.data));
const sid = par[0].data.sessionId, pay = par[0].data.paymentId;
t('одна сессия в БД', q(`select count(*) from parking_sessions where profile_id='${usr.pid}'`) === '1');
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: veh, idemKey: idem + 'z' }), usr.tok); t('на той же машине вторая сессия нельзя', r.data.error === 'vehicle_in_use', r.data);
t('баланс не тронут отказом', bal(usr) === 800);
r = await P('/sessions', null, usr.tok); t('моя сессия активна', r.data.sessions[0].status === 'active' && r.data.sessions[0].secondsLeft > 7100 && r.data.sessions[0].payments.length === 1, r.data);
r = await P('/sessions', null, usr2.tok); t('чужие сессии не видны', r.data.sessions.length === 0, r.data);
r = await P(`/sessions/${sid}/extend-quote?minutes=60`, null, usr.tok); t('котировка продления 100', r.data.costRub === 100, r.data);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 60, idemKey: idem + 'e1' }), usr2.tok); t('чужую сессию не продлить', r.status === 404, r.data);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 60, idemKey: idem + 'e1' }), usr.tok); t('продление', r.data.ok && r.data.amountRub === 100, r.data);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 60, idemKey: idem + 'e1' }), usr.tok); t('повтор продления без списания', r.data.duplicate && bal(usr) === 700, r.data);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 600, idemKey: idem + 'e2' }), usr.tok); t('сверх максимума', r.data.error === 'duration_too_long', r.data);
// места: 2. вторая и третья машина
const v2 = (await P('/vehicles', J({ plate: 'В777АА99' }), usr2.tok)).data.id; fund(usr2, 500);
const v3 = (await P('/vehicles', J({ plate: 'С555ТТ50' }), out.tok)).data.id; fund(out, 500);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: v2, idemKey: idem + 'u2' }), usr2.tok); t('вторая машина занимает место', r.data.ok, r.data);
const sid2 = r.data.sessionId, pay2 = r.data.paymentId;
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: v3, idemKey: idem + 'u3' }), out.tok); t('мест нет', r.data.error === 'lot_full', r.data);
t('при отказе деньги не списаны', bal(out) === 500);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: v3, idemKey: idem + 'own' }), own.tok); t('в своей парковке нельзя', r.data.error === 'own_lot' || r.data.error === 'vehicle_required', r.data);

// возвраты
r = await P(`/payments/${pay2}/refund`, J({ reason: 'x' }), usr2.tok); t('возврат без причины', r.data.error === 'reason_required', r.data);
r = await P(`/payments/${pay2}/refund`, J({ reason: 'Уехал сразу, места были заняты' }), usr.tok); t('чужой платёж — 404', r.status === 404, r.data);
r = await P(`/payments/${pay2}/refund`, J({ reason: 'Уехал сразу, места были заняты' }), usr2.tok); t('запрос возврата', r.status === 201, r.data);
r = await P(`/payments/${pay2}/refund`, J({ reason: 'Уехал сразу, места были заняты' }), usr2.tok); t('второй запрос — 409', r.data.error === 'refund_exists', r.data);
const rid = q(`select id from parking_refunds where payment_id='${pay2}'`);
r = await P(`/refunds/${rid}/approve`, J({}), usr2.tok); t('свой возврат не решить', r.status === 404 || r.data.error === 'self_review', r.data);
r = await P(`/refunds/${rid}/approve`, J({}), usr.tok); t('посторонний не решает', r.status === 404, r.data);
r = await P(`/orgs/${org}/refunds`, null, own.tok); t('владелец видит запрос', r.data.refunds.length === 1, r.data);
const results = await Promise.all([1, 2].map(() => P(`/refunds/${rid}/approve`, J({}), own.tok)));
t('одобрение: зачислено один раз', bal(usr2) === 500 && results.filter((x) => x.data.ok).length === 1, results.map((x) => x.data));
r = await P('/sessions', null, usr2.tok); t('сессия прекращена возвратом', r.data.sessions[0].status === 'cancelled' && r.data.sessions[0].payments[0].status === 'refunded', r.data);
r = await P('/sessions', J({ lotId: lot, tariffId: tar, minutes: 60, vehicleId: v3, idemKey: idem + 'u4' }), out.tok); t('место освободилось', r.data.ok, r.data);
r = await P(`/orgs/${org}/sessions`, null, own.tok); t('организация видит сессии и итоги', r.data.sessions.length >= 3 && r.data.totals.refundedRub === 100 && /Выплат/.test(r.data.totals.note), r.data);
r = await P(`/orgs/${org}/sessions`, null, usr.tok); t('посторонний не видит сессии организации', r.status === 404, r.data);

// жалобы
r = await P(`/lots/${lot}/report`, J({ reason: 'nonsense' }), usr.tok); t('плохая причина жалобы', r.data.error === 'bad_reason', r.data);
r = await P(`/lots/${lot}/report`, J({ reason: 'closed', note: 'Шлагбаум закрыт' }), usr.tok); t('жалоба', r.status === 201, r.data);
r = await P(`/lots/${lot}/report`, J({ reason: 'closed' }), usr.tok); t('повторная жалоба', r.data.error === 'already_reported', r.data);
r = await AD('/reports', null, usr.tok); t('жалобы — только модерации', r.status === 403, r.data);
r = await AD('/reports', null, mod.tok); const rep = r.data.reports?.[0];
t('очередь жалоб', !!rep, r.data);
r = await AD(`/reports/${rep.id}/resolve`, J({ resolution: 'Проверено, шлагбаум работает' }), mod.tok); t('жалоба закрыта', r.data.ok, r.data);

// окончание сессии
q(`update parking_sessions set ends_at = now() - interval '1 minute' where id='${sid}'`);
r = await P('/sessions', null, usr.tok); t('истёкшая сессия — ended', r.data.sessions[0].status === 'ended' && r.data.sessions[0].secondsLeft === 0, r.data);
r = await P(`/sessions/${sid}/extend`, J({ minutes: 60, idemKey: idem + 'e9' }), usr.tok); t('закончившуюся не продлить', r.data.error === 'session_ended', r.data);
t('журнал кошелька сходится', Number(q(`select coalesce(sum(amount),0) from wallet_transactions where user_id='${usr.pid}' and type='parking'`)) === -300);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
