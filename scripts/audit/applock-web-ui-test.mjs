/* Блокировка приложения в браузере: код и биометрия (виртуальный аутентификатор WebAuthn). Dev-сервер vite на :5199; playwright-core. */
import { chromium } from 'playwright-core';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
const URL_ = process.argv[2] || 'http://localhost:5199/';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const salt = randomBytes(16);
const code = JSON.stringify({ salt: salt.toString('hex'), hash: pbkdf2Sync('2468', salt, 150000, 32, 'sha256').toString('hex') });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-proxy-server'] });
const mk = async (withBio) => {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.addInitScript(([c]) => { if (!localStorage.getItem('sky:applock:v1')) { localStorage.setItem('sky:applock:v1', '1'); localStorage.setItem('sky:applock:code:v1', c); } }, [code]);
  return { ctx, page, cdp };
};
// 1. только код
{
  const { ctx, page } = await mk();
  await page.goto(URL_); await page.waitForSelector('[aria-label="Приложение заблокировано"]', { timeout: 20000 });
  t('замок показан при запуске', true);
  t('без биометрии сразу ввод кода', await page.locator('input[type=password]').isVisible());
  await page.fill('input[type=password]', '1111'); await page.click('text=Войти');
  await page.getByText('Неверный код').waitFor({ timeout: 5000 }).catch(() => {}); t('неверный код — отказ', await page.getByText('Неверный код').isVisible());
  t('замок остался', await page.locator('[aria-label="Приложение заблокировано"]').isVisible());
  await page.fill('input[type=password]', '2468'); await page.click('text=Войти');
  await page.waitForTimeout(500);
  t('верный код — замок снят', !(await page.locator('[aria-label="Приложение заблокировано"]').isVisible()));
  await ctx.close();
}
// 2. биометрия через виртуальный аутентификатор
{
  const { ctx, page } = await mk();
  await page.goto(URL_); await page.waitForSelector('[aria-label="Приложение заблокировано"]', { timeout: 20000 });
  const id = await page.evaluate(async () => {
    const c = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Sky' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'x', displayName: 'x' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, attestation: 'none' } });
    const u = new Uint8Array(c.rawId); const s = btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('sky:applock:wa:v1', s); return s;
  });
  t('ключ создан', Boolean(id));
  await page.reload(); await page.waitForTimeout(2500);
  t('с биометрией замок снимается сам', !(await page.locator('[aria-label="Приложение заблокировано"]').isVisible()));
  await ctx.close();
}
await browser.close();
console.log(`Итого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
