// Sky Resource Optimizer: режимы и гистерезис (чистая функция), API админки, права, step-up, журнал; при RESOURCE_FORCE_LEVEL=3 — шлюз тяжёлых загрузок.
//   node scripts/audit/resourceopt-test.mjs <каталог с api.log> [critical]
//   API: OWNER_USERNAME=ownertest ADMIN_GATE=off   (для фазы critical — ещё RESOURCE_FORCE_LEVEL=3; режим подтягивается за ~2 с)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; const PHASE = process.argv[3] ?? 'normal';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const put = (p, b, u) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };

if (PHASE === 'normal') {
  /* ── гистерезис ── */
  process.env.DATABASE_URL ??= 'postgres://sky:sky@127.0.0.1:5432/sky';
  const { nextLevel } = await import('../../server/resourceopt.mjs');
  let st = { level: 0, up: 0, down: 0 };
  let n = nextLevel(st, 2); t('один высокий замер не переключает режим', !n.changed && n.up === 1);
  st = { level: 0, ...n }; n = nextLevel(st, 2); t('два высоких замера подряд — повышение сразу до цели', n.changed && n.level === 2);
  st = { level: 0, up: 1, down: 0 }; n = nextLevel(st, 0); t('спокойный замер между высокими сбрасывает счётчик', !n.changed && n.up === 0);
  st = { level: 2, up: 0, down: 0 }; let ch = 0; for (let i = 0; i < 7; i++) { n = nextLevel(st, 0); if (n.changed) ch++; st = { level: n.level, up: n.up, down: n.down }; }
  t('7 спокойных замеров режим ещё не понижают', ch === 0 && st.level === 2);
  n = nextLevel(st, 0); t('8-й спокойный — понижение на ОДНУ ступень', n.changed && n.level === 1);
  st = { level: 3, up: 0, down: 0 }; for (let i = 0; i < 8; i++) { n = nextLevel(st, 1); st = { level: n.level, up: n.up, down: n.down }; }
  t('из critical вниз только ступенями (3→2)', st.level === 2);
  st = { level: 1, up: 0, down: 5 }; n = nextLevel(st, 1); t('при равенстве счётчики сбрасываются (нет дребезга)', !n.changed && n.up === 0 && n.down === 0);

  /* ── API ── */
  q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
  const OWN = await mkuser(S, 'resown'); q(`update profiles set username='ownertest' where id='${OWN.pid}'`);
  const USR = await mkuser(S, 'resusr');
  t('обычный человек не видит раздел', (await call('/api/admin/resources', {}, USR.tok)).status === 403);
  let r = await call('/api/admin/resources', {}, OWN.tok);
  t('владелец видит сводку', r.status === 200 && r.data.mode && r.data.settings && r.data.now && r.data.database && Array.isArray(r.data.events), JSON.stringify(r.data).slice(0, 200));
  t('в сводке нет секретов (ключи, пароли, токены)', !/secret|password|api[_-]?key|authorization/i.test(JSON.stringify({ ...r.data, events: [], containers: '' })));
  t('режим по умолчанию — обычный', r.data.mode === 'normal');
  t('canEdit у владельца', r.data.canEdit === true);
  r = await put('/api/admin/resources/settings', { settings: { maxHeavyParallel: 3 } }, OWN);
  t('настройки без подтверждения личности отклонены', r.status === 401, r.status);
  const step = async () => { q(`update admin_step_up set used_at = now() where actor_id='${OWN.pid}' and used_at is null`); await post('/api/admin/resources/step-up', {}, OWN); await sleep(1300); return codeOf(OWN.email); };
  r = await put('/api/admin/resources/settings', { settings: { maxHeavyParallel: 3, economy: true }, stepUpCode: await step() }, OWN);
  t('владелец меняет настройки', r.status === 200 && r.data.settings.maxHeavyParallel === 3 && r.data.settings.economy === true, JSON.stringify(r.data));
  r = await put('/api/admin/resources/settings', { settings: { maxHeavyParallel: 999 }, stepUpCode: await step() }, OWN);
  t('значение вне диапазона отклоняется', r.status === 400 && r.data.field === 'maxHeavyParallel', JSON.stringify(r.data));
  r = await put('/api/admin/resources/settings', { settings: { highLoadPerCore: 300, criticalLoadPerCore: 100 }, stepUpCode: await step() }, OWN);
  t('порог «высокая» не может быть выше «критической»', r.status === 400, JSON.stringify(r.data));
  t('изменение записано в журнал администрации', Number(q(`select count(*) from admin_log where type='resource_settings'`)) >= 1);
  r = await call('/api/admin/resources', {}, OWN.tok);
  t('в истории есть запись о настройках', r.data.events.some((e) => e.kind === 'settings'));
  r = await put('/api/admin/resources/settings', { settings: { economy: false }, stepUpCode: await step() }, OWN);
  t('экономию можно выключить обратно', r.status === 200 && r.data.settings.economy === false);
  r = await post('/api/admin/resources/disk-scan', {}, OWN);
  t('подсчёт места по категориям', r.status === 200 && Array.isArray(r.data.categories) && r.data.categories.some((c) => c.label === 'База данных'), JSON.stringify(r.data).slice(0, 200));
  r = await call('/api/admin/resources', {}, OWN.tok);
  t('медленные запросы — только форма, без значений', r.data.slowQueries.every((x) => !/@|password|token/i.test(x.sql)));
  t('обычная загрузка при нормальной нагрузке не блокируется шлюзом', (await post('/api/film/upload', {}, OWN)).data?.error !== 'busy_heavy');
} else {
  const OWN = await mkuser(S, 'resown2');
  await sleep(3500);
  t('принудительный режим критической нагрузки включился и записан в историю', Number(q(`select count(*) from resource_events where kind='mode' and mode='critical' and ts > now() - interval '2 minutes'`)) >= 1);
  // Тяжёлая загрузка (не JSON) отклоняется понятной ошибкой.
  const up = await fetch('http://127.0.0.1:8080/api/film/upload', { method: 'POST', headers: { authorization: `Bearer ${OWN.tok}`, 'content-type': 'application/octet-stream' }, body: 'x' });
  const d = await up.json().catch(() => ({}));
  t('при critical большая загрузка отклонена: 503 busy_heavy + Retry-After', up.status === 503 && d.error === 'busy_heavy' && up.headers.get('retry-after') === '60', `${up.status} ${JSON.stringify(d)}`);
  t('сообщение понятное человеку', /загрузк/i.test(d.message ?? ''));
  t('владельцу ушло уведомление о критической нагрузке', Number(q(`select count(*) from gift_notifications where kind='security' and title like 'Sky: Критическая%' and created_at > now() - interval '3 minutes'`)) >= 1 || !q(`select 1 from profiles where lower(username)='ownertest' limit 1`));
  const chat = await call('/api/skyid/profiles', {}, OWN.tok);
  t('обычные запросы (чтение, вход) при critical работают', chat.status === 200, chat.status);
  const login = await call('/api/platform/status');
  t('статус платформы отвечает', login.status === 200);
  const json = await call('/api/film/upload', { method: 'POST', body: '{}' }, OWN.tok);
  t('JSON-запросы к тому же разделу шлюзом не блокируются', json.data?.error !== 'busy_heavy', JSON.stringify(json.data));
}
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
