/**
 * Журнал кошелька (миграция 162): только дописывается, валюта у записей, сверка ловит подмену баланса,
 * обмен рублей на баллы пишет обе записи. API на :8080 (мигрирован), DATABASE_URL в окружении.
 * Запуск: node scripts/audit/wallet-ledger-test.mjs <scratchpad>
 */
import { execFileSync } from 'node:child_process';
import { mkuser } from './lib.mjs';
import { wallet, reconcileLedger } from '../../server/wallet.mjs';
import { pool } from '../../server/db.mjs';
const S = process.argv[2] ?? '.';
const sql = (q) => execFileSync('psql', [process.env.DATABASE_URL, '-tAc', q], { encoding: 'utf8' }).trim();
const psqlErr = (q) => { try { execFileSync('psql', [process.env.DATABASE_URL, '-tAc', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return ''; } catch (e) { return String(e.stderr); } };
let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, i); } };
const drifted = async (pid) => { const r = await reconcileLedger({ sample: 100000 }); return { rub: r.driftRub.some((d) => d.userId === pid), pts: r.driftPts.some((d) => d.userId === pid), r }; };

const u = await mkuser(S, 'Led');
await wallet.credit(u.pid, 5000, 'topup', 'тест', 'led:1');
await wallet.creditPoints(u.pid, 300, 'cashback', 'тест', 'led:2');
await wallet.spend(u.pid, 700, 'market', 'тест', 'led:3');
await wallet.exchangeToPoints(u.pid, 100);
await wallet.spendPoints(u.pid, 50, 'тест', 'led:4');
const st = await wallet.getState(u.pid);
check('баланс 4200, баллы 1250', st.balance === 4200 && st.points === 1250, `${st.balance}/${st.points}`);
check('валюта проставлена у всех записей', Number(sql(`select count(*) from wallet_transactions where user_id='${u.pid}' and currency is null`)) === 0);
check('обмен: есть списание рублей', Number(sql(`select count(*) from wallet_transactions where user_id='${u.pid}' and type='exchange_out' and amount=-100 and currency='rub'`)) === 1);
check('обмен: есть начисление баллов', Number(sql(`select count(*) from wallet_transactions where user_id='${u.pid}' and type='points_earn' and amount=1000 and currency='pts'`)) === 1);
let d = await drifted(u.pid);
check('честные операции — расхождения нет', !d.rub && !d.pts, JSON.stringify(d.r.driftRub.filter((x) => x.userId === u.pid)));

// журнал не правится и не удаляется
const e1 = psqlErr(`update wallet_transactions set amount = amount + 1 where user_id='${u.pid}'`);
check('UPDATE суммы запрещён', /только дописывается/.test(e1), e1.slice(0, 100));
const e2 = psqlErr(`delete from wallet_transactions where user_id='${u.pid}'`);
check('DELETE запрещён', /только дописывается/.test(e2), e2.slice(0, 100));
const e3 = psqlErr(`update wallet_transactions set currency='pts' where user_id='${u.pid}'`);
check('смена уже проставленной валюты запрещена', /только дописывается/.test(e3));
check('записи на месте', Number(sql(`select count(*) from wallet_transactions where user_id='${u.pid}'`)) === 6);

// подмена баланса в обход журнала видна сверке
sql(`update wallet_accounts set balance = balance + 777 where user_id='${u.pid}'`);
d = await drifted(u.pid);
check('подмена balance обнаружена', d.rub && !d.pts);
const dr = d.r.driftRub.find((x) => x.userId === u.pid);
check('размер расхождения 777', dr?.drift === 777, JSON.stringify(dr));
sql(`update wallet_accounts set balance = balance - 777, points = points + 5 where user_id='${u.pid}'`);
d = await drifted(u.pid);
check('подмена баллов обнаружена', !d.rub && d.pts);
sql(`update wallet_accounts set points = points - 5 where user_id='${u.pid}'`);
d = await drifted(u.pid);
check('после возврата расхождения нет', !d.rub && !d.pts);

// запись без валюты не сверяется (честно «не проверено»), а разметить её можно один раз
sql(`insert into wallet_transactions(id,user_id,type,amount,descr) values('tx-led-null-${Date.now()}','${u.pid}','admin_adjust',10,'тест')`);
const r = await reconcileLedger({ sample: 100000 });
check('счёт с неразобранной записью — «не сверено»', !r.driftRub.some((x) => x.userId === u.pid) && r.unchecked >= 1);
check('перерасчёт для проверки: баланс не менялся', (await wallet.getState(u.pid)).balance === 4200);
await pool.end();
console.log(`${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
