import { readFileSync, writeFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const eps = readFileSync(S + '/eps2.txt', 'utf8').split('\n').filter(Boolean).map((l) => { const [mp, f] = l.split('|'); const [m, p] = mp.split(' '); return { m, p, f }; });
const U = await mkuser(S, 'fz');
const bodies = ['null', '[]', '{}', '{"id":null,"text":null,"title":null,"amount":null,"items":null}', '{"id":{"$ne":1},"amount":-1,"limit":"x","page":{}}', '{"id":"' + 'A'.repeat(5000) + '","text":"\\u0000"}', '{"amount":1e999,"qty":-99999999999999999999}'];
const ids = ['x-1', '%00', '..%2f..%2fetc', '1;select', "'%20or%201=1--", 'A'.repeat(600), '%E0%A4%A'];
const seen = new Map();
for (const e of eps) {
  if (/\/(logout|shutdown|delete-account|deactivate)/.test(e.p)) continue;
  const paths = e.p.includes('ID1') ? ids.map((i) => e.p.replace(/ID1/g, i)) : [e.p];
  for (const p of paths) {
    const bs = e.m === 'GET' || e.m === 'DELETE' ? [undefined] : bodies;
    for (const b of bs) {
      let st;
      try { st = (await call(p + (e.m === 'GET' && !p.includes('?') ? '?limit=-1&offset=abc&q=%00' : ''), { method: e.m, body: b }, U.tok)).status; } catch { st = 'ERR'; }
      if (String(st).startsWith('5') || st === 'ERR') { const k = `${e.m} ${e.p} [${e.f}]`; if (!seen.has(k)) seen.set(k, []); seen.get(k).push(`${st}:${(b ?? p).slice(0, 40)}`); }
    }
  }
}
console.log('endpoints with 5xx:', seen.size);
for (const [k, v] of seen) console.log(k, [...new Set(v)].slice(0, 3).join(' | '));
writeFileSync(S + '/fuzzall.out', [...seen].map(([k, v]) => k + ' ' + v.join(',')).join('\n'));
