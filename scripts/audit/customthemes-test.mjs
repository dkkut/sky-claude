// Playwright на dev-сервере vite (npx vite --port 5199): свои темы — разбор, очистка, применение, снятие.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const p = await b.newPage();
await p.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  const m = await import('/src/settings/customThemes.ts');
  const out = {};
  out.bad = m.parseTheme('{oops').ok;
  out.noTag = m.parseTheme({ name: 'x' }).ok;
  const good = m.parseTheme({ 'sky-theme': 1, name: 'T', scheme: 'dark', base: { bg: '#101820', panel: '#16222e', text: '#e0f0ff', accent: '#00ccaa' },
    vars: { '--bg-l2': '#223344', '--evil': 'red', '--t2': 'url(http://x)' }, css: '@import url(http://evil); .a{background:url(http://evil/x.png)} .b{background:url(data:image/png;base64,AAAA)} </style><script>' });
  out.vars = Object.keys(good.theme.vars);
  out.css = good.theme.css;
  m.useCustomThemes.getState().add(good.theme);
  m.useCustomThemes.getState().activate(good.theme.id);
  await new Promise((r) => setTimeout(r, 200));
  const cs = getComputedStyle(document.documentElement);
  out.bg = cs.getPropertyValue('--bg').trim(); out.l2 = cs.getPropertyValue('--bg-l2').trim(); out.acc = cs.getPropertyValue('--accent').trim();
  out.styleEl = !!document.getElementById('sky-custom-theme-css');
  // смена тёмной/светлой вручную снимает тему
  (await import('/src/settings/store.ts')).useSettings.getState().set({ colorScheme: 'light' });
  await new Promise((r) => setTimeout(r, 200));
  out.afterLight = { active: m.useCustomThemes.getState().activeId, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), el: !!document.getElementById('sky-custom-theme-css') };
  return out;
});
const checks = [
  ['мусор вместо JSON отклонён', r.bad === false], ['JSON без sky-theme отклонён', r.noTag === false],
  ['чужие переменные и значения-«url» вырезаны', r.vars.length === 1 && r.vars[0] === '--bg-l2'],
  ['внешний url() и @import вырезаны, data:image оставлен', r.css === '.a{background:none} .b{background:url(data:image/png;base64,AAAA)}'],
  ['переменные темы применены', r.bg === '#101820' && r.l2 === '#223344' && r.acc === '#00ccaa'],
  ['свой CSS подключён', r.styleEl === true],
  ['ручная смена светлая/тёмная снимает тему', r.afterLight.active === null && r.afterLight.bg === '#f4f5f7' && r.afterLight.el === false],
];
let bad = 0; for (const [n, ok] of checks) { console.log(ok ? 'ok  ' : 'FAIL', n); if (!ok) bad++; }
console.log(bad ? `${bad} провалено` : 'всё ок');
await b.close();
