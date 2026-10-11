// Денежные операции админки (server/adminmoney.mjs) против тестовой базы:
// правка баланса, откат операции, снятие Prime с возвратом, отзыв подарков, отмена подписки.
// Запуск: из каталога стенда с env.sh — node scripts/audit/adminmoney-test.mjs <каталог>
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const M = await import('../../server/adminmoney.mjs');
const { wallet } = await import('../../server/wallet.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, x); } };
const bal = (id) => Number(q(`select balance from wallet_accounts where user_id='${id}'`) || 0);
const pts = (id) => Number(q(`select points from wallet_accounts where user_id='${id}'`) || 0);

const U = Date.now().toString(36);
const A = await mkuser(S, 'AmA'); const B = await mkuser(S, 'AmB');

// ── правка баланса
let r = await M.adjustBalance(A.pid, 'money', 500, 'тест начисления', 'apa-t1');
t('начисление', r.ok && bal(A.pid) === 500, JSON.stringify(r));
r = await M.adjustBalance(A.pid, 'money', -200, 'тест списания', 'apa-t2');
t('списание', r.ok && bal(A.pid) === 300, JSON.stringify(r));
r = await M.adjustBalance(A.pid, 'money', -1000, 'слишком много', 'apa-t3');
t('списать больше, чем есть — отказ, баланс цел', r.error === 'insufficient_funds' && bal(A.pid) === 300, JSON.stringify(r));
r = await M.adjustBalance(A.pid, 'points', 100, 'баллы', 'apa-t4');
t('баллы начислены', r.ok && pts(A.pid) === 100);
r = await M.adjustBalance(A.pid, 'money', 0, 'x', 'apa-t5');
t('нулевая сумма отклонена', r.error === 'bad_amount');
const types = q(`select string_agg(distinct type, ',') from wallet_transactions where user_id='${A.pid}'`);
t('записи в истории помечены admin_adjust', types.includes('admin_adjust'), types);

// ── откат операции
await wallet.credit(A.pid, 400, 'topup', 'Пополнение для теста', null);       // +400 => 700
const topup = q(`select id from wallet_transactions where user_id='${A.pid}' and type='topup' order by created_at desc limit 1`);
const chk = await M.reversibleTx(A.pid, topup);
t('операция годна к откату', !chk.error);
r = await M.reverseTransaction(A.pid, topup, 'ошибочное пополнение', 'apa-r1');
t('откат прихода списывает', r.ok && bal(A.pid) === 300, JSON.stringify(r));
r = await M.reverseTransaction(A.pid, topup, 'ещё раз', 'apa-r2');
t('второй откат невозможен', r.error === 'already_reversed' && bal(A.pid) === 300, JSON.stringify(r));
const par = await Promise.all([1, 2, 3].map(() => M.reverseTransaction(A.pid, q(`select id from wallet_transactions where user_id='${A.pid}' and type='admin_adjust' and amount=-200`), 'гонка', 'apa-rr')));
t('гонка откатов — ровно один успех', par.filter((x) => x.ok).length === 1 && bal(A.pid) === 500, JSON.stringify(par.map((x) => x.error || 'ok')));
const spend = await wallet.spend(A.pid, 100, 'market', 'Покупка', 'ord-1');   // 500 -> 400
const spendTx = q(`select id from wallet_transactions where user_id='${A.pid}' and type='market' limit 1`);
r = await M.reverseTransaction(A.pid, spendTx, 'отмена покупки', 'apa-r3');
t('откат расхода возвращает', r.ok && bal(A.pid) === 500, JSON.stringify(r));
// откат прихода, который человек уже потратил
await wallet.credit(B.pid, 50, 'topup', 'Пополнение', null);
await wallet.spend(B.pid, 50, 'market', 'Потратил', null);
const bTop = q(`select id from wallet_transactions where user_id='${B.pid}' and type='topup' limit 1`);
r = await M.reverseTransaction(B.pid, bTop, 'потраченное', 'apa-r4');
t('откат уже потраченного — отказ', r.error === 'reverse_insufficient_funds' && bal(B.pid) === 0, JSON.stringify(r));
const foreign = await M.reversibleTx(B.pid, topup);
t('чужую операцию откатить нельзя', foreign.error === 'not_found');
const rev = q(`select id from wallet_transactions where user_id='${A.pid}' and type='admin_reversal' limit 1`);
t('откат отката запрещён', (await M.reversibleTx(A.pid, rev)).error === 'not_reversible');

// ── Prime: покупка 30 дней за 300, осталось ~15 дней => возврат ~150
await wallet.credit(B.pid, 300, 'topup', 'на Prime', null);
await wallet.spend(B.pid, 300, 'prime', 'Sky Prime · 30 дн.');
q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-t1-${U}','${B.pid}','active','standard', now() + interval '15 days')`);
q(`update profiles set is_prime=true where id='${B.pid}'`);
const info = await M.primeInfo(B.pid);
t('сводка Prime показывает возврат', info.active && info.refundPreview === 150, JSON.stringify(info));
const before = bal(B.pid);
r = await M.revokePrimeAdmin(B.pid, true, 'по просьбе', 'apa-p1');
t('Prime снят с возвратом', r.ok && bal(B.pid) - before === 150, JSON.stringify(r));
t('флаг Prime снят', q(`select is_prime from profiles where id='${B.pid}'`) === 'f');
r = await M.revokePrimeAdmin(B.pid, true, 'ещё раз', 'apa-p2');
t('повторно снять нечего', r.error === 'no_active_prime' && bal(B.pid) - before === 150, JSON.stringify(r));
// Prime без оплаты: возврата нет
q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-t2-${U}','${A.pid}','active','standard', now() + interval '10 days')`);
const aBefore = bal(A.pid);
r = await M.revokePrimeAdmin(A.pid, true, 'выдан админом', 'apa-p3');
t('выданный Prime возврата не даёт', r.ok && bal(A.pid) === aBefore, JSON.stringify(r));
// отмена подписки без возврата
q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-t3-${U}','${A.pid}','active','standard', now() + interval '10 days')`);
r = await M.cancelSubscriptionAdmin(A.pid, 'prime', 'отмена');
t('подписка Prime отменена без возврата', r.ok && bal(A.pid) === aBefore, JSON.stringify(r));
r = await M.cancelSubscriptionAdmin(A.pid, 'family', 'нет семьи');
t('нет семьи — отказ', r.error === 'no_family');

// ── подарки
q(`insert into gift_catalog(id,name,price_points) values ('gc-00000000-0000-0000-0000-000000000001','Тест',80) on conflict do nothing`);
const mkOrder = (id, kind, price, cur, extra = '') => q(`insert into gift_orders(id,idem_key,buyer_id,kind,gift_catalog_id,recipient_id,price,currency,status,prime_days${extra}) values ('${id}','k-${id}','${A.pid}','${kind}',${kind === 'gift' ? "'gc-00000000-0000-0000-0000-000000000001'" : 'NULL'},'${B.pid}',${price},'${cur}','paid',${kind === 'prime' ? 30 : 'NULL'})`);
const gid = `gi-${crypto.randomUUID()}`, pid = `pgi-${crypto.randomUUID()}`;
mkOrder(`go-1-${U}`, 'gift', 80, 'points'); mkOrder(`go-2-${U}`, 'prime', 300, 'money');
q(`insert into gift_instances(id,order_id,gift_catalog_id,sender_id,recipient_id) values ('${gid}','go-1-${U}','gc-00000000-0000-0000-0000-000000000001','${A.pid}','${B.pid}')`);
q(`insert into prime_gift_instances(id,order_id,sender_id,recipient_id,days,status) values ('${pid}','go-2-${U}','${A.pid}','${B.pid}',30,'activated')`);
q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-t4-${U}','${B.pid}','active','standard', now() + interval '40 days')`);
const pBefore = pts(A.pid), bBefore = bal(A.pid);
const gs = await M.giftForRevoke(gid);
t('подарок находится по отправителю', gs?.sender_id === A.pid && gs.kind === 'gift');
r = await M.revokeGiftAdmin(A.pid, gid, 'нарушение', 'apa-g1');
t('обычный подарок отозван, баллы вернулись', r.ok && pts(A.pid) - pBefore === 80, JSON.stringify(r));
r = await M.revokeGiftAdmin(A.pid, gid, 'ещё раз', 'apa-g2');
t('второй отзыв — отказ, деньги один раз', r.error === 'already_cancelled' && pts(A.pid) - pBefore === 80, JSON.stringify(r));
r = await M.revokeGiftAdmin(B.pid, gid, 'чужой', 'apa-g3');
t('отзыв от чужого имени — не найден', r.error === 'not_found');
r = await M.revokeGiftAdmin(A.pid, pid, 'нарушение', 'apa-g4');
t('активированный Prime-подарок отозван, деньги вернулись', r.ok && bal(A.pid) - bBefore === 300, JSON.stringify(r));
const exp = q(`select extract(day from expires_at - now())::int from prime_subscriptions where id='prime-t4-${U}'`);
t('у получателя убраны подаренные дни (40 -> ~10)', Number(exp) >= 9 && Number(exp) <= 10, exp);
t('статус подарка и заказа', q(`select status from prime_gift_instances where id='${pid}'`) === 'unavailable' && q(`select status from gift_orders where id='go-2-${U}'`) === 'refunded');
const sum = await M.userMoneySummary(A.pid);
t('сводка собирается', sum.balance === bal(A.pid) && sum.transactions.length > 0 && sum.gifts.length === 2, JSON.stringify(sum).slice(0, 200));

console.log(`ИТОГО: ${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
