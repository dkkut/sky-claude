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
let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
q(`delete from go_places where name='Кафе Тест'`);
const U = await mk('uMock'); const Ad = await mk('uMAdm'); const Se = await mk('uMSell');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${Ad.pid}'`);
// заведение для категорий еды
q(`update profiles set date_of_birth='1990-01-01' where id='${Se.pid}'`);
let r = await call('/api/go/executors', { method: 'POST', body: JSON.stringify({ role: 'food_seller', legalForm: 'npd', city: 'Москва', fields: { fullName: 'Иванов Иван Иванович', inn: gen(12, (s) => validInn(s, { length: 12 })), phone: '+79991234567' }, extra: { placeName: 'Кафе Тест' } }) }, Se.tok);
await call(`/api/go/executors/${r.data.id}/submit`, { method: 'POST', body: '{}' }, Se.tok);
await call(`/api/admin/go/applications/${r.data.id}/decide`, { method: 'POST', body: JSON.stringify({ action: 'approve' }) }, Ad.tok);
q(`insert into wallet_accounts(user_id,balance) values ('${Se.pid}',500) on conflict (user_id) do update set balance=500`);
await call('/api/go/subscription/food_seller/buy', { method: 'POST', body: JSON.stringify({ idemKey: 'm1' }) }, Se.tok);
await call('/api/go/pay-details', { method: 'PUT', body: JSON.stringify({ method: 'card', number: '4111111111111111', holder: 'ТЕСТ ТЕСТОВ', bank: 'Тест' }) }, Se.tok);
await call('/api/go/food/my/place', { method: 'PUT', body: JSON.stringify({ name: 'Кафе Тест', address: 'Москва, Покровка 5', category: 'Кафе', hours: '10-22', descr: 'Домашняя кухня' }) }, Se.tok);
await call('/api/go/food/my/items', { method: 'POST', body: JSON.stringify({ name: 'Борщ', priceRub: 250, category: 'Супы' }) }, Se.tok);
await call('/api/go/food/my/publish', { method: 'POST', body: JSON.stringify({ on: true }) }, Se.tok);

const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 420, height: 880 }, locale: 'ru-RU', geolocation: { latitude: 55.7558, longitude: 37.6176 }, permissions: ['geolocation'] });
await ctx.addCookies(U.cookies);
await ctx.addInitScript(() => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'light', introAnim: false })); } catch {} });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(F + '/'); await p.waitForTimeout(3500);
const body = () => p.evaluate(() => document.body.innerText);
const tap = async (t, n = 0) => { const l = p.getByText(t, { exact: true }); await (n === -1 ? l.last() : l.nth(n)).click({ timeout: 6000 }); await p.waitForTimeout(800); };
try { await tap('Начать'); } catch {}
await tap('Sky', 0); await tap('Sky GO', 0); await p.waitForTimeout(1000);

/* Доставка: хаб */
await tap('Доставка', 0); await p.waitForTimeout(600);
let t = await body();
ok(/Курьер/.test(t) && /Экспресс/.test(t) && /Поручения/.test(t) && /Пункты выдачи/.test(t) && /Грузовой/.test(t) && /Из ПВЗ/.test(t), 'M1. хаб «Доставка»: Курьер, Пункты выдачи, Грузовой');
await p.screenshot({ path: S + '/m1.png' });
await tap('Экспресс', 0); await p.waitForTimeout(800);
t = await body();
ok(/Откуда/.test(t) && /Малый/.test(t) && /Средний/.test(t) && /Крупный/.test(t) && /Стоимость/.test(t), 'M2. «Экспресс»: адреса, размеры, стоимость');
const addr = p.getByPlaceholder('Город, улица, дом');
await addr.nth(0).fill('Москва, Тверская 1'); await addr.nth(1).fill('Москва, Арбат 10');
await p.waitForTimeout(2500);
t = await body();
ok(/\d[\d\s\u00a0]*₽/.test(t) && !/Малый[\s\S]{0,60}—/.test(t), 'M3. цены на карточках размеров появились сами (авто-расчёт)');
await p.screenshot({ path: S + '/m2.png' });
const inp = p.locator('input:not([type=file]):not([type=checkbox]):not([type=date])');
// заполняем «что внутри», контакты
await p.getByLabel('Что внутри').fill('Документы').catch(async () => { await p.locator('label:has-text("Что внутри") input').fill('Документы'); });
const labels = async (l, v, n = 0) => p.locator(`label:has-text("${l}") input`).nth(n).fill(v);
await labels('Имя', 'Отправитель', 0); await labels('Телефон', '+79995551111', 0);
await labels('Имя', 'Получатель', 1); await labels('Телефон', '+79995550000', 1);
await p.waitForTimeout(400);
await p.screenshot({ path: S + '/m3.png' });
await p.getByText('Заказать', { exact: true }).last().click(); await p.waitForTimeout(2000);
t = await body();
ok(/Ищем курьера/.test(t) && /Отменить заказ/.test(t), 'M4. заказ создан из новой формы, открыта карточка заказа');
await tap('Отменить заказ'); await p.waitForTimeout(800);

/* Грузовой */
await tap('Главная', -1); await tap('Доставка', 0); await tap('По городу', 0); await p.waitForTimeout(800);
t = await body();
ok(/Кузов/.test(t) && /Грузчики/.test(t) && /Максимум 300 кг/.test(t), 'M5. «Грузовой»: кузов, грузчики, вместимость из тарифа');
await addr.nth(0).fill('Москва, Тверская 1'); await addr.nth(1).fill('Москва, Арбат 10'); await p.waitForTimeout(2500);
const price0 = (await body()).match(/Стоимость\s*\n?\s*([\d\s\u00a0]+)/)?.[1]?.replace(/\D/g, '');
await p.getByText('2', { exact: true }).last().click(); await p.waitForTimeout(2000);
const price2 = (await body()).match(/Стоимость\s*\n?\s*([\d\s\u00a0]+)/)?.[1]?.replace(/\D/g, '');
console.log('грузовой цена', price0, '→', price2);
ok(price0 && price2 && Number(price2) === Number(price0) + 1400, 'M6. два грузчика добавляют 2 × 700 ₽');
await p.screenshot({ path: S + '/m4.png' });

/* Такси */
await tap('Главная', -1); await tap('Такси', 0); await p.waitForTimeout(2000);
t = await body();
ok(/Точка подачи/.test(t) && /Моё местоположение/.test(t), 'M7. такси: точка подачи — по геолокации');
await p.getByPlaceholder('Куда едем?').fill('Москва, Арбат 10'); await p.waitForTimeout(2500);
t = await body();
ok(/Эконом/.test(t) && /Заказать/.test(t), 'M8. такси: после адреса сразу тарифы и кнопка «Заказать»');
await p.screenshot({ path: S + '/m5.png' });

/* Еда */
await tap('Главная', -1); await tap('Еда', 0); await p.waitForTimeout(1500);
t = await body();
ok(await p.locator('input[placeholder*="оиск"]').count() > 0 && /Кафе/.test(t) && /Заведений: \d/.test(t) && /Кафе Тест/.test(t), 'M9. еда: поиск, категории из настоящих заведений, список');
await p.screenshot({ path: S + '/m6.png' });

/* Моё авто */
await tap('Главная', -1); await tap('Моё авто', 0); await p.waitForTimeout(800);
t = await body();
ok(/Добавить машину/.test(t) && /Заправить/.test(t) && /Помыть/.test(t), 'M10. «Моё авто»: добавить машину, Заправить, Помыть');
await tap('Добавить машину'); 
await p.locator('label:has-text("Марка") input').fill('Kia'); await p.locator('label:has-text("Модель") input').fill('Rio');
await p.getByText('АИ-95', { exact: true }).click();
await tap('Сохранить'); await p.waitForTimeout(1200);
t = await body();
ok(/Kia Rio/.test(t) && /АИ-95/.test(t), 'M11. машина сохранена и показана');
await p.screenshot({ path: S + '/m7.png' });
await tap('Заправить'); await p.waitForTimeout(500);
await tap('Найти рядом'); await p.waitForTimeout(2500);
t = await body();
ok(/Тест-АЗС 1/.test(t) || /АЗС/.test(t), 'M12. заправки рядом (с топливом из машины)');
await p.getByText('Тест-АЗС 1').first().click().catch(() => {}); await p.waitForTimeout(1800);
t = await body();
ok(/Поехали/.test(t) && /Дополнительно/.test(t) && /Цены на топливо поставщик/.test(t), 'M13. карточка станции: Поехали, Дополнительно, честная пометка о ценах');
await p.screenshot({ path: S + '/m8.png' });
await p.getByText('Назад', { exact: true }).first().click().catch(() => {}); 

/* Путешествия */
await p.goto(F + '/'); await p.waitForTimeout(3000);
try { await tap('Начать'); } catch {}
await tap('Sky', 0); await tap('Sky GO', 0); await p.waitForTimeout(800);
await tap('Отели', 0).catch(async () => { await p.getByText('Отели').first().click(); }); await p.waitForTimeout(1000);
t = await body();
ok(/Путешествия/.test(t) && /отели/.test(t) && /квартиры/.test(t) && /авиа/.test(t) && /Куда вы хотите поехать/.test(t) && /Нужен отель сейчас/.test(t) && /Мои бронирования/.test(t), 'M14. «Путешествия»: вкладки, форма, «Нужен отель сейчас?», «Мои бронирования»');
await p.screenshot({ path: S + '/m9.png' });
await tap('авиа'); await p.waitForTimeout(800);
ok(/Найти билеты/.test(await body()), 'M15. вкладка «авиа» внутри «Путешествий»');
await br.close();
ok(errs.length === 0, 'M16. без ошибок JS ' + JSON.stringify(errs));
console.log(fails ? 'ПРОВАЛЕНО ' + fails : 'Все проверки пройдены');
q(`delete from go_places where owner_id='${Se.pid}'`);
process.exit(fails ? 1 : 0);
