// Единый журнал: источники, поиск, права, секреты, цепочка, хранение, выгрузка, телеметрия.
// API: OWNER_USERNAME=slowner ADMIN_GATE=off; запускать с `. env.sh` (импортирует skylog напрямую).
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
import { scrub, logEvent, flushNow, sweepLogs, verifyChain } from '../../server/skylog.mjs';
import { closeDb } from '../../server/db.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- scrub
const sc = scrub({ password: 'x', token: 'y', apiKey: 'z', text: 'привет', message: 'секрет', address: 'ул', requisite: 'r', email_code: '123456', ok: 'fine', nested: { secret: 's', n: 1 }, list: [1, 2] });
t('scrub скрывает секреты и содержимое', sc.password === '[скрыто]' && sc.token === '[скрыто]' && sc.apiKey === '[скрыто]' && sc.text === '[скрыто]' && sc.message === '[скрыто]' && sc.address === '[скрыто]' && sc.requisite === '[скрыто]' && sc.email_code === '[скрыто]' && sc.nested.secret === '[скрыто]');
t('scrub сохраняет безопасное', sc.ok === 'fine' && sc.nested.n === 1 && sc.list.length === 2);
t('scrub ограничивает размер строки', scrub('a'.repeat(5000)).length === 300);

const A = await mkuser(S, 'slAdmin'); const U = await mkuser(S, 'slUser');
q(`update profiles set is_admin=true, admin_role='security_admin' where id='${A.pid}'`);
const get = (p, u) => call(p, {}, u.tok);
const tel = (events, u) => call('/api/telemetry', { method: 'POST', body: JSON.stringify({ events }) }, u?.tok);

let r = await call('/api/admin/logs', {}, U.tok);
t('обычному человеку журналы закрыты', r.status === 403);
r = await call('/api/telemetry', { method: 'POST', body: '{"events":[]}' }, null);
t('телеметрия без входа — 401', r.status === 401);

// --- источники
await flushNow(); await sleep(1500);
r = await get('/api/admin/logs?type=login&limit=50', A);
t('вход пишется в журнал (login)', r.status === 200 && r.data.items.some((e) => e.type === 'login' && e.category === 'user'), JSON.stringify(r.data.items?.slice(0, 2)));
const P = Date.now().toString(36);
await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email: `nobody${P}@example.com`, code: '000000' }) });
await sleep(1500);
r = await get('/api/admin/logs?type=login_code_failed&limit=20', A);
t('неверный код входа — security / denied', r.data.items.some((e) => e.category === 'security' && e.result === 'denied'), JSON.stringify(r.data.items?.slice(0, 1)));
t('в записи входа нет сырого кода и адреса', !JSON.stringify(r.data.items).includes('000000') && !JSON.stringify(r.data.items).includes(`nobody${P}`));
// действие администрации
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='slowner'`);
const OW = await mkuser(S, 'slOwn'); q(`update profiles set username='slowner' where id='${OW.pid}'`);
r = await call('/api/admin/upload-limits', { method: 'PUT', body: JSON.stringify({ scope: 'personal', kind: 'film', maxConcurrent: 3 }) }, OW.tok);
await sleep(1500);
r = await get('/api/admin/logs?category=admin&q=upload_limits', A);
t('действие администрации попало в журнал (admin)', r.data.items.some((e) => e.type === 'upload_limits' && e.audit === true), JSON.stringify(r.data.items?.slice(0, 1)));

// --- телеметрия
r = await tel([
  { type: 'js_error', level: 'ERROR', message: '=HYPERLINK("http://x","y")', route: '/chat/abcdefabcdefabcdefabcdef1234', appVersion: '1.2.3', platform: 'web' },
  { type: 'bad level', level: 'EVIL', message: 'x'.repeat(1000) },
  { type: 'x', level: 'DEBUG', message: 'debug не принимается' },
], U);
t('телеметрия принята', r.status === 202 && r.data.accepted === 3, JSON.stringify(r));
await sleep(1500);
r = await get('/api/admin/logs?category=client&limit=20', A);
const ev = r.data.items.find((e) => e.type === 'js_error');
t('клиентское событие в журнале, маршрут без идентификатора', !!ev && ev.detail.route === '/chat/:id' && ev.level === 'ERROR' && ev.actorId === U.pid, JSON.stringify(ev));
t('уровень и длина ограничены сервером', r.data.items.every((e) => ['INFO', 'WARN', 'ERROR', 'CRITICAL'].includes(e.level)) && r.data.items.every((e) => (e.reason ?? '').length <= 200));
let burst = 0; for (let i = 0; i < 14; i += 1) { const x = await tel([{ type: 'spam' }], U); if (x.status === 429) burst += 1; }
t('телеметрия ограничена по частоте', burst >= 1, burst);

// --- поиск и фильтры
r = await get('/api/admin/logs?category=client&level=ERROR&limit=1', A);
t('фильтры по категории и уровню + страница', r.status === 200 && r.data.items.length === 1 && r.data.next !== null);
const next = r.data.next;
r = await get(`/api/admin/logs?category=client&level=ERROR&limit=1&before=${next}`, A);
t('следующая страница по курсору', r.data.items.length === 1 && r.data.items[0].id < next);
r = await get(`/api/admin/logs?actor=${U.pid}&limit=50`, A);
t('поиск по человеку', r.data.items.length > 0 && r.data.items.every((e) => e.actorId === U.pid || e.targetId === U.pid));
r = await get("/api/admin/logs?type=' OR 1=1 --&limit=5", A);
t('SQL-инъекция в фильтре безвредна', r.status === 200 && r.data.items.length === 0);
r = await get('/api/admin/logs?minLevel=ERROR&limit=100', A);
t('minLevel: только ERROR и выше', r.data.items.every((e) => ['ERROR', 'CRITICAL'].includes(e.level)));
r = await get('/api/admin/logs/summary', A);
t('сводка: счётчики и состояние писателя', r.status === 200 && r.data.total > 0 && r.data.last24h.byCategory.client && r.data.writer.dropped === 0, JSON.stringify(r.data.writer));

// --- выгрузка
const csv = await fetch(`${B}/api/admin/logs/export?category=client&format=csv`, { headers: { authorization: `Bearer ${A.tok}` } });
const text = await csv.text();
t('CSV: заголовки и тип', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && text.includes('"js_error"'));
t("CSV: формула экранирована ('=HYPERLINK…)", text.includes(`"'=HYPERLINK`) && !text.includes(`,"=HYPERLINK`));
const js = await fetch(`${B}/api/admin/logs/export?format=json&category=client`, { headers: { authorization: `Bearer ${A.tok}` } });
t('JSON-выгрузка', js.status === 200 && Array.isArray(await js.json()));
t('выгрузка записана в журнал администрации', Number(q(`select count(*) from admin_log where type='logs_export'`)) >= 2);
const no = await fetch(`${B}/api/admin/logs/export`, { headers: { authorization: `Bearer ${U.tok}` } });
t('выгрузка недоступна без права', no.status === 403);

// --- цепочка
r = await call('/api/admin/logs/verify', { method: 'POST', body: '{}' }, A.tok);
t('цепочка аудиторских записей цела', r.status === 200 && r.data.ok === true && r.data.checked > 0, JSON.stringify(r.data));
const victim = q(`select event_id from sky_events where chain_seq is not null order by chain_seq desc limit 1 offset 1`);
const old = q(`select reason from sky_events where event_id='${victim}'`);
q(`update sky_events set reason='подделка' where event_id='${victim}'`);
r = await call('/api/admin/logs/verify', { method: 'POST', body: '{}' }, A.tok);
t('правка записи ломает цепочку и это видно', r.data.ok === false && r.data.why, JSON.stringify(r.data));
q(`update sky_events set reason='${old.replace(/'/g, "''")}' where event_id='${victim}'`);
r = await call('/api/admin/logs/verify', { method: 'POST', body: '{}' }, A.tok);
t('после восстановления цепочка снова цела', r.data.ok === true);

// --- настройки и хранение
r = await call('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify({ retentionDays: { admin: 30 } }) }, A.tok);
t('срок хранения аудита меньше 90 дней — отказ', r.status === 400 && r.data.error === 'audit_retention_min_90');
r = await call('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify({ retentionDays: { client: 7 }, debugMinutes: 30 }) }, A.tok);
t('срок хранения клиентских и временный DEBUG', r.status === 200 && r.data.settings.retentionDays.client === 7 && r.data.settings.debugUntil);
r = await call('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify({ debugMinutes: 99999 }) }, A.tok);
t('DEBUG не дольше суток', r.status === 400 && r.data.error === 'bad_debug');
await call('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify({ debugMinutes: 0 }) }, A.tok);
q(`insert into sky_events (event_id, at, category, level, type) values ('ev-old-${P}', now() - interval '20 days', 'client', 'ERROR', 'old_client_event')`);
q(`insert into sky_events (event_id, at, category, level, type) values ('ev-old-s-${P}', now() - interval '20 days', 'server', 'ERROR', 'old_server_event')`);
await sleep(31000); // кэш настроек 30 с
const removed = await sweepLogs();
t('уборка по срокам: старое клиентское удалено, серверное (60 дн.) осталось', Number(q(`select count(*) from sky_events where event_id='ev-old-${P}'`)) === 0 && Number(q(`select count(*) from sky_events where event_id='ev-old-s-${P}'`)) === 1 && removed >= 1, removed);
await call('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify({ retentionDays: { client: 30 } }) }, A.tok);
r = await call('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify({ telemetry: false }) }, A.tok); if (r.status !== 200) console.log('PUT telemetry', r.status, JSON.stringify(r.data));
r = await tel([{ type: 'off' }], U);
t('телеметрию можно выключить', r.status === 204, r.status);
await call('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify({ telemetry: true }) }, A.tok);

// --- устойчивость: запись не бросает и не ждёт
const t0 = Date.now(); for (let i = 0; i < 2000; i += 1) logEvent({ category: 'server', type: 'load_test', detail: { i } }); const dt = Date.now() - t0;
t('2000 записей не блокируют поток (<200 мс)', dt < 200, dt);
await flushNow();
t('все записи нагрузки дошли до базы', Number(q(`select count(*) from sky_events where type='load_test'`)) >= 2000);
logEvent({ category: 'nonsense', type: 'x' }); logEvent(null);
t('мусорные вызовы не бросают исключений', true);
q(`delete from sky_events where type='load_test'`);
await closeDb().catch(() => {});
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
