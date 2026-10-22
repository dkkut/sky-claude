// Приглашения новых людей (server/invites.mjs): ссылка, учёт регистрации, защита от «пригласил сам себя».
// (TEST_DATABASE_URL=… node scripts/audit/invites-test.mjs <каталог с api.log>)
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (dev, inv, ip) => ({ headers: { 'x-real-ip': ip, ...(dev ? { 'x-sky-device': dev } : {}), ...(inv ? { 'x-sky-invite': inv } : {}), 'user-agent': 'inv-test' } });
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const register = async (tag, dev, inv, ip) => {
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }), ...H(dev, inv, ip) }); await sleep(1300);
  const r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code: codeOf(email) }), ...H(dev, inv, ip) });
  return { r, email };
};

const A = await mkuser(S, 'inva');
let r = await call('/api/invite/me', {}, A.tok);
ok(r.status === 200 && /^[A-Z2-9]{8}$/.test(r.data.code) && r.data.count === 0 && r.data.link.includes('?inv=' + r.data.code), 'ссылка-приглашение выдана', r.text.slice(0, 120));
const code = r.data.code;
r = await call('/api/invite/me', {}, A.tok); ok(r.data.code === code, 'ссылка постоянная');
r = await call('/api/invite/me'); ok(r.status === 401, 'без входа ссылки нет');

// новый человек по ссылке, другое устройство
let n = await register('invb', 'device-new-bbbbbbbbbbbbbbbb', code, '198.51.100.7');
ok(n.r.status === 201 && n.r.data.isNew, 'новый человек зарегистрирован', String(n.r.status));
await sleep(500);
r = await call('/api/invite/me', {}, A.tok); ok(r.data.count === 1, 'регистрация засчитана', JSON.stringify(r.data));
// тот же человек входит повторно с кодом — второй раз не считается
const again = await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email: n.email }), ...H('device-new-bbbbbbbbbbbbbbbb', code, '198.51.100.7') }); await sleep(1300);
await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email: n.email, code: codeOf(n.email) }), ...H('device-new-bbbbbbbbbbbbbbbb', code, '198.51.100.7') });
r = await call('/api/invite/me', {}, A.tok); ok(r.data.count === 1, 'повторный вход приглашение не удваивает');
// мусорный код
n = await register('invc', 'device-new-cccccccccccccccc', 'ZZZZZZZZ', '198.51.100.8'); ok(n.r.status === 201, 'неизвестный код регистрацию не ломает');
n = await register('invd', 'device-new-dddddddddddddddd', "'; drop table x; --", '198.51.100.9'); ok(n.r.status === 201, 'мусорный заголовок регистрацию не ломает');
r = await call('/api/invite/me', {}, A.tok); ok(r.data.count === 1, 'чужие и мусорные коды не засчитаны');
// приглашение «самим собой»: пригласивший входит с устройства DEVA, затем новый Sky ID с DEVA по его коду
const DEVA = 'device-inviter-aaaaaaaaaaaa';
const mk2 = async (tag, dev, ip) => {
  const { r, email } = await register(tag, dev, '', ip);
  let tok = r.data.accessToken;
  const p = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag + Date.now().toString(36), acceptLegal: true }), ...H(dev, '', ip) }, tok);
  const pid = p.data.profile.id;
  const sel = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}', ...H(dev, '', ip) }, tok);
  return { tok: sel.data.accessToken ?? tok, pid, email };
};
const I2 = await mk2('invii', DEVA, '198.51.100.10');
const a2code = (await call('/api/invite/me', {}, I2.tok)).data.code;
ok(!!a2code, 'второй пригласивший получил ссылку');
n = await register('invself', DEVA, a2code, '198.51.100.11'); ok(n.r.status === 201, 'регистрация с того же устройства проходит');
await sleep(500);
r = await call('/api/invite/me', {}, I2.tok); ok(r.data.count === 0, 'приглашение самим собой (то же устройство) не засчитано', JSON.stringify(r.data));
console.log(`\n${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
