// Очистка сессий и заморозка новых входов (server/accountfreeze.mjs).
//   (. env.sh; node scripts/audit/accountfreeze-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const post = (p, b, tok, ip) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), headers: { 'x-real-ip': ip ?? `198.51.100.${(++n % 200) + 1}`, 'user-agent': 'TestAgent/1' } }, tok);
const get = (p, tok) => call(p, {}, tok);
const mailCode = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const lastLink = (email) => { const log = readFileSync(S + '/api.log', 'utf8'); const k = log.lastIndexOf(email + ' | Новые входы'); if (k < 0) return null; const m = /\/unfreeze\?t=([A-Za-z0-9_-]+)/.exec(log.slice(k)); return m ? m[1] : null; };
// вход по почте (как человек), возвращает токен
const login = async (email, ip) => {
  q(`delete from verification_codes where destination='${email}'`); // сбросить паузу между письмами
  await post('/api/auth/email/start', { email }, null, ip); await sleep(1300);
  const code = mailCode(email);
  return post('/api/auth/email/verify', { email, code }, null, ip);
};

const email = `frz${Date.now()}@example.com`;
let r = await login(email, '203.0.113.1');
let tok = r.data.accessToken;
r = await post('/api/skyid/profiles', { name: 'Frz', username: 'frz' + Date.now().toString(36), acceptLegal: true }, tok);
const pid = r.data.profile.id;
const sky = q(`select sky_id from profiles where id='${pid}'`);
// Чистое состояние: одна сессия — «основная»
await post('/api/auth/devices/revoke-all', {}, tok);
r = await login(email, '203.0.113.1'); const main = r.data.accessToken;
{ const x = await get('/api/auth/freeze', main); t('основная сессия работает', x.status === 200, JSON.stringify(x.data) + ' ' + r.status + JSON.stringify(r.data).slice(0,150)); }
t('состояние: не заморожен, почта подтверждена', (await get('/api/auth/freeze', main)).data.frozen === false && (await get('/api/auth/freeze', main)).data.hasEmail === true);

// Три «чужие» сессии разного возраста
const mk = async (ip) => (await login(email, ip)).data.accessToken;
const old = await mk('203.0.113.2'), mid = await mk('203.0.113.3'), fresh = await mk('203.0.113.4');
const ids = q(`select 1`) && (await get('/api/auth/devices', main)).data.devices;
t('в списке 4 сессии', ids.length === 4, String(ids.length));
const sid = (tk) => JSON.parse(Buffer.from(tk.split('.')[1], 'base64url').toString()).sid;
// Состарим: по ключам Redis
const rc = (a) => execSync(`redis-cli -p 6380 ${a}`).toString().trim();
const age = (id, hours) => { const k = `sess:${id}`; const v = JSON.parse(rc(`get ${k}`)); v.createdAt = Date.now() - hours * 3_600_000; const ttl = rc(`ttl ${k}`); execSync(`redis-cli -p 6380 setex ${k} ${ttl} '${JSON.stringify(v)}'`); };
age(sid(old), 24 * 20); age(sid(mid), 5); age(sid(fresh), 0.1);

// Валидация
r = await post('/api/auth/devices/protect', { remove: 'none' }, main);
t('ничего не выбрано — отказ', r.status === 400 && r.data.error === 'nothing_to_do');
r = await post('/api/auth/devices/protect', { remove: 'period', hours: 7 }, main);
t('неизвестный период — отказ', r.data.error === 'bad_period');
r = await post('/api/auth/devices/protect', { remove: 'none', freezeHours: 5 }, main);
t('неизвестный срок заморозки — отказ', r.data.error === 'bad_freeze');

// «Последний вход»
r = await post('/api/auth/devices/protect', { remove: 'last' }, main);
t('«последний вход» завершает ровно одну — самую свежую', r.status === 200 && r.data.removed === 1, JSON.stringify(r.data));
t('свежая сессия погашена, остальные живы', (await get('/api/auth/freeze', fresh)).status === 401 && (await get('/api/auth/freeze', mid)).status === 200 && (await get('/api/auth/freeze', old)).status === 200);
t('текущая сессия цела', (await get('/api/auth/freeze', main)).status === 200);

// «За период»: 24 часа — заденет mid (5 ч), но не old (20 дней)
r = await post('/api/auth/devices/protect', { remove: 'period', hours: 24 }, main);
t('период 24 ч завершает сессию, начатую 5 ч назад', r.data.removed === 1 && (await get('/api/auth/freeze', mid)).status === 401, JSON.stringify(r.data));
t('старая сессия (20 дней) остаётся', (await get('/api/auth/freeze', old)).status === 200);
t('текущая цела и при периоде «месяц»: (проверка ниже)', true);
r = await post('/api/auth/devices/protect', { remove: 'period', hours: 720 }, main);
t('период 30 дней завершает и старую, текущую — никогда', r.data.removed === 1 && (await get('/api/auth/freeze', old)).status === 401 && (await get('/api/auth/freeze', main)).status === 200, JSON.stringify(r.data));
r = await post('/api/auth/devices/protect', { remove: 'last' }, main);
t('когда других сессий нет — removed 0, не ошибка', r.status === 200 && r.data.removed === 0);

// Заморозка требует подтверждённой почты
q(`update sky_ids set email_verified=false where id='${sky}'`);
r = await post('/api/auth/devices/protect', { freezeHours: 1 }, main);
t('без подтверждённой почты заморозить нельзя (иначе не снять)', r.status === 409 && r.data.error === 'email_required');
q(`update sky_ids set email_verified=true where id='${sky}'`);

// Заморозка
r = await post('/api/auth/devices/protect', { freezeHours: 24 }, main);
t('заморозка включена на сутки', r.status === 200 && r.data.frozenUntil, JSON.stringify(r.data));
await sleep(800);
const token = lastLink(email);
t('на почту ушло письмо со ссылкой /unfreeze?t=', Boolean(token), 'нет ссылки в журнале');
t('в базе нет самого токена', !q(`select freeze_token_hash from sky_ids where id='${sky}'`).includes(token));
let st = (await get('/api/auth/freeze', main)).data;
t('состояние: заморожен, ссылка не подтверждена, баннера нет', st.frozen && st.linkConfirmed === false && st.until);

// Новые входы закрыты всеми способами
q(`delete from verification_codes where destination='${email}'`);
await post('/api/auth/email/start', { email }, null, '203.0.113.50'); await sleep(1300);
r = await post('/api/auth/email/verify', { email, code: mailCode(email) }, null, '203.0.113.50');
t('вход по коду с почты — 423 account_frozen', r.status === 423 && r.data.error === 'account_frozen' && r.data.until, JSON.stringify(r.data));
t('сессия при этом не создана', !r.data.accessToken);
// пароль
const hashPw = (await import('../../server/security.mjs')).hashPassword ? await (await import('../../server/security.mjs')).hashPassword('Str0ng-Passw0rd!') : null;
if (hashPw) {
  q(`update sky_ids set password_hash='${hashPw}', password_set_at=now() where id='${sky}'`);
  r = await post('/api/auth/password/login', { email, password: 'Str0ng-Passw0rd!' }, null, '203.0.113.51');
  t('вход по паролю — тоже 423', r.status === 423, JSON.stringify(r.data).slice(0, 120));
}
// вход по QR: подтвердить чужое устройство нельзя
r = await post('/api/auth/link/start', { kind: 'tv' }); const dl = r.data;
r = await post('/api/skyid/link/decide', { id: dl.id, approve: true, verify: dl.verify }, main);
t('подтвердить вход ТВ по QR во время заморозки нельзя', r.status === 423);
t('уже открытая сессия во время заморозки работает', (await get('/api/auth/devices', main)).status === 200);
const tries = q(`select count(*) from account_freeze_log where sky_id='${sky}' and kind='blocked_login'`);
t('попытка входа записана (не дублируется чаще раза в 10 минут)', tries === '1', tries);
st = (await get('/api/auth/freeze', main)).data;
t('в состоянии видна попытка входа с адресом', st.events.some((e) => e.kind === 'blocked_login' && e.ip));

// Разморозка: без ссылки нельзя
r = await post('/api/auth/freeze/unfreeze', {}, main);
t('без ссылки из письма разморозить нельзя', r.status === 409 && r.data.error === 'link_required');
// Заморозку нельзя «сократить» повторным включением
const until1 = q(`select login_frozen_until from sky_ids where id='${sky}'`);
await post('/api/auth/devices/protect', { freezeHours: 1 }, main);
t('повторная заморозка на 1 ч не укорачивает сутки', q(`select login_frozen_until from sky_ids where id='${sky}'`) !== '' && q(`select login_frozen_until > now() + interval '23 hours' from sky_ids where id='${sky}'`) === 't');
await sleep(600);
const token2 = lastLink(email);
// Ссылка: плохая / настоящая
r = await post('/api/auth/freeze/link', { t: 'x'.repeat(40) });
t('чужая ссылка не принимается', r.status === 404);
r = await post('/api/auth/freeze/link', { t: token });
t('прежняя ссылка погасла после выпуска новой (токен один актуальный)', r.status === 404, JSON.stringify(r.data));
r = await post('/api/auth/freeze/link', { t: token2 });
t('актуальная ссылка из письма подтверждена без входа в аккаунт', r.status === 200 && r.data.ok);
r = await post('/api/auth/freeze/link', { t: token2 });
t('ссылка одноразовая', r.status === 404);
st = (await get('/api/auth/freeze', main)).data;
t('теперь баннер: linkConfirmed = true', st.linkConfirmed === true && st.linkUntil);
r = await login(email, '203.0.113.60');
t('но сама ссылка вход не разморозила', r.status === 423);

// Аутентификатор
const secret = generateSecret();
q(`update sky_ids set two_factor_enabled=true, two_factor_method='app', two_factor_secret='${encryptSecret(secret)}' where id='${sky}'`);
r = await post('/api/auth/freeze/unfreeze', {}, main);
t('при включённом аутентификаторе нужен его код', r.data.error === 'totp_required');
r = await post('/api/auth/freeze/unfreeze', { totp: '000000' }, main);
t('неверный код — отказ', r.data.error === 'bad_code');
t('без сессии разморозить нельзя', (await post('/api/auth/freeze/unfreeze', { totp: currentTotp(secret) })).status === 401);
r = await post('/api/auth/freeze/unfreeze', { totp: currentTotp(secret) }, main);
t('ссылка + сессия + код — разморожено', r.status === 200 && r.data.ok, JSON.stringify(r.data));
q(`update sky_ids set two_factor_enabled=false, two_factor_secret=NULL where id='${sky}'`);
st = (await get('/api/auth/freeze', main)).data;
t('состояние: не заморожен', st.frozen === false && st.linkConfirmed === false);
r = await login(email, '203.0.113.61');
t('новые входы снова работают', r.status === 200 && r.data.accessToken);

// Окно ссылки истекло
await post('/api/auth/devices/protect', { freezeHours: 1 }, main); await sleep(500);
const token3 = lastLink(email);
await post('/api/auth/freeze/link', { t: token3 });
q(`update sky_ids set freeze_link_ok_until = now() - interval '1 minute' where id='${sky}'`);
r = await post('/api/auth/freeze/unfreeze', {}, main);
t('окно после открытия ссылки (30 мин) истекло — нужна новая ссылка', r.data.error === 'link_required');
r = await post('/api/auth/freeze/resend', {}, main); await sleep(500);
t('письмо можно запросить заново', r.status === 200 && lastLink(email) && lastLink(email) !== token3);
// Автоокончание
q(`update sky_ids set login_frozen_until = now() - interval '1 second' where id='${sky}'`);
r = await login(email, '203.0.113.62');
t('заморозка кончается сама по сроку', r.status === 200 && r.data.accessToken);
// Чужая учётная запись не затрагивается
const other = `frz2${Date.now()}@example.com`; r = await login(other, '203.0.113.70');
t('чужой аккаунт замороженным не стал', r.status === 200 || r.status === 201);
// Гонка: два одновременных unfreeze
await post('/api/auth/devices/protect', { freezeHours: 1 }, main); await sleep(500);
await post('/api/auth/freeze/link', { t: lastLink(email) });
const both = await Promise.all([1, 2].map(() => post('/api/auth/freeze/unfreeze', {}, main)));
t('два одновременных «Разморозить» — оба без ошибок', both.every((x) => x.status === 200));
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
