// Обнаружение утечек и самозащита (server/selfdefense.mjs, leakdetect.mjs, routes/defense.mjs, scripts/sky-guard.sh).
// API: OWNER_USERNAME=defowner ADMIN_GATE=off GUARD_SECRET=guard-secret-0123456789abcdef EMAIL_MODE=log DOMAIN=sky.test
//   (. env.sh; GUARD_SECRET=guard-secret-0123456789abcdef node scripts/audit/defense-test.mjs <каталог с api.log>)
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2]; const KEY = process.env.GUARD_SECRET;
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const as = (ip) => ({ 'x-real-ip': ip });
const mails = () => readFileSync(S + '/api.log', 'utf8');
const lastLink = () => { const m = [...mails().matchAll(/defense-undo\?t=([A-Za-z0-9_-]+)/g)]; return m.length ? m[m.length - 1][1] : null; };

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='defowner'`);
const own = await mkuser(S, 'defOwn'); q(`update profiles set username='defowner' where id='${own.pid}'`);
const secret = generateSecret();
q(`update sky_ids set two_factor_enabled=true, two_factor_secret='${encryptSecret(secret)}' where id=(select sky_id from profiles where id='${own.pid}')`);
const adm = await mkuser(S, 'defAdm'); const usr = await mkuser(S, 'defUsr'); const vic = await mkuser(S, 'defVic');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm.pid}'`);
q(`delete from defense_ip_blocks`); q(`update defense_level set level=0, until=null, lockdown_by_us=false`); q(`update admin_lockdown set active=false`);
q(`delete from defense_canaries`); q(`update defense_guard set last_seen=null`); q(`delete from defense_incidents`); q(`delete from leak_events`); q(`delete from defense_host_cmds`);
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) });

// ── доступ
t('человек не видит самозащиту', (await call('/api/admin/defense', {}, usr.tok)).status === 403);
t('администратор видит обзор', (await call('/api/admin/defense', {}, adm.tok)).status === 200);
let r = await call('/api/admin/defense', {}, own.tok); if (!r.data.level) console.log(r.status, JSON.stringify(r.data));
t('обзор: уровень 0, настройки, сторож не на связи', r.data.level.level === 0 && r.data.settings.enabled && !r.data.guard.alive, JSON.stringify(r.data.level));
t('администратор не меняет настройки', (await call('/api/admin/defense/settings', { method: 'PUT', body: '{}' }, adm.tok)).status === 403);
const stepUp = async () => { const s = await call('/api/admin/defense/step-up', J({}), own.tok); return currentTotp(secret); };

// ── приманка
await call('/api/admin/defense/step-up', J({}), own.tok);
r = await call('/api/admin/defense/canaries', J({ label: 'Ключ в старом репозитории', hint: 'тест', stepUpCode: currentTotp(secret) }), own.tok);
t('приманка создана, токен показан один раз', r.status === 200 && /^skc_/.test(r.data.token ?? ''), JSON.stringify(r.data));
const canary = r.data.token;
const att = '198.51.100.23';
r = await call(`/api/platform/status?k=${canary}`, {}, null, as(att));
t('запрос с приманкой отбит', r.status === 403 && r.data.error === 'defense_blocked', JSON.stringify(r.data));
await sleep(600);
t('следующий запрос с адреса злоумышленника отбит', (await call('/api/platform/status', {}, null, as(att))).status === 403);
t('другой адрес не задет', (await call('/api/platform/status', {}, null, as('198.51.100.99'))).status === 200);
r = await call('/api/admin/defense', {}, own.tok);
t('уровень 3 включён и панель закрыта для не-владельца', r.data.level.level === 3 && [401, 403].includes((await call('/api/admin/defense', {}, adm.tok)).status), JSON.stringify(r.data.level));
t('владелец в закрытой панели работает', r.status === 200);
const inc = r.data.incidents.find((i) => /приманк/i.test(i.title));
t('инцидент создан', Boolean(inc), JSON.stringify(r.data.incidents.map((i) => i.title)));
const det = (await call(`/api/admin/defense/incidents/${inc.id}`, {}, own.tok)).data;
const kinds = det.actions.map((a) => `${a.kind}:${a.status}`);
t('действия: блок адреса и уровень выполнены, ключ — ждёт сторожа (пропущено)', kinds.includes('block_ip:done') && kinds.includes('raise_level:done') && kinds.includes('host_rotate_jwt:skipped'), kinds.join());
t('число срабатываний приманки учтено', Number(q(`select hits from defense_canaries where label like 'Ключ в старом%'`)) >= 1);
t('письмо владельцу со ссылкой отмены', Boolean(lastLink()) && /Sky: сработала самозащита/.test(mails()));

// ── отмена по ссылке: нужен код аутентификатора
let link = lastLink();
r = await call(`/api/defense/undo/info?t=${link}`);
t('страница отмены показывает инцидент и действия', r.status === 200 && r.data.actions.length >= 2, JSON.stringify(r.data).slice(0, 120));
t('мусорная ссылка → 404', (await call('/api/defense/undo/info?t=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).status === 404);
r = await call('/api/defense/undo/confirm', J({ t: link, code: '000000' }));
t('неверный код отклонён', r.status === 401, JSON.stringify(r.data));
t('адрес всё ещё заблокирован', (await call('/api/platform/status', {}, null, as(att))).status === 403);
for (let i = 0; i < 5; i++) r = await call('/api/defense/undo/confirm', J({ t: link, code: '111111' }));
t('после 5 неверных кодов — блокировка ссылки', r.status === 429, JSON.stringify(r.data));
r = await call('/api/defense/undo/confirm', J({ t: link, code: currentTotp(secret) }));
t('при блокировке даже верный код не принимается', r.status === 429);
q(`update defense_undo_links set locked_until=null, attempts=0`);
r = await call('/api/defense/undo/confirm', J({ t: link, code: currentTotp(secret), falseAlarm: true }));
t('верный код: всё отменено', r.status === 200 && r.data.results.every((x) => x.ok || x.error === 'not_active'), JSON.stringify(r.data));
await sleep(300);
t('адрес снова свободен', (await call('/api/platform/status', {}, null, as(att))).status === 200);
r = await call('/api/admin/defense', {}, own.tok);
t('уровень вернулся в 0, панель открыта', r.data.level.level === 0 && q(`select active from admin_lockdown`) === 'f', JSON.stringify(r.data.level));
t('инцидент закрыт как отменённый', r.data.incidents.find((i) => i.id === inc.id)?.status === 'cancelled');
t('событие помечено ложной тревогой', q(`select status from leak_events where incident_id='${inc.id}' limit 1`) === 'false_positive');

// ── сканирование
for (let i = 0; i < 125; i++) await call(`/api/nope-${i}`, {}, null, as('198.51.100.40'));
await sleep(600);
t('сканирование (поток 4xx) → упреждающая блокировка', (await call('/api/platform/status', {}, null, as('198.51.100.40'))).status === 403);

// ── выгрузки и замораживание аккаунта (пониженные пороги)
await call('/api/admin/defense/step-up', J({}), own.tok);
await sleep(1100);
r = await call('/api/admin/defense/settings', { method: 'PUT', body: JSON.stringify({ stepUpCode: currentTotp(secret), settings: { thresholds: { reqPerMin: 40, exports10min: 5, adminActions10min: 3 } } }) }, own.tok);
t('настройки сохраняются владельцем (код обязателен)', r.status === 200 && r.data.settings.thresholds.reqPerMin === 40, JSON.stringify(r.data).slice(0, 150));
r = await call('/api/admin/defense/settings', { method: 'PUT', body: JSON.stringify({ settings: { mode: 'auto' } }) }, own.tok);
t('без кода настройки не меняются', r.status === 401 || r.status === 400, String(r.status));
await sleep(11000);   // кэш настроек
const hipIp = '198.51.100.55';
for (let i = 0; i < 8; i++) await call('/api/directory/people', {}, vic.tok, as(hipIp));
await sleep(800);
t('частые обращения к спискам людей → аккаунт заморожен', q(`select count(*) from sky_ids where blocked_reason like 'defense:%'`) !== '0', q(`select kind||severity from leak_events order by created_at desc limit 3`));
t('адрес нарушителя заблокирован', (await call('/api/platform/status', {}, null, as(hipIp))).status === 403);
q(`update sky_ids set blocked_until=null, blocked_reason='' where blocked_reason like 'defense:%'`);
for (let i = 0; i < 50; i++) await call('/api/skyid/profiles', {}, usr.tok, as('198.51.100.60'));
await sleep(600);
t('просто частые запросы → только повышенный уровень, без блокировок', Number(q(`select count(*) from leak_events where kind='mass_export' and subject like 'profile:${usr.pid}'`)) >= 1 && (await call('/api/platform/status', {}, null, as('198.51.100.60'))).status === 200);

// ── владелец неприкосновенен
for (let i = 0; i < 60; i++) await call('/api/skyid/profiles', {}, own.tok, as('198.51.100.77'));
await sleep(600);
t('владелец не замораживается и не блокируется', q(`select count(*) from sky_ids s join profiles p on p.sky_id=s.id where p.id='${own.pid}' and s.blocked_reason like 'defense:%'`) === '0' && (await call('/api/platform/status', {}, null, as('198.51.100.77'))).status === 200);

// ── администратор: всплеск действий
for (let i = 0; i < 6; i++) await call('/api/admin/modules/music', { method: 'PUT', body: JSON.stringify({ closed: false }) }, adm.tok);
await sleep(900);
t('всплеск действий администратора → тревога', Number(q(`select count(*) from leak_events where kind='admin_anomaly'`)) >= 1);

// ── учение
r = await call('/api/admin/defense/drill', J({}), own.tok);
t('учение: инцидент без реальных действий', r.status === 200 && q(`select count(*) from defense_actions where status='simulated'`) !== '0' && q(`select count(*) from defense_actions a join defense_incidents i on i.id=a.incident_id where i.mode='drill' and a.status='done'`) === '0', JSON.stringify(r.data));
t('учебное письмо помечено', /\[УЧЕНИЕ\]/.test(mails()));

// ── сторож хоста: подпись
const sign = (method, path, body, ts = Math.floor(Date.now() / 1000), key = KEY) => ({ 'x-guard-ts': String(ts), 'x-guard-sig': crypto.createHmac('sha256', key).update(`${ts}\n${method}\n${path}\n${crypto.createHash('sha256').update(body).digest('hex')}`).digest('hex') });
const rep = JSON.stringify({ version: '1', host: 't', ok: true, findings: [] });
t('отчёт сторожа без подписи → 403', (await call('/api/guard/report', { method: 'POST', body: rep })).status === 403);
t('чужая подпись → 403', (await call('/api/guard/report', { method: 'POST', body: rep, headers: sign('POST', '/api/guard/report', rep, undefined, 'wrong-secret-0123456789abcdef') })).status === 403);
t('старое время → 403', (await call('/api/guard/report', { method: 'POST', body: rep, headers: sign('POST', '/api/guard/report', rep, Math.floor(Date.now() / 1000) - 600) })).status === 403);
t('верная подпись принята', (await call('/api/guard/report', { method: 'POST', body: rep, headers: sign('POST', '/api/guard/report', rep) })).status === 200);
r = await call('/api/admin/defense', {}, own.tok);
t('сторож на связи', r.data.guard.alive === true);

// ── сторож хоста: настоящий скрипт в песочнице (без docker)
const dir = mkdtempSync(join(tmpdir(), 'guard-')); const app = join(dir, 'app'); const st = join(dir, 'state');
mkdirSync(join(app, 'nginx'), { recursive: true }); mkdirSync(join(app, 'scripts'), { recursive: true });
writeFileSync(join(app, 'docker-compose.yml'), 'services: {}\n'); writeFileSync(join(app, 'nginx/a.conf'), 'ok\n'); writeFileSync(join(app, 'scripts/x.sh'), 'echo 1\n');
writeFileSync(join(app, '.env'), `GUARD_SECRET=${KEY}\nAPI_IMAGE=v1\nJWT_SECRET=old-jwt\n`, { mode: 0o600 });
const env = { ...process.env, APP_DIR: app, GUARD_STATE: st, GUARD_LOG: join(dir, 'g.log'), GUARD_API: B, PATH: process.env.PATH };
const sh = (...a) => spawnSync('bash', ['scripts/sky-guard.sh', ...a], { env, encoding: 'utf8' });
sh('--baseline'); r = sh('--once');
t('сторож: без изменений — тихо', r.status === 0 && Number(q(`select count(*) from leak_events where kind='integrity'`)) === 0, r.stderr);
writeFileSync(join(app, 'nginx/a.conf'), 'EVIL\n');
sh('--once'); await sleep(700);
t('сторож: правка конфигурации → тревога и инцидент', Number(q(`select count(*) from leak_events where kind='integrity' and detail->>'code'='files'`)) === 1, readFileSync(join(dir, 'g.log'), 'utf8'));
t('поставлены команды хосту (восстановить код, пересоздать)', Number(q(`select count(*) from defense_host_cmds where kind in ('restore_code','recreate_containers')`)) === 2);
sh('--once'); await sleep(500);
t('сторож вернул файл из эталона', readFileSync(join(app, 'nginx/a.conf'), 'utf8') === 'ok\n');
t('результат команды доложен', Number(q(`select count(*) from defense_host_cmds where kind='restore_code' and status='done'`)) === 1);
writeFileSync(join(app, '.env'), `GUARD_SECRET=${KEY}\nAPI_IMAGE=v2\nJWT_SECRET=old-jwt\n`, { mode: 0o600 });
writeFileSync(join(app, 'nginx/a.conf'), 'new-release\n');
const before = q(`select count(*) from leak_events where kind='integrity'`); sh('--once'); await sleep(400);
t('смена версии образа = законный деплой, не тревога', q(`select count(*) from leak_events where kind='integrity'`) === before);

// ── целостность кода приложения
r = await call('/api/admin/defense/integrity/check', J({}), own.tok); t('проверка целостности доступна и код не изменён', r.status === 200 && !r.data.changed, JSON.stringify(r.data));

// ── уборка
q(`delete from defense_ip_blocks`); q(`update defense_level set level=0, until=null, lockdown_by_us=false`); q(`update admin_lockdown set active=false`);
await sleep(11000); await call('/api/admin/defense/step-up', J({}), own.tok); await sleep(1100);
await call('/api/admin/defense/settings', { method: 'PUT', body: JSON.stringify({ stepUpCode: currentTotp(secret), settings: { thresholds: { reqPerMin: 900, adminActions10min: 30 } } }) }, own.tok);
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
