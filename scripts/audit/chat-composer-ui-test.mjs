// Мобильный чат: кнопки голосового и видео-кружка внутри экрана (390/360/320 px). Playwright; нужны API и сайт на :4173.
//   cd <каталог с playwright>; node chat-composer-ui-test.mjs <каталог с api.log> [ширина]
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
const ctx = await br.newContext({ viewport: { width: Number(process.argv[3] || 390), height: 780 }, locale: 'ru-RU', isMobile: true, hasTouch: true });
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


await p.getByText('Чаты', { exact: true }).last().click().catch(() => {}); await p.waitForTimeout(1200);
await p.getByText(/offb/).first().click(); await p.waitForTimeout(1500);
const m = await p.evaluate(() => {
  const vw = innerWidth;
  const get = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; };
  return { vw, vh: innerHeight, voice: get('[aria-label="Голосовое сообщение"]'), video: get('[aria-label="Видео-кружок"]'), ta: get('textarea[placeholder*="Написать"]'), docW: document.documentElement.scrollWidth };
});
console.log(JSON.stringify(m));
await p.screenshot({ path: S + '/chat-composer-' + (process.argv[3] || 390) + '.png' });
const fits = m.voice && m.video && m.voice.r <= m.vw && m.video.r <= m.vw && m.video.b <= m.vh && m.voice.l >= 0;
console.log(fits ? 'ok   кнопки ГС и кружка внутри экрана' : 'FAIL кнопки выходят за экран');
await br.close(); process.exit(fits ? 0 : 1);
