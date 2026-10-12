/* Sky GO бизнес и рабочее пространство исполнителя: интерфейс в браузере (Playwright).
   Нужны API :8080 (fake-google), dist на :4173 с прокси; запуск из каталога с playwright-core: node go-biz-ui-test.mjs <каталог с api.log> */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://localhost:4173';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const call = async (path, o = {}, tok) => { const r = await fetch(B + path, { ...o, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } }); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d, headers: r.headers }; };
const mk = async (tag) => {
  const email = `${tag.toLowerCase()}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
  await new Promise((r) => setTimeout(r, 2000));
  const code = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()[1];
  let r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  const cookies = r.headers.getSetCookie().map((c) => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: 'localhost', path: (a.find((x) => /path=/i.test(x)) || 'path=/').split('=')[1].trim() }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag.toLowerCase() + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('p${Date.now()}${tag}','${pid}','active','test')`);
  q(`update profiles set date_of_birth='1990-05-05' where id='${pid}'`);
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { cookies, tok: r.data.accessToken ?? tok, pid, tag, username: q(`select username from profiles where id='${pid}'`) };
};
const { validInn, validOgrn } = await import('/home/user/sky-claude/server/sellerrules.mjs');
const gen = (len, fn) => { for (let i = 0; i < 100000; i++) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } };
let fails = 0;
const ok = (c, n, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : ' ' + String(x).slice(0, 200)}`); if (!c) fails += 1; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const fund = (u, n) => q(`insert into wallet_accounts(user_id,balance) values ('${u.pid}',${n}) on conflict (user_id) do update set balance = wallet_accounts.balance + ${n}`);

const A = await mk('uBzAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const O = await mk('uBzOwn'), K = await mk('uBzCour');
const approve = (id) => call(`/api/admin/go/applications/${id}/decide`, J({ action: 'approve' }), A.tok);
let r = await call('/api/go/executors', J({ role: 'company', legalForm: 'ooo', city: 'Москва', fields: { orgName: 'ООО «Бизнес-UI»', inn: gen(10, (s) => validInn(s, { length: 10 })), ogrn: gen(13, validOgrn), orgPhone: '+74951234567', orgEmail: 'o@example.com', repName: 'Сидоров С.С.', repPosition: 'Директор', repIsHead: true }, extra: { brand: 'Бизнес-UI' } }), O.tok);
await call(`/api/go/executors/${r.data.id}/submit`, J({}), O.tok); await approve(r.data.id);
fund(O, 500); await call('/api/go/subscription/company/buy', J({}), O.tok);
r = await call('/api/go/executors', J({ role: 'courier', legalForm: 'npd', city: 'Москва', fields: { fullName: 'Иванов Иван Иванович', inn: gen(12, (s) => validInn(s, { length: 12 })), phone: '+79991234567' }, extra: { transport: 'bike' } }), K.tok);
await call(`/api/go/executors/${r.data.id}/docs?kind=id_doc`, { method: 'POST', body: PNG, headers: { 'content-type': 'application/octet-stream' } }, K.tok);
await call(`/api/go/executors/${r.data.id}/submit`, J({}), K.tok); await approve(r.data.id);
fund(K, 300); await call('/api/go/subscription/courier/buy', J({}), K.tok);
const ws = (await call('/api/go/workspaces', {}, O.tok)).data; const ORG = ws.orgs[0].id;
await call(`/api/go/org/${ORG}/members/invite`, J({ username: K.username, role: 'courier' }), O.tok);
const mkOrder = async (d, to) => (await call(`/api/go/org/${ORG}/orders`, J({ city: 'Москва', from: { address: 'Москва, Тверская 1' }, to: { address: to ?? 'Москва, Арбат 10' }, parcel: { description: d, weightKg: 1, size: 's' }, recipient: { name: 'Получатель Р.', phone: '+79995550000' }, sender: { name: 'Отправитель О.', phone: '+79995551111' } }), O.tok)).data.orderId;
const o1 = await mkOrder('Коробка UI-1'), o2 = await mkOrder('Коробка UI-2', 'Москва, Покровка 5');

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const open = async (u, vp, perms = true) => {
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU', ...(perms ? { geolocation: { latitude: 55.7558, longitude: 37.6176 }, permissions: ['geolocation'] } : {}) });
  await ctx.addCookies(u.cookies);
  await ctx.addInitScript(() => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'light', introAnim: false })); } catch {} });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
  await p.goto(F + '/'); await p.waitForTimeout(3500);
  const tap = async (t, n = 0) => { const l = p.getByText(t, { exact: true }); await (n === -1 ? l.last() : l.nth(n)).click({ timeout: 6000 }); await p.waitForTimeout(700); };
  try { await tap('Начать'); } catch {}
  if (vp.width >= 900) await tap('Медиа', 0); else await tap('Sky', 0);
  await tap('Sky GO', 0); await p.waitForTimeout(1200);
  return { ctx, p, errs, tap, body: () => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')) };
};

/* ── Владелец: кабинет бизнеса ── */
{
  const { p, errs, tap, body } = await open(O, { width: 420, height: 880 });
  await tap('Работа', -1); await p.waitForTimeout(1500);
  let t = await body();
  ok(/Кабинет бизнеса/.test(t) && /Бизнес-UI/.test(t) && /ваша роль: Владелец/.test(t), 'B1. «Работа» ведёт сразу в кабинет бизнеса (единственное рабочее пространство)', t.slice(0, 200));
  ok(/Новые/.test(t) && /Ждут принятия/.test(t) && /В доставке/.test(t) && /Требуют внимания/.test(t) && /Доставки на карте/.test(t) && /Среднее время доставки за 30 дней: нет данных/.test(t), 'B2. панель: счётчики, внимание, карта; без выдуманных цифр', t.slice(0, 300));
  await p.screenshot({ path: S + '/biz1.png' });
  await tap('Заказы', 0); await p.waitForTimeout(1200);
  t = await body();
  ok(/Коробка UI-1/.test(t) && /Коробка UI-2/.test(t) && /Ждёт исполнителя/.test(t), 'B3. заказы: список, статус', t.slice(0, 300));
  await p.getByLabel('Поиск заказов').fill('UI-2'); await p.waitForTimeout(1500);
  t = await body();
  ok(/Коробка UI-2/.test(t) && !/Коробка UI-1/.test(t), 'B4. поиск находит нужный заказ', t.slice(0, 200));
  await p.getByLabel('Поиск заказов').fill(''); await p.waitForTimeout(1200);
  await p.getByText('Коробка UI-1').first().click(); await p.waitForTimeout(1500);
  t = await body();
  ok(/Контакты/.test(t) && /Исполнитель/.test(t) && /Коды/.test(t) && /История статусов/.test(t) && /Не назначен/.test(t), 'B5. карточка заказа: контакты, исполнитель, коды, история', t.slice(0, 300));
  await p.screenshot({ path: S + '/biz2.png' });
  await p.getByRole('button', { name: '‹ К заказам' }).click(); await p.waitForTimeout(600);
  await tap('Команда', 0); await p.waitForTimeout(1200);
  t = await body();
  ok(/Пригласить сотрудника/.test(t) && /Приглашён/.test(t) && new RegExp(K.username).test(t), 'B6. команда: форма приглашения и приглашённый курьер', t.slice(0, 300));
  await p.screenshot({ path: S + '/biz3.png' });
  await tap('Организация', 0); await p.waitForTimeout(1200);
  t = await body();
  ok(/Назначение заказов/.test(t) && /Адреса отправления/.test(t) && /одобрена/.test(t) && /Регистрация компании одобрена сотрудниками Sky вручную/.test(t), 'B7. организация: статус проверки (честно), режимы, адреса', t.slice(0, 300));
  await p.screenshot({ path: S + '/biz4.png' });
  ok(errs.length === 0, 'B8. без ошибок JS (владелец)', errs.join('|'));
}

/* ── Курьер: принимает приглашение, работает на телефоне ── */
await call(`/api/go/org/invites/${ORG}/respond`, J({ accept: true }), K.tok);
{
  const { p, errs, tap, body } = await open(K, { width: 390, height: 800 });
  await tap('Работа', -1); await p.waitForTimeout(1800);
  let t = await body();
  ok(/Карта/.test(t) && /Заказы/.test(t) && /История/.test(t) && /Профиль/.test(t) && /Не на линии/.test(t), 'W1. «Работа» открывает рабочий экран курьера: нижняя навигация, статус «Не на линии»', t.slice(0, 300));
  await p.getByRole('button', { name: 'Выйти на линию' }).click(); await p.waitForTimeout(2500);
  t = await body();
  ok(/На линии/.test(t) && q(`select online from go_presence where profile_id='${K.pid}' and role='courier'`) === 't', 'W2. выход на линию (сервер подтвердил), смена началась', t.slice(0, 200));
  await call(`/api/go/org/${ORG}/orders/${o1}/assign`, J({ executorId: K.pid }), O.tok);
  await p.waitForTimeout(7500);
  t = await body();
  ok(/Принять назначение/.test(t) && /Вам назначен/.test(t), 'W3. назначение пришло и требует принятия', t.slice(0, 300));
  await p.screenshot({ path: S + '/work1.png' });
  await p.getByRole('button', { name: /Принять назначение/ }).click(); await p.waitForTimeout(1500);
  ok(q(`select data->'dispatch'->>'accepted' from go_orders where id='${o1}'`) === 'true', 'W4. принятие назначения записано на сервере');
  t = await body();
  ok(/Еду за отправлением/.test(t) && /Навигатор/.test(t) && /Проблема/.test(t), 'W5. следующее действие этапа, навигатор и «Проблема»', t.slice(0, 300));
  await p.getByRole('button', { name: 'Навигатор' }).click(); await p.waitForTimeout(400);
  t = await body();
  ok(/Яндекс Карты/.test(t) && /Google Карты/.test(t) && /2ГИС/.test(t), 'W6. внешние навигаторы');
  await p.getByRole('button', { name: /Еду за отправлением/ }).click(); await p.waitForTimeout(1200);
  ok(q(`select status from go_orders where id='${o1}'`) === 'heading_pickup', 'W7. статус меняется кнопкой и проверяется сервером');
  await p.getByRole('button', { name: /Я на месте получения/ }).click(); await p.waitForTimeout(1200);
  t = await body();
  ok(/Код передачи/.test(t), 'W8. на этапе получения требуется код передачи');
  const codes = (await call(`/api/go/org/${ORG}/orders/${o1}`, {}, O.tok)).data.order.codes;
  await p.getByPlaceholder('000000').fill('111111'); await p.getByRole('button', { name: /Принять отправление/ }).click(); await p.waitForTimeout(1200);
  ok(q(`select status from go_orders where id='${o1}'`) === 'at_pickup', 'W9. неверный код не двигает заказ');
  await p.getByPlaceholder('000000').fill(codes.pickup.code); await p.getByRole('button', { name: /Принять отправление/ }).click(); await p.waitForTimeout(1500);
  ok(q(`select status from go_orders where id='${o1}'`) === 'picked_up', 'W10. верный код — отправление получено');
  await p.screenshot({ path: S + '/work2.png' });
  await p.getByRole('button', { name: /Проблема/ }).first().click(); await p.waitForTimeout(500);
  await p.getByText('Неверный адрес', { exact: true }).click();
  await p.getByRole('button', { name: 'Отправить', exact: true }).click(); await p.waitForTimeout(1500);
  t = await body();
  ok(/Проблема передана/.test(t) && q(`select count(*) from go_order_problems where order_id='${o1}'`) === '1', 'W11. проблема отправлена диспетчеру; исполнитель сам её не закрывает', t.slice(0, 300));
  await p.getByRole('button', { name: 'Понятно' }).click().catch(() => {});
  const wtab = async (n) => { await p.locator('div[style*="z-index: 20"] nav button', { hasText: n }).click(); await p.waitForTimeout(900); };
  await wtab('Заказы'); await p.waitForTimeout(300);
  t = await body();
  ok(/Мои заказы/.test(t) && /Новые предложения/.test(t), 'W12. вкладка «Заказы»', t.slice(0, 200));
  await wtab('История'); await p.waitForTimeout(900);
  t = await body();
  ok(/Выполнено/.test(t) && /Часов на линии/.test(t) && /Оценок и рейтинга в Sky GO нет/.test(t), 'W13. история и статистика без выдуманных оценок', t.slice(0, 300));
  await wtab('Профиль'); await p.waitForTimeout(600);
  t = await body();
  ok(/Подписка/.test(t) && /Реквизиты/.test(t) && /Геолокация и помощь/.test(t), 'W14. профиль: подписка, реквизиты, помощь');
  await wtab('Карта');
  await p.route('**/api/go/work/**', (r) => r.abort()); await p.waitForTimeout(9000);
  t = await body();
  ok(/Нет связи с сервером/.test(t) && /последнее состояние на/.test(t), 'W15. без связи — отметка и последнее известное состояние', t.slice(0, 200));
  await p.unroute('**/api/go/work/**'); await p.waitForTimeout(8000);
  t = await body();
  ok(!/Нет связи с сервером/.test(t), 'W16. связь вернулась — данные обновлены');
  const w = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  ok(w, 'W17. нет горизонтального переполнения на телефоне');
  await p.getByRole('button', { name: 'Уйти с линии' }).click().catch(async () => { await wtab('Карта'); await p.getByRole('button', { name: 'Уйти с линии' }).click(); }); await p.waitForTimeout(2000);
  ok(q(`select lat is null from go_presence where profile_id='${K.pid}' and role='courier'`) === 't', 'W18. уход с линии стирает координаты');
  ok(errs.length === 0, 'W19. без ошибок JS (курьер)', errs.join('|'));
}

/* ── Диспетчер видит проблему, решает ── */
{
  const { p, errs, tap, body } = await open(O, { width: 1100, height: 800 });
  await tap('Работа', -1); await p.waitForTimeout(1500);
  let t = await body();
  ok(/Проблемы и споры/.test(t) && /Требуют внимания/.test(t), 'D1. панель на компьютере: проблема в «Требуют внимания»', t.slice(0, 300));
  await p.getByText('Коробка UI-1').first().click(); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Решить проблему' }).click(); await p.waitForTimeout(400);
  await p.getByLabel('Что решили (будет видно исполнителю)').fill('Уточнили адрес, продолжайте'); await p.getByRole('button', { name: 'Закрыть проблему' }).click(); await p.waitForTimeout(1500);
  ok(q(`select state from go_order_problems where order_id='${o1}'`) === 'resolved', 'D2. проблема решена диспетчером из интерфейса');
  await p.screenshot({ path: S + '/biz5.png' });
  const w = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  ok(w && errs.length === 0, 'D3. компьютер: без переполнения и ошибок JS', errs.join('|'));
}
await br.close();
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки интерфейса пройдены'); process.exit(fails ? 1 : 0);
