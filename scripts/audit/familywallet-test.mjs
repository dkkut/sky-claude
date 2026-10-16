// Общий счёт Sky Family: один баланс на семью, виден всем участникам (HTTP, API на :8080).
// Запуск: node scripts/audit/familywallet-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };

const a = await mkuser(S, 'fwA'); const b = await mkuser(S, 'fwB'); const k = await mkuser(S, 'fwKid'); const o = await mkuser(S, 'fwOut');
let r = await call('/api/family', { method: 'POST', body: JSON.stringify({ name: 'Тест' }) }, a.tok);
const fid = r.data?.data?.family?.id ?? r.data?.family?.id;
t('семья создана', !!fid, JSON.stringify(r.data));
const mem = (pid, role) => q(`insert into family_members (id, family_id, profile_id, role) values ('fm-' || gen_random_uuid(), '${fid}', '${pid}', '${role}')`);
mem(b.pid, 'adult'); mem(k.pid, 'child');
const bal = (pid) => Number(q(`select coalesce((select balance from wallet_accounts where user_id='${pid}'),0)`));
for (const u of [a, b, k, o]) q(`insert into wallet_accounts (user_id, balance) values ('${u.pid}', 1000) on conflict (user_id) do update set balance = 1000`);

r = await call(`/api/family/${fid}/wallet`, {}, o.tok);
t('посторонний не видит счёт', r.status === 404);
r = await call(`/api/family/${fid}/wallet-topup`, { method: 'POST', body: JSON.stringify({ amount: 300 }) }, a.tok);
t('владелец пополнил', r.status === 200 && r.data.balance === 300, JSON.stringify(r.data));
t('личный баланс уменьшился', bal(a.pid) === 700);
r = await call(`/api/family/${fid}/wallet`, {}, b.tok);
t('второй участник видит тот же баланс', r.status === 200 && r.data.balance === 300 && r.data.transactions.length === 1, JSON.stringify(r.data));
r = await call(`/api/family/${fid}/wallet-topup`, { method: 'POST', body: JSON.stringify({ amount: 5000 }) }, a.tok);
t('нехватка личных средств — отказ', r.status === 409 && r.data.error === 'insufficient_funds');
r = await call(`/api/family/${fid}/wallet-topup`, { method: 'POST', body: JSON.stringify({ amount: -5 }) }, a.tok);
t('отрицательная сумма — отказ', r.status === 400);
r = await call(`/api/family/${fid}/wallet-topup`, { method: 'POST', body: JSON.stringify({ amount: 1.5 }) }, a.tok);
t('дробная сумма — отказ', r.status === 400);
r = await call(`/api/family/${fid}/wallet-topup`, { method: 'POST', body: JSON.stringify({ amount: 100 }) }, k.tok);
t('ребёнок может пополнить', r.status === 200 && r.data.balance === 400);
r = await call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 50 }) }, k.tok);
t('ребёнок вывести не может', r.status === 403);
r = await call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 50 }) }, o.tok);
t('посторонний вывести не может', r.status === 404);
r = await call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 150 }) }, b.tok);
t('взрослый вывел', r.status === 200 && r.data.balance === 250 && bal(b.pid) === 1150, JSON.stringify(r.data));
r = await call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 9999 }) }, b.tok);
t('больше баланса — отказ', r.status === 409 && r.data.error === 'insufficient_family_funds');
r = await call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 20, toProfileId: k.pid, idemKey: 'allow-1' }) }, a.tok);
t('карманные деньги ребёнку', r.status === 200 && bal(k.pid) === 920 && r.data.balance === 230, JSON.stringify(r.data));
r = await call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 20, toProfileId: k.pid, idemKey: 'allow-1' }) }, a.tok);
t('повтор с тем же ключом не списывает', r.status === 200 && r.data.duplicate === true && r.data.balance === 230 && bal(k.pid) === 920);
r = await call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 20, toProfileId: o.pid }) }, a.tok);
t('нельзя перевести постороннему', r.status === 404);
// гонка: два параллельных вывода по 200 при балансе 230 — пройдёт только один
const [r1, r2] = await Promise.all([1, 2].map(() => call(`/api/family/${fid}/wallet-withdraw`, { method: 'POST', body: JSON.stringify({ amount: 200 }) }, b.tok)));
t('гонка: пройдёт ровно один вывод', [r1, r2].filter((x) => x.status === 200).length === 1, `${r1.status} ${r2.status}`);
t('баланс не ушёл в минус', Number(q(`select balance from family_wallet where family_id='${fid}'`)) === 30);
r = await call(`/api/family/${fid}/wallet-contribute`, { method: 'POST', body: JSON.stringify({ amount: 10, desc: 'цель' }) }, b.tok);
t('взнос в цель списывает с общего счёта', r.status === 200 && r.data.balance === 20);
t('сумма сходится (личные + общий = 4000)', bal(a.pid) + bal(b.pid) + bal(k.pid) + bal(o.pid) + Number(q(`select balance from family_wallet where family_id='${fid}'`)) + 10 === 4000);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
