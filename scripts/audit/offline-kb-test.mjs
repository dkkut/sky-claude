// Запуск: node scripts/audit/offline-kb-test.mjs <каталог с api.log>; нужны API :8080 и фронт :4173 (dist).
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

const A = await mk('offa'); const Bu = await mk('offb');
const wsOpen = (u) => new Promise((res, rej) => { const ws = new WebSocket('ws://127.0.0.1:8081', { headers: { origin: F } }); ws.events = [];
  ws.on('message', d => { try { ws.events.push(JSON.parse(d)); } catch {} }); ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: u.tok } })));
  const t = setInterval(() => { if (ws.events.some(e => e.type === 'snapshot-done')) { clearInterval(t); res(ws); } }, 100); setTimeout(() => rej(new Error('auth')), 8000); });
import { createRequire } from 'node:module';
const require = createRequire('/home/user/sky-claude/server/');
var WebSocket = require('ws');
const wb = await wsOpen(Bu);
const dm = 'dm-' + [A.pid, Bu.pid].sort().join('~');
wb.send(JSON.stringify({ type: 'create-chat', payload: { chat: { id: dm, type: 'direct', name: '', participants: [A.pid] } } }));
await new Promise(r => setTimeout(r, 800));
const sendB = (text) => wb.send(JSON.stringify({ type: 'send-message', payload: { chatId: dm, message: { id: 'm' + Math.random().toString(36).slice(2), chatId: dm, authorId: Bu.pid, kind: 'text', text, createdAt: new Date().toISOString() } } }));
sendB('Привет от собеседника'); await new Promise(r => setTimeout(r, 800));

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await br.newContext({ viewport: { width: 390, height: 780 }, locale: 'ru-RU', isMobile: true, hasTouch: true });
await ctx.addCookies(A.cookies);
await ctx.addInitScript(() => {
  try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'dark', introAnim: false })); } catch {}
  // управляемый visualViewport: тест «открывает клавиатуру», меняя высоту
  const vv = new EventTarget(); const st = { height: innerHeight, offsetTop: 0 };
  Object.defineProperties(vv, { height: { get: () => st.height }, offsetTop: { get: () => st.offsetTop }, width: { get: () => innerWidth } });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__kb = (h) => { st.height = innerHeight - h; vv.dispatchEvent(new Event('resize')); };
});
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 150)));
await p.goto(F + '/?tv=false'); await p.waitForTimeout(6500);
await p.getByRole('button', { name: 'Начать' }).click({ timeout: 1500 }).catch(() => {});
const txt = () => p.evaluate(() => document.body.innerText);

/* --- Клавиатура --- */
await p.getByText('Чаты', { exact: true }).last().click().catch(() => {}); await p.waitForTimeout(1200);
await p.getByText(/offb/).first().click(); await p.waitForTimeout(1500);
const ta = p.locator('textarea[placeholder*="Написать"]');
const geo = () => p.evaluate(() => {
  const t = document.querySelector('textarea[placeholder*="Написать"]'); const f = t.closest('footer'); const list = f.parentElement.querySelector('.overflow-y-auto');
  const fr = f.getBoundingClientRect(); const lr = list.getBoundingClientRect(); const last = [...list.querySelectorAll('p')].pop();
  const tab = document.querySelector('.kb-hide'); 
  return { vh: innerHeight, footBottom: Math.round(fr.bottom), footTop: Math.round(fr.top), listBottom: Math.round(lr.bottom), lastBottom: last ? Math.round(last.getBoundingClientRect().bottom) : 0,
    htmlKb: document.documentElement.classList.contains('kb-open'), appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h'), tabVisible: tab ? getComputedStyle(tab).display !== 'none' : false, scrollY };
});
const before = await geo();
await ta.focus(); await p.evaluate(() => window.__kb(300)); await p.waitForTimeout(700);
const after = await geo();
console.log('   before', JSON.stringify(before)); console.log('   after ', JSON.stringify(after));
await p.screenshot({ path: S + '/kb1.png' });
ok(after.htmlKb && after.appH.trim() === (780 - 300) + 'px', 'KB 1. корень ужат до видимой области над клавиатурой');
ok(after.footBottom <= 780 - 300 + 1, 'KB 2. панель ввода — над клавиатурой');
ok(after.lastBottom <= after.footTop + 1, 'KB 3. последнее сообщение не под панелью ввода');
ok(!after.tabVisible && after.scrollY === 0, 'KB 4. нижняя панель убрана, страница не уехала');
await p.evaluate(() => window.__kb(0)); await p.waitForTimeout(500);
const closed = await geo();
ok(!closed.htmlKb && closed.footBottom <= 780, 'KB 5. клавиатуру закрыли — раскладка вернулась');
ok(await p.evaluate(() => { const f = document.querySelector('textarea[placeholder*="Написать"]').closest('footer'); return getComputedStyle(f).borderTopLeftRadius !== '0px'; }), 'KB 6. панель ввода скруглена');

/* --- Офлайн: чаты --- */
await p.evaluate(() => window.__kb(0));
await ctx.setOffline(true); await p.waitForTimeout(1500);
await p.screenshot({ path: S + '/off1.png' });
ok((await txt()).includes('Офлайн'), 'OFF 1. офлайн-режим открылся');
ok((await txt()).includes('Привет от собеседника'), 'OFF 2. в списке чатов — последнее сообщение');
await p.getByText(/offb/).first().click(); await p.waitForTimeout(600);
await p.locator('textarea[aria-label="Сообщение"]').fill('Написано без сети'); await p.locator('button[aria-label="Отправить"]').click(); await p.waitForTimeout(600);
await p.screenshot({ path: S + '/off2.png' });
ok((await txt()).includes('Написано без сети') && (await txt()).includes('отправится при подключении'), 'OFF 3. сообщение остаётся в чате с пометкой «отправится при подключении»');
const cnt = () => q(`select count(*) from messages where chat_id='${dm}'`);
const base0 = Number(cnt());
ok(base0 >= 1, 'OFF 4. на сервер пока не ушло');
await ctx.setOffline(false); await p.waitForTimeout(9000);
ok(Number(cnt()) === base0 + 1, 'OFF 5. после переподключения сообщение дошло до сервера (ровно один раз)');
ok(!(await txt()).includes('отправится при подключении') || (await txt()).includes('Написано без сети'), 'OFF 6. интерфейс вернулся');

/* --- Офлайн: заказы (кэш) --- */
await p.evaluate((uid) => {
  localStorage.setItem('sky:offline:orders:v1:' + uid, JSON.stringify([{ id: 'o1', title: 'Наушники Sky', status: 'in_transit', role: 'buyer', total: 4990, updatedAt: new Date().toISOString(), tracking: 'SKY123456789RU', carrier: 'СДЭК', shipStatus: 'В пути', chatId: 'c-none', lastMessage: 'Отправили сегодня', lastAt: new Date().toISOString() }]));
}, A.pid);
await p.route('**/api/market/**', (r) => r.abort()); await p.route('**/api/orders**', (r) => r.abort()); await p.reload(); await p.waitForTimeout(6000); await p.getByRole('button', { name: 'Начать' }).click({ timeout: 1000 }).catch(() => {});
await ctx.setOffline(true); await p.waitForTimeout(1500);
await p.getByRole('button', { name: /Заказы/ }).click(); await p.waitForTimeout(600);
await p.screenshot({ path: S + '/off3.png' });
const t3 = await txt();
ok(t3.includes('SKY123456789RU') && t3.includes('Отправили сегодня'), 'ORD 1. в офлайне видны трек-номер и последнее сообщение заказа');
await p.getByText('Наушники Sky').click(); await p.waitForTimeout(500);
await p.locator('textarea[aria-label="Сообщение по заказу"]').fill('Где посылка?'); await p.locator('button[aria-label="Отправить"]').click(); await p.waitForTimeout(500);
await p.screenshot({ path: S + '/off4.png' });
ok((await txt()).toLowerCase().includes('ждёт отправки') && (await txt()).includes('Где посылка?'), 'ORD 2. сообщение по заказу встало в очередь');
const ob = await p.evaluate((uid) => JSON.parse(localStorage.getItem('sky:offline:dealout:v1:' + uid) || '[]').length, A.pid);
ok(ob === 1, 'ORD 3. очередь сохранена на устройстве');
console.log('   ошибки страницы:', errs.slice(0, 3));
await br.close(); wb.close();
console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nВсе проверки офлайна и клавиатуры пройдены');
process.exit(fails ? 1 : 0);
