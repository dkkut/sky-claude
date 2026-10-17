// Ограниченный доступ — интерфейс (Playwright): полоса на ограниченной сессии, «Доступ утерян», ползунок подтверждения на доверенном устройстве.
//   Нужны API (как в limitedaccess-test.mjs) и собранный сайт на :4173 с прокси на API (front.mjs).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 10);
const call = async (path, o = {}, tok, dev) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(dev ? { 'x-sky-device': dev } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, resp: r }; };
const log = () => readFileSync(S + '/api.log', 'utf8');
const codeTo = (email) => { const m = [...log().matchAll(new RegExp(email.replace(/[.+]/g, '\\$&') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const login = async (email, dev) => {
  q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${email}'`);
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }, null, dev); await sleep(1300);
  const r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code: codeTo(email) }) }, null, dev);
  const cookies = r.resp.headers.getSetCookie().map((c) => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find((x) => /path=/i.test(x)) || 'path=/').split('=')[1].trim() }; });
  return { r, cookies };
};
const A = 'devA' + rnd() + rnd() + rnd(), B2 = 'devB' + rnd() + rnd() + rnd();
const email = `limui${Date.now()}@example.com`;
let x = await login(email, A);
let tok = x.r.data.accessToken;
let r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'LimUi', username: 'limui' + Date.now().toString(36), acceptLegal: true }) }, tok, A);
const pid = r.data.profile.id;
r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok, A); tok = r.data.accessToken ?? tok;
const skyId = q(`select sky_id from profiles where id='${pid}'`);
const bk = `limuibk${rnd()}@example.com`;
q(`insert into sky_backup_emails (sky_id, email, verified_at, usable_after) values ('${skyId}', '${bk}', now(), now() - interval '1 minute')`);
r = await call('/api/skyid/limited', { method: 'PUT', body: JSON.stringify({ enabled: true }) }, tok, A);
t('настройка включена через API', r.status === 200 && r.data.enabled, JSON.stringify(r.data));

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const mkPage = async (cookies, dev, w = 420, h = 860) => {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU' }); await ctx.addCookies(cookies);
  await ctx.addInitScript((d) => { try { localStorage.setItem('sky:device:v1', d); } catch {} }, dev);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  return { ctx, p, errs, body: async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ') };
};

/* ── 1) Доверенное устройство A: настройка видна, ждёт запрос ── */
const A1 = await mkPage(x.cookies, A);
await A1.p.goto(F + '/'); await A1.p.waitForTimeout(3500);
await A1.p.screenshot({ path: S + '/lim-a-home.png' });

/* ── 2) Новое устройство B: ограниченная сессия ── */
const xb = await login(email, B2);
t('вход на B ограничен', xb.r.data.limited === true, JSON.stringify(xb.r.data).slice(0, 120));
const Bp = await mkPage(xb.cookies, B2);
await Bp.p.goto(F + '/'); await Bp.p.waitForTimeout(4000);
let b = await Bp.body();
t('UI 1. на B — полоса «Вход не подтверждён…» и кнопка «Доступ утерян»', /Вход не подтверждён/.test(b) && /Доступ утерян/.test(b), b.slice(0, 300));
await Bp.p.screenshot({ path: S + '/lim-b-bar.png' });

/* ── 3) На A появилась карточка с ползунком (остров/карточка) ── */
await A1.p.getByText('Начать', { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
await A1.p.evaluate(() => window.dispatchEvent(new CustomEvent('sky:limited-pending')));
await A1.p.waitForTimeout(2500);
// Компактная капсула острова раскрывается касанием.
await A1.p.getByText('Подтвердите вход с нового устройства').first().click({ timeout: 3000 }).catch(() => {});
await A1.p.waitForTimeout(1200);
const slider = A1.p.getByRole('button', { name: 'Проведите вправо, чтобы разрешить' }).first();
t('UI 2. на доверенном устройстве есть ползунок «Проведите вправо, чтобы разрешить»', await slider.count() > 0, (await A1.body()).slice(0, 300));
await A1.p.screenshot({ path: S + '/lim-a-swipe.png' });
await slider.focus(); await A1.p.keyboard.press('Enter');
await A1.p.waitForTimeout(2500);
t('UI 3. после жеста запрос подтверждён на сервере', q(`select count(*) from device_approvals where sky_id='${skyId}' and status='approved' and decided_via='device'`) === '1');
await Bp.p.waitForTimeout(6500);
b = await Bp.body();
t('UI 4. устройство B само сняло ограничение (страница перезагрузилась)', !/Вход не подтверждён/.test(b), b.slice(0, 200));

/* ── 4) «Доступ утерян» на новом устройстве C ── */
const C = 'devC' + rnd() + rnd() + rnd();
const xc = await login(email, C);
const Cp = await mkPage(xc.cookies, C);
await Cp.p.goto(F + '/'); await Cp.p.waitForTimeout(4000);
await Cp.p.getByRole('button', { name: 'Доступ утерян' }).first().click();
await Cp.p.waitForTimeout(500);
await Cp.p.screenshot({ path: S + '/lim-c-lost.png' });
q(`delete from recovery_attempts`);
await Cp.p.getByRole('button', { name: 'Отправить код на резервную почту' }).click();
await Cp.p.waitForTimeout(1800);
b = await Cp.body();
t('UI 5. показан замаскированный адрес резервной почты', /l\*\*\*@example\.com/.test(b), b.slice(0, 300));
await Cp.p.getByLabel('Код из письма').fill('000000');
await Cp.p.getByRole('button', { name: 'Подтвердить вход' }).click(); await Cp.p.waitForTimeout(1200);
t('UI 6. неверный код: сообщение', /Код не подошёл/.test(await Cp.body()));
await Cp.p.getByLabel('Код из письма').fill(codeTo(bk));
await Cp.p.getByRole('button', { name: 'Подтвердить вход' }).click(); await Cp.p.waitForTimeout(3500);
b = await Cp.body();
t('UI 7. верный код: ограничение снято', !/Вход не подтверждён/.test(b) && q(`select count(*) from device_approvals where sky_id='${skyId}' and decided_via='backup_email'`) === '1', b.slice(0, 200));

/* ── 5) Настройка в Профиль → Sky ID → Защита ── */
await A1.p.reload(); await A1.p.waitForTimeout(3500);
await A1.p.getByText('Профиль', { exact: true }).last().click().catch(() => {}); await A1.p.waitForTimeout(1500);
await A1.p.getByText('Sky ID', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
await A1.p.waitForTimeout(800);
await A1.p.getByText('Защита', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
await A1.p.waitForTimeout(1200);
b = await A1.body();
t('UI 8. в «Защите» есть переключатель «Ограничить вход с новых устройств»', /Ограничить вход с новых устройств/.test(b), b.slice(0, 300));
await A1.p.screenshot({ path: S + '/lim-settings.png' });
t('нет ошибок страницы', [A1, Bp, Cp].every((c) => c.errs.length === 0), JSON.stringify([A1.errs, Bp.errs, Cp.errs]));
await br.close();
console.log(`\nитого: ${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
