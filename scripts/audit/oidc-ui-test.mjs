// Sky ID для сервисов в браузере (Playwright): страница подтверждения входа со свайпом, отказ, ошибки без перенаправления, вкладка админки.
//   Нужны API (DOMAIN=sky.test OIDC_RATE_MULT=1000 ADMIN_GATE=off) и сайт на :4173 (front.mjs). (. env.sh; node scripts/audit/oidc-ui-test.mjs <каталог с api.log>)
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const codeOf = (email) => [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))].pop()?.[1];
const mk = async (tag, name) => {
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await sleep(1500);
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code: codeOf(email) }) });
  const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { pid, cookies, email, tok: r.data.accessToken ?? tok };
};
const U = await mk('oiu', 'Тест Человек'); const O = await mk('oio', 'Владелец Sky ID');
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
q(`update profiles set username='ownertest' where id='${O.pid}'`);
const step = async (u) => { await call('/api/admin/oidc/step-up', { method: 'POST', body: '{}' }, u.tok); await sleep(1300); return codeOf(u.email); };
const RURI = 'https://rp.example.com/cb'; const RUN = Date.now().toString(36);
let r = await call('/api/admin/oidc/clients', { method: 'POST', body: JSON.stringify({ name: 'Тест-сервис', kind: 'confidential', redirectUris: [RURI], scopes: ['openid', 'profile', 'email'], homepageUrl: 'https://rp.example.com', stepUpCode: await step(O) }) }, O.tok);
const CID = r.data.client.id;
const pk = () => { const v = crypto.randomBytes(48).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };
const authUrl = (over = {}) => { const p = pk(); const u = new URL(F + '/oauth/authorize'); for (const [k, v] of Object.entries({ response_type: 'code', client_id: CID, redirect_uri: RURI, scope: 'openid profile email', state: 'st-ui-1-' + RUN, nonce: 'nn', code_challenge: p.c, code_challenge_method: 'S256', ...over })) if (v !== undefined) u.searchParams.set(k, v); return u.toString(); };

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const newCtx = async (u, vp = { width: 1100, height: 900 }) => { const c = await br.newContext({ viewport: vp, locale: 'ru-RU' }); if (u) await c.addCookies(u.cookies); await c.route('https://rp.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>rp</body></html>' })); return c; };
const swipe = async (p) => {
  const h = p.getByRole('button', { name: /Проведите вправо/ }).first(); const bb = await h.boundingBox();
  const track = await p.locator('[aria-label="Проведите вправо, чтобы войти"]').first().evaluate((e) => e.parentElement.getBoundingClientRect().width);
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down();
  for (let i = 1; i <= 12; i += 1) await p.mouse.move(bb.x + bb.width / 2 + (track * i) / 12, bb.y + bb.height / 2);
  await p.mouse.up();
};

/* ── подтверждение жестом ── */
{
  const ctx = await newCtx(U); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  await p.goto(authUrl()); await p.waitForTimeout(4500);
  let txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('страница: показывает название сервиса и профиль человека', /Тест-сервис/.test(txt) && /хочет, чтобы вы вошли с помощью Sky ID/.test(txt) && /Тест Человек/.test(txt), txt.slice(0, 200));
  t('страница: перечислены разрешения, чувствительные — по желанию, без них — честное пояснение', /Ваше имя/.test(txt) && /по вашему желанию/.test(txt) && /случайный и свой для каждого сервиса/.test(txt));
  t('страница: параметры запроса убраны из адреса', !p.url().includes('code_challenge') && p.url().endsWith('/oauth/authorize'));
  t('страница: на сервере создан ровно один запрос (обновление не плодит новых)', Number(q(`select count(*) from oidc_requests where client_id='${CID}' and profile_id='${U.pid}'`)) === 1);
  await p.screenshot({ path: process.env.SHOTS + '/oidc1.png' });
  const nav = p.waitForURL((u) => u.toString().startsWith(RURI), { timeout: 8000 }).then(() => true).catch(() => false);
  await swipe(p);
  const went = await nav;
  const u2 = new URL(p.url());
  t('жест вправо: сервер подтвердил, браузер вернулся в сервис с кодом и state', went && u2.origin + u2.pathname === RURI && u2.searchParams.get('code')?.length > 20 && u2.searchParams.get('state') === 'st-ui-1-' + RUN, p.url().slice(0, 120));
  t('на сервере запрос approved, согласие записано только на выбранные разрешения', q(`select status from oidc_requests where client_id='${CID}' and profile_id='${U.pid}'`) === 'approved' && Boolean(q(`select scope from oidc_consents where client_id='${CID}' and profile_id='${U.pid}'`)));
  t('в интерфейсе нет ошибок JS', errs.length === 0, errs.join('|'));
  await ctx.close();
}
/* ── недосвайп не подтверждает, снятая галочка ограничивает данные ── */
{
  const ctx = await newCtx(U, { width: 400, height: 860 }); const p = await ctx.newPage();
  await p.goto(authUrl({ state: 'st-ui-2-' + RUN })); await p.waitForTimeout(4500);
  const h = p.getByRole('button', { name: /Проведите вправо/ }).first(); const bb = await h.boundingBox();
  await p.mouse.move(bb.x + 20, bb.y + 20); await p.mouse.down(); await p.mouse.move(bb.x + 70, bb.y + 20); await p.mouse.up(); await p.waitForTimeout(800);
  t('короткий свайп не подтверждает вход (остаёмся на странице, запрос pending)', p.url().includes('/oauth/authorize') && q(`select status from oidc_requests where state='st-ui-2-${RUN}'`) === 'pending');
  await p.getByRole('checkbox').nth(1).uncheck();   // имя
  await p.screenshot({ path: process.env.SHOTS + '/oidc2.png' });
  const nav = p.waitForURL((u) => u.toString().startsWith(RURI), { timeout: 8000 }).then(() => true).catch(() => false);
  await swipe(p); await nav;
  t('мобильная ширина: подтверждение работает; снятая галочка — разрешение не выдано', q(`select scope from oidc_consents where client_id='${CID}' and profile_id='${U.pid}'`).split(' ').sort().join(',') === 'email,openid' || !q(`select scope from oidc_consents where client_id='${CID}' and profile_id='${U.pid}'`).includes('profile'), q(`select scope from oidc_consents where client_id='${CID}' and profile_id='${U.pid}'`));
  await ctx.close();
}
/* ── отказ ── */
{
  const ctx = await newCtx(U); const p = await ctx.newPage();
  await p.goto(authUrl({ state: 'st-ui-3-' + RUN })); await p.waitForTimeout(4500);
  const nav = p.waitForURL((u) => u.toString().startsWith(RURI), { timeout: 8000 }).then(() => true).catch(() => false);
  await p.getByRole('button', { name: 'Отклонить' }).first().click(); await nav;
  const u3 = new URL(p.url());
  t('отказ: возврат в сервис с error=access_denied и без кода', u3.searchParams.get('error') === 'access_denied' && !u3.searchParams.get('code') && u3.searchParams.get('state') === 'st-ui-3-' + RUN);
  await ctx.close();
}
/* ── ошибки без перенаправления (нет открытого редиректа) ── */
{
  const ctx = await newCtx(U); const p = await ctx.newPage(); let navigatedAway = false;
  p.on('framenavigated', (f) => { if (f === p.mainFrame() && !f.url().startsWith(F)) navigatedAway = true; });
  await p.goto(authUrl({ redirect_uri: 'https://evil.example.com/cb' })); await p.waitForTimeout(4500);
  const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('чужой адрес возврата: ошибка на странице Sky, браузер никуда не уходит', /не зарегистрирован/.test(txt) && !navigatedAway && /Закрыть/.test(txt), txt.slice(0, 150));
  await ctx.close();
}
/* ── без входа в Sky ── */
{
  const ctx = await newCtx(null); const p = await ctx.newPage();
  await p.goto(authUrl({ state: 'st-ui-4-' + RUN })); await p.waitForTimeout(4000);
  const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('без входа: показывается обычный вход Sky, подтверждение недоступно', !/хочет, чтобы вы вошли/.test(txt) && Number(q(`select count(*) from oidc_requests where state='st-ui-4-${RUN}'`)) === 0, txt.slice(0, 120));
  await ctx.close();
}
/* ── админка: вкладка клиентов ── */
{
  const ctx = await newCtx(O); const p = await ctx.newPage();
  await p.goto(F + '/'); await p.waitForTimeout(5000);
  await p.getByText('Медиа', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(800);
  await p.getByText('Admin', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(3000);
  await p.getByRole('button', { name: 'Sky ID для сервисов', exact: true }).first().click(); await p.waitForTimeout(1800);
  let txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('админка: вкладка показывает клиентов и адрес конфигурации', /Sky ID для сторонних сервисов/.test(txt) && /Тест-сервис/.test(txt) && /openid-configuration/.test(txt));
  await p.screenshot({ path: process.env.SHOTS + '/oidc3.png', fullPage: true });
  await p.getByRole('button', { name: /Новый клиент/ }).click();
  await p.getByLabel('Название', { exact: true }).fill('Сервис из админки');
  await p.getByLabel('Адреса возврата').fill('https://admin-made.example.com/cb');
  await p.getByRole('button', { name: /Создать \(нужен код\)/ }).click(); await p.waitForTimeout(2200);
  await p.getByLabel('Код подтверждения').fill(codeOf(O.email) ?? ''); await p.getByRole('button', { name: 'Подтвердить' }).click(); await p.waitForTimeout(2500);
  txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  t('админка: клиент создан через интерфейс, секрет показан один раз', /Секрет клиента — показан один раз/.test(txt) && /sks_/.test(txt) && /Сервис из админки/.test(txt), txt.slice(0, 200));
  await p.getByRole('button', { name: /Я сохранил, скрыть/ }).click(); await p.waitForTimeout(400);
  t('админка: после скрытия секрет на странице больше не виден', !/sks_/.test(await p.evaluate(() => document.body.innerText)));
  await ctx.close();
}
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
