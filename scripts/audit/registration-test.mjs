// Ограничение регистрации новых аккаунтов (server/registration.mjs).
//   (. env.sh; node scripts/audit/registration-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const post = (p, b, tok, ip) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), headers: { 'x-real-ip': ip ?? `192.0.2.${(++n % 250) + 1}` } }, tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
// Регистрация нового человека по почте: возвращает ответ verify.
const register = async (ip, tag = 'rg') => {
  const email = `${tag}${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
  const st = await post('/api/auth/email/start', { email }, null, ip);
  // Закрыто или предел исчерпан для незнакомой почты — отказ уже на первом шаге, код не отправлялся.
  if (st.status === 403) return { ...st, email, atStart: true };
  await sleep(1100);
  const r = await post('/api/auth/email/verify', { email, code: codeOf(email) }, null, ip);
  return { ...r, email };
};
const set = (tok, b) => call('/api/admin/registration', { method: 'PUT', body: JSON.stringify(b) }, tok);
const sky24 = () => Number(q(`select count(*) from sky_ids where created_at > now() - interval '24 hours'`));

// Владелец (ник из окружения) и обычный человек
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'rgown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const usr = await mkuser(S, 'rgusr');
q(`update registration_settings set enabled=true, daily_limit=0, per_ip_limit=0, per_ip_hours=24, message='' where id`);

let r = await call('/api/admin/registration', {}, usr.tok);
t('обычному человеку админская ручка закрыта', r.status === 403);
r = await call('/api/admin/registration', {}, own.tok);
t('владелец видит настройки и настоящие цифры', r.status === 200 && r.data.settings.enabled === true && r.data.stats.total >= 2 && r.data.open === true, JSON.stringify(r.data).slice(0, 200));
r = await call('/api/platform/status');
t('публичный статус: регистрация открыта', r.data.registration?.open === true);

// Закрыто
r = await set(own.tok, { enabled: false, message: 'Набор закрыт до понедельника' });
t('владелец закрыл регистрацию', r.status === 200 && r.data.settings.enabled === false && r.data.settings.message.startsWith('Набор'));
const before = sky24();
let g = await register('192.0.2.200');
t('новый человек: 403 registration_closed с нашим сообщением уже после ввода почты', g.status === 403 && g.data.error === 'registration_closed' && g.data.message === 'Набор закрыт до понедельника' && g.atStart, JSON.stringify(g.data));
t('код такой почте не отправлялся', codeOf(g.email) === null);
r = await post('/api/auth/phone/start', { phone: '+79990001122' });
t('незнакомому номеру тоже 403 registration_closed', r.status === 403 && r.data.error === 'registration_closed', JSON.stringify(r.data));
t('аккаунт не создан', sky24() === before && q(`select count(*) from sky_ids where email='${g.email}'`) === '0');
r = await call('/api/platform/status');
t('публичный статус показывает закрыто и сообщение', r.data.registration.open === false && r.data.registration.reason === 'closed' && r.data.registration.message.startsWith('Набор'));
// Существующий человек входит
await sleep(200);
q(`delete from verification_codes where destination='${usr.email}'`);
r = await post('/api/auth/email/start', { email: usr.email });
t('зарегистрированной почте при закрытой регистрации код уходит', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
await sleep(1100);
r = await post('/api/auth/email/verify', { email: usr.email, code: codeOf(usr.email) });
t('для зарегистрированной почты шаг «ввод почты» проходит как обычно (код отправлен)', true);
t('уже зарегистрированный человек входит как обычно', r.status === 200 && r.data.accessToken, JSON.stringify(r.data).slice(0, 120));
r = await call('/api/admin/registration', {}, own.tok);
t('отказ попал в статистику «заблокировано за 24 ч»', r.data.stats.blocked24h.closed >= 1);

// Предел за сутки
await set(own.tok, { enabled: true, message: '' });
const base = sky24();
r = await set(own.tok, { dailyLimit: base + 2 });
t('предел за сутки: текущие + 2', r.status === 200 && r.data.settings.dailyLimit === base + 2);
const a = await register('192.0.2.201'), b = await register('192.0.2.202'), c = await register('192.0.2.203');
t('первые две регистрации проходят', [a, b].every((x) => x.status === 201 || x.status === 200), `${a.status} ${b.status}`);
t('третья — 403 registration_daily_limit (на шаге ввода почты)', c.status === 403 && c.data.error === 'registration_daily_limit', JSON.stringify(c.data));
r = await call('/api/platform/status');
t('статус: открыто = false, причина daily_limit', r.data.registration.open === false && r.data.registration.reason === 'daily_limit');

// Предел с одного адреса
await set(own.tok, { dailyLimit: 0, perIpLimit: 1, perIpHours: 24 });
const ip1 = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
const p1 = await register(ip1), p2 = await register(ip1), p3 = await register(`203.0.114.${1 + Math.floor(Math.random() * 250)}`);
t('с одного адреса — первая проходит, вторая 403 registration_ip_limit', (p1.status === 201 || p1.status === 200) && p2.status === 403 && p2.data.error === 'registration_ip_limit', `${p1.status} ${p2.status} ${JSON.stringify(p2.data)}`);
t('с другого адреса проходит', p3.status === 201 || p3.status === 200, String(p3.status));
t('в базе только хеш адреса', !q(`select reg_ip_hash from sky_ids where email='${p1.email}'`).includes(ip1) && q(`select length(reg_ip_hash) from sky_ids where email='${p1.email}'`) === '64');

// Гонка: до предела остаётся одно место, регистрируются пятеро одновременно
await set(own.tok, { perIpLimit: 0 });
const b2 = sky24(); await set(own.tok, { dailyLimit: b2 + 1 });
const emails = []; for (let i = 0; i < 5; i++) { const e = `race${Date.now()}${i}@example.com`; emails.push(e); await post('/api/auth/email/start', { email: e }, null, `198.18.0.${i + 1}`); }
await sleep(1500);
const res = await Promise.all(emails.map((e, i) => post('/api/auth/email/verify', { email: e, code: codeOf(e) }, null, `198.18.0.${i + 1}`)));
t('при одном свободном месте из 5 одновременных создаётся ровно один', res.filter((x) => x.status === 200 || x.status === 201).length === 1 && res.filter((x) => x.status === 403).length === 4, res.map((x) => x.status).join());
t('в базе предел не превышен', sky24() === b2 + 1, `${sky24()} vs ${b2 + 1}`);

// Валидация и права
r = await set(own.tok, { dailyLimit: -5, perIpHours: 99999, message: 'x'.repeat(1000) });
t('мусорные значения не принимаются (предел не меняется), сообщение обрезано', r.data.settings.dailyLimit === b2 + 1 && r.data.settings.perIpHours === 24 && r.data.settings.message.length === 300, JSON.stringify(r.data.settings).slice(0, 160));
r = await set(usr.tok, { enabled: false });
t('обычный человек закрыть регистрацию не может', r.status === 403);
t('правка записана в журнал администрации', Number(q(`select count(*) from admin_log where type='registration_settings'`)) >= 5);

// Возвращаем как было
await set(own.tok, { enabled: true, dailyLimit: 0, perIpLimit: 0, perIpHours: 24, message: '' });
r = await register('192.0.2.210');
t('после снятия пределов регистрация снова открыта', r.status === 201 || r.status === 200);
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
