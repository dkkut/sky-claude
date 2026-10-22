// Критические сценарии для Sky Sandbox: запускается раннером против ПРОВЕРЯЕМОЙ сборки на временной базе.
// API_BASE — адрес сборки; первый аргумент — каталог с api.log (оттуда берутся коды входа). Код выхода ≠ 0 — сценарий не пройден.
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let bad = 0; const t = (n, c, x = '') => { console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 160)); if (!c) bad++; };

let r = await call('/healthz'); t('healthz отвечает', r.status === 200, r.status);
r = await call('/api/platform/status'); t('статус платформы — JSON', r.status === 200 && typeof r.data === 'object', r.status);
for (const p of ['/api/admin/sandbox', '/api/skyid/me', '/api/wallet', '/api/transfer', '/api/qr/me', '/api/admin/logs'])
  { r = await call(p); t(`без входа закрыто: ${p}`, r.status === 401 || r.status === 403, r.status); }
r = await call('/api/sandbox/runner/claim', { method: 'POST', body: '{}' }); t('раннерский вход без подписи закрыт', r.status === 403 || r.status === 404, r.status);

const u = await mkuser(S, 'sbx');
t('регистрация и выбор профиля', !!u.tok && !!u.pid);
r = await call('/api/qr/me', {}, u.tok); t('QR: свой код создаётся', r.status === 200 && /^[A-Za-z0-9]{12}$/.test(r.data?.code ?? ''), r);
r = await call('/api/transfer', {}, u.tok, { 'x-sky-device': 'dv' + 'a'.repeat(24) }); t('Transfer: обзор', r.status === 200, r.status);
r = await call('/api/admin/sandbox', {}, u.tok); t('обычному человеку Sandbox закрыт', r.status === 403, r.status);
r = await call('/api/admin/logs', {}, u.tok); t('обычному человеку журналы закрыты', r.status === 403, r.status);
r = await call('/api/auth/refresh', { method: 'POST', body: '{}' }); t('обновление без токена — отказ, не 500', r.status >= 400 && r.status < 500, r.status);
process.exit(bad ? 1 : 0);
