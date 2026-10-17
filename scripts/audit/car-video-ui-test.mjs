/* Sky Car: кино/видео/книги только когда автомобиль стоит; предупреждение; пропажа сигнала; звук без картинки. Нужны API, dist на :4173 (front.mjs), playwright-core. */
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
  q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan,expires_at) VALUES ('p${Date.now()}${tag}','${pid}','active','test', now() + interval '30 days')`);
  q(`update profiles set is_prime=true where id='${pid}'`);
  r = await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok);
  return { cookies, tok: r.data.accessToken ?? tok, pid, tag };
};
const A = await mk('carv');
const stamp = Date.now().toString(36);
const mid = `mov-00000000-0000-0000-0000-${stamp.padEnd(12, '0').slice(0, 12)}`;
q(`INSERT INTO film_movies(id,owner_id,title,status,mime,bytes,duration_sec,genre) VALUES ('${mid}','${A.pid}','Фильм для машины ${stamp}','published','video/mp4',1000,100,'Драма')`);
let r0 = await call('/api/books/book', { method: 'POST', body: JSON.stringify({ title: `Книга в дорогу ${stamp}`, category: 'Проза' }) }, A.tok);
const bid = r0.data.book?.id;
await call(`/api/books/book/${bid}/chapter`, { method: 'POST', body: JSON.stringify({ title: 'Начало', content: 'Текст первой главы для чтения в стоянке.' }) }, A.tok);
q(`update books set status='published', published_at=now() where id='${bid}'`);

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await br.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU' });
await ctx.addCookies(A.cookies);
await ctx.addInitScript(() => {
  try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'dark', introAnim: false })); localStorage.setItem('sky:car:mode:v1', 'on'); sessionStorage.removeItem('sky:car:warn:v1'); } catch {}
  // управляемая геолокация: window.__fix(speed) — приходит замер; ничего не приходит — сигнала нет
  let cb = null; let id = 0;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    watchPosition: (ok) => { cb = ok; return ++id; }, clearWatch: () => { cb = null; }, getCurrentPosition: () => {},
  } });
  window.__fix = (speed) => { if (cb) cb({ coords: { speed, latitude: 55, longitude: 37, accuracy: 5 }, timestamp: Date.now() }); };
});
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
await p.goto(F + '/');
const txt = () => p.evaluate(() => document.body.innerText);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.waitForSelector('nav[aria-label="Разделы"]', { timeout: 20000 }).catch(() => {});
// выбор профиля, если спросит
if (await p.locator('text=Кто играет').count()) { await p.locator('button').first().click(); await sleep(1500); }
await p.waitForSelector('nav[aria-label="Разделы"]', { timeout: 20000 });
ok(true, 'Car открыт');

await p.click('button[aria-label="Кино"]');
await p.waitForSelector('[data-car-warning]', { timeout: 5000 });
ok((await txt()).includes('Не отвлекайтесь от дороги'), 'предупреждение показано перед кино');
await p.click('text=Понятно');
await p.waitForSelector('[data-car-unknown-banner]', { timeout: 5000 });
ok((await p.locator('[data-car-locked]').count()) === 0, 'сигнала нет — раздел НЕ закрыт, только баннер «состояние неизвестно»');
await sleep(1500);
ok((await txt()).includes(`Фильм для машины ${stamp}`), 'при неизвестном состоянии каталог виден');
await p.evaluate(() => window.__fix(13)); await sleep(500);
ok((await p.locator('[data-drive-state="driving"]').count()) === 1 && (await txt()).includes('в движении'), 'скорость 13 м/с — «автомобиль в движении», закрыто');
ok(!(await txt()).includes('Фильм для машины'), 'в движении каталог закрыт');
await p.evaluate(() => window.__fix(0)); await sleep(4000); await p.evaluate(() => window.__fix(0));
ok((await p.locator('[data-car-locked]').count()) === 1, 'через 4 с стоянки видео всё ещё закрыто (нужна выдержка)');
await sleep(5000); await p.evaluate(() => window.__fix(0)); await sleep(800);
ok((await p.locator('[data-drive-state="parked"]').count()) === 1, 'после выдержки — «автомобиль стоит»');
ok((await txt()).includes(`Фильм для машины ${stamp}`), 'каталог открылся');

await p.click(`button[aria-label="Фильм для машины ${stamp}"]`);
await p.waitForSelector('[data-car-video]', { timeout: 5000 });
ok((await p.locator('[data-car-video][data-picture="on"]').count()) === 1, 'плеер: картинка включена на стоянке');
await p.evaluate(() => window.__fix(11)); await sleep(700);
ok((await p.locator('[data-car-video][data-picture="off"]').count()) === 1 && (await p.locator('[data-car-video-locked]').count()) === 1, 'автомобиль тронулся: картинка погашена');
ok((await txt()).includes('Видео остановлено'), 'пояснение показано');
const vis = await p.evaluate(() => getComputedStyle(document.querySelector('[data-car-video] video')).visibility);
ok(vis === 'hidden', 'элемент video скрыт при движении');
ok((await p.locator('button[aria-label="Играть"][disabled]').count()) === 1, 'кнопка «Играть» заблокирована при движении');
await p.click('text=Слушать только звук'); await sleep(500);
ok((await txt()).includes('Идёт только звук'), 'режим «только звук» включён');
ok((await p.evaluate(() => getComputedStyle(document.querySelector('[data-car-video] video')).visibility)) === 'hidden', 'в режиме звука картинка по-прежнему скрыта');
await p.evaluate(() => window.__fix(0)); await sleep(8500); await p.evaluate(() => window.__fix(0)); await sleep(800);
ok((await p.locator('[data-car-video][data-picture="on"]').count()) === 1, 'остановились — картинка вернулась');
await p.click('button[aria-label="Закрыть"]'); await sleep(500);

// сигнал пропал
await sleep(21000);
ok((await p.locator('[data-drive-state="unknown"]').count()) === 1 && (await p.locator('[data-car-locked]').count()) === 0 && (await p.locator('[data-car-unknown-banner]').count()) === 1, 'сигнала нет 20+ с — «неизвестно»: кино открыто, показан баннер');
await p.evaluate(() => window.__fix(0)); await sleep(500); await p.evaluate(() => window.__fix(0));

// книги
await p.click('button[aria-label="Книги"]'); await sleep(1500);
await p.evaluate(() => window.__fix(9)); await sleep(500);
ok((await txt()).includes(`Книга в дорогу ${stamp}`), 'книги: список виден (аудио/чтение — внутри книги)');
await p.click(`button[aria-label="Книга в дорогу ${stamp}"]`); await sleep(1500);
ok((await txt()).includes('Читать (когда стоите)'), 'книги: «Читать» помечено — нужно стоять');
await p.click('text=Читать'); await sleep(800);
ok((await p.locator('[data-car-reader][data-text="off"]').count()) === 1 && (await txt()).includes('Чтение недоступно'), 'книги: текст закрыт без подтверждённой стоянки');
ok(!(await txt()).includes('Текст первой главы'), 'текст главы не показывается');
await p.evaluate(() => window.__fix(0)); await sleep(8500); await p.evaluate(() => window.__fix(0)); await sleep(1500);
ok((await p.locator('[data-car-reader][data-text="on"]').count()) === 1 && (await txt()).includes('Текст первой главы'), 'книги: на стоянке текст открылся');
await p.evaluate(() => window.__fix(9)); await sleep(800);
ok(!(await txt()).includes('Текст первой главы') && (await p.locator('[data-car-reader][data-text="off"]').count()) === 1, 'книги: тронулись — текст снова скрыт');

ok(errs.length === 0, `нет ошибок страницы ${errs.slice(0, 2).join(' | ')}`);
await br.close();
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки пройдены');
process.exit(fails ? 1 : 0);
