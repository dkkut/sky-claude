/* Sky GO: единая дизайн-система — состояния (загрузка/ошибка), доступность, адаптивность, «на потом». Playwright; API :8080, dist :4173. */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const call = async (path, o = {}, tok) => {
  const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r.headers };
};
const mk = async (tag) => {
  const email = `${tag.toLowerCase()}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
  await new Promise(r => setTimeout(r, 2500));
  const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  const cookies = r.headers.getSetCookie().map(c => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find(x => x.trim().toLowerCase().startsWith('path=')) || 'path=/').split('=')[1].trim() }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('p${Date.now()}${tag}','${pid}','active','test')`);
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { cookies, tok: r.data.accessToken ?? tok, pid, tag };
};

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const U = await mk('uDes');
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const open = async (w, h, setup) => {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU', geolocation: { latitude: 55.7558, longitude: 37.6176 }, permissions: ['geolocation'] });
  await ctx.addCookies(U.cookies);
  await ctx.addInitScript(() => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'light', introAnim: false })); } catch {} });
  const p = await ctx.newPage(); if (setup) await setup(p);
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  try { await p.getByText('Начать', { exact: true }).first().click({ timeout: 2000 }); } catch {}
  if (w >= 900) { await p.getByText('Медиа', { exact: true }).first().click({ timeout: 6000 }); await p.waitForTimeout(800); }
  else { try { await p.getByText('Sky', { exact: true }).first().click({ timeout: 4000 }); await p.waitForTimeout(500); } catch {} }
  await p.getByText('Sky GO', { exact: true }).first().click({ timeout: 6000 }); await p.waitForTimeout(2500);
  return { ctx, p };
};

/* Телефон 360 px */
let { ctx, p } = await open(360, 760);
ok(await p.locator('nav[aria-label] button[aria-current="page"]').count() === 1, 'нижняя навигация: текущий раздел помечен aria-current');
const hs = await p.locator('nav[aria-label] button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
ok(hs.length === 4 && hs.every((h) => h >= 44), `цели касания навигации ≥ 44 px (${hs.map(Math.round)})`);
ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'главная на 360 px без горизонтальной прокрутки');
const cols = await p.locator('.go-services').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
ok(cols === 2, `телефон: плитки в 2 колонки (${cols})`);
await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
const ring = await p.evaluate(() => { const e = document.activeElement; return e ? getComputedStyle(e).outlineStyle : 'none'; });
ok(ring !== 'none', 'клавиатурный фокус виден (outline)');
await p.getByText('Доставка', { exact: true }).first().click(); await p.waitForTimeout(600);
await p.getByText('Крупные вещи', { exact: false }).first().click(); await p.waitForTimeout(800);
const radios = await p.locator('[role="radiogroup"] [role="radio"]').count();
ok(radios >= 2, `переключатель (размер посылки) доступен как radiogroup (${radios})`);
ok((await p.locator('[role="radio"][aria-checked="true"]').count()) >= 1, 'выбранный пункт переключателя помечен aria-checked');
await ctx.close();

/* Широкий экран */
({ ctx, p } = await open(1280, 800));
const cols2 = await p.locator('.go-services').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
ok(cols2 === 3, `ПК: плитки в 3 колонки (${cols2})`);
const mw = await p.locator('main.go-main').evaluate((e) => Math.round(e.getBoundingClientRect().width));
ok(mw > 700 && mw <= 960, `ПК: контент шире телефонного, но не растянут (${mw} px)`);
await ctx.close();

/* Ошибка загрузки: не вечное «Загрузка…», а понятный текст и «Повторить» */
let blocked = true;
({ ctx, p } = await open(390, 800, async (pg) => { await pg.route('**/api/go/config*', (r) => (blocked ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }) : r.continue())); }));
ok(await p.getByRole('alert').filter({ hasText: 'недоступен' }).count() >= 1, 'сбой сервера: сообщение об ошибке (role=alert), а не вечная загрузка');
blocked = false;
await p.getByRole('button', { name: 'Повторить' }).click(); await p.waitForTimeout(2500);
ok(await p.getByText('Всё для города в одном месте').count() === 1, '«Повторить» перечитывает сервер и открывает Sky GO');
await ctx.close();

await br.close();
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
