/* Sky Console: экранная клавиатура на поле ввода Sky AI. Окружение как у console-ui-test.mjs. */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = process.argv[2], B = 'http://127.0.0.1:8080', F = 'http://127.0.0.1:5174';
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
  const cookies = r.headers.getSetCookie().map(c => { const [nv, ...a] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: '127.0.0.1', path: (a.find(x => x.trim().toLowerCase().startsWith('path=')) || 'path=/').split('=')[1].trim() }; });
  let tok = r.data.accessToken;
  r = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: tag, username: tag + Date.now().toString(36), acceptLegal: true }) }, tok);
  const pid = r.data.profile.id;
  q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('p${Date.now()}${tag}','${pid}','active','test')`);
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { cookies, tok: r.data.accessToken ?? tok, pid, tag };
};
import { createRequire } from 'node:module';
const require = createRequire('/home/user/sky-claude/server/');
const WebSocket = require('ws');
const A = await mk('cona');
const wsOpen = (u) => new Promise((res, rej) => { const ws = new WebSocket('ws://127.0.0.1:8081', { headers: { origin: F } }); ws.events = [];
  ws.on('message', d => { try { ws.events.push(JSON.parse(d)); } catch {} }); ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: u.tok } })));
  const t = setInterval(() => { if (ws.events.some(e => e.type === 'snapshot-done')) { clearInterval(t); res(ws); } }, 100); setTimeout(() => rej(new Error('auth')), 8000); });

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const PADINIT = () => {
  const state = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  window.__pad = state;
  navigator.getGamepads = () => [{ id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: true, mapping: 'standard', buttons: state.buttons, axes: state.axes, timestamp: performance.now() }];
};
const open = async (url, vp = { width: 1920, height: 1080 }, settings = {}, withCookies = true) => {
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU' });
  if (withCookies) await ctx.addCookies(A.cookies);
  await ctx.addInitScript((s) => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'dark', introAnim: false, ...s })); } catch {} }, settings);
  await ctx.addInitScript(PADINIT);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
  p.errs = errs;
  await p.goto(F + url); return p;
};
const press = async (p, i, hold = 130) => { await p.evaluate((i) => { window.__pad.buttons[i].pressed = true; }, i); await p.waitForTimeout(hold); await p.evaluate((i) => { window.__pad.buttons[i].pressed = false; }, i); await p.waitForTimeout(160); };
const A_ = 0, B_ = 1, X_ = 2, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const txt = (p) => p.evaluate(() => document.body.innerText);
const focusedLabel = (p) => p.evaluate(() => { const e = document.querySelector('.console-focused'); return e ? (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40) : ''; });


const p = await open('/?console=true');
await p.waitForTimeout(7500);
await press(p, A_); await p.waitForTimeout(2500);
for (let i = 0; i < 8; i++) await press(p, RIGHT);
console.log('focus:', await focusedLabel(p));
await press(p, A_); await p.waitForTimeout(3500);
console.log('inputs in music:', await p.evaluate(() => document.querySelectorAll('input,textarea').length));
await p.screenshot({ path: S + '/con13.png' });
await p.evaluate(() => document.querySelector('textarea,input').focus());
await press(p, A_); await p.waitForTimeout(600);
await p.screenshot({ path: S + '/con9.png' });
ok(await p.evaluate(() => !!document.querySelector('[data-console-keyboard]')), '17. экранная клавиатура открывается по A на поле ввода');
await press(p, RIGHT); await press(p, DOWN);
ok(await p.evaluate(() => !!document.activeElement?.closest('[data-console-keyboard]')), '17b. фокус внутри клавиатуры (под ней ничего не выбирается)');
await p.locator('[data-console-keyboard] button[aria-label="q"]').click();
await p.locator('[data-console-keyboard] button[aria-label="w"]').click();
ok((await p.evaluate(() => document.querySelector('textarea,input').value)) === 'qw', '18. символы попадают в настоящее поле');
await press(p, B_);
ok(await p.evaluate(() => !document.querySelector('[data-console-keyboard]')), '19. B закрывает клавиатуру');
await br.close();
console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nКлавиатура: проверки пройдены');
process.exit(fails ? 1 : 0);
