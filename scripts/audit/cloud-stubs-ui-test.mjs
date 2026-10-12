// Sky Cloud и Sky Gaming Cloud: заглушки, островок, карточки, мобильный вид (Playwright).
//   Нужны API и собранный сайт на :4173 (front.mjs с прокси).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const mk = async (tag) => {
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await new Promise((r) => setTimeout(r, 1300));
  const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag === 'svauth' ? 'Мастер Видео' : 'Зритель', username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { pid, cookies, tok: r.data.accessToken ?? tok };
};
const V = await mk('cloudv');
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const run = async (name, vp) => {
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU' }); await ctx.addCookies(V.cookies);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 200))); p.on('response', (r) => { if (r.status() >= 400 && !/\/api\/music\//.test(r.url())) errs.push(r.status() + ' ' + r.url().replace(/^https?:..[^/]+/, '')); });
  const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  const openTab = async (label) => {
    await p.goto(F + '/'); await p.waitForTimeout(3500);
    for (const lbl of ['Медиа', 'Sky', 'Сервисы']) { const el = p.getByText(lbl, { exact: true }).first(); if (await el.count()) { await el.click().catch(() => {}); break; } }
    await p.waitForTimeout(1200);
    if (label.includes('Cloud')) {
      // Облачные сервисы лежат во вкладке «Прочее» (последняя в ленте Sky)
      await p.locator('text="Прочее" >> visible=true').last().click({ timeout: 6000 }); await p.waitForTimeout(800);
      await p.locator(`text="${label}" >> visible=true`).first().click({ timeout: 6000 });
    } else await p.locator(`text="${label}" >> visible=true`).last().click({ timeout: 6000 });
    await p.waitForTimeout(900);
  };
  for (const lbl of ['Медиа', 'Sky', 'Сервисы']) { const el = p.getByText(lbl, { exact: true }).first(); if (await el.count()) { await el.click().catch(() => {}); break; } }
  await openTab('Sky Gaming Cloud');
  let txt = await body();
  t(`${name}: Sky Gaming Cloud открылся, статус «Скоро»`, /Sky Gaming Cloud/.test(txt) && /Скоро/.test(txt) && /готовится к запуску/.test(txt), txt.slice(0, 200));
  t(`${name}: нет кнопок оплаты, каталога и «Играть»`, !/Играть|Купить|Оплат|Тариф/.test(txt));
  const island = p.locator('[role=status]', { hasText: 'временно недоступен' });
  await p.waitForTimeout(1500);
  t(`${name}: островок показывает сообщение о временной недоступности`, (await island.count()) >= 1);
  await p.screenshot({ path: `${S}/cloud-gaming-${name}.png` });
  await p.waitForTimeout(8500);
  const n1 = await p.locator('text=Облачный гейминг временно недоступен. Мы работаем над запуском сервиса.').count();
  t(`${name}: островок свернулся сам (дубля нет, не больше одного заметного уведомления)`, n1 <= 2, String(n1));
  await p.getByText('Показать уведомление').first().click(); await p.waitForTimeout(1500);
  t(`${name}: уведомление открывается повторно`, (await p.locator('[role=status]', { hasText: 'Sky Gaming Cloud' }).count()) >= 1);
  await p.getByText('Показать уведомление').first().click(); await p.getByText('Показать уведомление').first().click(); await p.waitForTimeout(600);
  t(`${name}: повторные нажатия не плодят островков`, (await p.locator('[role=status]', { hasText: 'Sky Gaming Cloud' }).count()) <= 2);
  // Sky Cloud
  await openTab('Sky Cloud');
  txt = await body();
  t(`${name}: Sky Cloud — 4 карточки со статусами`, ['Sky VPS', 'Sky Mail', 'Sky Drive', 'Sky Business Analytics'].every((x) => txt.includes(x)) && /Скоро/.test(txt) && /В разработке/.test(txt), txt.slice(0, 300));
  await p.waitForTimeout(1500);
  t(`${name}: островок Sky Cloud`, (await p.locator('[role=status]', { hasText: 'Облачные сервисы временно недоступны' }).count()) >= 1);
  await p.screenshot({ path: `${S}/cloud-${name}.png` });
  await p.locator('[data-cloud-card=vps]').click(); await p.waitForTimeout(700);
  t(`${name}: панель Sky VPS с описанием и сообщением`, (await p.locator('[role=dialog]', { hasText: 'Панель управления VPS' }).count()) === 1);
  await p.screenshot({ path: `${S}/cloud-panel-${name}.png` });
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  t(`${name}: Esc закрывает панель`, (await p.locator('[role=dialog]').count()) === 0);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  t(`${name}: нет горизонтальной прокрутки`, !wide);
  // соседняя вкладка работает
  await openTab('Sky Blox');
  t(`${name}: после ухода островок облака снят`, (await p.locator('[role=status]', { hasText: 'Облачные сервисы' }).count()) === 0);
  t(`${name}: ошибок в консоли нет`, errs.length === 0, errs.join(' | '));
  await ctx.close();
};
await run('desktop', { width: 1280, height: 860 });
await run('mobile', { width: 390, height: 780 });
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
