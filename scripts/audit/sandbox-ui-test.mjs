// Sky Sandbox: вкладка админки (Playwright). Нужны API (SANDBOX_SECRET, OWNER_USERNAME=sbxowner ADMIN_GATE=off) и собранный сайт на :4173 (front.mjs).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, String(x).slice(0, 240)); } };
const mk = async (tag, role) => {
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await new Promise((r) => setTimeout(r, 1300));
  const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  if (role) q(`update profiles set is_admin=true, admin_role='${role}' where id='${pid}'`);
  return { pid, email, cookies, tok: r.data.accessToken ?? tok };
};
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const PB = await mk('sbxuip', 'sandbox_publisher'), VW = await mk('sbxuiv', 'sandbox_admin'), AU = await mk('sbxuia', 'sandbox_admin');
q('delete from sandbox_publications; delete from sandbox_builds');
const sha = () => crypto.randomBytes(20).toString('hex');
const chk = (id, status, detail = '') => ({ id, title: id === 'types' ? 'Типы (tsc)' : id, status, detail, ms: 1200, log: id === 'types' ? 'строка журнала проверки' : '' });
const seed = (id, status, mode, who, checks, extra = '') => q(`insert into sandbox_builds (id, sha, ref, profile, mode, status, requested_by, report, counts, finished_at) values ('${id}','${sha()}','main','full','${mode}','${status}','${who.pid}','${JSON.stringify({ checks, reasons: mode === 'local' ? ['изоляция не подтверждена: проверка шла не в изолированной среде'] : [] })}'::jsonb,'{}'::jsonb, now())`);
seed('sbx-uipass', 'passed', 'isolated', AU, [chk('checkout', 'ok', 'abc, изменено файлов: 3'), chk('types', 'ok', 'ошибок нет')]);
seed('sbx-uiwarn', 'warnings', 'local', AU, [chk('types', 'ok'), chk('audit', 'warn', 'высоких 2')]);
seed('sbx-uifail', 'failed', 'isolated', AU, [chk('secrets', 'fail', 'найден секрет')]);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const open = async (who, vp = { width: 1180, height: 1100 }) => {
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU' }); await ctx.addCookies(who.cookies);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  await p.getByRole('button', { name: 'Позже' }).first().click({ timeout: 2500 }).catch(() => {}); await p.waitForTimeout(500);
  await p.getByText('Медиа', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(900);
  await p.getByText('Admin', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1800);
  await p.getByRole('button', { name: 'Sky Sandbox', exact: true }).first().click(); await p.waitForTimeout(1500);
  return { p, ctx, errs, body: async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ') };
};

/* сотрудник без права публикации */
let s = await open(VW); let txt = await s.body();
t('вкладка открывается, три подписи вердикта видны', /Проверка пройдена/.test(txt) && /Есть замечания/.test(txt) && /Проверка не пройдена/.test(txt), txt.slice(0, 300));
t('без права публикации кнопки «Опубликовать…» нет', !/Опубликовать…/.test(txt));
t('раннер не выходил — честная подпись', /Раннер пока не выходил на связь|на связи|не отвечает/.test(txt));
await s.p.locator('div.rounded-2xl', { hasText: 'Проверка пройдена' }).getByRole('button', { name: 'Отчёт' }).first().click(); await s.p.waitForTimeout(900); txt = await s.body();
t('отчёт: проверки со статусами и подробностями', /Типы \(tsc\)/.test(txt) && /пройдена/.test(txt), txt.slice(0, 300));
await s.p.screenshot({ path: S + '/sbx-viewer.png' });
t('без ошибок страницы', s.errs.length === 0, s.errs.join(';')); await s.ctx.close();

/* публикующий */
s = await open(PB); txt = await s.body();
t('публикующий видит «Опубликовать…» у проверенных', /Опубликовать…/.test(txt));
const idx = await s.p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Опубликовать…')).length);
t('кнопка есть у «пройдена» и «замечания» (но не у «не пройдена»)', idx === 2, idx);
await s.p.getByRole('button', { name: /Опубликовать…/ }).first().click(); await s.p.waitForTimeout(1500);
txt = await s.body();
t('окно публикации: описание резервной копии и откат', /Опубликовать сборку/.test(txt) && /резервную копию/.test(txt));
const sub = s.p.getByRole('button', { name: 'Одобрить публикацию' });
t('без кода кнопка недоступна', await sub.isDisabled());
await s.p.getByPlaceholder(/Код из/).fill(codeOf(PB.email) ?? '000000'); await s.p.waitForTimeout(300);
await s.p.screenshot({ path: S + '/sbx-publish.png' });
// первый «Опубликовать…» относится к самой новой сборке — «замечания» или «пройдена»; для «замечаний» нужна галочка
const needAccept = /замечания в отчёте и согласен/.test(await s.body());
if (needAccept) { t('при замечаниях без галочки кнопка недоступна', await sub.isDisabled()); await s.p.getByRole('checkbox').first().check(); }
// код step-up берётся из письма, поэтому запрашиваем его перед отправкой
await sub.click({ timeout: 4000 }).catch(() => {}); await s.p.waitForTimeout(1500); txt = await s.body();
const pubs = Number(q('select count(*) from sandbox_publications'));
if (needAccept) t('«замечания» без изоляции публиковать нельзя — понятный отказ (сервер)', pubs === 0 && /без изоляции/.test(txt), txt.slice(0, 300));
else t('публикация одобрена, раннер ждёт', pubs === 1 && /ждёт раннера/.test(txt), txt.slice(0, 300));
await s.p.screenshot({ path: S + '/sbx-after.png' });
t('без ошибок страницы', s.errs.length === 0, s.errs.join(';')); await s.ctx.close();

/* вторая публикация — «проверка пройдена» (чистая сборка, раннер в изоляции) */
s = await open(PB);
await s.p.locator('div.rounded-2xl', { hasText: 'Проверка пройдена' }).getByRole('button', { name: /Опубликовать…/ }).first().click(); await s.p.waitForTimeout(1500);
txt = await s.body();
t('чистая сборка: галочки замечаний нет', !/замечания в отчёте и согласен/.test(txt));
await s.p.getByPlaceholder(/Код из/).fill(codeOf(PB.email) ?? '000000');
await s.p.getByRole('button', { name: 'Одобрить публикацию' }).click({ timeout: 4000 }).catch(() => {}); await s.p.waitForTimeout(1800); txt = await s.body();
t('публикация одобрена: в списке «ждёт раннера»', Number(q('select count(*) from sandbox_publications')) === 1 && /ждёт раннера/.test(txt), txt.slice(0, 300));
t('в журнале администрации есть запись об одобрении', Number(q("select count(*) from admin_log where type='sandbox_publish_approve'")) >= 1);
await s.p.screenshot({ path: S + '/sbx-after.png' });
/* телефон: после сужения окна нет горизонтальной прокрутки в содержимом вкладки */
await s.p.setViewportSize({ width: 390, height: 800 }); await s.p.waitForTimeout(900);
const sw = await s.p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
t('узкий экран: нет горизонтальной прокрутки', sw[0] <= sw[1] + 1, sw.join('/'));
await s.p.screenshot({ path: S + '/sbx-phone.png' });
t('без ошибок страницы', s.errs.length === 0, s.errs.join(';')); await s.ctx.close();
await br.close();
console.log(`\nSandbox UI: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
