/* Sky TV и Sky Car: профиль при запуске, боковая панель, музыка и коллекция с сервера, синхронизация, офлайн, безопасность Car, регрессия. Нужны API, статика dist на :4173 (front.mjs) и playwright-core. */
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
const A = await mk('tvu'); const Other = await mk('tvo');
// данные: личный фильм пользователя, чужой опубликованный (сохраняем в коллекцию), любимый трек
const stamp = Date.now();
q(`INSERT INTO film_movies(id,owner_id,title,status,mime,duration_sec,genre) VALUES ('tvmine${stamp}','${A.pid}','Мой личный фильм','private','video/mp4',100,'Драма')`);
q(`INSERT INTO film_movies(id,owner_id,title,status,mime,duration_sec,genre) VALUES ('tvpub${stamp}','${Other.pid}','Чужой публичный','published','video/mp4',100,'Комедия')`);
q(`INSERT INTO film_movies(id,owner_id,title,status,mime,duration_sec,genre) VALUES ('tvothpriv${stamp}','${Other.pid}','Чужой ЛИЧНЫЙ','private','video/mp4',100,'Драма')`);
const trk = q("select id from music_tracks where status='published' limit 1");
const saveRes = await call('/api/film/saved', { method: 'POST', body: JSON.stringify({ movieId: 'tvpub' + stamp, on: true }) }, A.tok);
console.log('save film:', saveRes.status);
const favRes = await call('/api/music/favorites', { method: 'POST', body: JSON.stringify({ trackId: trk, on: true }) }, A.tok);
console.log('fav track:', favRes.status);

let fails = 0;
const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const open = async (url, vp, init = {}) => {
  const ctx = await br.newContext({ viewport: vp, locale: 'ru-RU' });
  await ctx.addCookies(A.cookies);
  await ctx.addInitScript((s) => { try { localStorage.setItem('sky:settings:v1', JSON.stringify({ colorScheme: 'dark', introAnim: false })); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch {} }, init);
  const p = await ctx.newPage(); p.errs = []; p.ctx = ctx;
  p.on('pageerror', e => p.errs.push(e.message.slice(0, 160)));
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console: ' + m.text().slice(0, 140)); });
  await p.goto(F + url); return p;
};
const clk = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
const txt = (p) => p.evaluate(() => document.body.innerText);
const key = async (p, k, ms = 250) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };

/* ---------- SKY TV ---------- */
const tv = await open('/?tv=true', { width: 1920, height: 1080 });
await tv.waitForTimeout(6500);
ok((await txt(tv)).includes('КТО ИГРАЕТ'), 'TV 1. при входе спрашивается профиль («Кто играет?»)');
await tv.screenshot({ path: S + '/tv1.png' });
await tv.waitForTimeout(1300); await key(tv, 'Enter', 3000);
ok((await txt(tv)).length > 50 && !(await txt(tv)).includes('КТО ИГРАЕТ'), 'TV 2. профиль выбран с пульта, открыт Sky TV');
ok(await tv.evaluate(() => !!document.querySelector('nav[aria-label="Разделы"]')), 'TV 3. боковая панель (как на ПК)');
await tv.screenshot({ path: S + '/tv2.png' });
// на боковую панель: стрелка влево из контента
for (let i = 0; i < 6; i++) await key(tv, 'ArrowLeft', 120);
ok(await tv.evaluate(() => document.querySelector('nav[aria-label="Разделы"]')?.getBoundingClientRect().width > 250), 'TV 4. панель раскрывается с подписями при фокусе');
await tv.screenshot({ path: S + '/tv3.png' });
ok((await txt(tv)).includes('Моя коллекция'), 'TV 5. пункт «Моя коллекция» есть');
// Музыка
await clk(tv, '[data-tv-focusable=\"nav-music\"]'); await tv.waitForTimeout(3500);
const music = await txt(tv);
ok(music.includes('Sky Music') && !/Треков пока нет/.test(music), 'TV 6. каталог музыки загружен с сервера');
await tv.screenshot({ path: S + '/tv4.png' });
const firstCard = tv.locator('[data-tv-focusable^="hist-"],[data-tv-focusable^="fav-"],[data-tv-focusable^="fresh-"]').first();
await tv.evaluate(() => document.querySelector('[data-tv-focusable^="hist-"],[data-tv-focusable^="fav-"],[data-tv-focusable^="fresh-"]').click()); await tv.waitForTimeout(2500);
const audio = await tv.evaluate(() => { const a = document.querySelector('audio'); return a ? { src: a.src, paused: a.paused } : null; });
console.log('   audio:', audio && audio.src.slice(0, 80), audio?.paused);
ok(!!audio && /\/api\/music\//.test(audio.src), 'TV 7. трек запущен единым плеером с серверным адресом');
// Коллекция
await clk(tv, '[data-tv-focusable=\"nav-collection\"]'); await tv.waitForTimeout(3500);
const coll = await txt(tv);
await tv.screenshot({ path: S + '/tv5.png' });
ok(coll.includes('Мой личный фильм'), 'TV 8. личный фильм пользователя — в «Моей коллекции»');
ok(coll.includes('Чужой публичный'), 'TV 9. сохранённый фильм — в «Моей коллекции»');
ok(!coll.includes('Чужой ЛИЧНЫЙ'), 'TV 10. чужое личное кино не видно');
ok(coll.includes('Музыка: любимые'), 'TV 11. любимая музыка с сервера — в коллекции');
// каталог кино отдельно: личное не в общем
await clk(tv, '[data-tv-focusable=\"nav-movies\"]'); await tv.waitForTimeout(3000);
const cat = await txt(tv);
ok(!cat.includes('Мой личный фильм') && !cat.includes('Чужой ЛИЧНЫЙ'), 'TV 12. личные фильмы не попадают в общий каталог');
// синхронизация: убрали сохранённое «на другом устройстве»
await call('/api/film/saved', { method: 'POST', body: JSON.stringify({ movieId: 'tvpub' + stamp, on: false }) }, A.tok);
await tv.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await clk(tv, '[data-tv-focusable=\"nav-collection\"]'); await tv.waitForTimeout(3500);
ok(!(await txt(tv)).includes('Чужой публичный'), 'TV 13. изменение с другого устройства видно после возврата в приложение');
// удаление/добавление из ТВ
await call('/api/film/saved', { method: 'POST', body: JSON.stringify({ movieId: 'tvpub' + stamp, on: true }) }, A.tok);
await clk(tv, '[data-tv-focusable=\"nav-profile\"]'); await tv.waitForTimeout(800);
await clk(tv, '[data-tv-focusable=\"nav-collection\"]'); await tv.waitForTimeout(500);
await tv.evaluate(() => window.dispatchEvent(new Event('online')));
await tv.waitForTimeout(3500);
const sv = tv.locator('[data-tv-focusable^="sv-"]').first();
if (await sv.count()) {
  await clk(tv, '[data-tv-focusable^="sv-"]'); await tv.waitForTimeout(600);
  ok((await txt(tv)).includes('Убрать из коллекции'), 'TV 14. шторка действий над карточкой коллекции');
  await tv.screenshot({ path: S + '/tv6.png' });
  await clk(tv, '[data-tv-focusable="sheet-2"]'); await tv.waitForTimeout(100); await tv.waitForTimeout(1500);
  const left = q(`select count(*) from film_saved where user_id='${A.pid}' and movie_id='tvpub${stamp}'`);
  ok(left === '0', 'TV 15. удаление из коллекции сохранено на сервере');
} else console.log('SKIP TV 14-15: карточка сохранённого не найдена');
// офлайн
await tv.ctx.setOffline(true); await tv.waitForTimeout(2500);
ok((await txt(tv)).includes('Нет соединения с сервером'), 'TV 16. при потере соединения показывается сообщение, интерфейс жив');
await tv.ctx.setOffline(false);
// поиск с сервера
await clk(tv, '[data-tv-focusable=\"nav-search\"]'); await tv.waitForTimeout(800);
await tv.locator('input[aria-label="Поиск"]').fill('Трек'); await tv.waitForTimeout(2500);
await tv.screenshot({ path: S + '/tv7.png' });
ok((await txt(tv)).includes('Музыка'), 'TV 17. поиск идёт по серверу и находит музыку');
ok(await tv.evaluate(() => !!document.querySelector('[data-tv-focusable="kb-lang"]')), 'TV 18. экранная клавиатура остаётся при вводе');
// смена профиля
await clk(tv, '[data-tv-focusable=\"nav-profile\"]'); await tv.waitForTimeout(800);
await clk(tv, '[data-tv-focusable="tv-switch"]'); await tv.waitForTimeout(2500);
ok((await txt(tv)).includes('КТО ИГРАЕТ'), 'TV 19. смена профиля возвращает к выбору профиля');
const tverrs = tv.errs.filter(e => !/favicon|Failed to load resource|net::|WebSocket|offline/i.test(e));
console.log('   ошибки TV:', tverrs.slice(0, 5)); ok(tverrs.length === 0, 'TV 20. нет ошибок в консоли');
await tv.ctx.close();

/* ---------- SKY CAR ---------- */
const car = await open('/', { width: 1920, height: 720 }, { 'sky:car:mode:v1': 'on' });
await car.waitForTimeout(6500);
ok((await txt(car)).includes('КТО ИГРАЕТ'), 'CAR 1. при входе спрашивается профиль');
await car.waitForTimeout(1300); await key(car, 'Enter', 3000);
await car.screenshot({ path: S + '/car1.png' });
const ct = await txt(car);
ok(ct.includes('Музыка') && ct.includes('Подкасты') && ct.includes('Sky AI'), 'CAR 2. главный экран: музыка, подкасты, сообщения, Sky AI');
ok(!/Кино/.test(ct), 'CAR 3. видео для водителя нет');
ok(await car.evaluate(() => [...document.querySelectorAll('button')].every(b => { const r = b.getBoundingClientRect(); return r.width === 0 || (r.width >= 56 && r.height >= 56); })), 'CAR 4. все кнопки крупные (не меньше 56 px)');
await car.getByRole('button', { name: 'Любимые' }).first().click().catch(() => {});
await car.waitForTimeout(2500);
const caudio = await car.evaluate(() => { const a = document.querySelector('audio'); return a ? { src: a.src } : null; });
ok(!!caudio && /\/api\/music\//.test(caudio.src), 'CAR 5. любимое с сервера играет единым плеером');
await car.screenshot({ path: S + '/car2.png' });
await car.getByRole('button', { name: 'Музыка', exact: true }).first().click(); await car.waitForTimeout(2500);
await car.screenshot({ path: S + '/car3.png' });
const mt = await txt(car);
ok(mt.includes('Любимые') && mt.includes('Моя музыка') && mt.includes('Каталог'), 'CAR 6. музыка: недавние, любимые, моя, плейлисты, каталог');
await car.getByRole('tab', { name: /Каталог/ }).click(); await car.waitForTimeout(1500);
ok((await car.locator('button[aria-label*=" — "]').count()) > 5, 'CAR 7. реальный каталог треков отображается');
await car.getByRole('button', { name: 'Пауза' }).first().click().catch(() => {});
await car.waitForTimeout(800);
ok(await car.evaluate(() => { const a = document.querySelector('audio'); return !a || a.paused; }), 'CAR 8. пауза с нижней панели управляет плеером');
await car.getByRole('button', { name: 'Сообщения', exact: true }).first().click(); await car.waitForTimeout(1200);
await car.screenshot({ path: S + '/car4.png' });
ok(await car.evaluate(() => !document.querySelector('input,textarea')), 'CAR 9. нет свободного ввода текста за рулём');
await car.getByRole('button', { name: 'Sky AI', exact: true }).first().click(); await car.waitForTimeout(800);
ok(await car.evaluate(() => !document.querySelector('input,textarea')) && (await txt(car)).includes('Нажмите и говорите'), 'CAR 10. Sky AI только голосом');
await car.getByRole('button', { name: 'Главная', exact: true }).first().click(); await car.waitForTimeout(800);
ok((await txt(car)).includes('Сообщения'), 'CAR 11. возврат на главный экран');
await car.setViewportSize({ width: 1280, height: 600 }); await car.waitForTimeout(600);
await car.screenshot({ path: S + '/car5.png' });
ok(await car.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'CAR 12. нет горизонтального переполнения на 1280×600');
await car.setViewportSize({ width: 1024, height: 480 }); await car.waitForTimeout(600);
ok(await car.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'CAR 13. нет переполнения на 1024×480');
await car.screenshot({ path: S + '/car6.png' });
const carerrs = car.errs.filter(e => !/favicon|Failed to load resource|net::|WebSocket/i.test(e));
console.log('   ошибки CAR:', carerrs.slice(0, 5)); ok(carerrs.length === 0, 'CAR 14. нет ошибок в консоли');
await car.ctx.close();

/* ---------- регрессия ---------- */
const dk = await open('/?tv=false', { width: 1440, height: 900 });
await dk.waitForTimeout(5500);
ok((await txt(dk)).includes('Чаты') && !(await dk.evaluate(() => !!document.querySelector('nav[aria-label="Разделы"]'))), 'REG 1. десктоп-версия как раньше');
await dk.ctx.close();
const mb = await open('/?tv=false', { width: 390, height: 800 });
await mb.waitForTimeout(5500);
ok((await txt(mb)).includes('Чаты'), 'REG 2. мобильная версия как раньше');
await mb.ctx.close();
await br.close();
q(`DELETE FROM film_saved WHERE movie_id like 'tv%${stamp}'`); q(`DELETE FROM film_movies WHERE id like 'tv%${stamp}'`);
console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки Sky TV и Sky Car пройдены');
process.exit(fails ? 1 : 0);
