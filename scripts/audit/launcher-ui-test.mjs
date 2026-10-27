/* Sky Launcher в браузере (Playwright): открытие вкладки, переходы, подсчёт таймеров и запросов при закрытии.
   Нужны API :8080 (EXTRA_ORIGINS=http://localhost:4173), dist на :4173 (vite preview), глобальный playwright (NODE_PATH). Запуск: node launcher-ui-test.mjs <каталог с api.log> */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire((process.env.NODE_PATH || '') + '/x.js')('playwright');
const S = process.argv[2]; const B = 'http://127.0.0.1:8080'; const F = 'http://localhost:4173';
const q = (s) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r.headers }; };
const email = `lui${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await new Promise((r) => setTimeout(r, 2000));
const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
const cookies = r.headers.getSetCookie().map((c) => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find((x) => x.trim().toLowerCase().startsWith('path=')) || 'path=/').split('=')[1].trim() }; });
let tok = r.data.accessToken; r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'LUI', username: 'lui' + Date.now().toString(36), acceptLegal: true }) }, tok); const pid = r.data.profile.id;
q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('pl${Date.now()}','${pid}','active','test')`);
// опубликованная игра и сервер для отображения
q(`INSERT INTO launcher_servers (id, kind, platform, name, host, port, status, status_source) VALUES ('lsv-00000000-0000-0000-0000-0000000000${String(Date.now()).slice(-2)}','minecraft','paper','UI Server','ui.example.com',25565,'published','none') ON CONFLICT DO NOTHING`);
q(`UPDATE onboarding_state SET status='skipped', finished_at=now()`);
let fails = 0; const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 420, height: 880 }, locale: 'ru-RU' }); await ctx.addCookies(cookies);
await ctx.addInitScript(() => {
  try { localStorage.setItem('sky:settings:v1', JSON.stringify({ introAnim: false })); } catch {}
  const live = new Map(); let n = 0; const si = window.setInterval.bind(window); const ci = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); live.set(id, ms); return id; };
  window.clearInterval = (id) => { live.delete(id); return ci(id); };
  window.__timers = () => [...live.values()]; void n;
});
const page = await ctx.newPage(); const reqs = []; page.on('request', (rq) => { if (/\/api\/launcher/.test(rq.url())) reqs.push(Date.now()); });
const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
await page.goto(F + '/?module=extras', { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
const timers = () => page.evaluate(() => window.__timers());
await page.getByText('LUI', { exact: true }).first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); await page.getByText('Продолжить', { exact: true }).first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(2500);
await page.screenshot({ path: S + '/ln-0.png' }); console.log((await page.locator('body').innerText()).slice(0, 400).replace(/\n/g, ' | '));
const base = await timers(); console.log('таймеров до открытия вкладки:', base.length);
await page.getByText('Прочее', { exact: true }).first().click({ timeout: 8000 }); await page.waitForTimeout(600);
await page.getByText('Лаунчер', { exact: true }).first().click({ timeout: 8000 }); await page.waitForTimeout(1200);
ok(await page.getByText('Sky Game Launcher').first().isVisible(), 'главная Лаунчера: три направления');
ok(await page.getByText('GTA V', { exact: true }).first().isVisible() && await page.getByText('Minecraft', { exact: true }).first().isVisible(), 'карточки GTA V и Minecraft');
const hub = await timers(); const hubReqs = reqs.length; console.log('таймеров на главной Лаунчера:', hub.length, '· запросов /api/launcher:', hubReqs);
ok(hub.length <= base.length + 1, 'главная Лаунчера не добавляет постоянных таймеров'); ok(hubReqs === 0, 'главная не делает запросов к лаунчеру');
await page.getByText('Minecraft', { exact: true }).first().click(); await page.waitForTimeout(1500);
ok(await page.getByText('UI Server').first().isVisible(), 'каталог Minecraft показывает сервер'); ok(await page.getByText('Статус неизвестен').first().isVisible(), 'без проверки статус честно «неизвестен»');
await page.screenshot({ path: S + '/ln-mc.png' });
const mc = await timers(); console.log('таймеров в каталоге серверов:', mc.length, '(+', mc.length - base.length, ')');
await page.getByLabel('Назад').last().click(); await page.waitForTimeout(500);
await page.getByText('Sky Game Launcher').first().click(); await page.waitForTimeout(1200);
ok(await page.getByText('Магазин', { exact: true }).first().isVisible(), 'раздел игр: магазин'); await page.getByText('Библиотека', { exact: true }).first().click(); await page.waitForTimeout(600);
ok(await page.getByText('Это веб-версия').first().isVisible(), 'в вебе честно сказано про установку только в приложении Windows');
await page.getByText('Мои игры').first().click(); await page.waitForTimeout(800); ok(await page.getByText('Название новой игры').first().isVisible() || await page.getByPlaceholder('Название новой игры').isVisible(), 'кабинет «Мои игры»');
await page.screenshot({ path: S + '/ln-games.png' });
// уход с вкладки: таймеры возвращаются к исходным, запросы прекращаются
await page.getByText('← Лаунчер').first().click().catch(() => {}); await page.waitForTimeout(300); await page.getByLabel('Назад').last().click().catch(() => {}); await page.waitForTimeout(300);
await page.getByText('Главная', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(800);
const left = await timers(); const t0 = reqs.length; await page.waitForTimeout(65000); const t1 = reqs.length;
console.log('таймеров после ухода с вкладки:', left.length, '· запросов за 65 с после ухода:', t1 - t0);
ok(left.length <= base.length + 1, 'после ухода с вкладки новые таймеры не остаются'); ok(t1 - t0 === 0, 'после ухода запросы к лаунчеру не идут');
ok(errs.length === 0, 'ошибок страницы нет ' + errs.join('|'));
await br.close(); console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'launcher-ui-test: всё пройдено'); process.exit(fails ? 1 : 0);
