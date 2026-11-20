// Sky Pets (Playwright): дом, питомец, яйца, магазин, город и админский конструктор против настоящего API. Нужны vite dev на :5173 и API на :8080 (PETS_RATE_MULT=50).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
import { mkuser, call } from './lib.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:5173'; const API = process.env.API_BASE || 'http://127.0.0.1:8080'; const S = process.argv[2] || '/tmp/apit';
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const P = (path, tok, b = {}) => call(path, { method: 'POST', body: JSON.stringify(b) }, tok);
const u = await mkuser(S, 'SpuA'), adminU = await mkuser(S, 'SpuD'); sql(`update profiles set is_admin=true, admin_role='pets_admin' where id='${adminU.pid}'`); sql(`update admin_lockdown set active=false`);
// питомец заранее (через API): яйцо → инкубатор → вылупление
const ov = (await call('/api/skypets/overview', {}, u.tok)).data; const egg = ov.eggs[0].id; await P(`/api/skypets/egg/${egg}/incubate`, u.tok); sql(`update sp_player_eggs set ready_at=now()-interval '1 second', touches=3 where id='${egg}'`);
const hp = (await P(`/api/skypets/egg/${egg}/hatch`, u.tok, { name: 'Тест' })).data.pet; t('питомец вылупился через API', !!hp?.id);
// второе яйцо для проверки интерфейса
sql(`insert into sp_player_eggs (id, owner_id, egg_id, source) values ('peg-' || gen_random_uuid(),'${u.pid}','egg-common','test')`);
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const errs = [];
const open = async (c, tok, pid, mod, exp) => {
  const p = await c.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|401|403|404|WebSocket/.test(m.text())) errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
  await p.route('**/api/**', async (route) => { const r = route.request(); const url = new URL(r.url()); if (url.origin === API) return route.continue();
    try { const resp = await fetch(API + url.pathname + url.search, { method: r.method(), headers: { ...r.headers(), host: '127.0.0.1:8080' }, body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() ?? undefined }); const body = Buffer.from(await resp.arrayBuffer()); await route.fulfill({ status: resp.status, headers: Object.fromEntries([...resp.headers].filter(([k]) => !/content-encoding|content-length|transfer-encoding/i.test(k))), body }); } catch { await route.abort(); } });
  await p.goto(BASE + '/guide'); await p.waitForTimeout(1500);
  await p.evaluate(async ({ token, pid, mod, exp }) => {
    const api = await import('/src/core/auth/api.ts'); api.setAccessToken(token);
    const st = await import('/src/core/auth/store.ts'); st.useAuthStore.setState({ currentUserId: pid, isAuthenticated: true });
    const React = await import('/node_modules/.vite/deps/react.js').catch(() => import('react')); const RD = await import('/node_modules/.vite/deps/react-dom_client.js').catch(() => import('react-dom/client'));
    const m = await import(mod); const div = document.createElement('div'); div.id = 'sp-root'; div.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#222';
    document.body.appendChild(div); (RD.createRoot ?? RD.default.createRoot)(div).render((React.default ?? React).createElement(m[exp]));
  }, { token: tok, pid, mod, exp });
  return p;
};
for (const [name, w, h] of [['desktop', 1280, 800], ['phone', 390, 800]]) {
  const c = await browser.newContext({ locale: 'ru-RU', viewport: { width: w, height: h }, hasTouch: w < 600 }); const p = await open(c, u.tok, u.pid, '/src/skypets/SkyPets.tsx', 'default'); const R = p.locator('#sp-root');
  await p.waitForSelector('text=Sky Pets', { timeout: 20000 }).catch(() => {});
  t(`${name}: заголовок и вкладки`, (await R.innerText()).includes('Мой дом') && (await R.innerText()).includes('Магазин'));
  await p.waitForSelector('button[aria-label="Тест"]', { timeout: 15000 }).catch(() => {});
  t(`${name}: питомец стоит в доме`, (await p.locator('button[aria-label="Тест"]').count()) >= 1);
  t(`${name}: нет горизонтальной прокрутки`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p.screenshot({ path: `/tmp/skypets-${name}-home.png` });
  await p.locator('button[aria-label="Тест"]').first().click({ force: true }); await p.waitForTimeout(600);
  t(`${name}: быстрые действия по нажатию`, (await R.getByRole('button', { name: 'Подробнее' }).count()) >= 1);
  await R.getByRole('button', { name: 'Подробнее' }).first().click(); await p.waitForSelector('text=Навыки', { timeout: 8000 });
  await R.getByRole('button', { name: /Купать/ }).click(); await p.waitForTimeout(700);
  t(`${name}: уход даёт отклик`, (await p.locator('body').innerText()).includes('+4 опыта') || (await p.locator('body').innerText()).includes('Готово') || (await p.locator('body').innerText()).includes('Питомец чистый'));
  await p.screenshot({ path: `/tmp/skypets-${name}-pet.png` });
  await R.getByRole('button', { name: 'Закрыть' }).first().click(); await p.waitForTimeout(300);
  await R.getByRole('tab', { name: 'Яйца' }).click(); await p.waitForSelector('text=Обычное яйцо', { timeout: 8000 });
  t(`${name}: яйца видны`, (await R.innerText()).includes('Обычное яйцо'));
  await R.getByRole('button', { name: 'Шансы' }).first().click(); await p.waitForSelector('text=Шансы считает сервер', { timeout: 8000 });
  t(`${name}: шансы яйца с процентами`, (await p.locator('body').innerText()).includes('%'));
  await p.screenshot({ path: `/tmp/skypets-${name}-odds.png` }); await R.getByRole('button', { name: 'Закрыть' }).first().click();
  await R.getByRole('tab', { name: 'Магазин' }).click(); await p.waitForSelector('text=Монеты — игровые', { timeout: 8000 });
  await p.screenshot({ path: `/tmp/skypets-${name}-shop.png` });
  await R.getByRole('button', { name: /^● \d+$/ }).first().click(); await p.waitForTimeout(800);
  t(`${name}: покупка в магазине`, (await p.locator('body').innerText()).includes('Куплено'));
  await R.getByRole('tab', { name: 'Задания' }).click(); await p.waitForSelector('text=Ежедневные', { timeout: 8000 }).catch(() => {});
  t(`${name}: задания`, (await R.innerText()).includes('Ежедневные'));
  await R.getByRole('tab', { name: 'Город питомцев' }).click(); await p.waitForTimeout(800);
  t(`${name}: город питомцев`, (await R.innerText()).includes('Кто может заходить'));
  await p.screenshot({ path: `/tmp/skypets-${name}-city.png` });
  t(`${name}: нет горизонтальной прокрутки в разделах`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await c.close();
}
// админский конструктор
{
  const c = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 900 } }); const p = await open(c, adminU.tok, adminU.pid, '/src/admin/SkyPetsAdminTab.tsx', 'SkyPetsAdminTab'); const R = p.locator('#sp-root');
  await p.waitForSelector('text=Игроков', { timeout: 15000 }).catch(() => {});
  t('админка: обзор', (await R.innerText()).includes('Игроков'));
  await R.getByRole('button', { name: 'Питомцы', exact: true }).click(); await p.waitForSelector('text=Полосатик', { timeout: 10000 }).catch(() => {});
  t('админка: список питомцев (встроенные)', (await R.innerText()).includes('Полосатик'));
  await R.getByRole('button', { name: '+ Добавить' }).click(); await p.waitForSelector('text=Новый материал', { timeout: 5000 });
  await p.locator('input[maxlength="60"]').fill('UI-зверь'); await R.getByRole('button', { name: 'Создать черновик' }).click(); await p.waitForTimeout(1200);
  t('админка: черновик создан', (await p.locator('body').innerText()).includes('UI-зверь'));
  await p.screenshot({ path: '/tmp/skypets-admin.png' });
  await c.close();
}
await browser.close();
console.log(errs.length ? 'ОШИБКИ КОНСОЛИ:\n' + [...new Set(errs)].slice(0, 8).join('\n') : 'ошибок консоли нет'); t('консоль без ошибок', errs.length === 0);
console.log(`\nSky Pets UI: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
