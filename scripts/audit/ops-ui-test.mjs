// Вкладка «Сервер» (src/admin/OpsTab.tsx): Playwright на dev-сервере vite, компонент монтируется напрямую, ответы API подменены.
// Запуск: npx vite --port 5199 & node scripts/audit/ops-ui-test.mjs  (BASE=http://127.0.0.1:5199; страница в ru-RU, иначе интерфейс переводится на английский)
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');   // PLAYWRIGHT_CORE — путь к index.mjs, если пакет не в проекте
const BASE = process.env.BASE || 'http://127.0.0.1:5199';
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); if (!c) process.exitCode = 1; };
const oc = await import('../../server/opscmds.mjs');
const commands = oc.catalog();
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'ru-RU' });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
const calls = [];
let agentOnline = true; let polls = 0; let busyJob = false;
await page.route(/\/api\/admin\/ops/, async (route) => {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const body = req.postData() ? JSON.parse(req.postData()) : {};
  calls.push({ m: req.method(), p, body });
  const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (p === '/api/admin/ops' && req.method() === 'GET') return json(200, { enabled: true, agent: { online: agentOnline, lastSeen: new Date().toISOString(), runner: 'host-1' }, commands, jobs: busyJob ? [{ id: 'ops-aaaaaaaaaaaaaaaa', kind: 'deploy', label: 'Деплой', status: 'running', mutating: true, createdAt: new Date().toISOString() }] : [{ id: 'ops-bbbbbbbbbbbbbbbb', kind: 'status', label: 'Состояние служб', status: 'done', mutating: false, createdAt: new Date().toISOString(), note: 'готово' }] });
  if (p === '/api/admin/ops/step-up') return json(200, { ok: true, method: 'email' });
  if (p === '/api/admin/ops/jobs' && req.method() === 'POST') {
    if (['repair', 'deploy', 'build_apps', 'restart'].includes(body.kind) && body.stepUpCode !== '123456') return json(401, { error: 'step_up_invalid' });
    return json(201, { ok: true, id: 'ops-cccccccccccccccc', kind: body.kind, params: body.params });
  }
  if (/\/api\/admin\/ops\/jobs\/ops-[0-9a-f]{16}$/.test(p)) {
    polls++; const from = Number(url.searchParams.get('from') || 0); const full = '▶ Починить всё\n✔ docker работает\n✔ API отвечает\nГотово: проблем не осталось.\n';
    const done = polls >= 2; const text = done ? full : '▶ Починить всё\n';
    return json(200, { id: 'ops-cccccccccccccccc', label: 'Починить всё', status: done ? 'done' : 'running', output: text.slice(from), length: text.length });
  }
  return json(404, { error: 'not_found' });
});
await page.goto(BASE + '/guide', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const rm = await import('/node_modules/.vite/deps/react.js'); const React = rm.createElement ? rm : rm.default;
  const dm = await import('/node_modules/.vite/deps/react-dom_client.js'); const createRoot = dm.createRoot ?? dm.default.createRoot;
  const mod = await import('/src/admin/OpsTab.tsx');
  const el = document.createElement('div'); el.id = 'ops-root'; el.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#0f1115;padding:16px;color:#fff'; document.body.appendChild(el);
  window.__root = createRoot(el); window.__render = () => window.__root.render(React.createElement(mod.OpsTab));
});
await page.evaluate(() => window.__render());
await page.getByText('Агент на сервере на связи').waitFor({ timeout: 8000 });
ok('агент на связи показан', true);
for (const t of ['Починить всё', 'Деплой', 'Пересобрать приложения', 'Перезапустить', 'Консоль — вывод с сервера', 'Последние задания']) ok(`есть «${t}»`, (await page.getByText(t, { exact: false }).count()) > 0);
ok('история заданий показана', (await page.getByText('Состояние служб').count()) > 0);

/* «Починить всё»: код → запуск → вывод по мере появления */
await page.getByRole('button', { name: 'Починить', exact: true }).click();
await page.getByPlaceholder('Код').waitFor({ timeout: 4000 }).catch(async (e) => { console.log('CALLS', JSON.stringify(calls.slice(-4)), 'ERRS', errs.join('|')); console.log((await page.locator('#ops-root').innerText()).slice(0, 700)); throw e; });
ok('«Починить»: запрошен код подтверждения', calls.some((c) => c.p.endsWith('/step-up')));
const confirm = page.getByRole('button', { name: /Подтвердить и запустить/ });
ok('без кода запуск закрыт', await confirm.isDisabled());
await page.getByPlaceholder('Код').fill('000000'); await confirm.click(); await page.waitForTimeout(600);
ok('неверный код: задание не создано, окно кода осталось', (await page.getByPlaceholder('Код').count()) === 1 && calls.filter((c) => c.p.endsWith('/jobs') && c.m === 'POST').length === 1);
await page.getByPlaceholder('Код').fill('123456'); await confirm.click();
await page.getByText('Готово: проблем не осталось.').waitFor({ timeout: 10000 });
const post = calls.filter((c) => c.p.endsWith('/jobs') && c.m === 'POST').pop();
ok('отправлено: repair с кодом и галочкой снятия блокировок', post.body.kind === 'repair' && post.body.stepUpCode === '123456' && post.body.params.clearBlocks === true, JSON.stringify(post.body));
const out = await page.locator('pre[translate="no"]').innerText();
ok('вывод дописывается без дублей', (out.match(/▶ Починить всё/g) || []).length === 1 && out.includes('✔ API отвечает'), out);
ok('статус «готово» показан', (await page.getByText('готово', { exact: true }).count()) > 0);
ok('окно подтверждения закрылось', (await page.getByPlaceholder('Код').count()) === 0);

/* Деплой: галочка skipPull */
await page.getByRole('checkbox').nth(1).check();
await page.getByRole('button', { name: 'Выложить' }).click(); await page.getByPlaceholder('Код').fill('123456');
await page.getByRole('button', { name: /Подтвердить и запустить/ }).click(); await page.waitForTimeout(800);
const d = calls.filter((c) => c.p.endsWith('/jobs') && c.m === 'POST').pop();
ok('деплой: kind=deploy, skipPull=true', d.body.kind === 'deploy' && d.body.params.skipPull === true, JSON.stringify(d.body));

/* Сборка: выбор цели */
await page.getByRole('combobox').first().selectOption('apk').catch(() => {});
/* Консоль: чтение без кода */
polls = 0;
await page.getByRole('combobox').filter({ has: page.locator('option', { hasText: 'Журнал службы' }) }).selectOption({ label: 'Журнал службы' });
await page.getByRole('button', { name: 'Выполнить' }).click(); await page.waitForTimeout(800);
const rd = calls.filter((c) => c.p.endsWith('/jobs') && c.m === 'POST').pop();
ok('консоль: чтение запускается без кода', rd.body.kind === 'logs' && !('stepUpCode' in rd.body) && rd.body.params.service === 'api' && rd.body.params.lines === 200, JSON.stringify(rd.body));
ok('консоль: список только из чтения', (await page.locator('select option', { hasText: 'Деплой (забрать' }).count()) === 0);

/* Агент не отвечает → кнопки закрыты и показана установка */
agentOnline = false; await page.evaluate(() => { window.__root.unmount(); }); await page.evaluate(() => { document.getElementById('ops-root').remove(); });
await page.evaluate(async () => { const el = document.createElement('div'); el.id = 'ops-root'; el.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#0f1115;padding:16px;color:#fff'; document.body.appendChild(el); const rm = await import('/node_modules/.vite/deps/react.js'); const React = rm.createElement ? rm : rm.default; const dm = await import('/node_modules/.vite/deps/react-dom_client.js'); const createRoot = dm.createRoot ?? dm.default.createRoot; const mod = await import('/src/admin/OpsTab.tsx'); createRoot(el).render(React.createElement(mod.OpsTab)); });
await page.getByText('Агент на сервере не отвечает').waitFor({ timeout: 8000 });
ok('агента нет: кнопки заблокированы', await page.getByRole('button', { name: 'Починить', exact: true }).isDisabled() && await page.getByRole('button', { name: 'Выложить' }).isDisabled());
ok('агента нет: показана инструкция установки', (await page.getByText('install-ops.sh --genkey', { exact: false }).count()) > 0);
ok('нет ошибок в консоли страницы', errs.length === 0, errs.join(' | '));
await page.screenshot({ path: '/tmp/ops-tab.png', fullPage: false });
await browser.close();
