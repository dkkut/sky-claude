// Передача магазина/ПВЗ другому аккаунту. API с ADMIN_GATE=off MV_WRITE_PER_MIN=500 MV_READ_PER_MIN=500 OWNER_USERNAME=ownertest
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const T = (p, o, tok) => call('/api/market/transfers' + p, o, tok);
const uname = async (u) => q(`select username from profiles where id='${u.pid}'`);

const tag = Date.now().toString(16).padStart(12, '0');
const A = await mkuser(S, 'trAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const O = await mkuser(S, 'trOwn'), N = await mkuser(S, 'trNew'), X = await mkuser(S, 'trOth'), P = await mkuser(S, 'trPvz');
const seller = (u, name, kind = 'ip', ver = 'approved') => q(`insert into market_sellers(profile_id, shop_name, verification_status, tax_kind, payment_details_enc, has_payment_details) values ('${u.pid}','${name}','${ver}','${kind}','secret',true)`);
seller(O, 'Магазин-передача');
q(`insert into market_products(id, seller_id, title, price_kop) values ('mp-aaaaaaaa-0000-0000-0000-${tag}','${O.pid}','Товар',10000)`);

/* Магазин */
let r = await T('', J({ kind: 'shop', toUsername: await uname(O) }), O.tok); t('себе передать нельзя', r.status === 409 && r.data.error === 'self_transfer', r.data);
r = await T('', J({ kind: 'shop', toUsername: 'no_such_user_zz' }), O.tok); t('получатель не найден', r.status === 404, r.data);
seller(X, 'Чужой магазин');
r = await T('', J({ kind: 'shop', toUsername: await uname(X) }), O.tok); t('у получателя уже есть магазин', r.data.error === 'target_has_shop', r.data);
r = await T('', J({ kind: 'shop', toUsername: await uname(O) }), N.tok); t('передать несуществующий магазин нельзя', r.data.error === 'not_found', r.data);
q(`insert into market_orders(id, buyer_id, seller_id, product_id, market_type, title_snap, price_kop, total_kop, status) select 'mo-open-${tag}','${X.pid}','${O.pid}', id, 'standard', 'Т', 10000, 10000, 'fulfillment' from market_products where seller_id='${O.pid}' limit 1`);
r = await T('', J({ kind: 'shop', toUsername: await uname(N) }), O.tok); t('с незавершённым заказом нельзя', r.data.error === 'has_active_orders', r.data);
q(`update market_orders set status='completed' where id='mo-open-${tag}'`);
r = await T('', J({ kind: 'shop', toUsername: await uname(N) }), O.tok); t('предложение создано', r.status === 200 && !!r.data.id, r.data);
const id = r.data.id;
r = await T('', J({ kind: 'shop', toUsername: await uname(N) }), O.tok); t('второе открытое предложение нельзя', r.data.error === 'transfer_open', r.data);
r = await T(`/${id}/accept`, J({}), X.tok); t('чужой не может принять', r.status === 404, r.data);
r = await T(`/${id}/approve`, J({}), A.tok); t('одобрить до принятия нельзя', r.data.error === 'wrong_state', r.data);
r = await T(`/${id}/approve`, J({}), O.tok); t('владелец сам одобрить не может', r.status === 403, r.data);
r = await T(`/${id}/accept`, J({}), N.tok); t('получатель принял', r.data.status === 'accepted', r.data);
r = await T('/admin?status=accepted', {}, O.tok); t('список очереди без прав закрыт', r.status === 403, r.data);
r = await T('/admin?status=accepted', {}, A.tok); t('админ видит очередь', r.status === 200 && r.data.items.some((x) => x.id === id), r.data);
r = await T(`/${id}/approve`, J({ comment: 'ок' }), A.tok); t('админ одобрил', r.status === 200 && r.data.status === 'approved', r.data);
t('магазин теперь у нового владельца', q(`select count(*) from market_sellers where profile_id='${N.pid}' and shop_name='Магазин-передача'`) === '1');
t('у прежнего магазина нет', q(`select count(*) from market_sellers where profile_id='${O.pid}'`) === '0');
t('товар и заказ перешли', q(`select count(*) from market_products where seller_id='${N.pid}'`) === '1' && q(`select count(*) from market_orders where seller_id='${N.pid}'`) === '1');
t('налоговый статус сброшен, реквизиты выплат стёрты', q(`select verification_status||'|'||coalesce(tax_kind,'-')||'|'||has_payment_details||'|'||coalesce(payment_details_enc,'-') from market_sellers where profile_id='${N.pid}'`) === 'none|-|false|-');
r = await T(`/${id}/approve`, J({}), A.tok); t('повторное одобрение нельзя', r.data.error === 'wrong_state', r.data);
r = await T('', {}, N.tok); t('новый владелец видит запись', r.data.items?.[0]?.status === 'approved', r.data);

/* Отказ получателя / отмена / отклонение */
seller(P, 'Магазин P');
r = await T('', J({ kind: 'shop', toUsername: await uname(O) }), P.tok); t('предложение P→O', r.status === 200, r.data);
const id2 = r.data.id;
r = await T(`/${id2}/decline`, J({}), O.tok); t('получатель отклонил', r.data.status === 'declined', r.data);
r = await T('', J({ kind: 'shop', toUsername: await uname(O) }), P.tok);
r = await T(`/${r.data.id}/cancel`, J({}), P.tok); t('отправитель отменил', r.data.status === 'cancelled', r.data);
r = await T('', J({ kind: 'shop', toUsername: await uname(O) }), P.tok); const id3 = r.data.id;
await T(`/${id3}/accept`, J({}), O.tok);
r = await T(`/${id3}/reject`, J({ comment: '' }), A.tok); t('отказ без причины нельзя', r.data.error === 'reason_required', r.data);
r = await T(`/${id3}/reject`, J({ comment: 'не подходит' }), A.tok); t('админ отклонил', r.data.status === 'rejected', r.data);
t('при отказе магазин остался у P', q(`select count(*) from market_sellers where profile_id='${P.pid}'`) === '1');

/* ПВЗ */
const pvz = `mpp-aaaaaaaa-0000-0000-0000-${tag}`;
const OW = await mkuser(S, 'trPvzOwn'), NP = await mkuser(S, 'trPvzNew'), NS = await mkuser(S, 'trPvzSimple');
seller(OW, 'Магазин владельца ПВЗ'); seller(NP, 'Магазин нового', 'ip'); seller(NS, 'Магазин НПД', 'npd');
q(`insert into market_pickup_points(id,title,city,address,active,owner_id,owner_status,owner_payment_details_enc,has_owner_payment_details) values ('${pvz}','ПВЗ-передача','Москва','ул. Тест',true,'${OW.pid}','active','pay',true)`);
q(`insert into market_pvz_staff(id,pvz_id,profile_id,role,permissions,added_by) values ('pzs-${tag}','${pvz}','${OW.pid}','owner','{}','${OW.pid}')`);
r = await T('', J({ kind: 'pvz', subjectId: pvz, toUsername: await uname(NS) }), OW.tok); t('получатель-НПД не подходит для ПВЗ', r.data.error === 'target_not_pvz_eligible', r.data);
r = await T('', J({ kind: 'pvz', subjectId: pvz, toUsername: await uname(NP) }), X.tok); t('чужой ПВЗ передать нельзя', r.data.error === 'not_found', r.data);
q(`update market_pickup_points set admin_blocked=true where id='${pvz}'`);
r = await T('', J({ kind: 'pvz', subjectId: pvz, toUsername: await uname(NP) }), OW.tok); t('заблокированный ПВЗ не передать', r.data.error === 'subject_blocked', r.data);
q(`update market_pickup_points set admin_blocked=false where id='${pvz}'`);
r = await T('', J({ kind: 'pvz', subjectId: pvz, toUsername: await uname(NP) }), OW.tok); t('предложение ПВЗ', r.status === 200, r.data);
const pid = r.data.id;
await T(`/${pid}/accept`, J({}), NP.tok);
r = await T(`/${pid}/approve`, J({}), A.tok); t('ПВЗ одобрен', r.data.status === 'approved', r.data);
t('владелец ПВЗ сменился, реквизиты стёрты', q(`select owner_id='${NP.pid}' and owner_payment_details_enc is null and not has_owner_payment_details from market_pickup_points where id='${pvz}'`) === 't');
t('роль owner: у нового активна, у старого снята', q(`select string_agg(profile_id||':'||status, ',' order by profile_id) from market_pvz_staff where pvz_id='${pvz}' and role='owner'`).includes(`${NP.pid}:active`) && q(`select status from market_pvz_staff where pvz_id='${pvz}' and profile_id='${OW.pid}'`) === 'revoked');
console.log(`\nИтого: ok=${ok} fail=${bad}`); process.exit(bad ? 1 : 0);
