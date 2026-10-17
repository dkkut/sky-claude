/**
 * Обход админских адресов: обычный пользователь и аноним не должны получать
 * 2xx ни на один /api/admin/* (и 5xx — тоже подозрительно). Адреса берутся из
 * исходников маршрутов, подстановки (:id) заменяются заглушкой.
 * Запуск: node scripts/audit/admin-authz-sweep-test.mjs <scratchpad>  (API на :8080)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2] ?? '.';
const dir = new URL('../../server/routes/', import.meta.url);
const paths = new Set();
for (const f of readdirSync(dir)) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  for (const m of src.matchAll(/['"`](\/api\/admin\/[A-Za-z0-9_\-\/:.${}]*)/g)) {
    let p = m[1].replace(/\$\{[^}]*\}/g, 'x').replace(/:[A-Za-z]+/g, 'x').replace(/\/$/, '');
    if (p.length > 11) paths.add(p);
  }
}
// корневые адреса модулей, которые в коде собираются из префикса
for (const p of ['/api/admin', '/api/admin/users', '/api/admin/modules', '/api/admin/logs', '/api/admin/registration']) paths.add(p);

let ok = 0, bad = 0; const dist = {};
const check = (name, cond, info = '') => { if (cond) ok++; else { bad++; console.log('FAIL', name, info); } };
const u = await mkuser(S, 'Sweep');
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
for (const p of [...paths].sort()) {
  for (const m of methods) {
    const body = m === 'GET' ? undefined : '{}';
    for (const [who, tok] of [['user', u.tok], ['anon', undefined]]) {
      const r = await call(p, { method: m, body }, tok);
      dist[r.status] = (dist[r.status] ?? 0) + 1;
      check(`${who} ${m} ${p}`, p === '/api/admin/gate' || r.status >= 400 && r.status < 500 || r.status === 501, `→ ${r.status} ${String(r.text).slice(0, 80)}`);
    }
  }
}
console.log('коды ответов:', JSON.stringify(dist));
check('429 не маскирует проверку (<5%)', (dist[429] ?? 0) < 0.05 * ok);
console.log(`адресов: ${paths.size}; ${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
