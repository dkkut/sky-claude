/* Sky GO: регистрация курьера в браузере без даты рождения (ошибка на экране → дата → заявка уходит). Запускать из каталога с playwright-core. */
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



const { validInn } = await import('/home/user/sky-claude/server/sellerrules.mjs');
const gen = (len, fn) => { for (let i = 0; i < 100000; i++) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } };
const PNG = '/tmp/doc.png'; (await import('node:fs')).writeFileSync(PNG, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(64, 1)]));
const U = await mk('uReg'); console.log('cookies', U.cookies.map(c => c.name), 'tok', !!U.tok);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 420, height: 860 }, locale: 'ru-RU' });
await ctx.addCookies(U.cookies);
await ctx.addInitScript(() => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'dark', introAnim: false })); } catch {} });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
const net = []; p.on('response', async (r) => { if (r.url().includes('/api/go/')) net.push(r.request().method() + ' ' + r.url().replace(/^.*\/api/, '/api') + ' ' + r.status()); });
await p.goto(F + '/'); await p.waitForTimeout(3500);
const tap = async (t, n = 0) => { await p.getByText(t, { exact: true }).nth(n).click({ timeout: 5000 }); await p.waitForTimeout(800); };
try { await tap('Начать'); } catch {}
await p.screenshot({ path: S + '/reg0.png' });
await tap('Sky', 0); await tap('Sky GO', 0); await p.waitForTimeout(800);
await tap('Работа', -1 === 0 ? 0 : 1).catch(async () => { await p.getByText('Работа', { exact: true }).last().click(); });
await p.waitForTimeout(800);
await p.getByText('Курьер', { exact: true }).last().click(); await p.waitForTimeout(800);
const inputs = p.locator('input:not([type=file]):not([type=checkbox])');
console.log('inputs:', await inputs.count());
await p.getByText('Самозанятый (НПД)').first().click();
const vals = ['Иванов Иван Иванович', gen(12, (s) => validInn(s, { length: 12 })), '+79991234567'];
for (let i = 0; i < 3; i++) await inputs.nth(i).fill(vals[i]);
const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Загрузить', { exact: true }).first().click()]);
await fc.setFiles(PNG);
await p.waitForTimeout(1500);
// 1) без даты рождения: ошибка остаётся на экране
await p.getByText('Отправить на проверку', { exact: true }).click(); await p.waitForTimeout(1800);
const t1 = await p.evaluate(() => document.body.innerText);
console.log('ERR_ON_SCREEN', /Укажите дату рождения/.test(t1));
await p.screenshot({ path: S + '/reg1.png' });
// 2) вводим дату рождения и отправляем
await p.locator('input[type=date]').fill('1990-05-05');
await p.getByText('Отправить на проверку', { exact: true }).click(); await p.waitForTimeout(2000);
await p.screenshot({ path: S + '/reg2.png' });
console.log((await p.evaluate(() => document.body.innerText)).replace(/\n/g, ' | ').slice(0, 700));
console.log(net.join('\n'));
console.log('errs', errs);
await br.close();
