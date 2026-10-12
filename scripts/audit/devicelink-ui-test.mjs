// Вход по QR/коду — интерфейс (Playwright): экран консоли с кодом, телефон открывает ссылку из QR, подтверждает.
//   Нужны API и собранный сайт на :4173 (front.mjs с прокси), см. devicelink-test.mjs.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const email = `dlui${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
await new Promise((r) => setTimeout(r, 1200));
const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find((x) => /path=/i.test(x)) || 'path=/').split('=')[1].trim() }; });
let tok = r.data.accessToken;
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'DlUi', username: 'dlui' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id;
r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errs = [];
// «Консоль»: свой контекст без кук, user-agent PlayStation 5
const cctx = await br.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU', userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15' });
const c = await cctx.newPage(); c.on('pageerror', (e) => errs.push('console: ' + e.message.slice(0, 200)));
await c.goto(F + '/?console=true'); await c.waitForTimeout(2500);
await c.keyboard.press('Enter'); await c.waitForTimeout(1500);
const cbody = async () => (await c.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
let txt = await cbody();
t('консоль: экран «Вход в Sky» с QR и кодом', txt.includes('Вход в Sky') && /код подключения/i.test(txt) && /число для проверки/i.test(txt), txt.slice(0, 200));
t('консоль: есть QR-картинка', await c.locator('[aria-label="QR-код для входа"] svg').count() === 1);
t('консоль: есть запасной вход по почте', txt.includes('Войти по почте'));
const linkCode = (await c.locator('p[translate=no]').nth(0).innerText()).trim();
const verify = (await c.locator('p[translate=no]').nth(1).innerText()).trim();
t('код и число прочитаны с экрана', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(linkCode) && /^\d{2}$/.test(verify), linkCode + ' ' + verify);

// Телефон
const pctx = await br.newContext({ viewport: { width: 400, height: 860 }, locale: 'ru-RU' }); await pctx.addCookies(cookies);
const p = await pctx.newPage(); p.on('pageerror', (e) => errs.push('phone: ' + e.message.slice(0, 200)));
await p.goto(F + `/link?code=${linkCode.replace('-', '')}`); await p.waitForTimeout(3500);
const pbody = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
txt = await pbody();
t('телефон: по ссылке из QR сразу видны данные устройства', txt.includes('PlayStation 5') && txt.includes('Игровая консоль') && txt.includes('Адрес (IP)') && txt.includes('Просит войти в ваш Sky ID'), txt.slice(0, 300));
await c.waitForTimeout(2500);
t('консоль: видит, что код отсканирован', (await cbody()).includes('Код отсканирован'));
const wrong = verify === '00' ? '01' : '00';
await p.getByLabel('Число с экрана устройства').fill(wrong);
await p.getByText('Разрешить вход').click(); await p.waitForTimeout(800);
t('телефон: неверное число — понятная ошибка, вход не разрешён', (await pbody()).includes('Число не совпало'));
await p.getByLabel('Число с экрана устройства').fill(verify);
await p.getByText('Разрешить вход').click(); await p.waitForTimeout(1500);
t('телефон: вход разрешён', (await pbody()).includes('Вход разрешён'));
await c.waitForTimeout(4500);
txt = await cbody();
t('консоль: вошла сама, экран входа исчез', !/код подключения/i.test(txt) && !txt.includes('Вход в Sky'), txt.slice(0, 200));
await p.screenshot({ path: S + '/dl-phone.png' }); await c.screenshot({ path: S + '/dl-console.png' });

// Устройства: сессия консоли видна с пометкой
const dev = await call('/api/auth/devices', {}, tok);
t('в «Устройствах» есть сессия с пометкой привязки', dev.data.devices.some((d) => d.via?.kind === 'console'), JSON.stringify(dev.data).slice(0, 200));

// Отклонение
await cctx.clearCookies(); const c2 = await cctx.newPage(); await c2.goto(F + '/?console=true'); await c2.waitForTimeout(3500);
await c2.keyboard.press('Enter'); await c2.waitForTimeout(1500);
const code2 = (await c2.locator('p[translate=no]').nth(0).innerText()).trim();
await p.goto(F + `/link?code=${code2.replace('-', '')}`); await p.waitForTimeout(3000);
await p.getByRole('button', { name: 'Это не я' }).click(); await p.waitForTimeout(1200);
await c2.waitForTimeout(4000);
const t2 = (await c2.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
t('отказ на телефоне: консоль пишет об этом и предлагает новый код', t2.includes('отклонён') && t2.includes('Получить новый код'), t2.slice(0, 200));
t('нет ошибок страницы', errs.length === 0, errs.join(' | '));
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
