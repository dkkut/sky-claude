/**
 * Покупка Prime: списание и выдача — одна транзакция (аудит 2026-11).
 * Нужны API на :8080 и psql к его базе (DATABASE_URL). Запуск: node … <scratchpad>
 */
import { execFileSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2] ?? '.';
const sql = (q) => execFileSync('psql', [process.env.DATABASE_URL, '-tAc', q], { encoding: 'utf8' }).trim();
let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, i); } };
const bal = (pid) => Number(sql(`select balance from wallet_accounts where user_id='${pid}'`) || 0);
const rows = (pid) => Number(sql(`select count(*) from wallet_transactions where user_id='${pid}' and type='prime'`));
const subs = (pid) => Number(sql(`select count(*) from prime_subscriptions where profile_id='${pid}' and status='active'`));
const buy = (u, body) => call('/api/skyid/prime/grant', { method: 'POST', body: JSON.stringify(body) }, u.tok);

// 1. без денег
let u = await mkuser(S, 'PrA');
let r = await buy(u, { days: 30 });
check('без средств — отказ', r.status === 400 && r.data.error === 'insufficient_funds', JSON.stringify(r.data));
check('без средств — нет Prime и записи', subs(u.pid) === 0 && rows(u.pid) === 0);

// 2. успех + план из запроса игнорируется
sql(`insert into wallet_accounts(user_id,balance) values('${u.pid}',1000) on conflict (user_id) do update set balance=1000`);
r = await buy(u, { days: 30, plan: 'family' });
check('покупка проходит', r.status === 200, JSON.stringify(r.data).slice(0, 120));
check('баланс −399', bal(u.pid) === 601, String(bal(u.pid)));
check('одна запись списания', rows(u.pid) === 1);
check('подписка активна, план стандартный', sql(`select plan from prime_subscriptions where profile_id='${u.pid}' and status='active'`) === 'standard');

// 3. гонка: денег ровно на одну покупку
u = await mkuser(S, 'PrB');
sql(`insert into wallet_accounts(user_id,balance) values('${u.pid}',399) on conflict (user_id) do update set balance=399`);
const rs = await Promise.all([buy(u, { days: 30 }), buy(u, { days: 30 }), buy(u, { days: 30 })]);
check('гонка: ровно одна успешная', rs.filter((x) => x.status === 200).length === 1, rs.map((x) => x.status).join());
check('гонка: баланс 0, не минус', bal(u.pid) === 0);
check('гонка: одна запись и одна подписка', rows(u.pid) === 1 && subs(u.pid) === 1);

// 4. сбой выдачи после списания откатывает списание
u = await mkuser(S, 'PrC');
sql(`insert into wallet_accounts(user_id,balance) values('${u.pid}',1000) on conflict (user_id) do update set balance=1000`);
sql(`create or replace function _boom() returns trigger language plpgsql as $$ begin if new.profile_id='${u.pid}' then raise exception 'boom'; end if; return new; end $$`);
sql(`create trigger _boom_t before insert on prime_subscriptions for each row execute function _boom()`);
try {
  r = await buy(u, { days: 30 });
  check('сбой выдачи — 500', r.status === 500, String(r.status));
  check('сбой выдачи — баланс цел', bal(u.pid) === 1000, String(bal(u.pid)));
  check('сбой выдачи — нет записи списания', rows(u.pid) === 0);
} finally { sql('drop trigger if exists _boom_t on prime_subscriptions'); sql('drop function if exists _boom()'); }

// 5. бессрочный Prime — деньги не списываются
u = await mkuser(S, 'PrD');
sql(`insert into wallet_accounts(user_id,balance) values('${u.pid}',1000) on conflict (user_id) do update set balance=1000`);
sql(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values('prime-t-${Date.now()}','${u.pid}','active','legacy',NULL)`);
r = await buy(u, { days: 30 });
check('бессрочный — 409', r.status === 409 && r.data.error === 'already_lifetime', JSON.stringify(r.data));
check('бессрочный — баланс цел', bal(u.pid) === 1000);

// 6. подделка цены/срока
u = await mkuser(S, 'PrE');
sql(`insert into wallet_accounts(user_id,balance) values('${u.pid}',5000) on conflict (user_id) do update set balance=5000`);
for (const days of [0, 1, -30, 31, '30; drop', 99999]) {
  r = await buy(u, { days, price: 1 });
  check(`нестандартный срок ${days} отклонён`, r.status === 400 && r.data.error === 'invalid_plan', String(r.status));
}
check('баланс не тронут', bal(u.pid) === 5000);
console.log(`${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
