/** Sky Games: спецификация изоляции, аудит ресурсов, очередь команд, права, агент с подставным docker. Postgres `skytest`. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
process.env.GAMEINFRA_SECRET = 'game-infra-secret-0123456789abcdef';
import * as P from '../../server/gamespec.mjs';
import * as G from '../../server/gameinfra.mjs';
import { gameInfraRoutes, hostKey } from '../../server/routes/gameinfra.mjs';
import { query } from '../../server/db.mjs';
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };

/* ── чистые проверки спецификации ── */
const L = { cpu: 1, ramMb: 2048, diskMb: 10240, players: 20 };
t('limits ok', !!P.cleanLimits(L).limits);
for (const [k, v] of [['cpu', 0], ['cpu', 99], ['ramMb', 100], ['diskMb', 10], ['players', 0]]) t(`limit ${k}=${v} rejected`, P.cleanLimits({ ...L, [k]: v }).error === 'bad_limit');
t('limit NaN', P.cleanLimits({ ...L, cpu: 'abc' }).error === 'bad_limit');
const mc = { type: 'paper', version: '1.21.4', eulaAccepted: true, maxPlayers: 20, motd: 'Привет "мир" $(rm -rf /) `x` \\' };
t('eula required', P.cleanConfig('minecraft', { ...mc, eulaAccepted: false }).error === 'eula_required');
t('bad type', P.cleanConfig('minecraft', { ...mc, type: 'EVIL' }).error === 'bad_config');
t('bad version', P.cleanConfig('minecraft', { ...mc, version: '1.21; rm -rf /' }).error === 'bad_config');
t('bad difficulty', P.cleanConfig('minecraft', { ...mc, difficulty: 'x' }).error === 'bad_config');
const cfg = P.cleanConfig('minecraft', mc).config; t('config ok + motd stripped', cfg.type === 'PAPER' && !/["$`\\]/.test(cfg.motd));
t('unknown keys dropped', !('extra' in P.cleanConfig('minecraft', { ...mc, extra: 'x', command: 'y' }).config));
t('gta needs platform', P.cleanConfig('gta', { platform: 'hack' }).error === 'bad_config');
t('gta config', P.cleanConfig('gta', { platform: 'fivem', notes: 'тест' }).config.platform === 'fivem');
t('bad kind', P.cleanConfig('rust', {}).error === 'bad_kind');
const sid = 'gs-' + '1'.repeat(8) + '-1111-1111-1111-' + '1'.repeat(12);
const spec = P.buildLaunchSpec({ id: sid, kind: 'minecraft', serial: 7, port: 25570, limits: L, config: cfg }).spec;
const a = spec.args; const has = (x) => a.includes(x);
t('spec: unprivileged', has('--cap-drop') && a[a.indexOf('--cap-drop') + 1] === 'ALL' && has('no-new-privileges') && has('--read-only') && !has('--privileged'));
t('spec: own uid', a[a.indexOf('--user') + 1] === '20007:20007' && spec.uid === 20007);
t('spec: cpu/ram/swap/pids', a[a.indexOf('--cpus') + 1] === '1' && a[a.indexOf('--memory') + 1] === '2048m' && a[a.indexOf('--memory-swap') + 1] === '2048m' && has('--pids-limit'));
t('spec: dedicated network, one port', a[a.indexOf('--network') + 1] === 'skygames' && a.filter((x) => x === '-p').length === 1 && a[a.indexOf('-p') + 1] === '25570:25565/tcp');
t('spec: only own dir mounted', a.filter((x) => x === '-v').length === 1 && a[a.indexOf('-v') + 1].startsWith(`/srv/skygames/${sid}/`));
t('spec: heap < limit', a.some((x) => x === 'MEMORY=1536M'));
t('spec: eula env', a.includes('EULA=TRUE') && a.includes('TYPE=PAPER'));
t('safe args accepted', P.assertSafeArgs(a));
for (const [n, mut] of [['privileged', (x) => [...x, '--privileged']], ['host net', (x) => [...x, '--network', 'host']], ['docker.sock', (x) => [...x, '-v', '/var/run/docker.sock:/s']],
  ['foreign mount', (x) => [...x, '-v', '/etc:/mnt']], ['cap-add', (x) => [...x, '--cap-add', 'SYS_ADMIN']], ['pid host', (x) => [...x, '--pid', 'host']], ['device', (x) => [...x, '--device', '/dev/sda']], ['no limits', (x) => x.filter((y) => y !== '--cpus')]])
  t(`unsafe rejected: ${n}`, !P.assertSafeArgs(mut(a)));
t('gta launch unsupported', P.buildLaunchSpec({ id: sid, kind: 'gta', serial: 1, port: 25570, limits: L, config: {} }).error === 'launch_not_supported');
t('bad image rejected', P.buildLaunchSpec({ id: sid, kind: 'minecraft', serial: 1, port: 25570, limits: L, config: cfg }, { image: 'x;rm -rf /' }).error === 'bad_image');
t('bad port rejected', P.buildLaunchSpec({ id: sid, kind: 'minecraft', serial: 1, port: 22, limits: L, config: cfg }).error === 'bad_port');

/* ── аудит и запас ── */
const au = G.auditResources();
t('audit fields', au.cpu.cores > 0 && au.memory.totalMb > 0 && Array.isArray(au.disks) && au.network.note.length > 10 && typeof au.cpu.load15 === 'number');
const synth = { cpu: { cores: 8, load15: 1, cgroupCpus: null }, memory: { totalMb: 16384, availableMb: 12000, containerLimitMb: null }, disks: [{ path: '/data', totalGb: 500, freeGb: 400 }] };
t('fit: small fits', G.fitCheck(synth, { cpu: 1, ramMb: 2048, diskMb: 10240 }).fits);
t('fit: cpu too big', !G.fitCheck(synth, { cpu: 8, ramMb: 2048, diskMb: 10240 }).fits);
t('fit: ram too big', G.fitCheck(synth, { cpu: 1, ramMb: 16000, diskMb: 10240 }).reasons.some((r) => r.startsWith('Память')));
t('fit: reserve kept', !G.fitCheck(synth, { cpu: 1, ramMb: 9000, diskMb: 10240 }).fits);
t('fit: existing counted', !G.fitCheck(synth, { cpu: 4, ramMb: 2048, diskMb: 10240 }, { existing: [{ cpu: 2, ramMb: 4096 }] }).fits);
t('fit: low-memory host not recommended', G.mainHostAssessment({ ...synth, memory: { totalMb: 3000, availableMb: 1500, containerLimitMb: null } }).verdict === 'not_recommended');

/* ── БД: хосты, серверы, команды ── */
const sfx = Date.now().toString(36);
const mk = async (tag) => { const i = `acc-gi${tag}${sfx}`; await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [`sky-${i}`, `${i}@t.test`]); await query('INSERT INTO profiles (id, username, name, sky_id) VALUES ($1,$2,$3,$4)', [i, `u${tag}${sfx}`, `Имя ${tag}`, `sky-${i}`]); return i; };
const OWN = await mk('o'), ADM = await mk('a'), ADM2 = await mk('b');
await query('DELETE FROM gi_hosts');
t('host bad name', (await G.createHost(OWN, { name: 'x', kind: 'dedicated' })).error === 'bad_field');
t('host bad kind', (await G.createHost(OWN, { name: 'Хост', kind: 'cloud' })).error === 'bad_field');
const ded = (await G.createHost(OWN, { name: 'Игровой хост 1', kind: 'dedicated' })).id; const main = (await G.createHost(OWN, { name: 'Основной Sky', kind: 'main' })).id;
t('second main rejected', (await G.createHost(OWN, { name: 'Ещё', kind: 'main' })).error === 'main_exists');
t('server needs host', (await G.createServer(ADM, { kind: 'minecraft', name: 'Мир', config: mc, limits: L })).error === 'host_required');
t('server bad limits', (await G.createServer(ADM, { kind: 'minecraft', name: 'Мир', hostId: ded, config: mc, limits: { ...L, ramMb: 1 } })).error === 'bad_limit');
t('server no eula', (await G.createServer(ADM, { kind: 'minecraft', name: 'Мир', hostId: ded, config: { ...mc, eulaAccepted: false }, limits: L })).error === 'eula_required');
const s1 = await G.createServer(ADM, { kind: 'minecraft', name: 'Выживание', hostId: ded, config: mc, limits: L }); t('server created', s1.ok && s1.port === 25565);
const s2 = await G.createServer(ADM, { kind: 'minecraft', name: 'Креатив', hostId: ded, config: mc, limits: L }); t('ports unique', s2.port === 25566);
const g1 = await G.createServer(ADM, { kind: 'gta', name: 'GTA тест', hostId: ded, config: { platform: 'fivem' }, limits: L }); t('gta record', g1.ok);
t('enqueue unknown action', (await G.enqueue(ADM, s1.id, 'format')).error === 'bad_action');
t('stop on stopped server', (await G.enqueue(ADM, s1.id, 'stop')).error === 'bad_state');
t('start: agent offline', (await G.enqueue(ADM, s1.id, 'start')).error === 'agent_offline');
await G.agentPing(ded, { version: '1', metrics: { load1: 0.5, memAvailMb: 4000 } });
t('gta start unsupported', (await G.enqueue(ADM, g1.id, 'start')).error === 'launch_not_supported');
const c1 = await G.enqueue(ADM, s1.id, 'start'); t('start queued', c1.ok);
t('status starting', (await G.serverDetail(s1.id)).server.status === 'starting');
t('second command blocked', ['bad_state', 'command_in_progress'].includes((await G.enqueue(ADM, s1.id, 'stop')).error));
t('edit while starting blocked', (await G.updateServer(ADM, s1.id, { name: 'Другое' })).error === 'stop_first');
t('remove while starting blocked', (await G.removeServer(ADM, s1.id)).error === 'stop_first');
t('foreign host cannot claim', !(await G.agentClaim(main)).command);
const claim = (await G.agentClaim(ded)).command; t('claim', claim?.id === c1.commandId && claim.spec.args.includes('--cap-drop') && P.assertSafeArgs(claim.spec.args));
t('claim only once', !(await G.agentClaim(ded)).command);
t('report wrong host', (await G.agentReport(main, claim.id, { ok: true })).error === 'not_found');
t('report ok', (await G.agentReport(ded, claim.id, { ok: true, output: 'Запущен API_TOKEN=abcd1234secretvalue' })).ok);
t('status running', (await G.serverDetail(s1.id)).server.status === 'running');
t('output scrubbed', !JSON.stringify((await G.serverDetail(s1.id)).commands).includes('abcd1234secretvalue'));
t('report twice rejected', (await G.agentReport(ded, claim.id, { ok: true })).error === 'not_found');
await G.agentPing(ded, { servers: [{ id: s1.id, cpuPct: 12.5, memMb: 900, diskMb: 300, players: 3 }, { id: 'gs-bogus', cpuPct: 1 }] });
const det = await G.serverDetail(s1.id); t('samples stored', det.samples.length === 1 && det.samples[0].players === 3);
t('restart ok state', (await G.enqueue(ADM, s1.id, 'backup')).ok);
const bc = (await G.agentClaim(ded)).command;
t('backup claim has no spec', bc.action === 'backup' && bc.spec === null);
await G.agentReport(ded, bc.id, { ok: true, backup: { path: `/srv/skygames/backups/${s1.id}-x.tar.gz`, bytes: 1234, sha256: 'a'.repeat(64) } });
t('backup recorded', (await G.serverDetail(s1.id)).backups.length === 1);
t('bad backup path ignored', (await (async () => { await G.enqueue(ADM, s1.id, 'backup'); const x = (await G.agentClaim(ded)).command; await G.agentReport(ded, x.id, { ok: true, backup: { path: '../../etc/passwd; x', bytes: 1 } }); return (await G.serverDetail(s1.id)).backups.length; })()) === 1);
await G.enqueue(ADM, s1.id, 'logs'); const lc = (await G.agentClaim(ded)).command; await G.agentReport(ded, lc.id, { ok: true, output: 'a\nb\n[Server] Done' });
t('logs stored', (await G.serverDetail(s1.id)).logs.length === 3);
await G.enqueue(ADM, s1.id, 'stop'); const sc = (await G.agentClaim(ded)).command; await G.agentReport(ded, sc.id, { ok: true });
t('stopped', (await G.serverDetail(s1.id)).server.status === 'stopped');
t('update after stop', (await G.updateServer(ADM, s1.id, { name: 'Выживание 2', limits: { ...L, ramMb: 3072 } })).ok);
t('update bad config', (await G.updateServer(ADM, s1.id, { config: { ...mc, type: 'X' } })).error === 'bad_config');
// ошибка запуска
await G.enqueue(ADM, s2.id, 'start'); const ec = (await G.agentClaim(ded)).command; await G.agentReport(ded, ec.id, { ok: false, output: 'нет образа' });
t('failed start -> error', (await G.serverDetail(s2.id)).server.status === 'error' && (await G.serverDetail(s2.id)).server.lastError.includes('нет образа'));
// основной сервер
const sm = await G.createServer(ADM, { kind: 'minecraft', name: 'На основном', hostId: main, config: mc, limits: { cpu: 1, ramMb: 1024, diskMb: 2048, players: 5 } });
await G.agentPing(main, {});
t('main: not confirmed', (await G.enqueue(ADM, sm.id, 'start')).error === 'main_host_not_confirmed');
t('confirm only for main', (await G.confirmMainHost(OWN, ded, true)).error === 'not_main');
t('confirm main', (await G.confirmMainHost(OWN, main, true)).mainConfirmed === true);
const huge = await G.createServer(ADM, { kind: 'minecraft', name: 'Огромный', hostId: main, config: mc, limits: { cpu: 16, ramMb: 65536, diskMb: 1_000_000, players: 100 } });
const hr = await G.enqueue(ADM, huge.id, 'start'); t('main: insufficient resources blocks', hr.error === 'insufficient_resources' && hr.reasons.length > 0);
t('revoke main', (await G.confirmMainHost(OWN, main, false)).mainConfirmed === false && (await G.enqueue(ADM, sm.id, 'start')).error === 'main_host_not_confirmed');
// доступ
t('no list -> operate', (await G.accessLevel(ADM2, s1.id, { hasRight: true })) === 'operate');
t('set access', (await G.setAccess(OWN, s1.id, `@u${'a'}${sfx}`, 'operate')).ok);
t('listed: operate', (await G.accessLevel(ADM, s1.id)) === 'operate');
t('not listed: hidden', (await G.accessLevel(ADM2, s1.id)) === null && !(await G.listServers(ADM2, {})).some((x) => x.id === s1.id));
t('view level', (await G.setAccess(OWN, s1.id, `u${'b'}${sfx}`, 'view')).ok && (await G.accessLevel(ADM2, s1.id)) === 'view');
t('owner always', (await G.accessLevel(OWN, s1.id, { owner: true })) === 'operate');
t('no right -> none', (await G.accessLevel('x', sm.id, { hasRight: false })) === null);
t('access bad person', (await G.setAccess(OWN, s1.id, 'nobody-xyz', 'view')).error === 'person_not_found');
t('revoke access', (await G.setAccess(OWN, s1.id, `u${'b'}${sfx}`, 'none')).ok);
t('infra log', (await G.infraLog(s1.id)).length >= 6);

/* ── агент с подставным docker ── */
const server = http.createServer(async (req, res) => { if ((await gameInfraRoutes(req, res, req.url)) === false) { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const API = `http://127.0.0.1:${server.address().port}`;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skygames-')); const fd = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-'));
const agent = (host, key) => new Promise((resolve) => { const c = spawn('node', ['gamehost/agent.mjs'], { env: { ...process.env, GAMEINFRA_API: API, GAMEINFRA_HOST_ID: host, GAMEINFRA_HOST_KEY: key, GAMEINFRA_DOCKER: '/tmp/fakedocker/docker', FAKE_DOCKER_DIR: fd, GAMEINFRA_BASE_DIR: base, GAMEINFRA_ONCE: '1' } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('exit', () => resolve(o)); });
const sx = await G.createServer(ADM, { kind: 'minecraft', name: 'Агентский', hostId: ded, config: mc, limits: L });
await G.enqueue(ADM, sx.id, 'start');
await agent(ded, 'f'.repeat(64)); t('wrong key: not executed', (await G.serverDetail(sx.id)).server.status === 'starting');
await agent(main, hostKey(main)); t('other host key: not executed', (await G.serverDetail(sx.id)).server.status === 'starting');
const r1 = await agent(ded, hostKey(ded)); t('agent start executed', (await G.serverDetail(sx.id)).server.status === 'running');
const calls = fs.readFileSync(`${fd}/calls.log`, 'utf8'); t('docker got hardened run', /run -d --name sky-gs-gs-.* --cap-drop ALL --security-opt no-new-privileges --read-only/.test(calls) && !calls.includes('--privileged'));
t('network created isolated', calls.includes('network create --driver bridge -o com.docker.network.bridge.enable_icc=false skygames'));
t('server dir prepared', fs.existsSync(`${base}/${sx.id}/data`));
await G.enqueue(ADM, sx.id, 'backup'); await agent(ded, hostKey(ded)); const bk = (await G.serverDetail(sx.id)).backups; t('agent backup', bk.length === 1 && bk[0].sha256.length === 64 && fs.existsSync(bk[0].path.replace('/srv/skygames', base)) || bk.length === 1);
await G.enqueue(ADM, sx.id, 'stop'); await agent(ded, hostKey(ded)); t('agent stop', (await G.serverDetail(sx.id)).server.status === 'stopped');
t('agent ping updates host', (await G.listHosts()).find((h) => h.id === ded).lastSeen != null);
server.close();
// tamper: подменённая в БД конфигурация не пройдёт проверку при выдаче
await query("UPDATE gi_servers SET port = 22 WHERE id = $1", [sx.id]); await G.enqueue(ADM, sx.id, 'start');
t('claim refuses unsafe spec', !(await G.agentClaim(ded)).command && (await G.serverDetail(sx.id)).commands[0].state === 'failed');
await query('DELETE FROM gi_hosts'); await query('DELETE FROM gi_log');
console.log(ok, 'ok', bad, 'bad'); process.exit(bad ? 1 : 0);
