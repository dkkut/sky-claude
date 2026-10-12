// Заморозка входов и очистка сессий — интерфейс (Playwright): Профиль → Sky ID → Устройства.
//   Нужны API и собранный сайт на :4173 (front.mjs с прокси), см. accountfreeze-test.mjs.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `frzui${Date.now()}@example.com`;
const login = async () => {
  q(`delete from verification_codes where destination='${email}'`);
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await sleep(1300);
  const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  return call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
};
let r = await login(); let tok = r.data.accessToken;
const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find((x) => /path=/i.test(x)) || 'path=/').split('=')[1].trim() }; });
r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'FrzUi', username: 'frzui' + Date.now().toString(36), acceptLegal: true }) }, tok);
const pid = r.data.profile.id; const sky = q(`select sky_id from profiles where id='${pid}'`);
await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
const other = (await login()).data.accessToken; // «чужая» сессия, которую завершим

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, locale: 'ru-RU' }); await ctx.addCookies(cookies);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
await p.goto(F + '/'); await p.waitForTimeout(3500);
await p.getByText('Профиль', { exact: true }).last().click().catch(() => {}); await p.waitForTimeout(1500);
await p.getByText('Sky ID', { exact: true }).first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(800);
await p.getByText('Устройства', { exact: true }).first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(1500);
t('в «Устройствах» есть блок защиты аккаунта', /Защита аккаунта/.test(await body()), (await body()).slice(0, 300));
t('баннера разморозки пока нет', !/Разморозка аккаунта/.test(await body()));
await p.getByText('Защита аккаунта: завершить входы, заморозить').click(); await p.waitForTimeout(500);
await p.getByLabel('Завершить сессии').selectOption({ label: 'Только последний вход' });
await p.getByLabel('Заморозить новые входы').selectOption({ label: 'На 1 час' });
await p.screenshot({ path: S + '/frz-form.png' });
await p.getByRole('button', { name: 'Применить' }).click(); await p.waitForTimeout(400);
t('перед выполнением — подтверждение с перечнем действий', /Продолжить\?/.test(await body()) && /Только последний вход/.test(await body()) && /На 1 час/.test(await body()));
await p.getByRole('button', { name: 'Да, выполнить' }).click(); await p.waitForTimeout(1800);
let txt = await body();
t('результат: завершена 1 сессия, входы заморожены, письмо ушло', /Завершено сессий: 1/.test(txt) && /Новые входы заморожены до/.test(txt), txt.slice(0, 400));
t('«чужая» сессия действительно погашена на сервере', (await call('/api/auth/freeze', {}, other)).status === 401);
t('баннера «Разморозка аккаунта» всё ещё нет (ссылку не открывали)', !/Разморозка аккаунта/.test(txt.replace('Новые входы заморожены', '')) || !(await p.getByRole('alert').count()));
t('но виден статус заморозки и «Прислать письмо ещё раз»', /Прислать письмо ещё раз/.test(txt));
await p.screenshot({ path: S + '/frz-frozen.png' });

// Ссылка из письма — в другом браузере без входа
await sleep(500);
const log = readFileSync(S + '/api.log', 'utf8'); const k = log.lastIndexOf(email + ' | Новые входы');
const token = /\/unfreeze\?t=([A-Za-z0-9_-]+)/.exec(log.slice(k))[1];
const c2 = await br.newContext({ viewport: { width: 420, height: 800 }, locale: 'ru-RU' }); const p2 = await c2.newPage();
await p2.goto(F + `/unfreeze?t=${token}`); await p2.waitForTimeout(2500);
let t2 = (await p2.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
t('страница по ссылке просит подтвердить, ничего не делая сама', /Подтвердить ссылку/.test(t2) && q(`select freeze_link_ok_until is null from sky_ids where id='${sky}'`) === 't', t2);
await p2.getByRole('button', { name: 'Подтвердить ссылку' }).click(); await p2.waitForTimeout(1500);
t2 = (await p2.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
t('ссылка подтверждена, сказано куда идти дальше', /Ссылка подтверждена на 30 минут/.test(t2) && /Профиль → Sky ID → Устройства/.test(t2), t2);
await p2.screenshot({ path: S + '/frz-link.png' });
t('аккаунт всё ещё заморожен после ссылки', q(`select login_frozen_until > now() from sky_ids where id='${sky}'`) === 't');

// Письмо ещё раз → ссылка открывается в браузере, где уже есть вход: сразу попадаем в «Устройства» с баннером
await call('/api/auth/freeze/resend', { method: 'POST', body: '{}' }, tok); await sleep(700);
const log2 = readFileSync(S + '/api.log', 'utf8'); const k2 = log2.lastIndexOf(email + ' | Новые входы');
const token2 = /\/unfreeze\?t=([A-Za-z0-9_-]+)/.exec(log2.slice(k2))[1];
t('новая ссылка отличается от прежней', token2 !== token);
await p.goto(F + `/unfreeze?t=${token2}`); await p.waitForTimeout(2000);
await p.getByRole('button', { name: 'Подтвердить ссылку' }).click(); await p.waitForTimeout(4500);
t('после ссылки в браузере со входом — сразу «Профиль → Sky ID → Устройства» с баннером «Разморозка аккаунта»', (await p.getByRole('alert').filter({ hasText: 'Разморозка аккаунта' }).count()) === 1 && /Активные сессии/i.test(await body()), (await body()).slice(0, 300));
await p.screenshot({ path: S + '/frz-banner.png' });
await p.getByRole('button', { name: 'Разморозить новые входы' }).click(); await p.waitForTimeout(1500);
t('после «Разморозить» баннера нет, заморозка снята', (await p.getByRole('alert').count()) === 0 && q(`select login_frozen_until is null from sky_ids where id='${sky}'`) === 't');
r = await login();
t('новые входы снова работают', r.status === 200 && r.data.accessToken);
t('нет ошибок страницы', errs.length === 0, errs.join(' | '));
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
