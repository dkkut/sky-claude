// Sky Video: нажатие на автора открывает канал — все видео и «Подписаться» (Playwright).
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
const A = await mk('svauth'), V = await mk('svview');
const ids = [];
for (let i = 1; i <= 3; i++) {
  const id = `vid-test-${Date.now()}-${i}`; ids.push(id);
  q(`insert into sky_videos (id, owner_id, title, mime, bytes, status, privacy, duration_sec, published_at, width, height) values ('${id}','${A.pid}','Ролик канала ${i}','video/mp4',1000,'published','public',120,now(),1280,720)`);
}
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 1100, height: 900 }, locale: 'ru-RU' }); await ctx.addCookies(V.cookies);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
await p.goto(F + '/'); await p.waitForTimeout(3500);
await p.getByText('Видео', { exact: true }).first().click({ timeout: 4000 }); await p.waitForTimeout(2500);
let txt = await body();
t('в ленте Sky Video видны ролики автора', /Ролик канала 1/.test(txt) && /Мастер Видео/.test(txt), txt.slice(0, 300));
await p.getByText('Мастер Видео', { exact: true }).first().click(); await p.waitForTimeout(2000);
txt = await body();
t('нажатие на автора открывает КАНАЛ (а не профиль): 3 видео и «Подписаться»', /Подписаться/.test(txt) && /3 видео/.test(txt) && /Ролик канала 1/.test(txt) && /Ролик канала 2/.test(txt) && /Ролик канала 3/.test(txt), txt.slice(0, 400));
await p.screenshot({ path: S + '/sv-channel.png' });
await p.getByRole('button', { name: 'Подписаться' }).click(); await p.waitForTimeout(1500);
t('«Подписаться» → «Вы подписаны»', /Вы подписаны/.test(await body()));
const r = await call(`/api/follows/${A.pid}`, {}, V.tok);
t('подписка сохранена на сервере', q(`select count(*) from follows where following_id='${A.pid}'`) === '1' || JSON.stringify(r.data).includes(V.pid), q(`select count(*) from follows where following_id='${A.pid}'`));
await p.getByText('Ролик канала 2', { exact: true }).first().click(); await p.waitForTimeout(1500);
t('из канала открывается ролик', /Ролик канала 2/.test(await body()) && /Открыть канал/.test(await body()));
await p.getByText('Открыть канал').first().click(); await p.waitForTimeout(1500);
t('со страницы ролика «Открыть канал» ведёт обратно в канал', /Вы подписаны/.test(await body()) && /Ролик канала 3/.test(await body()));
t('нет ошибок страницы', errs.length === 0, errs.join(' | '));
for (const id of ids) q(`delete from sky_videos where id='${id}'`);
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
