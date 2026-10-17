/**
 * Пределы по адресу клиента на отправку кодов и вход по паролю (аудит 2026-11).
 * Поднимает ОТДЕЛЬНЫЙ экземпляр API на :18081 с AUTH_START_RATE_MULT=1 (боевые пределы),
 * чтобы не мешать остальным тестам. Нужны окружение env.sh и свободный порт 18081.
 */
import { spawn } from 'node:child_process';
const BASE = 'http://127.0.0.1:18081';
process.env.API_BASE = BASE;
const { call } = await import('./lib.mjs');
let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, i); } };
const srv = spawn('node', ['server/server.mjs'], {
  cwd: new URL('../../', import.meta.url).pathname,
  env: { ...process.env, API_PORT: '18081', SIGNAL_PORT: '18082', AUTH_START_RATE_MULT: '1', RATE_LIMIT_PER_MINUTE: '100000' },
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/api/platform/status'); if (r.ok) break; } catch { /* ждём */ } await new Promise((r) => setTimeout(r, 500)); }
  const ipA = { 'x-real-ip': '203.0.113.10', 'x-forwarded-proto': 'https' }, ipB = { 'x-real-ip': '203.0.113.11', 'x-forwarded-proto': 'https' };
  const start = (ch, n, ip) => call(`/api/auth/${ch}/start`, { method: 'POST', body: JSON.stringify(ch === 'email' ? { email: `lim${n}${Date.now()}@example.com` } : { phone: `+7900${String(1000000 + n)}` }) }, undefined, ip);
  // почта: 20 в минуту с одного адреса
  const st = [];
  for (let i = 0; i < 23; i++) st.push((await start('email', i, ipA)).status);
  const blocked = st.filter((s) => s === 429).length;
  check('почта: первые запросы проходят', st.slice(0, 20).every((s) => s !== 429), st.join());
  check('почта: после 20 в минуту — 429', blocked >= 3, st.join());
  const other = await start('email', 99, ipB);
  check('другой адрес не задет', other.status !== 429, String(other.status));
  // телефон: 10 в минуту
  const ph = [];
  for (let i = 0; i < 13; i++) ph.push((await start('phone', i, ipA)).status);
  check('телефон: после 10 в минуту — 429', ph.filter((s) => s === 429).length >= 3, ph.join());
  // вход по паролю: 20 в минуту с адреса при разных почтах
  const pw = [];
  for (let i = 0; i < 24; i++) pw.push((await call('/api/auth/password/login', { method: 'POST', body: JSON.stringify({ email: `nouser${i}${Date.now()}@example.com`, password: 'x' }) }, undefined, ipA)).status);
  check('пароль: много разных почт с одного адреса — 429 после 20', pw.slice(0, 20).every((s) => s === 401) && pw.slice(20).every((s) => s === 429), pw.join());
  const pwB = await call('/api/auth/password/login', { method: 'POST', body: JSON.stringify({ email: 'nouserB@example.com', password: 'x' }) }, undefined, ipB);
  check('пароль: другой адрес не задет', pwB.status === 401, String(pwB.status));
} finally { srv.kill('SIGTERM'); }
console.log(`${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
