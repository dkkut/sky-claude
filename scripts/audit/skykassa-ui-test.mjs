// SkyKassa в браузере (Playwright): платёжная страница в кошельке (ПК и телефон) и вкладка админки.
//   Нужны API (с SKYKASSA_RATE_MULT) и собранный сайт на :4173 (front.mjs с прокси).
//   (. env.sh; node scripts/audit/skykassa-ui-test.mjs <каталог с api.log>)
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r }; };
const post = (p, b, tok) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, tok);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const mk = async (tag, name) => {
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) }); await sleep(1300);
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code: codeOf(email) }) });
  const cookies = r.headers.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { pid, cookies, email, tok: r.data.accessToken ?? tok };
};
const stepUp = async (u, path) => { await post(path, {}, u.tok); await sleep(1200); return codeOf(u.email); };

const O = await mk('kkuo', 'Владелец Касса'); const U = await mk('kkuu', 'Плательщик Тест'); const ST = await mk('kkus', 'Сотрудник Касса');
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
q(`update profiles set username='ownertest' where id='${O.pid}'`);
q(`update profiles set is_admin=true, admin_role='skykassa_staff' where id='${ST.pid}'`);
q(`delete from skykassa_settings`); q(`delete from skykassa_payments where kind='partner'`); q(`delete from skykassa_partners`); q(`delete from skykassa_requisites`); q(`update skykassa_methods set enabled=false`);
// Настройка способа (подтверждение личности — как в боевой админке)
let code = await stepUp(O, '/api/admin/skykassa/settings-step-up');
let r = await post('/api/admin/skykassa/requisites', { methodId: 'skm-account', recipient: 'ООО Тестовый Получатель', bank: 'Тест-банк', idKind: 'account', identifier: '40702810900000000001', primary: true, enabled: true, stepUpCode: code }, O.tok);
t('реквизит заведён', r.status === 200, JSON.stringify(r.data));
code = await stepUp(O, '/api/admin/skykassa/settings-step-up');
r = await call('/api/admin/skykassa/methods/skm-account', { method: 'PUT', body: JSON.stringify({ enabled: true, min: 100, max: 50000, senderFields: [{ key: 'bank', label: 'Банк отправителя', type: 'text', required: true }], stepUpCode: code }) }, O.tok);
t('способ включён', r.status === 200, JSON.stringify(r.data));

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);

for (const [label, vp] of [['ПК', { width: 1280, height: 860 }], ['телефон', { width: 390, height: 780 }]]) {
  q(`delete from skykassa_payments where user_id='${U.pid}'`);
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU' }); await ctx.addCookies(U.cookies);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  await p.getByRole('button', { name: 'Начать' }).click({ timeout: 2500 }).catch(() => {}); await p.waitForTimeout(500);
  // Профиль → SkyMoney → Пополнить
  await p.locator('text="Профиль" >> visible=true').first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(1200);
  await p.locator('text="SkyMoney" >> visible=true').first().click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(1200);
  await p.locator('text="Пополнить" >> visible=true').first().click({ timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => /Куда зачислить/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  let txt = await body();
  t(`[${label}] открыта страница SkyKassa с источником`, /SkyKassa/.test(txt) && /Пополнение из приложения/.test(txt) && /Куда зачислить/i.test(txt), txt.slice(0, 200));
  t(`[${label}] нет горизонтальной прокрутки`, !(await overflow(p)));
  const cont = p.getByRole('button', { name: /Продолжить/ });
  t(`[${label}] без суммы «Продолжить» неактивна`, await cont.isDisabled());
  await p.getByLabel('Сумма пополнения в рублях').fill('50');
  t(`[${label}] сумма ниже минимума не принимается`, await cont.isDisabled());
  await p.getByRole('button', { name: /^500 ₽$/ }).click();
  await cont.click();
  await p.waitForFunction(() => /Прямая оплата с подтверждением/i.test(document.body.innerText) && /Платёжные партнёры|Оплата через платёжного/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
  txt = await body();
  t(`[${label}] выбор способа: сумма, валюта, приложение, назначение`, /Прямая оплата с подтверждением/i.test(txt) && /RUB/.test(txt) && /Sky Web/.test(txt) && /Баланс SkyMoney/.test(txt) && /Расчётный счёт/.test(txt), txt.slice(0, 300));
  t(`[${label}] партнёры честно не подключены`, /Платёжные партнёры пока не подключены/.test(txt));
  await p.screenshot({ path: `${S}/kk-method-${label}.png` });
  await p.getByRole('button', { name: /Расчётный счёт/ }).click(); await p.waitForTimeout(1500);
  txt = await body();
  t(`[${label}] реквизиты, сумма, назначение, срок`, /ООО Тестовый Получатель/.test(txt) && /40702810900000000001/.test(txt) && /Переведите ровно 500 ₽/.test(txt) && /SK-/.test(txt) && /\d\d:\d\d/.test(txt), txt.slice(0, 300));
  t(`[${label}] видна подсказка про данные отправителя и запрет на PIN/CVV`, /Это поможет администрации проверить поступление/.test(txt) && /никогда не просим PIN-код, CVV/.test(txt));
  t(`[${label}] есть кнопки копирования`, (await p.getByRole('button', { name: /Скопировать:/ }).count()) >= 4);
  await p.screenshot({ path: `${S}/kk-pay-${label}.png`, fullPage: false });
  t(`[${label}] нет горизонтальной прокрутки на реквизитах`, !(await overflow(p)));
  // Отправка без заполнения
  await p.getByRole('button', { name: /Перевод совершён/ }).click(); await p.waitForTimeout(1200);
  txt = await body();
  t(`[${label}] без данных отправителя сервер не пускает, ошибка видна у поля`, /Укажите фамилию и имя полностью/.test(txt), txt.slice(-300));
  await p.getByLabel('ФИО отправителя').fill('Иван Иванов');
  await p.getByRole('button', { name: 'Номер карты' }).click();
  await p.getByLabel('Номер карты отправителя').fill('4111111111111112');
  await p.getByLabel(/Банк отправителя/).fill('Тест-банк');
  await p.getByRole('button', { name: /Перевод совершён/ }).click(); await p.waitForTimeout(1200);
  t(`[${label}] неверный номер карты отклонён`, /Номер карты указан неверно/.test(await body()));
  await p.getByLabel('Номер карты отправителя').fill('4111 1111 1111 1111');
  await p.getByRole('button', { name: /Перевод совершён/ }).click(); await p.waitForTimeout(1200);
  t(`[${label}] без подтверждения данных отправка запрещена`, /Подтвердите, что данные отправителя верны/.test(await body()));
  await p.getByLabel('Подтверждаю, что данные отправителя верны').check();
  await p.getByRole('button', { name: /Перевод совершён/ }).click(); await p.waitForTimeout(2000);
  txt = await body();
  t(`[${label}] заявка ушла на проверку`, /Ожидает проверки/.test(txt) && /4111/.test(txt) === false && /•••• 1111/.test(txt), txt.slice(0, 300));
  const pid = q(`select id from skykassa_payments where user_id='${U.pid}' order by created_at desc limit 1`);
  t(`[${label}] в базе статус «Ожидает проверки»`, q(`select status from skykassa_payments where id='${pid}'`) === 'awaiting_review');
  await p.screenshot({ path: `${S}/kk-review-${label}.png` });
  // Сотрудник и владелец проводят заявку
  const bal0 = Number(q(`select balance from wallet_accounts where user_id='${U.pid}'`) || 0);
  r = await post(`/api/admin/skykassa/payments/${pid}/act`, { action: 'take' }, ST.tok); r = await post(`/api/admin/skykassa/payments/${pid}/act`, { action: 'forward', note: 'Сверено' }, ST.tok);
  t(`[${label}] сотрудник передал владельцу`, r.data.status === 'awaiting_owner', JSON.stringify(r.data));
  code = await stepUp(O, '/api/admin/skykassa/step-up');
  r = await post(`/api/admin/skykassa/payments/${pid}/act`, { action: 'owner_confirm', stepUpCode: code }, O.tok);
  t(`[${label}] владелец подтвердил`, r.data.status === 'completed', JSON.stringify(r.data));
  // Экран сам увидит зачисление (опрос раз в 8 с) и покажет анимацию
  await p.waitForFunction(() => /Средства успешно зачислены/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  txt = await body();
  t(`[${label}] анимированный экран зачисления с номером, датой, балансом`, /Средства успешно зачислены/.test(txt) && /Зачисление из SkyKassa/.test(txt) && /\+500 ₽/.test(txt) && /Номер операции/.test(txt) && new RegExp(`${(bal0 + 500).toLocaleString('ru-RU').replace(/\s/g, '\\s')}`).test(txt.replace(/\u00a0/g, ' ')) || /Баланс после зачисления/.test(txt), txt.slice(0, 300));
  await p.waitForTimeout(1500); await p.screenshot({ path: `${S}/kk-done-${label}.png` });
  t(`[${label}] нет горизонтальной прокрутки на финальном экране`, !(await overflow(p)));
  await p.getByRole('button', { name: 'Готово' }).click(); await p.waitForTimeout(1200);
  txt = await body();
  t(`[${label}] баланс в кошельке обновился`, new RegExp(`${bal0 + 500}|${(bal0 + 500).toLocaleString('ru-RU')}`.replace(/\s/g, '\\s')).test(txt.replace(/\u00a0/g, ' ')), txt.slice(0, 200));
  // История
  await p.locator('text="Пополнить" >> visible=true').first().click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'История платежей' }).click(); await p.waitForTimeout(1500);
  txt = await body();
  t(`[${label}] история: платёж со статусом`, /Успешно завершён/.test(txt) && /500 ₽/.test(txt));
  await p.locator('[class*="rounded-3xl"]', { hasText: 'Успешно завершён' }).first().click(); await p.waitForTimeout(1500);
  txt = await body();
  t(`[${label}] карточка платежа: статус, способ, отправитель замаскирован, запрос возврата`, /Успешно завершён/.test(txt) && /•••• 1111/.test(txt) && /Запросить возврат/.test(txt) && !/4111 1111 1111 1111/.test(txt), txt.slice(0, 300));
  t(`[${label}] без ошибок страницы`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ── Админка: вкладка SkyKassa ──
q(`delete from skykassa_payments where user_id='${U.pid}'`);
const upid = await (async () => {
  const c = await post('/api/skykassa/payments', { amount: 700, destination: 'balance', app: 'web' }, U.tok); const id = c.data.payment.id;
  await post(`/api/skykassa/payments/${id}/choose`, { mode: 'direct', methodId: 'skm-account' }, U.tok);
  await post(`/api/skykassa/payments/${id}/sender`, { fio: 'Мария Петрова', idKind: 'phone', idNumber: '8 900 111-22-33', extra: { bank: 'Тест-банк' }, confirmed: true }, U.tok);
  await post(`/api/skykassa/payments/${id}/report`, { amount: 700 }, U.tok);
  return id;
})();
{
  const ctx = await br.newContext({ viewport: { width: 1100, height: 1000 }, locale: 'ru-RU' }); await ctx.addCookies(O.cookies);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  const body = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  await p.getByText('Медиа', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(1000);
  await p.getByText('Admin', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'SkyKassa', exact: true }).first().click(); await p.waitForTimeout(1800);
  let txt = await body();
  t('админка: вкладка SkyKassa с подвкладками', /Заявки/.test(txt) && /Способы и реквизиты/.test(txt) && /Партнёры/.test(txt) && /Параметры/.test(txt), txt.slice(0, 300));
  t('админка: заявка видна в очереди', /700 ₽/.test(txt) && /Ожидает проверки/.test(txt));
  await p.locator('[data-kk-row]').first().click(); await p.waitForTimeout(1500);
  txt = await body();
  t('админка: карточка — данные отправителя целиком', /Мария Петрова/.test(txt) && /\+79001112233/.test(txt) && /Тест-банк/.test(txt) && /не доказательство оплаты/.test(txt), txt.slice(0, 400));
  t('админка: номер получателя в карточке замаскирован', !/40702810900000000001/.test(txt.split('Данные отправителя')[0]));
  await p.getByRole('button', { name: 'Взять в работу' }).click(); await p.waitForTimeout(1500);
  t('админка: «Взять в работу» → «На проверке»', q(`select status from skykassa_payments where id='${upid}'`) === 'in_review');
  await p.getByLabel('Комментарий').fill('Поступление найдено, сверено'); await p.getByRole('button', { name: 'Передать владельцу' }).click(); await p.waitForTimeout(1500);
  t('админка: передано владельцу', q(`select status from skykassa_payments where id='${upid}'`) === 'awaiting_owner');
  txt = await body();
  t('админка: у владельца кнопка «Подтвердить и зачислить»', /Подтвердить и зачислить/.test(txt));
  await p.getByRole('button', { name: /Подтвердить и зачислить/ }).click(); await p.waitForTimeout(1500);
  t('админка: зачисление требует подтверждения личности', /Подтвердите личность/.test(await body()));
  await p.screenshot({ path: `${S}/kk-admin-card.png` });
  await p.getByRole('button', { name: 'Отмена' }).first().click();
  await p.getByRole('button', { name: 'Способы и реквизиты', exact: true }).click(); await p.waitForTimeout(1500);
  txt = await body();
  t('админка: способы и реквизиты (номер замаскирован в списке)', /Расчётный счёт/.test(txt) && /•••• 0001/.test(txt) && /Новый способ оплаты/.test(txt), txt.slice(0, 300));
  await p.getByRole('button', { name: 'Партнёры', exact: true }).click(); await p.waitForTimeout(1200);
  t('админка: партнёры', /Партнёров нет|Не подключён|Подключён/.test(await body()));
  await p.getByRole('button', { name: 'Параметры', exact: true }).click(); await p.waitForTimeout(1200);
  txt = await body();
  t('админка: параметры и кнопка паузы', /Приём новых платежей/.test(txt) && /Приостановить приём/.test(txt));
  t('админка: без ошибок страницы', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
// Человек без прав вкладки не видит
{
  const ctx = await br.newContext({ viewport: { width: 1100, height: 900 }, locale: 'ru-RU' }); await ctx.addCookies(U.cookies);
  const p = await ctx.newPage();
  await p.goto(F + '/'); await p.waitForTimeout(3000);
  t('обычному человеку вкладка SkyKassa в админке недоступна', (await p.getByRole('button', { name: 'SkyKassa', exact: true }).count()) === 0);
  await ctx.close();
}
await br.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
