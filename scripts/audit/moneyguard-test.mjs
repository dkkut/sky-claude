// Замок SkyMoney на сервере: node scripts/audit/moneyguard-test.mjs <каталог с api.log>
// API с ADMIN_GATE=off; почта в режиме log (коды берутся из api.log).
import { readFileSync } from 'node:fs';
import { call } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastCode = (email) => {
  const log = readFileSync(S + '/api.log', 'utf8');
  return [...log.matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))].pop()?.[1];
};
const mkWith = async (tag, device) => {
  const email = `${tag.toLowerCase()}${Date.now()}@example.com`;
  const H = device ? { 'x-sky-device': device } : {};
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email, viaMail: true }) }, null, H);
  await sleep(1500);
  const r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code: lastCode(email) }) }, null, H);
  let tok = r.data.accessToken;
  const p = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok, H);
  const s = await call(`/api/skyid/profiles/${p.data.profile.id}/select`, { method: 'POST', body: '{}' }, tok, H);
  return { tok: s.data.accessToken ?? tok, email, H };
};

// ── A: устройство не доверенное, пароля нет ──
const A = await mkWith('MoneyA', null);
let r = await call('/api/wallet', {}, A.tok, A.H);
t('A: /api/wallet закрыт', r.status === 403 && r.data.error === 'money_locked', JSON.stringify(r.data));
t('A: ответ без финансовых данных', r.data.balance === undefined && r.data.transactions === undefined);
for (const [m, path] of [['GET', '/api/codes/history'], ['POST', '/api/wallet/exchange'], ['POST', '/api/wallet/topup'], ['POST', '/api/codes/redeem'], ['GET', '/api/skykassa/methods'], ['POST', '/api/skykassa/payments']]) {
  r = await call(path, { method: m, ...(m === 'POST' ? { body: '{}' } : {}) }, A.tok, A.H);
  t(`A: ${m} ${path} закрыт`, r.status === 403 && r.data.error === 'money_locked', `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
}
r = await call('/api/wallet/balance', {}, A.tok, A.H);
t('A: /balance открыт и без истории', r.status === 200 && typeof r.data.balance === 'number' && r.data.transactions === undefined);
r = await call('/api/wallet/spend', { method: 'POST', body: JSON.stringify({ amount: 5, type: 'market', desc: 'x' }) }, A.tok, A.H);
t('A: /spend не закрыт замком (нет денег — обычный отказ)', r.status !== 403 || r.data.error !== 'money_locked', JSON.stringify(r.data));
r = await call('/api/wallet', {}, null);
t('без входа — 401, не 403', r.status === 401, String(r.status));
r = await call('/api/skyid/money/status', {}, A.tok, A.H);
t('A: статус — нужно подтвердить устройство', r.data.unlocked === false && r.data.needDevice === true && r.data.needPassword === false && r.data.deviceProof === 'email', JSON.stringify(r.data));
r = await call('/api/skyid/money/unlock', { method: 'POST', body: '{}' }, A.tok, A.H);
t('A: без кода нельзя', r.status === 400 && r.data.error === 'device_code_required');
r = await call('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ code: '000000' }) }, A.tok, A.H);
t('A: неверный код отклонён', r.status === 400 && r.data.ok === false, JSON.stringify(r.data));
r = await call('/api/wallet', {}, A.tok, A.H);
t('A: после неверного кода всё ещё закрыт', r.status === 403);
await sleep(61_000);
r = await call('/api/skyid/money/code', { method: 'POST', body: '{}' }, A.tok, A.H);
t('A: код отправлен', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
await sleep(1500);
const code = lastCode(A.email);
r = await call('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ code }) }, A.tok, A.H);
t('A: верный код открывает', r.status === 200 && r.data.unlocked === true, JSON.stringify(r.data));
r = await call('/api/wallet', {}, A.tok, A.H);
t('A: после подтверждения кошелёк отдаёт данные', r.status === 200 && Array.isArray(r.data.transactions));
r = await call('/api/skyid/money/lock', { method: 'POST', body: '{}' }, A.tok, A.H);
r = await call('/api/wallet', {}, A.tok, A.H);
t('A: после «закрыть» снова 403', r.status === 403);

// ── B: доверенное устройство (вход по коду с X-Sky-Device), пароль задан ──
const dev = 'trusteddevice-' + Math.random().toString(36).slice(2, 12) + 'abcdef';
const B = await mkWith('MoneyB', dev);
r = await call('/api/wallet', {}, B.tok, B.H);
t('B: доверенное устройство без пароля — открыто', r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
await call('/api/auth/password/setup/start', { method: 'POST', body: '{}' }, B.tok, B.H);
await sleep(1500);
r = await call('/api/auth/password/setup', { method: 'POST', body: JSON.stringify({ password: 'Correct-Horse-9', code: lastCode(B.email) }) }, B.tok, B.H);
t('B: пароль задан', r.status === 200, JSON.stringify(r.data));
await call('/api/skyid/money/lock', { method: 'POST', body: '{}' }, B.tok, B.H);
r = await call('/api/wallet', {}, B.tok, B.H);
t('B: с паролем кошелёк закрыт', r.status === 403 && r.data.needPassword === true && r.data.needDevice === false, JSON.stringify(r.data));
r = await call('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ password: 'wrong-password-1' }) }, B.tok, B.H);
t('B: неверный пароль — 401', r.status === 401 && r.data.error === 'invalid_credentials', JSON.stringify(r.data));
r = await call('/api/wallet', {}, B.tok, B.H);
t('B: после неверного пароля закрыт', r.status === 403);
r = await call('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ password: 'Correct-Horse-9' }) }, B.tok, B.H);
t('B: верный пароль открывает', r.status === 200 && r.data.unlocked === true, JSON.stringify(r.data));
r = await call('/api/wallet', {}, B.tok, B.H);
t('B: данные отданы', r.status === 200);
console.log(`${ok} ок, ${bad} провалов`); process.exit(bad ? 1 : 0);
