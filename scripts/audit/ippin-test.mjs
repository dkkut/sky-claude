// PIN-код при смене IP (server/ippin.mjs): включение, блокировка нового адреса, перебор, сброс через
// код на почту + код аутентификатора, сокет.
//   (. env.sh; node scripts/audit/ippin-test.mjs <каталог с api.log>)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const require = createRequire(new URL('../../server/', import.meta.url));
const WebSocket = require('ws');
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const from = (ip) => ({ headers: { 'x-real-ip': ip } });
const post = (p, b, tok, ip = '127.0.0.1') => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), ...from(ip) }, tok);
const get = (p, tok, ip = '127.0.0.1') => call(p, { ...from(ip) }, tok);
const NEW1 = '198.51.100.10', NEW2 = '198.51.101.20';
const skyOf = (u) => q(`select sky_id from profiles where id='${u.pid}'`);
const mailCode = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| Сброс PIN-кода Sky ID \\| Код для сброса PIN-кода: (\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };

const u = await mkuser(S, 'pinA'), other = await mkuser(S, 'pinB');
const secret = generateSecret();

let r = await get('/api/skyid/pin', u.tok);
t('состояние: PIN выключен, включить нельзя (нет аутентификатора)', r.status === 200 && r.data.enabled === false && r.data.canEnable === false && r.data.missing.authenticator, JSON.stringify(r.data));
r = await post('/api/skyid/pin/enable', { pin: '1234', totp: '000000' }, u.tok);
t('без аутентификатора PIN не включить', r.status === 400 && r.data.error === 'authenticator_required', JSON.stringify(r.data));
q(`update sky_ids set two_factor_enabled=true, two_factor_method='app', two_factor_secret='${encryptSecret(secret)}' where id='${skyOf(u)}'`);
r = await post('/api/skyid/pin/enable', { pin: '12', totp: currentTotp(secret) }, u.tok);
t('PIN — ровно четыре цифры', r.status === 400 && r.data.error === 'bad_pin');
r = await post('/api/skyid/pin/enable', { pin: 'abcd', totp: currentTotp(secret) }, u.tok);
t('буквы вместо цифр не принимаются', r.data.error === 'bad_pin');
r = await post('/api/skyid/pin/enable', { pin: '1234', totp: '000000' }, u.tok);
t('неверный код аутентификатора — PIN не включается', r.data.error === 'bad_code');
r = await post('/api/skyid/pin/enable', { pin: '1234', totp: currentTotp(secret) }, u.tok);
t('PIN включён', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('в базе — только хеш', !q(`select ip_pin_hash from sky_ids where id='${skyOf(u)}'`).includes('1234') && q(`select ip_pin_hash from sky_ids where id='${skyOf(u)}'`).includes(':'));

// адрес входа и новый адрес
r = await get('/api/skyid/profiles', u.tok);
t('с адреса входа всё работает без PIN', r.status === 200, JSON.stringify(r.data).slice(0, 80));
r = await get('/api/skyid/profiles', u.tok, NEW1);
t('с нового адреса — 403 pin_required', r.status === 403 && r.data.error === 'pin_required', `${r.status} ${JSON.stringify(r.data)}`);
r = await post('/api/music/ticket', {}, u.tok, NEW1);
t('и запись с нового адреса закрыта', r.status === 403 && r.data.error === 'pin_required');
r = await get('/api/skyid/pin', u.tok, NEW1);
t('ручки PIN с нового адреса открыты', r.status === 200 && r.data.enabled === true);
r = await get('/api/skyid/profiles', other.tok, NEW1);
t('у человека без PIN смена адреса ничего не меняет', r.status === 200);

// сокет с нового адреса
const wsAuth = (tok, ip) => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:8081', { headers: { origin: process.env.WS_ORIGIN || 'http://localhost:4173', 'x-real-ip': ip } });
  const ev = []; ws.on('message', (d) => { try { ev.push(JSON.parse(d).type); } catch {} });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: tok } })));
  ws.on('close', () => res(ev.includes('auth-failed') ? 'failed' : ev.includes('snapshot-done') ? 'ok' : 'closed'));
  setTimeout(() => { const v = ev.includes('snapshot-done') ? 'ok' : ev.includes('auth-failed') ? 'failed' : 'timeout'; ws.close(); res(v); }, 2500);
});
t('сокет с нового адреса закрыт', (await wsAuth(u.tok, NEW1)) === 'failed');
t('сокет с адреса входа работает', (await wsAuth(u.tok, '127.0.0.1')) === 'ok');

// перебор
r = await post('/api/skyid/pin/verify', { pin: '0000' }, u.tok, NEW1);
t('неверный PIN: осталось 4 попытки', r.status === 400 && r.data.error === 'wrong_pin' && r.data.left === 4, JSON.stringify(r.data));
for (let i = 0; i < 4; i++) r = await post('/api/skyid/pin/verify', { pin: '0000' }, u.tok, NEW1);
t('5 неверных — ввод заблокирован на 15 минут', r.status === 429 && r.data.error === 'locked' && r.data.lockedFor >= 800, JSON.stringify(r.data));
r = await post('/api/skyid/pin/verify', { pin: '1234' }, u.tok, NEW1);
t('во время блокировки даже верный PIN не принимается', r.status === 429 && r.data.error === 'locked');
q(`update sky_ids set ip_pin_locked_until = null where id='${skyOf(u)}'`);
r = await post('/api/skyid/pin/verify', { pin: '1234' }, u.tok, NEW1);
t('после блокировки верный PIN открывает адрес', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await get('/api/skyid/profiles', u.tok, NEW1);
t('адрес NEW1 для этой сессии запомнен', r.status === 200);
r = await get('/api/skyid/profiles', u.tok, NEW2);
t('другой новый адрес снова закрыт', r.status === 403 && r.data.error === 'pin_required');
t('верный ввод сбросил счётчик', q(`select ip_pin_fails from sky_ids where id='${skyOf(u)}'`) === '0');
t('сокет с подтверждённого адреса работает', (await wsAuth(u.tok, NEW1)) === 'ok');

// смена и выключение
r = await post('/api/skyid/pin/change', { pin: '9999', newPin: '4321' }, u.tok);
t('смена PIN: старый неверный — отказ', r.data.error === 'wrong_pin');
r = await post('/api/skyid/pin/change', { pin: '1234', newPin: '43' }, u.tok);
t('смена PIN: новый обязан быть из 4 цифр', r.data.error === 'bad_pin');
r = await post('/api/skyid/pin/change', { pin: '1234', newPin: '4321' }, u.tok);
t('PIN сменён', r.status === 200 && r.data.ok);
r = await post('/api/skyid/pin/verify', { pin: '1234' }, u.tok, NEW2);
t('старый PIN больше не подходит', r.data.error === 'wrong_pin');
r = await post('/api/skyid/pin/verify', { pin: '4321' }, u.tok, NEW2);
t('новый подходит', r.status === 200);

// сброс: код на почту + код аутентификатора
q(`update sky_ids set ip_pin_fails = 0, ip_pin_locked_until = null where id='${skyOf(u)}'`);
const NEW3 = '198.51.102.30';
r = await post('/api/skyid/pin/reset/finish', { emailCode: '123456', totp: currentTotp(secret), newPin: '1111' }, u.tok, NEW3);
t('сброс без запроса кода на почту невозможен', r.data.error === 'no_request', JSON.stringify(r.data));
r = await post('/api/skyid/pin/reset/start', {}, u.tok, NEW3);
t('код сброса отправлен на почту (с закрытого адреса — ручка открыта)', r.status === 200 && r.data.ok && /•••/.test(r.data.emailHint), JSON.stringify(r.data));
await sleep(900);
const code = mailCode(u.email);
t('письмо с кодом пришло', Boolean(code));
r = await post('/api/skyid/pin/reset/finish', { emailCode: code, totp: '000000', newPin: '1111' }, u.tok, NEW3);
t('верный код с почты, но неверный аутентификатор — отказ', r.data.error === 'bad_codes' && r.data.left === 4, JSON.stringify(r.data));
r = await post('/api/skyid/pin/reset/finish', { emailCode: '000000', totp: currentTotp(secret), newPin: '1111' }, u.tok, NEW3);
t('верный аутентификатор, но неверный код с почты — отказ', r.data.error === 'bad_codes');
t('причина не раскрывает, какой из кодов неверный', true);
r = await get('/api/skyid/profiles', u.tok, NEW3);
t('после неудачных попыток адрес всё ещё закрыт', r.status === 403);
r = await post('/api/skyid/pin/reset/finish', { emailCode: code, totp: currentTotp(secret), newPin: '1111' }, u.tok, NEW3);
t('оба кода верны — PIN заменён, адрес открыт', r.status === 200 && r.data.ok && r.data.enabled === true, JSON.stringify(r.data));
r = await get('/api/skyid/profiles', u.tok, NEW3);
t('сессия работает с адреса сброса', r.status === 200);
r = await post('/api/skyid/pin/reset/finish', { emailCode: code, totp: currentTotp(secret), newPin: '2222' }, u.tok, NEW3);
t('код сброса одноразовый', r.data.error === 'no_request');
r = await post('/api/skyid/pin/verify', { pin: '1111' }, u.tok, NEW1);
t('новый PIN (после сброса) работает', r.status === 200);

// сброс с выключением
await post('/api/skyid/pin/reset/start', {}, u.tok); await sleep(900);
r = await post('/api/skyid/pin/reset/finish', { emailCode: mailCode(u.email), totp: currentTotp(secret) }, u.tok);
t('сброс без нового PIN выключает защиту', r.status === 200 && r.data.enabled === false, JSON.stringify(r.data));
r = await get('/api/skyid/profiles', u.tok, '203.0.113.99');
t('после выключения новый адрес не требует PIN', r.status === 200);

// 10 неверных — сессия завершается
r = await post('/api/skyid/pin/enable', { pin: '5555', totp: currentTotp(secret) }, u.tok);
q(`update sky_ids set ip_pin_fails = 0, ip_pin_locked_until = null where id='${skyOf(u)}'`);
let last;
for (let i = 0; i < 10; i++) { q(`update sky_ids set ip_pin_locked_until = null where id='${skyOf(u)}'`); last = await post('/api/skyid/pin/verify', { pin: '0001' }, u.tok, '203.0.113.50'); }
t('10-я неверная попытка завершает сессию', last.data.error === 'session_ended' || last.status === 401, JSON.stringify(last.data));
r = await get('/api/skyid/profiles', u.tok);
t('токен подбиравшего больше не работает', r.status === 401);

console.log(`\nИТОГО: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
