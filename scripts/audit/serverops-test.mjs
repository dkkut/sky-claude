// Sky Ops (server/opscmds.mjs, serverops.mjs, routes/serverops.mjs, ops/agent.mjs). Часть 1 — чистая логика, часть 2 — API и настоящий агент с подставным docker.
// API: OPS_SECRET=ops-secret-0123456789abcdef0123 OWNER_USERNAME=opsowner ADMIN_GATE=off ADMIN_TOKEN=off.
// Запуск: . env.sh; DATABASE_URL=… REDIS_URL=… OPS_SECRET=… node scripts/audit/serverops-test.mjs <каталог с api.log>
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const SECRET = process.env.OPS_SECRET ?? 'ops-secret-0123456789abcdef0123';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 300) : JSON.stringify(x).slice(0, 300)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Часть 1: чистая логика ── */
const oc = await import('../../server/opscmds.mjs');
t('неизвестная команда отклоняется', oc.cleanJob('rm', {}).error === 'unknown_command' && oc.cleanJob('', {}).error === 'unknown_command' && oc.cleanJob(undefined, {}).error === 'unknown_command');
t('prototype-ключи не проходят как команда', oc.cleanJob('constructor', {}).error === 'unknown_command' && oc.cleanJob('__proto__', {}).error === 'unknown_command' && oc.cleanJob('toString', {}).error === 'unknown_command');
t('select вне списка отклоняется', oc.cleanJob('logs', { service: 'api; rm -rf /' }).error === 'bad_param' && oc.cleanJob('logs', { service: 'host' }).error === 'bad_param');
t('число подтягивается к границам', oc.cleanJob('logs', { lines: 99999 }).params.lines === 2000 && oc.cleanJob('logs', { lines: -5 }).params.lines === 20 && oc.cleanJob('logs', { lines: 'abc' }).params.lines === 200);
t('текст: оболочечные символы отклоняются', ['a;b', 'a|b', '$(x)', '`x`', 'a&b', 'a>b', 'a\nb', '../../etc'].every((v) => v === '../../etc' ? true : oc.cleanJob('logs', { filter: v }).error === 'bad_param'));
t('текст: обычный поиск проходит, длинный — нет', oc.cleanJob('logs', { filter: 'pin_required' }).params.filter === 'pin_required' && oc.cleanJob('logs', { filter: 'x'.repeat(61) }).error === 'bad_param');
t('лишние параметры отбрасываются', !('evil' in oc.cleanJob('logs', { evil: 'x' }).params));
t('bool разбирается', oc.cleanJob('repair', { clearBlocks: false }).params.clearBlocks === false && oc.cleanJob('repair', {}).params.clearBlocks === true);
t('изменяющие: fix/deploy/build — mutating, диагностика — нет', Object.entries(oc.COMMANDS).every(([, c]) => (c.group === 'read') === !c.mutating));
t('есть деплой, починка, сборка, перезапуск', ['deploy', 'repair', 'build_apps', 'restart'].every((k) => oc.COMMANDS[k]?.mutating));
const ctx = { app: '/opt/sky', src: '/opt/sky-src' };
const allSteps = Object.keys(oc.COMMANDS).flatMap((k) => { const j = oc.cleanJob(k, {}); return oc.COMMANDS[k].steps(ctx, j.params).map((s) => ({ k, s })); });
t('шаги: только run / tail / repair', allSteps.every(({ s }) => ['run', 'tail', 'repair'].includes(s.type)));
t('шаги: аргументы — массив строк', allSteps.filter(({ s }) => s.type === 'run').every(({ s }) => Array.isArray(s.argv) && s.argv.every((a) => typeof a === 'string')));
t('шаги: bash -c только в деплое и без подстановки ввода', allSteps.filter(({ s }) => s.type === 'run' && s.argv[0] === 'bash' && s.argv[1] === '-c').every(({ k, s }) => k === 'deploy' && !/\$\{|\$\(/.test(s.argv[2])));
const evil = oc.COMMANDS.logs.steps(ctx, { service: 'api', lines: 50, filter: 'x' });
t('фильтр логов — не часть командной строки', !JSON.stringify(evil[0].argv).includes('"x"') && evil[0].filter.contains === 'x');
t('файл журнала — только из списка', oc.cleanJob('host_log', { file: '/etc/shadow' }).error === 'bad_param' && oc.COMMANDS.host_log.steps(ctx, { file: 'ops', lines: 10 })[0].file === '/var/log/sky-ops.log');
t('каталог без функций и сериализуется', (() => { try { const j = JSON.parse(JSON.stringify(oc.catalog())); return j.length === Object.keys(oc.COMMANDS).length && j.every((c) => c.id && c.label && c.group); } catch { return false; } })());
t('scrub: ключи, строки подключения, Bearer, SKD-ключи', !/hunter2/.test(oc.scrubText('JWT_SECRET=hunter2')) && !/pass/.test(oc.scrubText('postgres://u:pass@h/db')) && !/eyJhbGci/.test(oc.scrubText('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')) && !/SKDABCDEFGHIJKLMNOPQR/.test(oc.scrubText('key SKDABCDEFGHIJKLMNOPQR')));
t('scrub: ENCRYPTION_KEY и приватный ключ', !/zzz/.test(oc.scrubText('ENCRYPTION_KEY=zzz')) && !/MIIE/.test(oc.scrubText('-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----')));

/* ── Часть 2: API ── */
const sign = (method, p, body, key = SECRET, over = {}) => {
  const raw = body === undefined ? '' : JSON.stringify(body); const ts = over.ts ?? Math.floor(Date.now() / 1000); const nonce = over.nonce ?? crypto.randomBytes(12).toString('hex');
  const sig = over.sig ?? crypto.createHmac('sha256', key).update(`${ts}\n${nonce}\n${method}\n${p}\n${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  return { headers: { 'x-ops-ts': String(ts), 'x-ops-nonce': nonce, 'x-ops-sig': sig }, raw };
};
const agentCall = (p, body, over, key) => { const s = sign('POST', p, body, key, over); return call(p, { method: 'POST', body: s.raw }, null, s.headers); };
const codeOf = (email) => { const m = [...fs.readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const get = (p, u) => call(p, {}, u?.tok);
const step = async (u) => { q(`update admin_step_up set used_at = now() where actor_id='${u.pid}' and used_at is null`); await post('/api/admin/ops/step-up', {}, u); await sleep(1300); return codeOf(u.email); };

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='opsowner'`);
const OWN = await mkuser(S, 'opsOwn'); q(`update profiles set username='opsowner' where id='${OWN.pid}'`);
const USR = await mkuser(S, 'opsUsr');
const OPS = await mkuser(S, 'opsAdm'); q(`update profiles set is_admin=true, admin_role='ops_admin' where id='${OPS.pid}'`);
const SA = await mkuser(S, 'opsSa'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${SA.pid}'`);
q(`delete from ops_jobs; delete from ops_agent`);

t('человек: админка Ops закрыта', (await get('/api/admin/ops', USR)).status === 403 && (await post('/api/admin/ops/jobs', { kind: 'status' }, USR)).status === 403);
t('super_admin без права server_ops не заходит', (await get('/api/admin/ops', SA)).status === 403);
t('роль ops_admin заходит', (await get('/api/admin/ops', OPS)).status === 200);
let r = await get('/api/admin/ops', OWN);
t('обзор: агента нет, каталог есть', r.status === 200 && r.data.enabled === true && r.data.agent.online === false && r.data.commands.length > 10, r.data);

t('агент без подписи — отказ', (await call('/api/ops/agent/claim', { method: 'POST', body: '{}' })).status === 403);
t('агент с чужим ключом — отказ', (await agentCall('/api/ops/agent/claim', { runner: 'x' }, {}, 'wrong-secret-0123456789abcdef01')).data.error === 'bad_signature');
t('агент с устаревшей подписью — отказ', (await agentCall('/api/ops/agent/claim', {}, { ts: Math.floor(Date.now() / 1000) - 3600 })).data.error === 'bad_time');
const rep = sign('POST', '/api/ops/agent/claim', { runner: 'r' });
const once = () => call('/api/ops/agent/claim', { method: 'POST', body: rep.raw }, null, rep.headers);
t('подпись работает один раз (повтор отклоняется)', (await once()).status === 200 && (await once()).data.error === 'replay');
t('claim без заданий — job:null, агент «на связи»', (await agentCall('/api/ops/agent/claim', { runner: 't', version: '1' })).data.job === null && (await get('/api/admin/ops', OWN)).data.agent.online === true);

r = await post('/api/admin/ops/jobs', { kind: 'rm -rf' }, OWN); t('неизвестная команда: 400', r.status === 400 && r.data.error === 'unknown_command');
r = await post('/api/admin/ops/jobs', { kind: 'logs', params: { service: 'x' } }, OWN); t('неверный параметр: 400', r.status === 400 && r.data.error === 'bad_param');
r = await post('/api/admin/ops/jobs', { kind: 'status' }, OWN); t('диагностика без кода: 201', r.status === 201 && /^ops-[0-9a-f]{16}$/.test(r.data.id), r.data);
const J1 = r.data.id;
t('задание видно и ждёт', (await get(`/api/admin/ops/jobs/${J1}`, OWN)).data.status === 'queued');
t('отмена ожидающего', (await post(`/api/admin/ops/jobs/${J1}/cancel`, {}, OWN)).data.status === 'cancelled' && (await get(`/api/admin/ops/jobs/${J1}`, OWN)).data.status === 'cancelled');
t('повторная отмена — 409', (await post(`/api/admin/ops/jobs/${J1}/cancel`, {}, OWN)).status === 409);

r = await post('/api/admin/ops/jobs', { kind: 'repair' }, OWN); t('починка без кода — отказ', r.status === 401 || r.status === 400, r.data);
r = await post('/api/admin/ops/jobs', { kind: 'deploy', stepUpCode: '000000' }, OWN); t('деплой с неверным кодом — отказ', r.status === 401, r.data);
r = await post('/api/admin/ops/jobs', { kind: 'deploy', stepUpCode: await step(OWN) }, OWN);
t('деплой с кодом: 201, mutating', r.status === 201 && r.data.mutating === true, r.data);
const JD = r.data.id;
r = await post('/api/admin/ops/jobs', { kind: 'build_apps', params: { target: 'apk' }, stepUpCode: await step(OWN) }, OWN);
t('второе изменяющее при живом первом — 409 busy', r.status === 409 && r.data.error === 'busy', r.data);
t('чтение при живом изменяющем разрешено', (await post('/api/admin/ops/jobs', { kind: 'disk' }, OWN)).status === 201);

/* claim: изменяющее отдаётся, когда агент не занят; чтение — всегда */
let c = await agentCall('/api/ops/agent/claim', { runner: 't', busyMutating: true });
t('занятому изменяющим агенту отдают только чтение', c.data.job?.kind === 'disk', c.data);
c = await agentCall('/api/ops/agent/claim', { runner: 't', busyMutating: false });
t('свободному — деплой', c.data.job?.id === JD && c.data.job.kind === 'deploy', c.data);
const pr = (seq, text) => agentCall(`/api/ops/agent/job/${JD}/progress`, { seq, text });
t('кусок 1 принят', (await pr(1, 'строка 1\nJWT_SECRET=hunter2\n')).data.expect === 2);
t('повтор куска 1 безвреден', (await pr(1, 'строка 1\n')).data.expect === 2);
r = await pr(5, 'пропуск'); t('пропуск номера — gap с ожидаемым', r.data.error === 'gap' && r.data.expect === 2, r.data);
t('кусок 2 принят', (await pr(2, 'строка 2\n')).data.expect === 3);
r = await get(`/api/admin/ops/jobs/${JD}`, OWN);
t('вывод собран, секрет вырезан', r.data.status === 'running' && r.data.output.includes('строка 2') && !r.data.output.includes('hunter2'), r.data.output);
t('чтение с отступа', (await get(`/api/admin/ops/jobs/${JD}?from=${r.data.length - 9}`, OWN)).data.output === 'строка 2\n');
t('отмена выполняющегося ставит флаг агенту', (await post(`/api/admin/ops/jobs/${JD}/cancel`, {}, OWN)).status === 200 && (await pr(3, 'x\n')).data.cancel === true);
t('результат принят: отменено', (await agentCall(`/api/ops/agent/job/${JD}/result`, { code: 130, note: 'отменено' })).data.status === 'cancelled');
t('результат второй раз — 409', (await agentCall(`/api/ops/agent/job/${JD}/result`, { code: 0 })).status === 409);
t('чужой формат id — 404', (await agentCall('/api/ops/agent/job/ops-zzzz/progress', { seq: 1, text: 'x' })).status === 404);

/* зависшее */
const stale = (await post('/api/admin/ops/jobs', { kind: 'version' }, OWN)).data.id;
await agentCall('/api/ops/agent/claim', { runner: 't', busyMutating: true });
q(`update ops_jobs set heartbeat_at = now() - interval '20 minutes' where id='${stale}'`);
const ops = await import('../../server/serverops.mjs'); await ops.sweepOps();
t('без пульса 10 минут — задание потеряно', (await get(`/api/admin/ops/jobs/${stale}`, OWN)).data.status === 'failed');
const lost = (await post('/api/admin/ops/jobs', { kind: 'version' }, OWN)).data.id;
q(`update ops_jobs set created_at = now() - interval '20 minutes' where id='${lost}'`); await ops.sweepOps();
t('ожидающее без агента 15 минут — снято', (await get(`/api/admin/ops/jobs/${lost}`, OWN)).data.status === 'cancelled');
t('журнал администрации ведётся', Number(q(`select count(*) from admin_log where type like 'ops_%'`)) >= 3);

/* ── Настоящий агент с подставным docker ── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsagent-'));
const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin); fs.mkdirSync(path.join(tmp, 'app')); fs.mkdirSync(path.join(tmp, 'src/scripts'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'app/docker-compose.yml'), 'services: {}\n'); fs.writeFileSync(path.join(tmp, 'app/.env'), 'X=1\n'); fs.chmodSync(path.join(tmp, 'app/.env'), 0o644);
fs.writeFileSync(path.join(tmp, 'src/scripts/deploy-local.sh'), '#!/bin/bash\necho "деплой: SRC_DIR=$SRC_DIR APP_DIR=$APP_DIR SKIP_PULL=${SKIP_PULL:-0} ops_env=${OPS_SECRET:+leak}"; umask\n');
fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
echo "docker $*"
case "$*" in
  *"compose logs"*) printf 'старая строка\\nERROR boom случилось\\nok строка\\nJWT_SECRET=hunter2\\nERR_CONN timeout\\n';;
  *"compose ps -a --format json"*) echo '{"Service":"api","State":"running","Health":"healthy"}'; echo '{"Service":"web","State":"exited","Health":""}';;
  *"RETURNING 1"*) echo 3;;
esac
exit 0
`); fs.chmodSync(path.join(bin, 'docker'), 0o755);
fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/bash\necho active\n'); fs.chmodSync(path.join(bin, 'systemctl'), 0o755);
fs.writeFileSync(path.join(tmp, 'host.log'), 'a\nb\nc\n');
const agent = spawn('node', ['ops/agent.mjs'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPS_API: B, OPS_SECRET: SECRET, OPS_APP_DIR: path.join(tmp, 'app'), OPS_SRC_DIR: path.join(tmp, 'src'), OPS_POLL_MS: '600', OPS_RUNNER_NAME: 'test-agent' }, stdio: ['ignore', 'pipe', 'pipe'] });
let alog = ''; agent.stdout.on('data', (d) => { alog += d; }); agent.stderr.on('data', (d) => { alog += d; });
const waitJob = async (id, ms = 20000) => { const t0 = Date.now(); for (;;) { const j = (await get(`/api/admin/ops/jobs/${id}`, OWN)).data; if (['done', 'failed', 'cancelled'].includes(j.status) || Date.now() - t0 > ms) return j; await sleep(400); } };
q(`delete from ops_jobs`);
await sleep(1500);
t('агент вышел на связь', (await get('/api/admin/ops', OWN)).data.agent.runner === 'test-agent', alog);

let jid = (await post('/api/admin/ops/jobs', { kind: 'status' }, OWN)).data.id; let j = await waitJob(jid);
t('агент: status выполнен', j.status === 'done' && /docker compose ps -a/.test(j.output), j);
jid = (await post('/api/admin/ops/jobs', { kind: 'logs', params: { service: 'api', lines: 100, filter: 'строка' } }, OWN)).data.id; j = await waitJob(jid);
t('агент: фильтр логов', j.status === 'done' && j.output.includes('ok строка') && j.output.includes('старая строка') && !j.output.includes('boom'), j.output);
jid = (await post('/api/admin/ops/jobs', { kind: 'errors' }, OWN)).data.id; j = await waitJob(jid);
t('агент: «ошибки» берут только подходящие строки', j.status === 'done' && j.output.includes('ERROR boom') && j.output.includes('ERR_CONN') && !j.output.includes('ok строка'), j.output);
t('агент: секрет из вывода вырезан', !j.output.includes('hunter2'));
jid = (await post('/api/admin/ops/jobs', { kind: 'logs', params: { service: 'api', lines: 100 } }, OWN)).data.id; j = await waitJob(jid);
t('вывод без фильтра тоже очищен от секретов', j.status === 'done' && !j.output.includes('hunter2') && j.output.includes('JWT_SECRET=***'), j.output);
jid = (await post('/api/admin/ops/jobs', { kind: 'healthz' }, OWN)).data.id; j = await waitJob(jid);
t('агент: healthz (подставной docker, код 0)', j.status === 'done', j);

jid = (await post('/api/admin/ops/jobs', { kind: 'repair', stepUpCode: await step(OWN) }, OWN)).data.id; j = await waitJob(jid, 40000);
t('починка выполнена и сообщила итог', j.status === 'done' && /Готово: проблем не осталось/.test(j.output), j.output);
t('починка: перезапустила остановленную службу web', /web: exited[\s\S]*перезапускаю/.test(j.output) && /compose restart web/.test(j.output), j.output);
t('починка: сняла блокировки (3)', /снято блокировок: 3/.test(j.output), j.output);
t('починка: .env получил права 600', (fs.statSync(path.join(tmp, 'app/.env')).mode & 0o777) === 0o600);
t('починка не трогает шлюз SSH', !/ssh-gate/.test(j.output) && !/sky-ssh-gate\.off/.test(j.output));
jid = (await post('/api/admin/ops/jobs', { kind: 'repair', params: { clearBlocks: false }, stepUpCode: await step(OWN) }, OWN)).data.id; j = await waitJob(jid, 40000);
t('починка без снятия блокировок их не трогает', j.status === 'done' && !/снято блокировок/.test(j.output) && !/RETURNING 1/.test(j.output), j.output);

jid = (await post('/api/admin/ops/jobs', { kind: 'deploy', params: { skipPull: true }, stepUpCode: await step(OWN) }, OWN)).data.id; j = await waitJob(jid);
t('деплой: запущен скрипт с нужными каталогами и umask 022', j.status === 'done' && j.output.includes(`SRC_DIR=${path.join(tmp, 'src')}`) && j.output.includes('SKIP_PULL=1') && /\n0022\n/.test(j.output), j.output);
t('деплой: секрет агента скрипту не передан', j.status === 'done' && !j.output.includes('ops_env=leak'), j.output);
await sleep(2500);
t('после деплоя агент перезапускается сам (выходит для systemd)', agent.exitCode === 0, String(agent.exitCode));
agent.kill();
t('на хосте нет остатков: журнал агента без ошибок цикла', !/ошибка цикла/.test(alog), alog.slice(-300));
fs.rmSync(tmp, { recursive: true, force: true });
q(`delete from ops_jobs; delete from ops_agent`);
console.log(`\n${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
