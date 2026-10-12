// Закрытие модулей: баннер у людей, вход для администратора (Playwright).
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
const V = await mk('modv');
const O = await mk('modo');
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
q(`update profiles set username='ownertest' where id='${O.pid}'`);
q('delete from closed_modules');
q(`insert into closed_modules (module, reason, show_reason) values ('cloud','тест',true),('video','тест',false)`);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const open = async (who, label) => {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ru-RU' }); await ctx.addCookies(who.cookies);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  if (label === 'Видео') await p.getByText('Видео', { exact: true }).first().click();
  else { await p.getByText('Медиа', { exact: true }).first().click(); await p.waitForTimeout(1200); if (label === 'Sky Cloud') { await p.locator('text="Прочее" >> visible=true').last().click(); await p.waitForTimeout(800); } await p.locator(`text="${label}" >> visible=true`).first().click(); }
  await p.waitForTimeout(1500);
  const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  return { txt, p, ctx, errs };
};
let r = await open(V, 'Sky Cloud');
t('человек: вкладка Sky Cloud закрыта баннером', /Сервис временно недоступен/.test(r.txt) && /Мы уже работаем над восстановлением доступа/.test(r.txt) && /тест/.test(r.txt) && !/Sky VPS/.test(r.txt), r.txt.slice(0, 200));
await r.p.screenshot({ path: S + '/mod-banner.png' }); await r.ctx.close();
r = await open(V, 'Видео');
t('человек: раздел Видео закрыт, причина не показана', /Сервис временно недоступен/.test(r.txt) && !/Причина|тест/.test(r.txt.replace(/Мы уже.*/, '')), r.txt.slice(0, 200));
await r.ctx.close();
r = await open(O, 'Sky Cloud');
t('владелец: Sky Cloud открыт, видна метка', /Sky VPS/.test(r.txt) && /Закрыт для людей/.test(r.txt) && !/Сервис временно недоступен/.test(r.txt), r.txt.slice(0, 200));
await r.ctx.close();
q('delete from closed_modules'); await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
