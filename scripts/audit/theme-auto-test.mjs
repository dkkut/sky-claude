/* Автопереключение темы по времени (Playwright с подменой часов). Нужны API :8080, dist на :4173; запускать из каталога с playwright-core. */
/* Sky GO «Жилье и отдых»: интерфейс в браузере (Playwright). Нужны API :8080, dist на :4173; запускать из каталога с playwright-core. */
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
const U = await mk('uTheme');
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const run = async (iso, seed, fn) => {
  const ctx = await br.newContext({ viewport: { width: 420, height: 860 }, locale: 'ru-RU' });
  await ctx.addCookies(U.cookies);
  await ctx.addInitScript((s) => { try { localStorage.setItem('sky:settings:v1', JSON.stringify(s)); } catch {} }, seed);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.clock.install({ time: new Date(iso) });
  await p.goto(F + '/'); await p.waitForTimeout(3000);
  await fn(p); await ctx.close(); return errs;
};
const theme = (p) => p.evaluate(() => document.documentElement.dataset.theme);
const base = { introAnim: false, autoTheme: true, autoThemeLight: '07:00', autoThemeDark: '21:00' };
let errs = [];
errs.push(...await run('2026-10-12T23:30:00', { ...base, colorScheme: 'light' }, async (p) => { ok(await theme(p) === 'dark', 'TH1. в 23:30 включается тёмная (была светлая)'); }));
errs.push(...await run('2026-10-12T12:00:00', { ...base, colorScheme: 'dark' }, async (p) => { ok(await theme(p) === 'light', 'TH2. в 12:00 включается светлая (была тёмная)'); }));
errs.push(...await run('2026-10-12T03:00:00', { ...base, colorScheme: 'light' }, async (p) => { ok(await theme(p) === 'dark', 'TH3. в 03:00 (после полуночи) — тёмная'); }));
errs.push(...await run('2026-10-12T20:59:00', { ...base, colorScheme: 'dark' }, async (p) => {
  ok(await theme(p) === 'light', 'TH4. в 20:59 ещё светлая');
  await p.clock.fastForward(2 * 60 * 1000); await p.waitForTimeout(500);
  ok(await theme(p) === 'dark', 'TH5. после 21:00 тема переключается сама, без перезагрузки');
}));
errs.push(...await run('2026-10-12T12:00:00', { ...base, autoTheme: false, colorScheme: 'dark' }, async (p) => { ok(await theme(p) === 'dark', 'TH6. автопереключение выключено — тема не трогается'); }));
errs.push(...await run('2026-10-12T12:00:00', { ...base, autoThemeLight: '22:00', autoThemeDark: '06:00', colorScheme: 'light' }, async (p) => { ok(await theme(p) === 'dark', 'TH7. интервал через полночь (светлая 22:00–06:00): в 12:00 — тёмная'); }));
errs.push(...await run('2026-10-12T12:00:00', { ...base, autoTheme: false, colorScheme: 'dark' }, async (p) => {
  const tap = async (t, n = 0) => { await p.getByText(t, { exact: true }).nth(n).click({ timeout: 5000 }); await p.waitForTimeout(700); };
  try { await tap('Начать'); } catch {}
  await tap('Профиль', 0);
  await tap('Настройки', 0);
  await p.getByText('Автопереключение по времени').scrollIntoViewIfNeeded().catch(() => {});
  ok(await p.getByText('Автопереключение по времени').count() > 0, 'TH9. в Настройках есть «Автопереключение по времени»');
  await p.getByText('Автопереключение по времени').locator('xpath=../../..').locator('[role=switch]').click({ timeout: 3000 }).catch((e) => console.log('CLICKERR', e.message.slice(0, 80)));
  await p.waitForTimeout(600);
  await p.getByText('Автопереключение по времени').scrollIntoViewIfNeeded().catch(() => {});
  await p.screenshot({ path: S + '/theme1.png' });
  await p.clock.fastForward(1000); await p.waitForTimeout(400);
  
  const isLight = await theme(p);
  ok(isLight === 'light', 'TH10. включили в 12:00 — тема сразу стала светлой (' + isLight + ')');
  await p.getByText('Тёмная', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(500);
  ok(await theme(p) === 'dark', 'TH11. ручной выбор «Тёмная» перебивает автопереключение');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sky:settings:v1') || '{}').autoTheme);
  ok(saved === false, 'TH12. после ручного выбора автопереключение выключено');
}));
await br.close();
ok(errs.length === 0, 'TH8. без ошибок JS ' + JSON.stringify(errs));
console.log(fails ? 'ПРОВАЛЕНО ' + fails : 'Все проверки пройдены');
process.exit(fails ? 1 : 0);
