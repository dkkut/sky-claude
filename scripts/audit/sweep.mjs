import { readFileSync, writeFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const eps = readFileSync(S + '/eps2.txt', 'utf8').split('\n').filter(Boolean).map((l) => { const [mp, f] = l.split('|'); const [m, p] = mp.split(' '); return { m, p: p.replace(/ID1/g, 'x-1'), f }; });
const U = await mkuser(S, 'swp');
const rows = [];
for (const e of eps) {
  if (/\/(logout|shutdown)/.test(e.p)) continue;
  const run = async (tok) => {
    try { const r = await call(e.p, { method: e.m, body: e.m === 'GET' ? undefined : '{}' }, tok); return r.status; } catch { return 'ERR'; }
  };
  const a = await run(undefined), b = await run(U.tok);
  rows.push({ ...e, anon: a, user: b });
}
writeFileSync(S + '/sweep.json', JSON.stringify(rows, null, 1));
const bad5 = rows.filter((r) => String(r.anon).startsWith('5') || String(r.user).startsWith('5') || r.anon === 'ERR');
const anon200 = rows.filter((r) => r.anon === 200);
const adminUser200 = rows.filter((r) => /admin|staff|moder|analytics/.test(r.p) && r.user === 200);
console.log('всего', rows.length, '| 5xx/ERR:', bad5.length, '| anon 200:', anon200.length, '| admin-путь, 200 для обычного:', adminUser200.length);
console.log('--5xx'); bad5.forEach((r) => console.log(r.m, r.p, r.anon, r.user, r.f));
console.log('--admin 200 для user'); adminUser200.forEach((r) => console.log(r.m, r.p, r.anon, r.user));
console.log('--anon 200'); anon200.forEach((r) => console.log(r.m, r.p, r.f));
