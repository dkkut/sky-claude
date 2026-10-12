// Лендинг (site/index.html + cms.js) в браузере: без ОБТ, «Веб-версия», скачивание/статус/ссылки из админки, апелляция и заявки на релиз с файлами.
//   Запускать из каталога с playwright-core: node site-ui-test.mjs <каталог с api.log>. Нужны API :8080 (SITE_DIR задан) и статика site/ + прокси /api/ на :4180.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4180';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d }; };
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const email = `siteui${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await new Promise((r) => setTimeout(r, 1300));
const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
let tok = r.data.accessToken;
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'SiteUi', username: 'siteui' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id; q(`update profiles set username='ownertest' where id='${pid}'`);
r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok); tok = r.data.accessToken ?? tok;
// содержимое из админки
const apk = crypto.randomBytes(200000);
await fetch(B + '/api/admin/site/downloads/android/file?name=Sky-4.1.apk', { method: 'POST', body: apk, headers: { authorization: `Bearer ${tok}` } });
await call('/api/admin/site/downloads/android', { method: 'PUT', body: JSON.stringify({ status: 'available', version: '4.1', button: 'Скачать .apk' }) }, tok);
const st0 = (await call('/api/admin/site/status', {}, tok)).data;
await call('/api/admin/site/status', { method: 'PUT', body: JSON.stringify({ headline: '', note: 'Музыка вернётся вечером', components: st0.components.map((c) => (c.id === 'music' ? { ...c, state: 'maintenance' } : c)) }) }, tok);
const links0 = (await call('/api/admin/site/links', {}, tok)).data.links;
await call('/api/admin/site/links', { method: 'PUT', body: JSON.stringify({ links: links0.map((l) => (l.key === 'discord' ? { ...l, url: 'https://discord.gg/FROMADMIN' } : l)) }) }, tok);
writeFileSync(S + '/ev.png', Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(300, 5)]));
writeFileSync(S + '/t.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 3)]));

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await (await br.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' })).newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const go = async (id) => { await p.evaluate((x) => window.goTo(x), id); await p.waitForTimeout(700); };
await p.goto(F + '/'); await p.waitForTimeout(3000);
try { await p.getByRole('button', { name: 'Принять' }).click({ timeout: 1500 }); } catch { /* cookie */ }
let txt = await body();
t('кнопки «Регистрация на ОБТ» на сайте больше нет', !/Регистрация на ОБТ|ОБТ/.test(txt) && (await p.locator('#btn-obt, #page-obt-register').count()) === 0);
t('есть кнопка «Веб-версия» со ссылкой на веб-приложение', (await p.locator('#btn-web').count()) === 1 && /Веб-версия/.test(await p.locator('#btn-web').innerText()) && (await p.locator('#btn-web').getAttribute('href')) === 'https://web.skymessenger.online');
t('ссылка Discord подставлена из админки', (await p.locator('[data-cms-link=discord]').getAttribute('href')) === 'https://discord.gg/FROMADMIN');
await go('downloads'); txt = await body();
const card = p.locator('[data-platform=android]');
t('«Скачать»: карточка Android активна, версия и файл из админки', (await card.count()) === 1 && /v4\.1/.test(await card.innerText()) && /Sky-4\.1\.apk/.test(await card.innerText()) && !(await card.getAttribute('class')).includes('coming-soon'), await card.innerText());
t('кнопка скачивания ведёт на наш файл', (await card.locator('a.plat-btn').getAttribute('href')) === '/api/site/download/android');
const [dl] = await Promise.all([p.waitForEvent('download'), card.locator('a.plat-btn').click()]);
const path = await dl.path();
t('скачивается тот же файл (по байтам)', readFileSync(path).equals(apk) && dl.suggestedFilename() === 'Sky-4.1.apk');
t('остальные платформы — «Скоро», кнопки неактивны', (await p.locator('[data-platform=windows] button.plat-btn[disabled]').count()) === 1);
await p.screenshot({ path: S + '/site-downloads.png' });
await go('status'); txt = await body();
t('«Статус»: Sky Music — технические работы, общий — работы, заметка', /Sky Music.*Технические работы/.test(txt) && /Идут технические работы/.test(txt) && /Музыка вернётся вечером/.test(txt), txt.slice(0, 300));
await p.screenshot({ path: S + '/site-status.png' });

// Апелляция с файлом
await go('appeals');
const ap = p.locator('[data-cms-form=appeal]');
await p.locator('#page-appeals .appeal-type').nth(1).click();
await ap.locator('input').nth(0).fill('@tester');
await ap.locator('input[type=email]').fill(email);
await ap.locator('textarea').fill('Мой контент удалили по ошибке, прошу пересмотреть решение, вот скриншоты.');
await ap.locator('input[type=file]').setInputFiles(S + '/ev.png');
await ap.locator('button.btn-primary').click(); await p.waitForTimeout(3000);
txt = await body();
const mc = /SKY-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(txt);
t('апелляция отправлена: на сайте показан номер', Boolean(mc) && /Заявка принята/.test(txt), txt.slice(0, 200));
const row = q(`select kind||'|'||username||'|'||status from site_appeals where code='${mc?.[0]}'`);
t('в базе: тип «Удаление контента», ник, статус new', row === 'content_removal|tester|new', row);
t('скриншот приложен к заявке', q(`select count(*) from site_attachments a join site_appeals p on p.id=a.owner_id where p.code='${mc?.[0]}'`) === '1');
// решение в админке -> статус на сайте
const it = (await call('/api/admin/site/appeals', {}, tok)).data.items.find((x) => x.code === mc[0]);
await call(`/api/admin/site/appeals/${it.id}/decide`, { method: 'POST', body: JSON.stringify({ status: 'accepted', answer: 'Контент восстановлен.' }) }, tok);
await go('appeals');
await p.locator('#cms-chk-code').fill(mc[0]); await p.locator('#cms-chk-email').fill(email); await p.locator('#cms-chk-btn').click(); await p.waitForTimeout(1500);
t('«Проверить статус»: удовлетворена и ответ администрации', /Удовлетворена/.test(await p.locator('#cms-chk-res').innerText()) && /Контент восстановлен/.test(await p.locator('#cms-chk-res').innerText()));
await p.locator('#cms-chk-email').fill('чужая@почта.рф'); await p.locator('#cms-chk-btn').click(); await p.waitForTimeout(1200);
t('чужая почта — «Не найдено»', /Не найдено/.test(await p.locator('#cms-chk-res').innerText()));

// Пустая форма
await go('release');
const rm = p.locator('[data-cms-form=release-music]');
await rm.locator('button.btn-primary').click(); await p.waitForTimeout(400);
t('релиз: пустая форма — подсказка о обязательных полях', /Заполните обязательные поля/.test(await rm.innerText()));
// Музыка с аудио и обложкой
await rm.locator('input').nth(0).fill('Мой трек'); await rm.locator('input').nth(1).fill('Артист');
await rm.locator('input[type=email]').fill(email);
await rm.locator('input[type=file]').nth(0).setInputFiles(S + '/t.mp3'); await rm.locator('input[type=file]').nth(1).setInputFiles(S + '/ev.png');
await rm.locator('input[type=checkbox]').check();
await rm.locator('button.btn-primary').click(); await p.waitForTimeout(3000);
txt = await body();
const rc = /REL-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(txt);
t('заявка на релиз (музыка) принята, номер REL-…', Boolean(rc), txt.slice(0, 200));
t('приложены аудио и обложка', q(`select count(*) from site_attachments a join site_releases r on r.id=a.owner_id where r.code='${rc?.[0]}'`) === '2');
// Кино: ссылка вместо файла
await go('release'); await p.evaluate(() => window.switchRelease('film', document.getElementById('release-tab-film')));
const rf = p.locator('[data-cms-form=release-film]');
await rf.locator('input').nth(0).fill('Мой фильм'); await rf.locator('textarea').fill('Короткий синопсис фильма.');
await rf.locator('input[placeholder*="drive.google"]').fill('https://drive.google.com/file/x'); await rf.locator('input[type=email]').fill(email);
await rf.locator('input[type=checkbox]').check();
await rf.locator('button.btn-primary').click(); await p.waitForTimeout(2500);
t('заявка на релиз (кино) со ссылкой вместо файла принята', /REL-[A-Z2-9]{4}-[A-Z2-9]{4}/.test(await body()) && q(`select count(*) from site_releases where title='Мой фильм'`) === '1');
const rel = (await call('/api/admin/site/releases', {}, tok)).data.items.find((x) => x.title === 'Мой фильм');
t('в админке поля анкеты кино дошли (синопсис, ссылка)', rel && Object.values(rel.data).some((v) => /drive\.google/.test(v)));
t('нет ошибок страницы', errs.length === 0, errs.join(' | '));
// возврат прежних значений
await call('/api/admin/site/status', { method: 'PUT', body: JSON.stringify({ headline: '', note: '', components: st0.components }) }, tok);
await call('/api/admin/site/links', { method: 'PUT', body: JSON.stringify({ links: links0 }) }, tok);
await call('/api/admin/site/downloads/android/file', { method: 'DELETE' }, tok);
await call('/api/admin/site/downloads/android', { method: 'PUT', body: JSON.stringify({ status: 'soon', version: '' }) }, tok);
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
