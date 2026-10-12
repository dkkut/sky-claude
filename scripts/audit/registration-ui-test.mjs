// Ограничение регистрации и стрелки в админке — интерфейс (Playwright).
//   Нужны API и собранный сайт на :4173 (front.mjs с прокси), см. registration-test.mjs.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
q(`update registration_settings set enabled=true, daily_limit=0, per_ip_limit=0, message='' where id`);
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const email = `rgui${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
await new Promise((r) => setTimeout(r, 1200));
const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find((x) => /path=/i.test(x)) || 'path=/').split('=')[1].trim() }; });
let tok = r.data.accessToken;
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'RgUi', username: 'rgui' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id; q(`update profiles set username='ownertest' where id='${pid}'`);
await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 900, height: 900 }, locale: 'ru-RU' }); await ctx.addCookies(cookies);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
await p.goto(F + '/'); await p.waitForTimeout(3500);
await p.getByText('Медиа', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1200);
await p.getByText('Admin', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(2500);
t('админка открылась (есть вкладка «Регистрация»)', /Регистрация/.test(await body()), (await body()).slice(0, 300));
// Стрелки
const right = p.getByLabel('Прокрутить вправо').first();
t('на узкой ленте вкладок есть стрелка вправо', await right.count() > 0 && await right.isVisible());
const left0 = await p.getByLabel('Прокрутить влево').count();
t('в начале ленты стрелки влево нет', left0 === 0);
const sc0 = await p.evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => d.scrollWidth > d.clientWidth + 20 && getComputedStyle(d).overflowX === 'auto' && d.textContent.includes('Мониторинг')); return el ? el.scrollLeft : -1; });
await right.click(); await p.waitForTimeout(700);
const sc1 = await p.evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => d.scrollWidth > d.clientWidth + 20 && getComputedStyle(d).overflowX === 'auto' && d.textContent.includes('Мониторинг')); return el ? el.scrollLeft : -1; });
t('клик по стрелке прокручивает ленту вбок', sc1 > sc0, `${sc0} → ${sc1}`);
t('после прокрутки появилась стрелка влево', await p.getByLabel('Прокрутить влево').count() > 0);
await p.screenshot({ path: S + '/rg-arrows.png' });
await p.getByLabel('Прокрутить влево').first().click(); await p.waitForTimeout(700);

// Вкладка «Регистрация»
await p.getByRole('button', { name: 'Регистрация', exact: true }).first().click(); await p.waitForTimeout(1500);
let txt = await body();
t('вкладка показывает «Регистрация открыта» и настоящие числа', /Регистрация открыта/.test(txt) && /Всего аккаунтов/.test(txt) && /Новых за 24 часа/.test(txt), txt.slice(0, 300));
await p.getByLabel('Принимать новые регистрации').uncheck();
await p.getByLabel('Предел в сутки').fill('5');
await p.getByLabel('Сообщение людям').fill('Набор откроется в понедельник');
await p.getByRole('button', { name: 'Сохранить' }).click(); await p.waitForTimeout(1500);
t('сохранено на сервере', q(`select enabled::text||daily_limit||message from registration_settings where id`) === 'false5Набор откроется в понедельник', q(`select enabled::text||daily_limit||message from registration_settings where id`));
txt = await body();
t('вкладка сразу показывает «закрыта»', /закрыта для новых людей/.test(txt));
await p.screenshot({ path: S + '/rg-tab.png' });

// Экран входа без сессии: баннер
const c2 = await br.newContext({ viewport: { width: 420, height: 800 }, locale: 'ru-RU' }); const p2 = await c2.newPage();
await p2.goto(F + '/'); await p2.waitForTimeout(4000);
const t2 = (await p2.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
t('экран входа предупреждает, что регистрация закрыта, и показывает сообщение', /Регистрация новых аккаунтов сейчас закрыта/.test(t2) && /Набор откроется в понедельник/.test(t2) && /входите как обычно/.test(t2), t2.slice(0, 300));
await p2.screenshot({ path: S + '/rg-login.png' });
// Новый человек получает понятный отказ
await p2.getByPlaceholder(/почт|mail|@/i).first().fill(`newbie${Date.now()}@example.com`).catch(() => {});
t('нет ошибок страницы', errs.length === 0, errs.join(' | '));
q(`update registration_settings set enabled=true, daily_limit=0, message='' where id`);
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
