// Sky GO: регистрация исполнителя с документами (Playwright): неверный ИНН, HEIC, тяжёлое фото (сжатие перед загрузкой), отправка.
//   Запускать из каталога с playwright-core: node go-register-ui-test.mjs <каталог с api.log>; нужны API :8080 и dist на :4173.
/* Sky GO: интерфейс в браузере (Playwright): такси, заказ, отмена, «Работа», регистрация, светлая тема. Нужны API :8080, dist на :4173 (front.mjs); запускать из каталога с playwright-core. */
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
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
  await new Promise(r => setTimeout(r, 1200));
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
const A = await mk('goui');

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 400, height: 860 }, locale: 'ru-RU', geolocation: { latitude: 55.7558, longitude: 37.6176 }, permissions: ['geolocation'] });
await ctx.addCookies(A.cookies);
await ctx.addInitScript(() => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'light', introAnim: false })); } catch {} });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(F + '/'); await p.waitForTimeout(4000);
await p.screenshot({ path: S + '/go0.png' });
const t0 = await p.evaluate(() => document.body.innerText);
console.log(t0.slice(0, 300).replace(/\n/g, ' | '));
const tap = async (t, n = 0) => { const l = p.getByText(t, { exact: true }); await (n === -1 ? l.last() : l.nth(n)).click({ timeout: 4000 }); await p.waitForTimeout(700); };
try { await tap('Начать'); } catch {}
await tap('Sky', 0);
const body = () => p.evaluate(() => document.body.innerText);
await tap('Sky GO', 0); await p.waitForTimeout(1200);
let t = await body();
ok(t.includes('Всё для города в одном месте') && t.includes('Такси') && t.includes('Авиабилеты') && t.includes('Моё авто'), 'UI 1. главная Sky GO: сервисы');
ok(['Главная', 'Заказы', 'Работа', 'Профиль'].every((x) => t.includes(x)), 'UI 2. нижняя навигация');
await p.screenshot({ path: S + '/go1.png' });
await tap('Такси', 0);
await p.getByPlaceholder('Город, улица, дом').first().fill('Москва, Тверская 1').catch(() => {});
await p.getByPlaceholder('Куда едем?').fill('Москва, Арбат 10'); await p.waitForTimeout(2500);
t = await body();
ok(/Эконом/.test(t) && /₽/.test(t), 'UI 3. такси: расчёт показал тарифы с ценой с сервера');
await p.screenshot({ path: S + '/go2.png' });
await tap('Заказать'); await p.waitForTimeout(1500);
t = await body();
ok(/Ищем водителя/.test(t) && /Отменить заказ/.test(t), 'UI 4. заказ создан, открыта карточка заказа');
await p.screenshot({ path: S + '/go3.png' });
await tap('Отменить заказ'); await p.waitForTimeout(1200);
ok(/Отменён/.test(await body()), 'UI 5. заказ отменён');
await tap('Заказы', -1); await p.waitForTimeout(800);
await tap('История'); await p.waitForTimeout(1200);
ok(/Такси/.test(await body()), 'UI 6. в истории видны заказы');
await tap('Работа', -1); await p.waitForTimeout(800);
t = await body();
ok(/Водитель/.test(t) && /Курьер/.test(t) && /Продавец еды/.test(t) && /Компания/.test(t), 'UI 7. «Работа»: четыре кабинета');
await p.screenshot({ path: S + '/go4.png' });
await tap('Курьер', 0); await p.waitForTimeout(800);
// p.on('response', async (r) => { if (r.url().includes('/api/go/executors')) console.log('NET', r.request().method(), r.url().replace(F,''), r.status(), (await r.text().catch(()=>'')).slice(0,160)); });

import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
const txt = async () => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
// Большой PNG из случайных пикселей (~18 МБ): как фото с современного телефона
const W = 3000, H = 2000; const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W * 3; x += 4) raw.writeUInt32LE((Math.random() * 4294967296) >>> 0, y * (W * 3 + 1) + 1 + x - (x % 4 ? 0 : 0)); }
const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(S + '/big.png', big);
ok(big.length > 9 * 1024 * 1024, `тестовое фото тяжёлое: ${(big.length / 1048576).toFixed(1)} МБ (больше лимита nginx 9 МБ и сервера 8 МБ)`);
const upl = async (files) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: /Загрузить/ }).first().click()]); await fc.setFiles(files); await p.waitForTimeout(3500); };

// 1) Анкета с неверным ИНН: загрузка не проходит, причина рядом с документом
await p.locator('input').nth(0).fill('Иванов Иван Иванович');
await p.locator('input').nth(1).fill('123');
await upl({ name: 'doc.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(200)]) });
t = await txt();
ok(/Анкета пока не сохраняется — исправьте поля выше/.test(t) && /Загрузить/.test(t), '1) неверный ИНН: рядом с документом написано, что исправить', t.slice(-500));
// 2) HEIC
await p.locator('input').nth(1).fill('500100732259'); await p.locator('input').nth(2).fill('+79991234567');
await upl({ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.alloc(5000, 1) });
t = await txt();
ok(/Формат HEIC не поддерживается/.test(t), '2) HEIC: понятное сообщение, а не молчание', t.slice(-400));
// 3) Тяжёлое фото
await upl(S + '/big.png');
t = await txt();
const row = q(`select mime||'|'||size from go_executor_docs where kind='id_doc' order by created_at desc limit 1`);
const [mime, size] = row.split('|');
ok(mime === 'image/jpeg' && Number(size) < 2.5 * 1024 * 1024, `3) тяжёлое фото уменьшено перед загрузкой и принято: ${mime}, ${(Number(size) / 1048576).toFixed(2)} МБ`, row);
ok(!/Загрузить/.test((await txt()).split('Документы')[1]?.split('Возраст')[0] ?? ''), '3б) в списке документов появилась отметка вместо «Загрузить»');
await p.locator('input[type=date]').fill('1990-05-05');
await p.getByText('Отправить на проверку', { exact: true }).click(); await p.waitForTimeout(2200);
t = await txt();
ok(q(`select status from go_executors order by created_at desc limit 1`) === 'submitted', '4) заявка отправлена на проверку');
await br.close();
console.log(fails ? 'ПРОВАЛЕНО ' + fails : 'Все проверки пройдены'); process.exit(fails ? 1 : 0);
