/* Экран блокировки приложения, управляемый сервером (подмена /api/skyid/applock). Dev-сервер vite на :5199; playwright-core. Сам замок проверяет applock-test.mjs. */
import { chromium } from 'playwright-core';
const URL_ = process.argv[2] || 'http://localhost:5199/';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-proxy-server'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, locale: 'ru-RU' });
const page = await ctx.newPage();
let locked = true, unlockCalls = 0, pings = 0;
await page.route(/\/api\/skyid\/applock/, async (route) => {
  const u = new URL(route.request().url()); const m = route.request().method(); const p = u.pathname.replace('/api/skyid/applock', '');
  const j = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (m === 'GET') return j(200, { enabled: true, kind: 'web', bio: false, locked, fresh: false });
  if (p === '/ping') { pings++; return j(200, { locked }); }
  if (p === '/unlock') { unlockCalls++; const b = JSON.parse(route.request().postData() || '{}'); if (b.pin === '2468') { locked = false; return j(200, { ok: true }); } return j(400, { error: 'invalid_pin' }); }
  if (p === '/lock') { locked = true; return j(200, { ok: true }); }
  return j(404, {});
});
await page.goto(URL_);
// localStorage пуст — замок «стёрт» в браузере; состояние берётся с сервера
await page.evaluate(() => { localStorage.removeItem('sky:applock:v1'); });
await page.evaluate(async () => { const m = await import('/src/core/auth/store.ts'); m.useAuthStore.setState({ isAuthenticated: true }); });
const lock = page.locator('[aria-label="Приложение заблокировано"]');
await lock.waitFor({ timeout: 15000 }).catch(() => {});
t('замок показан по состоянию сервера, хотя локального флага нет', await lock.isVisible());
await lock.locator('input[type=password]').fill('1111'); await lock.getByRole('button', { name: 'Войти' }).click();
await page.getByText('Неверный код').waitFor({ timeout: 5000 }).catch(() => {});
t('неверный код — отказ сервера показан', await page.getByText('Неверный код').isVisible());
t('код ушёл на сервер', unlockCalls === 1, unlockCalls);
await lock.locator('input[type=password]').fill('2468'); await lock.getByRole('button', { name: 'Войти' }).click();
await page.waitForTimeout(800);
t('верный код — замок снят', !(await lock.isVisible()));
// 423 от любого запроса снова показывает замок
locked = true;
await page.evaluate(() => window.dispatchEvent(new CustomEvent('sky:applock')));
await page.waitForTimeout(800);
t('событие 423/сокета снова закрывает приложение', await lock.isVisible());
t('локальный кэш восстановлен', await page.evaluate(() => localStorage.getItem('sky:applock:v1')) === '1');
await browser.close();
console.log(`Итого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
