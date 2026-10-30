// SkyMoney: замок и заглушки SkyCards/SkyCrypto (Playwright на dev-сервере vite :5199, ответы API подменены).
// PW=/путь/к/playwright/index.mjs node scripts/audit/moneystubs-ui-test.mjs
const { chromium } = await import(process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.env.BASE || 'http://localhost:5199';
const EXACT = 'Вкладка недоступна, она в бета разработке';
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

const mount = async (page, what) => {
  await page.goto(BASE + '/guide', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200);
  await page.evaluate(async (what) => {
    const rm = await import('/node_modules/.vite/deps/react.js'); const React = rm.createElement ? rm : rm.default;
    const dm = await import('/node_modules/.vite/deps/react-dom_client.js');
    const el = document.createElement('div'); el.id = 'mount'; el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000'; document.body.appendChild(el);
    const root = (dm.createRoot ?? dm.default.createRoot)(el);
    window.__back = 0; window.__root = root;
    if (what === 'cards') { const m = await import('/src/wallet/stubs/SkyCards.tsx'); root.render(React.createElement(m.SkyCards, { onBack: () => { window.__back += 1; } })); }
    else if (what === 'crypto') { const m = await import('/src/wallet/stubs/SkyCrypto.tsx'); root.render(React.createElement(m.SkyCrypto, { onBack: () => { window.__back += 1; } })); }
    else { const m = await import('/src/wallet/SkyMoneyWallet.tsx'); root.render(React.createElement(m.SkyMoneyWallet)); }
  }, what);
  await page.waitForTimeout(1200);
};

for (const [label, vp] of [['телефон', { width: 390, height: 800 }], ['компьютер', { width: 1280, height: 800 }]]) {
  for (const what of ['cards', 'crypto']) {
    const page = await browser.newPage({ viewport: vp }); const reqs = []; const errs = [];
    page.on('request', (r) => { if (/\/api\//.test(r.url())) reqs.push(r.url()); }); page.on('pageerror', (e) => errs.push(String(e)));
    await mount(page, what);
    const txt = await page.locator('#mount').innerText();
    t(`${what}/${label}: баннер с точным текстом`, txt.includes(EXACT));
    t(`${what}/${label}: нет горизонтальной прокрутки`, await page.evaluate(() => { const m = document.getElementById('mount'); return m.scrollWidth <= m.clientWidth + 1; }));
    reqs.length = 0;
    const before = await page.locator('#mount').innerHTML();
    // Нажатия по карточкам, графику, тексту, углам: ничего не происходит
    for (const [x, y] of [[vp.width / 2, 260], [vp.width / 2, 420], [vp.width / 2, 560], [vp.width / 2, 700], [60, 400]]) { await page.mouse.click(x, y).catch(() => {}); }
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    t(`${what}/${label}: нажатия не шлют запросов`, reqs.length === 0, reqs.join());
    t(`${what}/${label}: нажатия не меняют разметку (нет окон)`, (await page.locator('#mount').innerHTML()) === before);
    t(`${what}/${label}: «Назад» нигде не срабатывал от кликов в контенте`, await page.evaluate(() => window.__back) === 0);
    const dead = await page.evaluate(() => { const d = document.querySelector('#mount [aria-disabled="true"]'); return !!d && d.hasAttribute('inert') && getComputedStyle(d).pointerEvents === 'none'; });
    t(`${what}/${label}: зона заглушки inert и без указателя`, dead);
    await page.getByRole('button', { name: 'Назад' }).click();
    t(`${what}/${label}: «Назад» работает`, await page.evaluate(() => window.__back) === 1);
    await page.screenshot({ path: `/tmp/${what}-${label}.png`, fullPage: false });
    t(`${what}/${label}: без ошибок страницы`, errs.length === 0, errs.join(' | '));
    await page.close();
  }
}

// Замок: до подтверждения не должно быть ни кошелька, ни запросов к /api/wallet
{
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } }); const walletReqs = []; let unlocked = false;
  await page.route('**/api/skyid/money/status', (r) => r.fulfill({ json: unlocked ? { unlocked: true } : { unlocked: false, needPassword: true, needDevice: false, passwordSet: true, trustedDevice: true } }));
  await page.route('**/api/skyid/money/unlock', (r) => { const b = JSON.parse(r.request().postData() || '{}'); if (b.password === 'good') { unlocked = true; r.fulfill({ json: { ok: true, unlocked: true } }); } else r.fulfill({ status: 401, json: { ok: false, error: 'invalid_credentials' } }); });
  await page.route('**/api/wallet**', (r) => { walletReqs.push(r.request().url()); r.fulfill({ json: { balance: 12345, points: 7, transactions: [] } }); });
  await page.goto(BASE + '/guide', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(800);
  await page.evaluate(() => { localStorage.setItem('x', '1'); });
  await mount(page, 'wallet');
  let txt = await page.locator('#mount').innerText();
  t('замок: виден экран блокировки', /SkyMoney закрыт|SkyMoney is locked/.test(txt));
  t('замок: нет баланса и разделов', !/12\s?345|Пополнить|SkyCards|SkyCrypto|История/.test(txt));
  t('замок: ни одного запроса к /api/wallet до подтверждения', walletReqs.length === 0, walletReqs.join());
  await page.getByLabel('Пароль Sky ID').fill('bad'); await page.getByRole('button', { name: /Открыть SkyMoney/ }).click(); await page.waitForTimeout(500);
  txt = await page.locator('#mount').innerText();
  t('замок: неверный пароль — ошибка и всё ещё закрыто', /Неверный пароль/.test(txt) && walletReqs.length === 0);
  await page.getByLabel('Пароль Sky ID').fill('good'); await page.getByRole('button', { name: /Открыть SkyMoney/ }).click(); await page.waitForTimeout(1500);
  txt = await page.locator('#mount').innerText();
  t('замок: верный пароль открывает кошелёк', /Пополнить/.test(txt), txt.slice(0, 120));
  t('замок: SkyCards и SkyCrypto внутри кошелька', /SkyCards/.test(txt) && /SkyCrypto/.test(txt));
  await page.getByRole('button', { name: /SkyCards/ }).click(); await page.waitForTimeout(600);
  t('SkyCards открывается из кошелька с баннером', (await page.locator('#mount').innerText()).includes(EXACT));
  await page.getByRole('button', { name: 'Назад' }).click(); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /SkyCrypto/ }).click(); await page.waitForTimeout(600);
  t('SkyCrypto открывается из кошелька с баннером', (await page.locator('#mount').innerText()).includes(EXACT));
  await page.close();
}
await browser.close();
console.log(`${ok} ок, ${bad} провалов`); process.exit(bad ? 1 : 0);
