// Путеводитель (Playwright): страница /guide без входа и знакомство после регистрации (ответы /api/onboarding подменены).
// Нужен vite dev на :5173 (BASE можно задать).
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const errs = [];
const mk = async (w, h) => { const c = await browser.newContext({ locale: 'ru-RU', viewport: { width: w, height: h }, hasTouch: w < 600 }); const p = await c.newPage(); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|401|403|404/.test(m.text())) errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e) + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' '))); return p; };

for (const [name, w, h] of [['desktop', 1280, 800], ['phone', 390, 800]]) {
  const p = await mk(w, h);
  await p.goto(BASE + '/guide'); await p.waitForSelector('h1');
  t(`${name}: заголовок`, (await p.textContent('h1')).includes('Знакомься. Создавай. Открывай Sky.'));
  t(`${name}: нет горизонтальной прокрутки`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const cards = await p.locator('section[aria-labelledby=gd-svc] button.gd-card').count();
  t(`${name}: восемь карточек`, cards === 8, cards);
  await p.getByRole('button', { name: 'Исследовать экосистему' }).click();
  await p.screenshot({ path: `/tmp/guide-${name}.png` });
  // каждая карточка открывается и закрывается
  let allOpen = true;
  for (let i = 0; i < 8; i++) {
    await p.locator('section[aria-labelledby=gd-svc] button.gd-card').nth(i).click();
    allOpen = allOpen && await p.getByRole('dialog').isVisible();
    if (i === 7) { t(`${name}: Sky Money — главная фраза о возврате`, (await p.getByRole('dialog').textContent()).includes('Не бойтесь, поможем с возвратом денег через банк, если произойдёт сбой')); await p.screenshot({ path: `/tmp/guide-${name}-money.png` }); }
    if (i === 4) t(`${name}: Sky Games честно говорит о том, чего нет`, (await p.getByRole('dialog').textContent()).includes('пока нет'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(80);
  }
  t(`${name}: все карточки открываются`, allOpen);
  await p.locator('section[aria-labelledby=gd-svc] button.gd-card').nth(0).click();
  const cta = p.getByRole('dialog').getByRole('button', { name: 'Войти в Sky' }); t(`${name}: без входа кнопка ведёт во вход`, await cta.isVisible());
  await p.keyboard.press('Escape');
  await p.getByRole('radio', { name: 'Находить тиммейтов' }).click(); t(`${name}: персональный маршрут`, (await p.textContent('#gd-int + p + div + div, #gd-int ~ div.gd-glass')).includes('Sky Games'));
  t(`${name}: финальный блок`, await p.getByRole('heading', { name: 'Это только начало' }).isVisible());
  await p.context().close();
}

// знакомство после регистрации
const run = async (state, w = 390, h = 800) => {
  const p = await mk(w, h); const calls = [];
  await p.route('**/api/onboarding', async (r) => { const rq = r.request(); if (rq.method() === 'POST') { calls.push(JSON.parse(rq.postData() || '{}')); await r.fulfill({ json: { ok: true, status: 'started', step: 0, interest: null, auto: true } }); } else await r.fulfill({ json: state }); });
  // монтируем знакомство в обычном приложении: вход подменяем состоянием стора
  await p.goto(BASE + '/'); await p.waitForTimeout(2500);   // пусть приложение закончит собственную проверку сессии
  await p.evaluate(async () => { const m = await import('/src/core/auth/store.ts'); m.useAuthStore.setState({ isAuthenticated: true, currentUserId: 'acc-test' }); });
  return { p, calls };
};
{
  const { p, calls } = await run({ status: 'not_started', step: 0, interest: null, auto: true });
  await p.getByText('Добро пожаловать в Sky!').waitFor({ timeout: 8000 });
  t('приветствие показано', true); await p.screenshot({ path: '/tmp/guide-welcome.png' });
  await p.getByRole('button', { name: /Начать знакомство/ }).click();
  t('шаг 1 из 8', await p.getByText('1 из 8').isVisible());
  await p.getByRole('button', { name: /Далее/ }).click(); t('шаг 2 из 8', await p.getByText('2 из 8').isVisible());
  await p.getByRole('button', { name: /Назад/ }).click(); t('назад на 1 из 8', await p.getByText('1 из 8').isVisible());
  await p.getByRole('button', { name: 'Пропустить знакомство' }).click();
  t('подтверждение пропуска', await p.getByText('Ты можешь познакомиться с возможностями Sky позже.').isVisible());
  await p.getByRole('button', { name: 'Продолжить знакомство' }).click(); t('«Продолжить» возвращает к шагу', await p.getByText('1 из 8').isVisible());
  for (let i = 0; i < 7; i++) await p.getByRole('button', { name: /Далее/ }).click();
  t('шаг 8 из 8 — Sky Money', await p.getByText('8 из 8').isVisible() && await p.getByText('Sky Money').first().isVisible());
  await p.screenshot({ path: '/tmp/guide-step8.png' });
  await p.getByRole('button', { name: /Далее/ }).click();
  t('вопрос об интересах', await p.getByRole('heading', { name: 'Что ты хочешь делать в Sky?' }).isVisible());
  await p.getByRole('radio', { name: 'Развивать бизнес' }).click(); await p.getByRole('button', { name: /Продолжить/ }).click();
  t('финальный экран', await p.getByText('Теперь ты знаешь, с чего начать!').isVisible());
  await p.getByRole('button', { name: /Перейти в Sky/ }).click();
  await p.waitForTimeout(300);
  t('оверлей закрыт', !(await p.getByRole('dialog', { name: 'Знакомство с Sky' }).count()));
  const last = calls[calls.length - 1];
  t('на сервер ушло завершение с интересом', last?.action === 'complete' && last?.interest === 'business', calls);
  t('запросы шагов уходили на сервер', calls.filter((c) => c.action === 'step').length >= 3 && calls.some((c) => c.action === 'start'));
  await p.context().close();
}
{
  const { p, calls } = await run({ status: 'not_started', step: 0, interest: null, auto: true });
  await p.getByText('Добро пожаловать в Sky!').waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: 'Позже' }).click(); await p.waitForTimeout(300);
  t('«Позже» — закрыто и сохранено как пропуск', calls.some((c) => c.action === 'skip') && !(await p.getByText('Добро пожаловать в Sky!').count()));
  await p.context().close();
}
{
  const { p } = await run({ status: 'completed', step: 8, interest: null, auto: false });
  await p.waitForTimeout(1500);
  t('завершённое не показывается', !(await p.getByText('Добро пожаловать в Sky!').count()));
  await p.context().close();
}
{
  const { p } = await run({ status: 'started', step: 3, interest: null, auto: true });
  await p.getByText('Добро пожаловать в Sky!').waitFor({ timeout: 8000 });
  t('незавершённое предлагает продолжить', await p.getByRole('button', { name: 'Продолжить знакомство' }).isVisible());
  await p.getByRole('button', { name: 'Продолжить знакомство' }).click(); t('возобновляется с сохранённого шага', await p.getByText('4 из 8').isVisible());
  await p.context().close();
}
// dev-сервер без API: ошибки самого приложения (checkPlatformStatus, customization) не относятся к путеводителю
const mine = errs.filter((e) => /src\/guide\/|GuidePage|GuideOnboarding/.test(e));
t('нет ошибок в коде путеводителя', mine.length === 0, mine.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
