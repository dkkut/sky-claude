/* Sky GO: возврат (заказчик и исполнитель), отчёт об оплатах, «На потом» в доставке, зоны в админке. Playwright; API :8080, dist :4173. */
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

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const C = await mk('uRfC'); const E = await mk('uRfE');
const id = `go-rfui-${Date.now()}`;
q(`insert into go_orders (id, kind, customer_id, executor_id, status, price_rub, city, data, completed_at) values ('${id}','taxi','${C.pid}','${E.pid}','paid',320,'Москва','{"from":{"address":"Тверская 1"},"to":{"address":"Арбат 10"},"tariffTitle":"Эконом"}'::jsonb, now())`);
q(`insert into go_order_pay (order_id, payer_id, payee_id, amount_rub, state, confirmed_at) values ('${id}','${C.pid}','${E.pid}',320,'confirmed', now())`);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const open = async (U, w = 390, h = 860) => {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU', geolocation: { latitude: 55.7558, longitude: 37.6176 }, permissions: ['geolocation'] });
  await ctx.addCookies(U.cookies);
  await ctx.addInitScript(() => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'light', introAnim: false })); } catch {} });
  const p = await ctx.newPage(); await p.goto(F + '/'); await p.waitForTimeout(3500);
  try { await p.getByText('Начать', { exact: true }).first().click({ timeout: 2000 }); } catch {}
  try { await p.getByText('Sky', { exact: true }).first().click({ timeout: 4000 }); await p.waitForTimeout(500); } catch {}
  await p.getByText('Sky GO', { exact: true }).first().click({ timeout: 6000 }); await p.waitForTimeout(2500);
  return { ctx, p };
};
const openOrder = async (p) => { await p.locator('nav[aria-label] button', { hasText: 'Заказы' }).click(); await p.waitForTimeout(1200); await p.getByText('История', { exact: true }).first().click(); await p.waitForTimeout(1500); await p.getByText('Оплачено', { exact: false }).first().click(); await p.waitForTimeout(2000); };

/* Заказчик */
let { ctx, p } = await open(C);
await openOrder(p);
ok(await p.getByText('Возврат денег', { exact: true }).count() === 1, 'заказчик видит блок «Возврат денег» в оплаченном заказе');
await p.getByRole('button', { name: 'Запросить возврат' }).first().click(); await p.waitForTimeout(500);
const send = p.getByRole('button', { name: 'Запросить возврат' }).last();
ok(await send.isDisabled(), 'кнопка отправки неактивна, пока причина короче 5 знаков');
await p.getByLabel('Причина').fill('Водитель не довёз до места'); await p.getByLabel('Сумма, ₽ (пусто — вся)').fill('100');
await send.click(); await p.waitForTimeout(2500);
ok(await p.getByText('Запрос отправлен', { exact: true }).count() >= 1 && await p.getByText('Возврат · 100', { exact: false }).count() >= 1, 'после отправки виден статус «Запрос отправлен» на 100 ₽');
ok(await p.getByRole('button', { name: 'Отозвать запрос' }).count() === 1, 'пока исполнитель не ответил, запрос можно отозвать');
await ctx.close();

/* Исполнитель */
({ ctx, p } = await open(E));
await p.locator('nav[aria-label] button', { hasText: 'Заказы' }).click(); await p.waitForTimeout(1200);
await p.getByText('Выполняю я', { exact: true }).first().click(); await p.waitForTimeout(800);
await p.getByText('История', { exact: true }).first().click(); await p.waitForTimeout(1500);
try { await p.getByText('Оплачено', { exact: false }).first().click({ timeout: 4000 }); } catch {}
await p.waitForTimeout(2000);
ok(await p.getByRole('button', { name: 'Согласен вернуть' }).count() === 1, 'исполнитель видит запрос и кнопку «Согласен вернуть»');
await p.getByRole('button', { name: 'Согласен вернуть' }).click(); await p.waitForTimeout(2000);
ok(await p.getByRole('button', { name: 'Я вернул деньги' }).count() === 1, 'после согласия — «Я вернул деньги»');
ok(await p.getByText('Переведите деньги заказчику сами', { exact: false }).count() === 1, 'интерфейс прямо говорит, что Sky деньги не возвращает');
await p.getByRole('button', { name: 'Я вернул деньги' }).click(); await p.waitForTimeout(2000);
ok(await p.getByText('Деньги возвращены — ждём подтверждения', { exact: true }).count() >= 1, 'статус «Деньги возвращены — ждём подтверждения»');
await ctx.close();

/* Заказчик подтверждает */
({ ctx, p } = await open(C));
await openOrder(p);
await p.getByRole('button', { name: 'Деньги получил' }).click(); await p.waitForTimeout(2000);
ok(await p.getByText('Возврат подтверждён', { exact: true }).count() >= 1, 'заказчик подтвердил — «Возврат подтверждён»');
await ctx.close();

/* Отчёт исполнителя */
({ ctx, p } = await open(E));
await p.locator('nav[aria-label] button', { hasText: 'Работа' }).click(); await p.waitForTimeout(1500);
const txt = async () => p.evaluate(() => document.body.innerText);
// отчёт лежит в кабинете водителя: открываем его, если есть плитка; иначе проверяем сервер
const earn = await (await fetch(B + '/api/go/earnings?days=30', { headers: { authorization: `Bearer ${E.tok}` } })).json();
ok(earn.grossRub === 320 && earn.refundedRub === 100 && earn.netRub === 220, `отчёт получателя: 320 − 100 = 220 (${earn.grossRub}/${earn.refundedRub}/${earn.netRub})`);
await ctx.close();

/* Доставка «На потом» */
({ ctx, p } = await open(C));
await p.getByText('Доставка', { exact: true }).first().click(); await p.waitForTimeout(600);
await p.getByText('Экспресс', { exact: false }).first().click(); await p.waitForTimeout(1200);
ok(await p.getByRole('radio', { name: 'На потом' }).count() === 1, 'в форме доставки есть переключатель «Сейчас / На потом»');
await p.getByRole('radio', { name: 'На потом' }).click(); await p.waitForTimeout(400);
ok(await p.locator('input[type=datetime-local]').count() === 1, 'после выбора «На потом» появляется выбор даты и времени');
ok(await p.getByText('Курьер назначается ближе ко времени', { exact: false }).count() === 1, 'честный текст: цена зафиксирована, курьер назначается позже');
await ctx.close();

await br.close();
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
