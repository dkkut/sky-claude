// Доверенные устройства: пропуск кода профиля в Car/Console/TV (server/trusteddevices.mjs).
// Запуск: node scripts/audit/trusted-test.mjs <каталог с api.log>   (API на :8080)
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { call } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const DEV = 'dev' + 'A'.repeat(24); const OTHER = 'dev' + 'B'.repeat(24);

const email = `trust${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }, null, { 'x-sky-device': DEV });
await new Promise((r) => setTimeout(r, 1500));
const log = readFileSync(S + '/api.log', 'utf8');
const code = [...log.matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) }, null, { 'x-sky-device': DEV });
const tok = r.data.accessToken;
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'Tr', username: 'tr' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id;
t('устройство запомнено после входа по коду', Number(q(`select count(*) from sky_trusted_devices where sky_id=(select sky_id from profiles where id='${pid}')`)) === 1);

// профиль под вторым фактором (код по почте)
q(`update profiles set two_factor_enabled=true, two_factor_method='email' where id='${pid}'`);
const sel = (extra) => call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok, extra);
r = await sel({ 'x-sky-device': DEV, 'x-sky-mode': 'car' });
t('по умолчанию код нужен и в Car', r.status === 401 && r.data.error === 'profile_code_required', JSON.stringify(r.data));

r = await call(`/api/skyid/profiles/${pid}/skip-code`, { method: 'POST', body: JSON.stringify({ on: true }) }, tok);
t('включить пропуск без кода нельзя', r.status === 401 && r.data.error === 'profile_code_required', JSON.stringify(r.data));
q(`update profiles set skip_code_trusted=true where id='${pid}'`);   // включено владельцем с кодом (проверка кода — через verifyProfileTwoFactor)

r = await sel({ 'x-sky-device': DEV, 'x-sky-mode': 'car' });
t('доверенное устройство + Car → без кода', r.status === 200 && r.data.activeProfileId === pid, JSON.stringify(r.data).slice(0, 150));
r = await sel({ 'x-sky-device': DEV, 'x-sky-mode': 'console' });
t('Console тоже', r.status === 200);
r = await sel({ 'x-sky-device': DEV });
t('обычный режим: код нужен всегда', r.status === 401, String(r.status));
r = await sel({ 'x-sky-device': OTHER, 'x-sky-mode': 'car' });
t('чужое устройство: код нужен', r.status === 401);
r = await sel({ 'x-sky-mode': 'car' });
t('без идентификатора устройства: код нужен', r.status === 401);
r = await sel({ 'x-sky-device': DEV, 'x-sky-mode': 'web' });
t('неизвестный режим: код нужен', r.status === 401);

r = await call('/api/skyid/trusted-devices', {}, tok, { 'x-sky-device': DEV });
t('список устройств, текущее помечено', r.status === 200 && r.data.devices.length === 1 && r.data.devices[0].current === true, JSON.stringify(r.data));
const id = r.data.devices[0].id;
r = await call(`/api/skyid/trusted-devices/${id}`, { method: 'DELETE' }, tok);
t('устройство убрано', r.status === 200);
r = await sel({ 'x-sky-device': DEV, 'x-sky-mode': 'car' });
t('после удаления код снова нужен', r.status === 401);
r = await call(`/api/skyid/profiles/${pid}/skip-code`, { method: 'POST', body: JSON.stringify({ on: false }) }, tok);
t('выключить пропуск можно без кода', r.status === 200 && q(`select skip_code_trusted from profiles where id='${pid}'`) === 'f');
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
