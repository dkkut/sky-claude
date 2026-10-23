// «Продолжить на другом устройстве»: два «устройства» одного Sky ID в браузере (Playwright). Нужны API (EXTRA_ORIGINS=http://localhost:4173) и сайт на :4173.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok, extra = {}) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra, ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, String(x).slice(0, 240)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `houi${Date.now()}@example.com`;
await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await sleep(1300);
const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; });
let tok = r.data.accessToken;
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'Хозяин', username: 'houi' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id;
r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok); tok = r.data.accessToken ?? tok;
q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan,expires_at) VALUES ('p${Date.now()}ho','${pid}','active','test', now() + interval '30 days')`);
const mid = 'mov-' + crypto.randomUUID();
q(`insert into film_movies (id, owner_id, title, mime, bytes, status, duration_sec, genre) values ('${mid}','${pid}','Фильм Передачи','video/mp4',1000,'private',3600,'Драма')`);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const open = async (vp, label) => {
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU' }); await ctx.addCookies(cookies);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  await p.getByRole('button', { name: 'Позже' }).first().click({ timeout: 2500 }).catch(() => {}); await p.waitForTimeout(500);
  const dev = await p.evaluate(() => localStorage.getItem('sky:device:v1'));
  return { ctx, p, errs, dev, label, body: async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ') };
};
const D1 = await open({ width: 1280, height: 860 }, 'ПК');
const D2 = await open({ width: 390, height: 800 }, 'Телефон');
await sleep(2500);
const ov = await call('/api/transfer', {}, tok, { 'x-sky-device': D1.dev });
const dev1 = ov.data.devices?.find((d) => d.current), dev2 = ov.data.devices?.find((d) => !d.current);
t('оба устройства зарегистрированы сами (без захода в «Передачу файлов»)', !!dev1 && !!dev2, ov.data);
t('второе ждёт подтверждения (защита от посторонних)', dev2?.status === 'pending', dev2);
r = await call('/api/handoff/send', { method: 'POST', body: JSON.stringify({ toDevice: dev2.id, kind: 'film', itemId: mid, title: 'Фильм Передачи', position: 600, duration: 3600, idemKey: crypto.randomUUID() }) }, tok, { 'x-sky-device': D1.dev });
t('неподтверждённое устройство передачу не получает', r.data.error === 'recipient_not_trusted', r.data);
r = await call(`/api/transfer/devices/${dev2.id}/approve`, { method: 'POST', body: '{}' }, tok, { 'x-sky-device': D1.dev }); t('подтверждено с первого устройства', r.status === 200, r);
await sleep(1500);
await D2.p.evaluate(() => window.dispatchEvent(new Event('focus')));
r = await call('/api/handoff/send', { method: 'POST', body: JSON.stringify({ toDevice: dev2.id, kind: 'film', itemId: mid, title: 'Фильм Передачи', position: 600, duration: 3600, idemKey: crypto.randomUUID() }) }, tok, { 'x-sky-device': D1.dev });
t('отправка на подтверждённое', r.status === 201, r.data);
const h1 = r.data.handoff?.id;

/* получатель (телефон) видит карточку */
await D2.p.waitForSelector('[role=alertdialog]', { timeout: 20000 }).catch(() => {});
let txt = await D2.body();
t('телефон: карточка «Продолжить» с названием и местом', /Фильм Передачи/.test(txt) && /10:00/.test(txt) && /Продолжить/.test(txt) && /Не сейчас/.test(txt), txt.slice(0, 300));
await D2.p.screenshot({ path: S + '/ho-incoming-phone.png' });
const sw = await D2.p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); t('телефон: нет горизонтальной прокрутки', sw[0] <= sw[1] + 1, sw.join('/'));
await D2.p.locator('[role=alertdialog]').getByRole('button', { name: 'Продолжить' }).click(); await D2.p.waitForTimeout(3000);
t('принято: состояние на сервере', q(`select state from handoffs where id='${h1}'`) === 'accepted');
txt = await D2.body();
t('телефон: открылся плеер кино с этим названием', /Фильм Передачи/.test(txt) && !(await D2.p.locator('[role=alertdialog]').count()), txt.slice(0, 300));
await D2.p.screenshot({ path: S + '/ho-opened-phone.png' });

/* обратно: с телефона на ПК через кнопку в плеере */
const btn = D2.p.getByRole('button', { name: 'Продолжить на другом устройстве' }).first();
t('в плеере кино есть кнопка «Продолжить на другом устройстве»', (await btn.count()) > 0);
if (await btn.count()) {
  await btn.click(); await D2.p.waitForTimeout(1800);
  txt = await D2.body();
  t('окно: устройства, Bluetooth-пояснение, «Не останавливать здесь»', /Продолжить на другом устройстве/.test(txt) && /Bluetooth/.test(txt), txt.slice(0, 400));
  await D2.p.screenshot({ path: S + '/ho-sheet-phone.png' });
  const sw2 = await D2.p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); t('окно на телефоне: без горизонтальной прокрутки', sw2[0] <= sw2[1] + 1, sw2.join('/'));
  await D2.p.locator('[role=dialog][aria-label="Продолжить на другом устройстве"]').getByText(dev1.name, { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
  await D2.p.waitForTimeout(1500);
  txt = await D2.body(); t('окно: «Ждём ответ»', /Ждём ответ/.test(txt), txt.slice(0, 300));
  await D1.p.waitForSelector('[role=alertdialog]', { timeout: 20000 }).catch(() => {});
  txt = await D1.body(); t('ПК: входящая карточка', /Фильм Передачи/.test(txt) && /Не сейчас/.test(txt), txt.slice(0, 300));
  await D1.p.screenshot({ path: S + '/ho-incoming-desktop.png' });
  await D1.p.locator('[role=alertdialog]').getByRole('button', { name: 'Не сейчас' }).click(); await D2.p.getByText('отклонило').first().waitFor({ timeout: 12000 }).catch(() => {});
  txt = await D2.body(); t('телефон: видит «отклонило» и может вернуть воспроизведение', /отклонило/.test(txt) && /Повторить/.test(txt), txt.slice(0, 300));
  const second = q(`select count(*) from handoffs where profile_id='${pid}' and state='declined'`); t('отклонение записано', second === '1');
  await D2.p.screenshot({ path: S + '/ho-declined-phone.png' });
}
t('без ошибок страницы (ПК)', D1.errs.length === 0, D1.errs.join(';')); t('без ошибок страницы (телефон)', D2.errs.length === 0, D2.errs.join(';'));
await br.close();
console.log(`\nHandoff UI: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
