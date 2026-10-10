import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const eps = readFileSync(S + '/eps2.txt', 'utf8').split('\n').filter(Boolean).map((l) => { const [mp, f] = l.split('|'); const [m, p] = mp.split(' '); return { m, p: p.replace(/ID1/g, 'x-1'), f }; })
  .filter((e) => /\/admin\b|\/admin\/|staff|\/moderation|\/analytics|\/review|\/queue/.test(e.p));
const mkRole = async (tag, role) => { const u = await mkuser(S, tag); q(`update profiles set is_admin=true, admin_role='${role}' where id='${u.pid}'`); return u; };
const U = await mkuser(S, 'rbu');
const RO = await mkRole('rbro', 'read_only_admin');
const SUP = await mkRole('rbsu', 'support_admin');
const CT = await mkRole('rbct', 'content_admin');
console.log('admin-like endpoints:', eps.length);
const leaks = [];
for (const e of eps) {
  for (const [label, u] of [['user', U], ['read_only', RO], ['support', SUP], ['content', CT]]) {
    const r = await call(e.p, { method: e.m, body: e.m === 'GET' ? undefined : '{}' }, u.tok);
    // GET допускаются «только чтение» для некоторых админских справочников; мутации — никогда
    const mut = e.m !== 'GET';
    if (label === 'user' && r.status < 400) leaks.push(`${label} ${e.m} ${e.p} → ${r.status} [${e.f}]`);
    if (label === 'read_only' && mut && r.status < 400) leaks.push(`${label} ${e.m} ${e.p} → ${r.status} [${e.f}]`);
  }
}
console.log('Подозрительные пропуски:', leaks.length); leaks.forEach((l) => console.log(' ', l));
// support не должен иметь денег/ролей
const sens = eps.filter((e) => /finance|wallet|grant|role|codes|payout|commission|secret|key/i.test(e.p));
const sl = [];
for (const e of sens) { const r = await call(e.p, { method: e.m, body: e.m === 'GET' ? undefined : '{}' }, SUP.tok); if (r.status < 400) sl.push(`support ${e.m} ${e.p} → ${r.status}`); }
console.log('support на финансовых/ролевых:', sl.length); sl.forEach((l) => console.log(' ', l));
