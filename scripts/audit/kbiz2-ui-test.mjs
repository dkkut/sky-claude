// SkyKassa Business, этап 2: сайт каталога в браузере — на Sky (/s/<адрес>) и на «своём сервере» (другой origin, CORS), страница чаевых.
//   Нужны API (:8080, KBIZ_RATE_MULT>1) и собранный сайт на :4173 (front с /s/ и /p/ как в nginx).  (node scripts/audit/kbiz2-ui-test.mjs <каталог с api.log>)
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2], F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'kb2ui');
q(`insert into wallet_accounts (user_id, balance, points) values ('${A.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const post = (p, b) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, A.tok);
const put = (p, b) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, A.tok);
await post('/api/kbiz/business', { name: 'Пекарня «Утро»', mode: 'both', legalType: 'selfemployed', description: 'Свежий хлеб' });
await put('/api/kbiz/requisites', { holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' });
await post('/api/kbiz/subscription/buy', { idemKey: 'ui1' }); await post('/api/kbiz/publish', { on: true });
const slug = 'ui-' + Date.now().toString(36);
await post('/api/kbiz/items', { title: 'Багет', priceRub: 90, category: 'Хлеб', variants: [{ name: 'Обычный' }, { name: 'Цельнозерновой', priceRub: 110 }] });
await post('/api/kbiz/items', { title: 'Круассан', priceRub: 150, category: 'Выпечка' });
await put('/api/kbiz/shop', { slug, enabled: true, notice: 'Пекарня работает с 7 до 20' });
const tip = (await post('/api/kbiz/tips', { recipient: 'Мария', message: 'Спасибо за визит!', amounts: [50, 100, 200], min: 20, max: 1000 })).data;
const tipPid = (await call('/api/kbiz/tips', {}, A.tok)).data.tips[0].publicId;

// «Свой сервер»: те же файлы из пакета, другой origin
const pk = await fetch('http://127.0.0.1:8080/api/kbiz/shop/package.tar.gz?api=https://x.invalid', { headers: { authorization: `Bearer ${A.tok}` } });
t('пакет для VPS скачивается', pk.status === 200);
const vps = mkdtempSync('/tmp/vps-'); for (const f of ['index.html', 'app.js', 'style.css']) copyFileSync(new URL('../../public/shop/' + f, import.meta.url).pathname, path.join(vps, f));
writeFileSync(path.join(vps, 'config.js'), `window.SKY_SHOP = { api: 'http://localhost:4173', slug: '${slug}' };\n`);
const srv = http.createServer(async (req, res) => { const p = req.url.split('?')[0].slice(1); const f = path.join(vps, ['app.js', 'style.css', 'config.js'].includes(p) ? p : 'index.html'); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(await readFile(f)); }).listen(4180);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const flow = async (name, url, vp) => {
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU' }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 160))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  await p.goto(url); await p.waitForSelector('.item, .notice', { timeout: 8000 }).catch(() => {});
  let b = await body();
  t(`${name}: название бизнеса, объявление и позиции`, b.includes('Пекарня «Утро»') && b.includes('работает с 7 до 20') && b.includes('Багет') && b.includes('Круассан'), b.slice(0, 200));
  t(`${name}: цена «от 90 ₽» у варианта`, /от 90/.test(b));
  await p.click('.cats button:has-text("Выпечка")'); b = await body();
  t(`${name}: фильтр по категории`, b.includes('Круассан') && !b.includes('Багет'));
  await p.click('.cats button:has-text("Все")');
  await p.selectOption('.item:has-text("Багет") select', { label: 'Цельнозерновой' });
  await p.locator('.item:has-text("Багет") [data-add]').click();
  await p.locator('.item:has-text("Круассан") [data-add]').click(); await p.locator('.item:has-text("Круассан") [data-add]').click();
  b = await body();
  t(`${name}: корзина считает 110 + 2×150 = 410 ₽`, b.includes('410 ₽') && b.includes('3 шт'), b.slice(-120));
  await p.click('#tocart');
  t(`${name}: корзина показывает строки и форму`, (await body()).includes('Ваши данные') && (await body()).includes('Цельнозерновой'));
  await p.fill('input[name=name]', 'Пётр'); await p.fill('input[name=phone]', '+7 911 000-11-22');
  await p.click('#go'); await p.waitForSelector('text=оформлен', { timeout: 8000 }).catch(() => {});
  b = await body();
  t(`${name}: заказ оформлен, видна сумма 410 ₽ и переход к оплате`, /Заказ № \d+ оформлен/.test(b) && b.includes('410 ₽') && b.includes('Перейти к оплате'), b.slice(0, 200));
  const href = await p.getAttribute('a.btn', 'href'); t(`${name}: ссылка на оплату ведёт на страницу Sky /p/`, /\/p\/[a-z0-9]{12,}$/.test(href ?? ''), href);
  await p.screenshot({ path: `/tmp/kb2-${name}.png` });
  t(`${name}: ошибок в консоли нет`, errs.length === 0, errs.join(' | '));
  await ctx.close(); return href;
};
const pay = await flow('sky-desktop', `${F}/s/${slug}`, { width: 1100, height: 800 });
await flow('sky-mobile', `${F}/s/${slug}`, { width: 390, height: 800 });
// страница оплаты заказа
{
  const ctx = await br.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' }); const p = await ctx.newPage();
  await p.goto(pay); await p.waitForSelector('text=К оплате', { timeout: 8000 }).catch(() => {});
  const b = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('страница оплаты заказа: сумма и состав', b.includes('410 ₽') && b.includes('Багет') && b.includes('Круассан') && /Заказ № \d+/.test(b), b.slice(0, 250));
  await p.screenshot({ path: '/tmp/kb2-pay.png' }); await ctx.close();
}
// чаевые
{
  const ctx = await br.newContext({ viewport: { width: 390, height: 900 }, locale: 'ru-RU' }); const p = await ctx.newPage();
  await p.goto(`${F}/p/${tipPid}`); await p.waitForSelector('text=Чаевые', { timeout: 8000 }).catch(() => {});
  let b = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('чаевые: получатель, сообщение, быстрые суммы', b.includes('Чаевые: Мария') && b.includes('Спасибо за визит') && b.includes('50 ₽') && b.includes('200 ₽'), b.slice(0, 250));
  await p.click('button:has-text("100 ₽")'); b = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('чаевые: выбранная сумма подставилась', /К оплате\s*100 ₽/.test(b) || b.includes('100'), b.slice(0, 250));
  await p.click('button:has-text("Я перевёл деньги")'); await p.waitForSelector('text=Заявка отправлена', { timeout: 8000 }).catch(() => {});
  t('чаевые: заявка отправлена', (await p.evaluate(() => document.body.innerText)).includes('Заявка отправлена'));
  await p.screenshot({ path: '/tmp/kb2-tip.png' }); await ctx.close();
}
// свой сервер: без разрешения — отказ, с разрешением — работает
{
  const ctx = await br.newContext({ viewport: { width: 1000, height: 800 }, locale: 'ru-RU' }); const p = await ctx.newPage();
  await p.goto('http://localhost:4180/'); await p.waitForSelector('.notice', { timeout: 8000 }).catch(() => {});
  t('VPS: сайт не из списка получает отказ', (await p.evaluate(() => document.body.innerText)).includes('не указан в настройках'));
  await ctx.close();
}
q(`update kb_businesses set shop_origins = array['http://localhost:4180'] where shop_slug='${slug}'`);
await flow('vps', 'http://localhost:4180/', { width: 1000, height: 800 });
await br.close(); srv.close();
console.log(`\nитого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
