/**
 * Одноразовый refresh-токен: ротация, окно для параллельных вкладок, повтор старого токена гасит сессию.
 * API на :8080 с REFRESH_REUSE_GRACE_SEC=3 (для теста). Запуск: node … <scratchpad>
 */
import { readFileSync } from 'node:fs';
import { call } from './lib.mjs';
const S = process.argv[2] ?? '.';
let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, i); } };
const APP = { 'x-sky-client': 'app' };
const login = async () => {
  const email = `rot${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
  await new Promise((r) => setTimeout(r, 1500));
  const log = readFileSync(S + '/api.log', 'utf8');
  const code = [...log.matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  const r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) }, undefined, APP);
  return r.data;
};
const refresh = (rt) => call('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) }, undefined, APP);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await login();
check('вход выдал refresh-токен', typeof a.refreshToken === 'string' && a.refreshToken.length > 20);
let r1 = await refresh(a.refreshToken);
check('первый refresh успешен', r1.status === 200 && r1.data.refreshToken, String(r1.status));
check('выдан НОВЫЙ токен', r1.data.refreshToken && r1.data.refreshToken !== a.refreshToken);
let r2 = await refresh(r1.data.refreshToken);
check('следующий токен работает (цепочка)', r2.status === 200 && r2.data.refreshToken !== r1.data.refreshToken);

// старый токен в окне допуска (вторая вкладка / потерянный ответ)
const rGrace = await refresh(r1.data.refreshToken);
check('предыдущий токен в окне допуска принимается', rGrace.status === 200, String(rGrace.status));
const rCur = await refresh(r2.data.refreshToken);
check('текущий токен после этого всё ещё работает', rCur.status === 200, String(rCur.status));

// параллельные обновления одним токеном: сессия не должна погаснуть
const b = await login();
const par = await Promise.all([refresh(b.refreshToken), refresh(b.refreshToken), refresh(b.refreshToken)]);
check('параллельные refresh одним токеном — все 200', par.every((x) => x.status === 200), par.map((x) => x.status).join());
const after = await refresh(par[0].data.refreshToken);
check('сессия жива после параллельных обновлений', after.status === 200, String(after.status));

// повтор токена вне окна = кража: сессия гасится вместе с актуальным токеном
const c = await login();
const c1 = await refresh(c.refreshToken);           // rv 0 → 1
const c2 = await refresh(c1.data.refreshToken);     // rv 1 → 2
await sleep(3500);                                  // окно допуска (3 с) вышло
const stolen = await refresh(c1.data.refreshToken); // устаревший токен
check('старый токен вне окна отклонён', stolen.status === 401, String(stolen.status));
const dead = await refresh(c2.data.refreshToken);
check('при повторе гаснет вся сессия (актуальный токен тоже)', dead.status === 401, String(dead.status));
const sess = await call('/api/auth/session', {}, c2.data.accessToken);
check('access-токен погашенной сессии не работает', sess.status === 401, String(sess.status));

// поддельный/чужой токен
const fake = await refresh(a.refreshToken.slice(0, -4) + 'AAAA');
check('подделанный токен отклонён', fake.status === 401);
console.log(`${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
