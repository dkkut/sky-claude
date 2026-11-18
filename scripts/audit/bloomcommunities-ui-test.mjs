// Bloom → «Сообщества» (Playwright): создание, пост в сообществе, метка в ленте, закрытое сообщество. Нужны vite dev :5173 и API :8080.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
import { mkuser } from './lib.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:5173'; const API = process.env.API_BASE || 'http://127.0.0.1:8080'; const S = process.argv[2] || '/tmp/apit';
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const u = await mkuser(S, 'BcuiA'); const sfx = Date.now().toString(36).slice(-6);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const errs = [];
for (const [name, w, h] of [['desktop', 1280, 800], ['phone', 390, 800]]) {
  const c = await browser.newContext({ locale: 'ru-RU', viewport: { width: w, height: h }, hasTouch: w < 600 }); const p = await c.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|401|403|404|WebSocket/.test(m.text())) errs.push(name + ': ' + m.text()); }); p.on('pageerror', (e) => errs.push(name + ': ' + e));
  await p.route('**/api/**', async (route) => { const r = route.request(); const url = new URL(r.url()); if (url.origin === API) return route.continue();
    try { const resp = await fetch(API + url.pathname + url.search, { method: r.method(), headers: { ...r.headers(), host: '127.0.0.1:8080' }, body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() ?? undefined }); const body = Buffer.from(await resp.arrayBuffer());
      await route.fulfill({ status: resp.status, headers: Object.fromEntries([...resp.headers].filter(([k]) => !/content-encoding|content-length|transfer/.test(k))), body }); } catch { await route.abort(); } });
  await p.goto(BASE + '/guide'); await p.waitForTimeout(1500);
  await p.evaluate(async ({ token, pid }) => {
    const api = await import('/src/core/auth/api.ts'); api.setAccessToken(token); const st = await import('/src/core/auth/store.ts'); st.useAuthStore.setState({ currentUserId: pid, isAuthenticated: true });
    const React = await import('/node_modules/.vite/deps/react.js'); const RD = await import('/node_modules/.vite/deps/react-dom_client.js'); const mod = await import('/src/bloom/BloomModule.tsx');
    const div = document.createElement('div'); div.id = 'bl-root'; div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0b0b14;display:flex;flex-direction:column'; document.body.appendChild(div);
    (RD.createRoot ?? RD.default.createRoot)(div).render((React.default ?? React).createElement(mod.BloomModule ?? mod.default));
  }, { token: u.tok, pid: u.pid });
  const R = p.locator('#bl-root'); await p.waitForTimeout(1500);
  await R.getByRole('button', { name: 'Сообщества' }).click(); await p.waitForTimeout(700);
  t(name + ': каталог открылся', (await R.innerText()).includes('Найти') || (await R.innerText()).includes('Создать'));
  await R.getByRole('button', { name: /Создать/ }).first().click();
  await p.getByPlaceholder('Название').fill('Любители кофе ' + name); await p.getByPlaceholder('адрес_латиницей').fill('cafe_' + name + '_' + sfx);
  await p.getByPlaceholder('О чём это сообщество').fill('Всё о кофе'); await p.getByRole('dialog', { name: 'Новое сообщество' }).getByRole('button', { name: 'Создать' }).click(); await p.waitForTimeout(1500);
  t(name + ': страница сообщества', (await R.innerText()).includes('Любители кофе ' + name) && (await R.innerText()).includes('Пост в сообществе'), (await R.innerText()).slice(0, 300));
  t(name + ': нет горизонтальной прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await R.getByRole('button', { name: /Пост в сообществе/ }).click(); await p.waitForTimeout(500);
  await p.locator('textarea').first().fill('Первый пост про кофе в сообществе ' + name); await p.getByRole('button', { name: 'Опубликовать' }).click(); await p.waitForTimeout(1800);
  t(name + ': пост появился на странице сообщества', (await R.innerText()).includes('Первый пост про кофе в сообществе ' + name), (await R.innerText()).slice(0, 400));
  await R.getByRole('tab', { name: 'О сообществе' }).click(); await p.waitForTimeout(300);
  t(name + ': вкладка «О сообществе»', (await R.innerText()).includes('Правила'));
  await R.getByRole('tab', { name: 'Управление' }).click(); await p.waitForTimeout(700);
  t(name + ': управление владельца (участники, журнал, настройки)', (await R.innerText()).includes('Журнал модерации') && (await R.innerText()).includes('Удалить сообщество'));
  await p.screenshot({ path: '/tmp/bloomc-' + name + '.png' });
  await c.close();
}
t('нет ошибок консоли', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log('ok ' + ok + ', fail ' + bad); await browser.close(); process.exit(bad ? 1 : 0);
