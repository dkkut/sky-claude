// Sky Storage в браузере (Playwright): вкладка админки (четыре кнопки по-настоящему, через интерфейс) и страница /storage-verify.
//   Нужны API (с STORAGE_*; ADMIN_GATE=off) и собранный сайт на :4173 (front.mjs с прокси).
//   (. env.sh; node scripts/audit/skystorage-ui-test.mjs <каталог с api.log>)
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok, extra = {}) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...extra, ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const mk = async (tag, name) => {
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await sleep(1500);
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code: [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1] }) });
  const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { pid, cookies, email, tok: r.data.accessToken ?? tok };
};
const O = await mk('stuio', 'Владелец Хранилища');
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
q(`update profiles set username='ownertest' where id='${O.pid}'`);
q(`update storage_state set settings = settings || '{"approvalScope":"off"}'::jsonb, emergency='{"active":false}'::jsonb, sky_auth='{"active":false}'::jsonb, maintenance='{"active":false}'::jsonb, restrictions='[]'::jsonb`);
await sleep(2500);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

/* ── вкладка админки ── */
{
  const ctx = await br.newContext({ viewport: { width: 1200, height: 1100 }, locale: 'ru-RU' }); await ctx.addCookies(O.cookies);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  await p.getByText('Медиа', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1000);
  await p.getByText('Admin', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Sky Storage', exact: true }).first().click(); await p.waitForTimeout(2500);
  let txt = await body();
  t('вкладка: общее состояние и четыре кнопки', /Общее состояние/.test(txt) && /1\. Выключить хранилище/.test(txt) && /2\. Ограничить доступ/.test(txt) && /3\. Включить хранилище/.test(txt) && /4\. Отключить ограничения/.test(txt), txt.slice(0, 300));
  t('вкладка: показано основное хранение медиа и площадка копий', /Основное хранение медиа/.test(txt) && /Площадка копий/.test(txt));
  await p.screenshot({ path: process.env.SHOTS + '/stor1.png', fullPage: true });
  // Кнопка 1 через интерфейс
  await p.getByRole('button', { name: /1\. Выключить хранилище/ }).click(); await p.waitForTimeout(500);
  const crit = p.locator('[data-storage-critical="/emergency-off"]');
  t('кнопка 1: перечислены последствия, файлы не удаляются', /НЕ удаляются/.test(await crit.innerText()));
  t('кнопка 1: без причины и галочки подтвердить нельзя', await crit.getByRole('button', { name: 'Выключить', exact: true }).isDisabled());
  await crit.getByLabel('Причина').fill('проверка кнопки из интерфейса'); await crit.getByRole('checkbox').check();
  await crit.getByRole('button', { name: 'Выключить', exact: true }).click(); await p.waitForTimeout(2500);
  await crit.getByLabel('Код подтверждения').fill(codeOf(O.email) ?? ''); await crit.getByRole('button', { name: 'Подтвердить' }).click(); await p.waitForTimeout(2500);
  txt = await body();
  t('кнопка 1: интерфейс показывает фактическое состояние сервера', /аварийное отключение/.test(txt) && /чтение закрыто/.test(txt) && /запись закрыта/.test(txt), txt.slice(0, 300));
  t('кнопка 1: в базе состояние изменено', q(`select emergency->>'active' from storage_state`) === 'true');
  await p.screenshot({ path: process.env.SHOTS + '/stor2.png', fullPage: true });
  // Кнопка 3 с предпросмотром проверок
  await sleep(2500);
  await p.getByRole('button', { name: /3\. Включить хранилище/ }).click(); await p.waitForTimeout(1500);
  const en = p.locator('[data-storage-critical="/enable"]');
  t('кнопка 3: проверки видны до подтверждения', /База данных/.test(await en.innerText()) && /Нет блокировки из-за компрометации/.test(await en.innerText()));
  await en.getByRole('checkbox').check(); await en.getByRole('button', { name: 'Включить', exact: true }).click(); await p.waitForTimeout(2500);
  await en.getByLabel('Код подтверждения').fill(codeOf(O.email) ?? ''); await en.getByRole('button', { name: 'Подтвердить' }).click(); await p.waitForTimeout(2500);
  txt = await body();
  t('кнопка 3: хранилище включено, остальное не тронуто', /без аварийного отключения/.test(txt) && q(`select emergency->>'active' from storage_state`) === 'false');
  // Остальные вкладки
  for (const [name, re] of [['Резервные копии', /Запустить копирование|Копии/], ['Подключения', /Подключения к управлению/], ['Квоты и пороги', /Пороги и лимиты/], ['Журнал', /Журнал безопасности/]]) {
    await p.getByRole('button', { name, exact: true }).last().click(); await p.waitForTimeout(1500);
    t(`вкладка «${name}» открывается`, re.test(await body()));
  }
  t('в интерфейсе нет ошибок JS', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ── страница /storage-verify ── */
{
  q(`update storage_state set settings = settings || '{"approvalScope":"admin"}'::jsonb`); await sleep(2500);
  q(`delete from storage_connections`);
  const dev = (n) => ({ 'x-sky-device': `dev-${n}-0123456789abcdef` });
  await call('/api/admin/storage/connection-status', {}, O.tok, dev('a'));   // первое устройство — начальная настройка
  const second = await call('/api/admin/storage/overview', {}, O.tok, dev('b'));
  t('подготовка: второе устройство ждёт подтверждения', second.data.error === 'connection_pending', JSON.stringify(second.data).slice(0, 150));
  const token = crypto.randomBytes(32).toString('base64url');
  q(`update storage_connections set token_hash='${crypto.createHash('sha256').update(token).digest('hex')}', mailed_at=now() where id='${second.data.pending.id}'`);
  const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, locale: 'ru-RU' });
  const p = await ctx.newPage(); const reqs = []; p.on('request', (r) => reqs.push(r.url() + ' ' + r.method()));
  const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  await p.goto(`${F}/storage-verify?t=${token}`); await p.waitForTimeout(2500);
  let txt = await body();
  t('страница: показывает сведения о запросе, решение не принято', /Подключение к Sky Storage/.test(txt) && /Запрошено/.test(txt) && /Само открытие этой страницы ничего не подтвердило/.test(txt) && q(`select status from storage_connections where id='${second.data.pending.id}'`) === 'pending', txt.slice(0, 300));
  t('страница: токен убран из адресной строки', !p.url().includes(token));
  t('страница: открытие ссылки не отправило решение', !reqs.some((r) => /verify\/decide/.test(r)));
  await p.screenshot({ path: process.env.SHOTS + '/stor3.png' });
  t('страница: без кода подтвердить нельзя', await p.getByRole('button', { name: /Это я, подтвердить/ }).isDisabled());
  await p.getByLabel('Код подтверждения').fill('000000'); await p.getByRole('button', { name: /Это я, подтвердить/ }).click(); await p.waitForTimeout(1500);
  t('страница: неверный код отклоняется, подключение не подтверждено', /Код не подошёл/.test(await body()) && q(`select status from storage_connections where id='${second.data.pending.id}'`) === 'pending');
  await sleep(500);
  await p.getByLabel('Код подтверждения').fill(codeOf(O.email) ?? ''); await p.getByRole('button', { name: /Это я, подтвердить/ }).click(); await p.waitForTimeout(2000);
  t('страница: с верным кодом подключение подтверждено', /Подключение подтверждено/.test(await body()) && q(`select status from storage_connections where id='${second.data.pending.id}'`) === 'approved');
  const p2 = await ctx.newPage(); await p2.goto(`${F}/storage-verify?t=${token}`); await p2.waitForTimeout(2000);
  t('страница: повторное открытие той же ссылки — недействительна', /Ссылка уже использована|уже подтверждено|недействительна/.test(await p2.evaluate(() => document.body.innerText)));
  const p3 = await ctx.newPage(); await p3.goto(`${F}/storage-verify?t=nonsense`); await p3.waitForTimeout(1800);
  t('страница: чужой токен — недействительна', /недействительна/.test(await p3.evaluate(() => document.body.innerText)));
  await ctx.close();
}
q(`update storage_state set settings = settings || '{"approvalScope":"off"}'::jsonb`);
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
