// PIN при смене IP — интерфейс (Playwright): экран блокировки с нового адреса, ввод PIN, сброс, настройки.
//   Нужны API и собранный сайт на :4173 (front.mjs с прокси), см. ippin-test.mjs.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };

const email = `pinui${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
await new Promise((r) => setTimeout(r, 1200));
const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find((x) => /path=/i.test(x)) || 'path=/').split('=')[1].trim() }; });
let tok = r.data.accessToken;
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'PinUi', username: 'pinui' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id;
r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok); tok = r.data.accessToken ?? tok;
const secret = generateSecret();
q(`update sky_ids set two_factor_enabled=true, two_factor_method='app', two_factor_secret='${encryptSecret(secret)}' where id=(select sky_id from profiles where id='${pid}')`);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 420, height: 860 }, locale: 'ru-RU' }); await ctx.addCookies(cookies);
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
let fakeIp = '';
await p.route('**/api/**', (route) => { const h = { ...route.request().headers() }; if (fakeIp) h['x-real-ip'] = fakeIp; return route.continue({ headers: h }); });
const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

// 1) настройка в Профиль → Sky ID → Защита
await p.goto(F + '/'); await p.waitForTimeout(3500);
await p.getByText('Профиль', { exact: true }).last().click().catch(() => {}); await p.waitForTimeout(1500);
for (const name of ['Sky ID']) await p.getByText(name, { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
await p.waitForTimeout(800);
await p.getByText('Защита', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
await p.waitForTimeout(1200);
t('UI 1. в «Защите» есть блок «PIN-код при смене IP»', /PIN-код при смене IP/.test(await body()), (await body()).slice(0, 300));
await p.getByText('Включить PIN', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
await p.getByLabel('PIN', { exact: true }).fill('2468').catch(() => {});
await p.getByLabel('Повтор PIN').fill('2468').catch(() => {});
await p.getByLabel('Код из аутентификатора').fill(currentTotp(secret)).catch(() => {});
await p.getByRole('button', { name: /^Включить$/ }).click({ timeout: 3000 }).catch(() => {});
await p.waitForTimeout(1500);
t('UI 2. PIN включён через настройки', /PIN включён/.test(await body()) && q(`select ip_pin_enabled from sky_ids where id=(select sky_id from profiles where id='${pid}')`) === 't', (await body()).slice(0, 300));
await p.screenshot({ path: S + '/pin-settings.png' });

// 2) новый адрес → экран блокировки
fakeIp = '198.51.100.77';
await p.reload(); await p.waitForTimeout(3500);
t('UI 3. с нового адреса — экран «Подтвердите, что это вы»', /Подтвердите, что это вы/.test(await body()), (await body()).slice(0, 200));
await p.screenshot({ path: S + '/pin-lock.png' });
const dlg = p.getByRole('dialog');
await dlg.getByLabel('PIN-код').fill('1111'); await p.waitForTimeout(1200);
t('UI 4. неверный PIN: сообщение и остаётся экран', /Неверный PIN-код/.test(await body()) && /Подтвердите, что это вы/.test(await body()), (await body()).slice(0, 300));
await dlg.getByLabel('PIN-код').fill('2468'); await p.waitForTimeout(3500);
t('UI 5. верный PIN: экран снят, приложение работает', !/Подтвердите, что это вы/.test(await body()) && /Чаты|Лента|Медиа/.test(await body()), (await body()).slice(0, 200));

// 3) сброс забытого PIN через интерфейс
fakeIp = '198.51.100.88';
await p.reload(); await p.waitForTimeout(3500);
await p.getByText('Забыли PIN?', { exact: true }).click({ timeout: 3000 });
await p.getByText('Отправить код на почту').click(); await p.waitForTimeout(1500);
const rc = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| Сброс PIN-кода Sky ID \\| Код для сброса PIN-кода: (\\d{6})', 'g'))].pop()?.[1];
t('UI 6. код сброса пришёл на почту', Boolean(rc));
await p.getByLabel('Код с почты').fill(rc ?? '000000');
await p.getByLabel('Код из аутентификатора').fill(currentTotp(secret));
await p.getByLabel('Новый PIN').fill('1357');
await p.getByText('Задать новый PIN').click(); await p.waitForTimeout(3500);
t('UI 7. сброс по двум кодам: экран снят, PIN заменён', !/Подтвердите, что это вы/.test(await body()) && q(`select ip_pin_fails from sky_ids where id=(select sky_id from profiles where id='${pid}')`) === '0', (await body()).slice(0, 200));
const vr = await call('/api/skyid/pin/verify', { method: 'POST', body: JSON.stringify({ pin: '1357' }), headers: { 'x-real-ip': '198.51.100.99' } }, tok);
t('UI 8. новый PIN действует', vr.status === 200 && vr.data.ok, JSON.stringify(vr.data));
t('UI 9. без ошибок JS', errs.length === 0, errs.join('|'));
await br.close();
console.log(`\nИТОГО: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
