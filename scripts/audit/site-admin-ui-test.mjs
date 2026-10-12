// Админка → вкладка «Сайт» (Playwright): загрузка файла приложения, версия/статус, ссылки, статус сервисов, апелляция с ответом.
//   Нужны API :8080 (SITE_DIR задан) и собранное приложение на :4173 (front.mjs с прокси).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const email = `sadm${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await new Promise((r) => setTimeout(r, 1300));
const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; });
let tok = r.data.accessToken;
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'SiteAdm', username: 'sadm' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id; q(`update profiles set username='ownertest' where id='${pid}'`);
r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok); tok = r.data.accessToken ?? tok;
// заявка с сайта для очереди
const ap = (await fetch(B + '/api/site/appeals', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.77' }, body: JSON.stringify({ kind: 'finance', username: 'payer', email: 'payer@example.com', body: 'Деньги списались дважды, прошу вернуть.' }) }).then((x) => x.json()));
await call('/api/admin/site/downloads/android/file', { method: 'DELETE' }, tok); await call('/api/admin/site/downloads/android', { method: 'PUT', body: JSON.stringify({ status: 'soon', version: '' }) }, tok); // чистое начальное состояние
const apk = crypto.randomBytes(1500000); writeFileSync(S + '/up.apk', apk);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 1000, height: 1000 }, locale: 'ru-RU' }); await ctx.addCookies(cookies);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
await p.goto(F + '/'); await p.waitForTimeout(3500);
await p.getByText('Медиа', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1000);
await p.getByText('Admin', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(2000);
await p.getByRole('button', { name: 'Сайт', exact: true }).first().click(); await p.waitForTimeout(1500);
let txt = await body();
t('вкладка «Сайт»: подвкладки и карточки платформ', /Скачивание/.test(txt) && /Ссылки/.test(txt) && /Апелляции/.test(txt) && /Релиз контента/.test(txt) && /Android/.test(txt) && /Windows/.test(txt), txt.slice(0, 250));
// Загрузка файла в карточку Android
const card = p.locator('div.rounded-2xl', { hasText: 'Android' }).filter({ has: p.getByLabel('Версия Android') }).first();
await card.getByLabel('Версия Android').fill('9.9.1');
await card.getByLabel('Статус Android').selectOption('available');
await card.getByRole('button', { name: 'Сохранить карточку' }).click(); await p.waitForTimeout(1200);
t('версия и статус сохранены на сервере', q(`select version||'|'||status from site_downloads where platform='android'`) === '9.9.1|available');
const fc = p.waitForEvent('filechooser'); await card.getByRole('button', { name: /Загрузить файл|Заменить файл/ }).click(); (await fc).setFiles(S + '/up.apk'); await p.waitForTimeout(3500);
const row = q(`select f.name||'|'||f.size from site_downloads d join site_files f on f.id=d.file_id where d.platform='android'`);
t('файл загружен через админку (имя и размер на сервере)', row === `up.apk|${apk.length}`, row);
txt = await body();
t('в карточке видны имя, размер, SHA-256 и счётчик', /up\.apk/.test(txt) && /1\.4 МБ|1\.5 МБ/.test(txt) && /SHA-256/.test(txt) && /скачали 0/.test(txt), txt.slice(0, 400));
await p.screenshot({ path: S + '/site-admin-dl.png' });
const dl = await fetch(B + '/api/site/download/android', { headers: { 'x-real-ip': '203.0.113.78' } });
t('сайт отдаёт загруженный файл по байтам', Buffer.from(await dl.arrayBuffer()).equals(apk));
// Ссылки
await p.getByRole('button', { name: 'Ссылки', exact: true }).first().click(); await p.waitForTimeout(1200);
await p.getByLabel('Ссылка web').fill('https://web.example.org');
await p.getByRole('button', { name: 'Сохранить ссылки' }).click(); await p.waitForTimeout(1200);
t('смена ссылки веб-версии сохранена и видна на сайте', q(`select url from site_links where key='web'`) === 'https://web.example.org' && (await fetch(B + '/api/site/public').then((x) => x.json())).links.web === 'https://web.example.org');
await p.getByLabel('Ссылка web').fill('javascript:alert(1)');
await p.getByRole('button', { name: 'Сохранить ссылки' }).click(); await p.waitForTimeout(1000);
t('опасная ссылка отклонена с понятным текстом', /Адрес должен начинаться с https/.test(await body()) && q(`select url from site_links where key='web'`) === 'https://web.example.org');
await p.getByLabel('Ссылка web').fill('https://web.skymessenger.online');
await p.getByRole('button', { name: 'Сохранить ссылки' }).click(); await p.waitForTimeout(800);
// Статус
await p.getByRole('button', { name: 'Статус', exact: true }).first().click(); await p.waitForTimeout(1200);
await p.getByLabel('Состояние Sky AI').selectOption('outage');
await p.getByRole('button', { name: 'Опубликовать статус' }).click(); await p.waitForTimeout(1200);
t('статус сервиса изменён и общий статус на сайте — «outage»', q(`select state from site_status_components where id='ai'`) === 'outage' && (await fetch(B + '/api/site/public').then((x) => x.json())).status.overall === 'outage');
await p.getByLabel('Состояние Sky AI').selectOption('operational'); await p.getByRole('button', { name: 'Опубликовать статус' }).click(); await p.waitForTimeout(800);
// Апелляции
await p.getByRole('button', { name: /^Апелляции/ }).first().click(); await p.waitForTimeout(1500);
txt = await body();
t('в очереди апелляций видна заявка с сайта (номер, ник, почта)', txt.includes(ap.code) && /payer@example\.com/.test(txt), txt.slice(0, 300));
await p.getByText(ap.code).first().click(); await p.waitForTimeout(800);
await p.getByLabel('Статус заявки').selectOption('accepted');
await p.getByRole('button', { name: /Сохранить и ответить/ }).click(); await p.waitForTimeout(1000);
t('итоговое решение без ответа не проходит (понятная ошибка)', /Напишите ответ человеку/.test(await body()));
await p.getByRole('textbox', { name: 'Ответ человеку' }).fill('Деньги вернём в течение трёх дней.');
await p.getByRole('button', { name: /Сохранить и ответить/ }).click(); await p.waitForTimeout(1500);
t('ответ сохранён, заявка ушла из открытых', q(`select status from site_appeals where code='${ap.code}'`) === 'accepted' && !(await body()).includes(ap.code));
await p.screenshot({ path: S + '/site-admin-appeals.png' });
t('нет ошибок страницы', errs.length === 0, errs.join(' | '));
await call('/api/admin/site/downloads/android/file', { method: 'DELETE' }, tok); await call('/api/admin/site/downloads/android', { method: 'PUT', body: JSON.stringify({ status: 'soon', version: '' }) }, tok);
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
