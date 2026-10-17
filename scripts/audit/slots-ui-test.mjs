/* Несколько Sky ID на устройстве: список, переключение, лимит 3. Playwright; API :8080, dist :4173. */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const call = async (path, o = {}, tok, slot) => {
  const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(slot ? { 'x-sky-slot': String(slot) } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r.headers };
};
const mk = async (tag, slot = 1) => {
  const email = `${tag.toLowerCase()}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }, undefined, slot);
  await new Promise(r => setTimeout(r, 2500));
  const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) }, undefined, slot);
  const cookies = r.headers.getSetCookie().map(c => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find(x => x.trim().toLowerCase().startsWith('path=')) || 'path=/').split('=')[1].trim() }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('p${Date.now()}${tag}','${pid}','active','test')`);
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { cookies, tok: r.data.accessToken ?? tok, pid, tag, email };
};

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const A = await mk('sluA', 1); const Bu = await mk('sluB', 2);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 420, height: 880 }, locale: 'ru-RU' });
await ctx.addCookies([...A.cookies, ...Bu.cookies]);
const meta = (u, slot) => ({ slot, skyId: `sky-fake-${slot}`, label: u.email, name: u.tag });
await ctx.addInitScript(([a, b]) => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'light', introAnim: false })); if (!localStorage.getItem('sky:auth:slot')) { localStorage.setItem('sky:auth:slot', '1'); localStorage.setItem('sky:auth:slots:v1', JSON.stringify([a, b])); } } catch {} }, [meta(A, 1), meta(Bu, 2)]);
const p = await ctx.newPage();
await p.goto(F + '/'); await p.waitForTimeout(3500);
try { await p.getByText('Начать', { exact: true }).first().click({ timeout: 2000 }); } catch {}
const openSkyId = async () => { await p.getByText('Профиль', { exact: true }).last().click({ timeout: 6000 }); await p.waitForTimeout(800); await p.getByText('Sky ID', { exact: true }).first().click({ timeout: 6000 }); await p.waitForTimeout(1200); };
await openSkyId();
ok(await p.locator('[data-device-accounts]').count() === 1, 'блок «Sky ID на этом устройстве» виден');
ok(await p.locator('[data-slot]').count() >= 1, 'активный слот в списке');
const slotNow = () => p.evaluate(() => localStorage.getItem('sky:auth:slot'));
ok(await slotNow() === '1', 'активен слот 1');
const list = await p.evaluate(() => JSON.parse(localStorage.getItem('sky:auth:slots:v1') ?? '[]'));
ok(list.length === 2 && list.find((x) => x.slot === 1)?.label === A.email, 'подпись слота 1 обновлена настоящими данными Sky ID: ' + JSON.stringify(list.map((x) => x.label)));
ok((await p.getByRole('button', { name: 'Добавить Sky ID' }).count()) === 1 && !(await p.getByRole('button', { name: 'Добавить Sky ID' }).isDisabled()), 'добавить ещё один можно (2 из 3)');
// переключение на второй Sky ID
const sw = p.getByRole('button', { name: 'Переключиться' });
ok(await sw.count() === 1, 'у второго Sky ID есть «Переключиться»');
await sw.click(); await p.waitForTimeout(4500);
ok(await slotNow() === '2', 'после переключения активен слот 2');
const sess = await p.evaluate(async () => (await fetch('/api/auth/refresh', { method: 'POST', headers: { 'x-sky-slot': localStorage.getItem('sky:auth:slot') || '1', 'content-type': 'application/json' }, body: '{}' })).json());
ok(sess?.skyId?.email === Bu.email, `сервер подтверждает: сессия слота 2 — второй Sky ID (${sess?.skyId?.email})`);
await openSkyId();
ok(await p.getByRole('button', { name: 'Переключиться' }).count() === 1, 'теперь «Переключиться» стоит у первого');
// добавление: слот 3, отмена возвращает назад
await p.getByRole('button', { name: 'Добавить Sky ID' }).click(); await p.waitForTimeout(4500);
ok(await slotNow() === '3', 'добавление открывает свободный слот 3');
ok(await p.getByText('Отмена, остаться в прежнем Sky ID', { exact: false }).count() === 1, 'на экране входа есть «Отмена»');
await p.getByText('Отмена, остаться в прежнем Sky ID', { exact: false }).click(); await p.waitForTimeout(4500);
ok(await slotNow() === '2', 'отмена вернула прежний слот 2');
ok(await p.evaluate(() => JSON.parse(localStorage.getItem('sky:auth:slots:v1') ?? '[]').length) === 2, 'пустой слот в списке не появился');
await br.close();
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
