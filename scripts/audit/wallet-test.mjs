import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const A = await mkuser(process.argv[2], 'wla');
await call('/api/wallet', {}, A.tok);
q(`update wallet_accounts set balance=1000, points=500 where user_id='${A.pid}'`);
const bal = () => Number(q(`select balance from wallet_accounts where user_id='${A.pid}'`));
const pts = () => Number(q(`select points from wallet_accounts where user_id='${A.pid}'`));
const spend = (amount, type = 'market', path = '/api/wallet/spend') => call(path, { method: 'POST', body: JSON.stringify({ amount, type, desc: 't' }) }, A.tok);
for (const bad of ['abc', -5, 0, 0.5, 1e21, '10', null, [5], {}, true, 9007199254740993, '1e3', -0, 'NaN']) {
  const r = await spend(bad);
  ok(r.status === 400 && bal() === 1000, `сумма ${JSON.stringify(bad)} отклонена, баланс цел`, `${r.status} bal=${bal()}`);
}
let r = await spend(100, 'prime'); ok(r.status === 400, 'служебный тип prime клиентом не принимается');
r = await spend(100, 'nft_purchase'); ok(r.status === 400, 'служебный тип nft_purchase не принимается');
r = await spend(100, 'blox_payout'); ok(r.status === 400, 'служебный тип blox_payout не принимается');
r = await spend(100, 'market'); ok(r.status === 200 && bal() === 900, 'обычное списание работает');
// гонка
const res = await Promise.all(Array.from({ length: 30 }, () => spend(100)));
const succ = res.filter((x) => x.status === 200).length;
ok(succ === 9 && bal() === 0, `гонка: из 30 параллельных по 100 прошло ${succ}, остаток ${bal()}`);
r = await spend(1); ok(r.status === 400 && r.data.error === 'insufficient_funds', 'при нуле — insufficient_funds');
// баллы
r = await call('/api/wallet/spend-points', { method: 'POST', body: JSON.stringify({ amount: -10, desc: 'x' }) }, A.tok); ok(r.status === 400 && pts() === 500, 'отрицательные баллы отклонены');
const rp = await Promise.all(Array.from({ length: 20 }, () => call('/api/wallet/spend-points', { method: 'POST', body: JSON.stringify({ amount: 100, desc: 'x' }) }, A.tok)));
ok(rp.filter((x) => x.status === 200).length === 5 && pts() === 0, `гонка по баллам: прошло ${rp.filter((x) => x.status === 200).length}, остаток ${pts()}`);
r = await call('/api/wallet/exchange', { method: 'POST', body: JSON.stringify({ rubles: -50 }) }, A.tok); ok(r.status === 400, 'обмен отрицательной суммы отклонён');
r = await call('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, A.tok); ok(r.status === 501 && bal() === 0, 'пополнение закрыто (платежей нет)');
r = await call('/api/wallet/refund', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, A.tok); ok(r.status === 501 && bal() === 0, 'самовозврат закрыт');
r = await call('/api/wallet/earn-points', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, A.tok); ok(r.status === 501, 'самоначисление баллов закрыто');
console.log(`\n${pass} ok, ${fail} fail`);
