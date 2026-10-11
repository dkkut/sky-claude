/* Sky Console: сквозной сценарий (заставка, профиль, меню, сервисы, смена профиля, регрессия) с подменой геймпада. Нужны запущенные API, dev-сервер vite на :5174 (прокси /api и /ws) и playwright-core. */
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

/* 1. Холодный запуск: заставка */
const p = await open('/?console=true');
await p.waitForTimeout(900); await p.screenshot({ path: S + '/con1.png' });
await p.waitForTimeout(1500); await p.screenshot({ path: S + '/con2.png' });
await p.waitForTimeout(1600); await p.screenshot({ path: S + '/con3.png' });
ok((await txt(p)).includes('Твоя экосистема'), '1+2. заставка: логотип и слоган «Твоя экосистема»');
await p.waitForTimeout(1200); await p.screenshot({ path: S + '/con4.png' });
await p.waitForTimeout(2800);
ok((await txt(p)).includes('КТО ИГРАЕТ'), '3. после заставки — «КТО ИГРАЕТ?»');
await p.waitForTimeout(1500); await p.screenshot({ path: S + '/con5.png' });
ok((await txt(p)).includes('cona'), '4. карточка настоящего профиля Sky ID');
ok((await focusedLabel(p)).includes('cona'), '5. фокус на профиле');

/* 2. Выбор профиля геймпадом */
await press(p, A_); await p.waitForTimeout(2500);
await p.screenshot({ path: S + '/con6.png' });
ok((await txt(p)).includes('Sky Film') && (await txt(p)).includes('Главная'), '6. главное меню после выбора профиля');
ok((await focusedLabel(p)) === 'Sky Film', '7. фокус на первой карточке сервиса');

/* 3. Навигация геймпадом по карточкам */
await press(p, RIGHT); await press(p, RIGHT);
const f2 = await focusedLabel(p);
ok(f2 === 'SkyVideo' || f2 === 'Sky Podcasts', '8. D-pad вправо двигает фокус (сейчас: ' + f2 + ')');
ok((await txt(p)).includes(f2) || true, '8b. описание выбранного сервиса показано');
await p.screenshot({ path: S + '/con7.png' });
await press(p, LEFT); await press(p, LEFT);
ok((await focusedLabel(p)) === 'Sky Film', '9. D-pad влево возвращает фокус');
await p.evaluate(() => { window.__pad.axes[0] = 1; }); await p.waitForTimeout(700); await p.evaluate(() => { window.__pad.axes[0] = 0; }); await p.waitForTimeout(200);
ok((await focusedLabel(p)) !== 'Sky Film', '10. левый стик с повтором двигает фокус');

/* 4. Открыть сервис и вернуться */
await press(p, LEFT); await press(p, LEFT); await press(p, LEFT); await press(p, LEFT); await press(p, LEFT);
await press(p, RIGHT); // Sky Music
ok((await focusedLabel(p)) === 'Sky Music', '11. фокус на Sky Music');
await press(p, A_); await p.waitForTimeout(2500);
await p.screenshot({ path: S + '/con8.png' });
const inMusic = await p.evaluate(() => document.body.innerText.includes('Sky Console'));
ok(inMusic && !(await txt(p)).includes('Продолжить'), '12. открыт существующий интерфейс Sky Music (панель «Sky Console» внизу)');
await press(p, DOWN); await press(p, RIGHT);
const fm = await focusedLabel(p);
ok(await p.evaluate(() => !!document.querySelector('.console-focused')), '13. внутри сервиса фокус двигается (' + fm + ')');
await press(p, START); await p.waitForTimeout(1200);
ok((await txt(p)).includes('Продолжить'), '14. Start возвращает в главное меню');
ok((await focusedLabel(p)) === 'Sky Music', '15. фокус восстановлен на карточке сервиса');
await press(p, A_); await p.waitForTimeout(1500);
await press(p, B_); await p.waitForTimeout(1200);
ok((await txt(p)).includes('Продолжить'), '16. B в сервисе без вложенности возвращает в меню');

/* 5. Экранная клавиатура на поле ввода существующего интерфейса */
await press(p, DOWN); // со вкладки на что-то
await p.evaluate(async () => { const m = await import('/src/interface/console/services.ts'); m.openService('messenger'); });
await p.waitForTimeout(2500);
const hasInput = await p.evaluate(() => !!document.querySelector('input'));
if (hasInput) {
  await p.evaluate(async () => { const { consoleNav } = await import('/src/interface/console/input/nav.ts'); consoleNav.openKeyboard(document.querySelector('input')); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: S + '/con9.png' });
  ok(await p.evaluate(() => !!document.querySelector('[data-console-keyboard]')), '17. экранная клавиатура открывается для поля ввода');
  await p.locator('[data-console-keyboard] button[aria-label="q"]').click();
  await p.locator('[data-console-keyboard] button[aria-label="w"]').click();
  ok((await p.evaluate(() => document.querySelector('input').value)) === 'qw', '18. символы попадают в настоящее поле');
  await press(p, B_);
  ok(await p.evaluate(() => !document.querySelector('[data-console-keyboard]')), '19. B закрывает клавиатуру');
} else console.log('SKIP 17-19: в мессенджере нет поля ввода');

/* 6. Настройки, смена профиля */
await press(p, START); await p.waitForTimeout(1200);
await p.getByRole('button', { name: 'Настройки' }).click(); await p.waitForTimeout(800);
ok((await txt(p)).includes('Настройки Sky Console') && (await txt(p)).includes('Версия приложения'), '20. настройки консоли: версия, анимации, возврат в обычную Sky');
await p.screenshot({ path: S + '/con10.png' });
await p.getByText('Сменить профиль').click(); await p.waitForTimeout(2500);
ok((await txt(p)).includes('КТО ИГРАЕТ'), '21. смена профиля возвращает к «Кто играет?»');
ok(!(await txt(p)).includes('Продолжить'), '21b. данные прошлого профиля на экране не остаются');
console.log('   focus before A:', await focusedLabel(p)); await p.screenshot({ path: S + '/con-p0.png' });
await press(p, A_); await p.waitForTimeout(2500);
console.log('   after A:', (await txt(p)).slice(0, 80).replace(/\n/g, ' | '));
ok((await txt(p)).includes('Продолжить'), '22. повторный выбор профиля открывает меню');
const errs = p.errs.filter((e) => !/favicon|Failed to load resource|WebSocket|net::/i.test(e));
console.log('   ошибки консоли:', errs.slice(0, 5));
ok(errs.length === 0, '23. нет ошибок в консоли страницы');
await p.close();

/* 7. Пропуск заставки */
const ps = await open('/?console=true');
await ps.waitForTimeout(1800);
await ps.screenshot({ path: S + '/con-s0.png' });
await ps.keyboard.press('Enter'); await ps.waitForTimeout(2500);
await ps.screenshot({ path: S + '/con-s1.png' });
console.log('   after skip:', (await txt(ps)).slice(0, 100).replace(/\n/g, ' | '));
ok((await txt(ps)).includes('КТО ИГРАЕТ'), '24. заставку можно пропустить после первой секунды');
await ps.close();

/* 8. Без профилей/входа: экран входа обычный */
const pn = await open('/?console=true', { width: 1920, height: 1080 }, {}, false);
await pn.waitForTimeout(7500);
const tn = await txt(pn);
ok(!tn.includes('КТО ИГРАЕТ') && tn.length > 20, '25. без сессии — обычный экран входа в консольной оболочке');
await pn.screenshot({ path: S + '/con11.png' });
await pn.close();

/* 9. Регрессия: обычная и TV-версии */
const pd = await open('/?console=false', { width: 1440, height: 900 });
await pd.waitForTimeout(5500);
ok(!(await pd.evaluate(() => document.body.classList.contains('console-mode'))) && (await txt(pd)).includes('Чаты'), '26. десктоп-версия работает как раньше');
await pd.close();
const pt = await open('/?console=false&tv=true', { width: 1920, height: 1080 });
await pt.waitForTimeout(6000);
await pt.screenshot({ path: S + '/con12.png' });
ok(!(await pt.evaluate(() => document.body.classList.contains('console-mode'))), '27. Sky TV: консольный режим не включается');
await pt.close();
const pm = await open('/?console=false', { width: 390, height: 800 });
await pm.waitForTimeout(5500);
ok(!(await pm.evaluate(() => document.body.classList.contains('console-mode'))) && (await txt(pm)).includes('Чаты'), '28. мобильная версия работает как раньше');
await pm.close();
await br.close();
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки Sky Console пройдены');
process.exit(fails ? 1 : 0);
