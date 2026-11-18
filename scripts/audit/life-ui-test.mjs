// Sky Life (Playwright): экраны на ПК и телефоне против настоящего API. Нужны vite dev на :5173 и API на :8080 (см. life-http-test.mjs); токен берётся через lib.mjs.
// Компонент монтируется поверх страницы приложения, запросы /api/** пересылаются на API.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
import { mkuser } from './lib.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:5173'; const API = process.env.API_BASE || 'http://127.0.0.1:8080'; const S = process.argv[2] || '/tmp/apit';
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const u = await mkuser(S, 'LuiA');
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const errs = [];
for (const [name, w, h] of [['desktop', 1280, 800], ['phone', 390, 800]]) {
  const c = await browser.newContext({ locale: 'ru-RU', viewport: { width: w, height: h }, hasTouch: w < 600 }); const p = await c.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|401|403|404|WebSocket/.test(m.text())) errs.push(`${name}: ${m.text()}`); }); p.on('pageerror', (e) => errs.push(`${name}: ${e}`));
  await p.route('**/api/**', async (route) => {
    const r = route.request(); const url = new URL(r.url()); if (url.origin === API) return route.continue();
    try { const resp = await fetch(API + url.pathname + url.search, { method: r.method(), headers: { ...r.headers(), host: '127.0.0.1:8080' }, body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() ?? undefined });
      const body = Buffer.from(await resp.arrayBuffer()); await route.fulfill({ status: resp.status, headers: Object.fromEntries([...resp.headers].filter(([k]) => !/content-encoding|content-length|transfer/.test(k))), body }); } catch { await route.abort(); }
  });
  await p.goto(BASE + '/guide'); await p.waitForTimeout(1500);
  await p.evaluate(async ({ token, pid }) => {
    const api = await import('/src/core/auth/api.ts'); api.setAccessToken(token);
    const st = await import('/src/core/auth/store.ts'); st.useAuthStore.setState({ currentUserId: pid, isAuthenticated: true });
    const React = await import('/node_modules/.vite/deps/react.js').catch(() => import('react')); const RD = await import('/node_modules/.vite/deps/react-dom_client.js').catch(() => import('react-dom/client'));
    const mod = await import('/src/life/LifeModule.tsx'); const div = document.createElement('div'); div.id = 'life-root'; div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg-l0,#0b0b14);'; document.body.appendChild(div);
    (RD.createRoot ?? RD.default.createRoot)(div).render((React.default ?? React).createElement(mod.LifeModule));
  }, { token: u.tok, pid: u.pid });
  await p.waitForSelector('text=Добрый', { timeout: 15000 }).catch(() => {});
  t(`${name}: главная с приветствием`, (await p.locator('#life-root').innerText()).includes('Добр') || (await p.locator('#life-root').innerText()).includes('Доброй'));
  t(`${name}: нет горизонтальной прокрутки`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p.screenshot({ path: `/tmp/life-${name}-home.png` });
  const R = p.locator('#life-root');
  await R.getByRole(name === 'desktop' ? 'button' : 'tab', { name: 'Мои цели' }).first().click(); await p.waitForTimeout(500);
  await R.getByRole('button', { name: /Цель/ }).first().click();
  await p.getByPlaceholder('Например: Накопить на первый взнос').fill(`Купить квартиру ${name}`);
  await p.getByRole('button', { name: 'Сохранить' }).click(); await p.waitForTimeout(800);
  t(`${name}: цель создана и видна`, (await R.innerText()).includes(`Купить квартиру ${name}`));
  await R.getByText(`Купить квартиру ${name}`).first().click(); await p.waitForTimeout(600);
  await p.getByPlaceholder('Новый этап').fill('Открыть вклад'); await p.getByRole('button', { name: 'Добавить', exact: true }).first().click(); await p.waitForTimeout(600);
  await p.getByPlaceholder('Новый этап').fill('Копить каждый месяц'); await p.getByRole('button', { name: 'Добавить', exact: true }).first().click(); await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'Отметить' }).first().click(); await p.waitForTimeout(800);
  t(`${name}: прогресс 50% после первого этапа`, (await R.innerText()).includes('50%'), (await R.innerText()).slice(0, 300));
  await p.screenshot({ path: `/tmp/life-${name}-goal.png` });
  await R.getByRole('button', { name: 'Назад' }).click(); await p.waitForTimeout(400);
  await R.getByRole(name === 'desktop' ? 'button' : 'tab', { name: 'Бизнес-связи' }).first().click(); await p.waitForSelector('text=Ничего не найдено', { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(300);
  t(`${name}: бизнес-связи с предупреждением о проверке`, (await R.innerText()).includes('не проверяет'), (await R.innerText()).slice(0, 200));
  await p.screenshot({ path: `/tmp/life-${name}-biz.png` });
  await R.getByRole(name === 'desktop' ? 'button' : 'tab', { name: 'Важные вещи' }).first().click(); await p.waitForTimeout(500);
  await R.getByRole('button', { name: /Добавить/ }).first().click(); await p.getByPlaceholder('Например: Гарантия на ноутбук').fill('Пароль от почты 123');
  await p.getByRole('button', { name: 'Сохранить' }).click(); await p.waitForTimeout(800);
  t(`${name}: пароль в «Важном» отклонён, окно не закрылось`, await p.getByPlaceholder('Например: Гарантия на ноутбук').isVisible());
  await p.screenshot({ path: `/tmp/life-${name}-important.png` });
  await c.close();
}
t('нет ошибок консоли', errs.length === 0, errs.slice(0, 4).join(' | '));
console.log(`ok ${ok}, fail ${bad}`); await browser.close(); process.exit(bad ? 1 : 0);
