// Sky Launcher: серверы GTA V / Minecraft на настоящей базе и поддельных серверах (Minecraft SLP и FiveM).
// DATABASE_URL=… REDIS_URL=… LAUNCHER_ALLOW_PRIVATE=1 node scripts/audit/lservers-test.mjs
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
process.env.LAUNCHER_ALLOW_PRIVATE = '1';
const { query, pool } = await import('../../server/db.mjs');
const S = await import('../../server/lservers.mjs');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };
const sfx = Date.now().toString(36);
await query('DELETE FROM launcher_servers');   // тестовая база: чистим остатки прошлого прогона

// поддельный Minecraft-сервер
const varint = (v) => { const b = []; do { let x = v & 0x7f; v >>>= 7; if (v) x |= 0x80; b.push(x); } while (v); return Buffer.from(b); };
const mc = net.createServer((s) => { let got = Buffer.alloc(0); s.on('data', (d) => { got = Buffer.concat([got, d]); if (got.length >= 6) { const j = Buffer.from(JSON.stringify({ version: { name: 'Paper 1.20.1' }, players: { online: 7, max: 50 }, description: { text: 'Hello Sky' } })); const body = Buffer.concat([varint(0), varint(j.length), j]); s.write(Buffer.concat([varint(body.length), body])); } }); });
await new Promise((r) => mc.listen(0, '127.0.0.1', r)); const mcPort = mc.address().port;
const fv = http.createServer((q, r) => { if (q.url === '/info.json') r.end(JSON.stringify({ server: 'FXServer', vars: { sv_maxClients: '64', sv_projectName: 'RP City' } })); else if (q.url === '/players.json') r.end(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }])); else { r.statusCode = 404; r.end(); } });
await new Promise((r) => fv.listen(0, '127.0.0.1', r)); const fvPort = fv.address().port;

const mkP = async (t) => { const id = `acc-l${t}${sfx}`; await query(`INSERT INTO sky_ids (id, email) VALUES ($1,$2)`, [`sky-${id}`, `${id}@t.test`]); await query(`INSERT INTO profiles (id, username, name, sky_id) VALUES ($1,$2,$3,$4)`, [id, `l${t}${sfx}`, `L${t}`, `sky-${id}`]); return id; };
const A = await mkP('a'); const B = await mkP('b');

// валидация
const bad = (o, p) => S.cleanServer(o, p).errors.length > 0;
ok(bad({ kind: 'gta', platform: 'paper', name: 'x1', host: 'a.b', port: 1 }), 'GTA + paper несовместимы');
ok(bad({ kind: 'minecraft', platform: 'vanilla', name: 'Ab', host: 'http://evil', port: 25565 }), 'схема в host отклонена');
ok(bad({ kind: 'minecraft', platform: 'vanilla', name: 'Ab', host: 'a b', port: 25565 }), 'пробелы в host');
ok(bad({ kind: 'minecraft', platform: 'vanilla', name: 'Ab', host: 'a.b', port: 70000 }), 'порт вне диапазона');
ok(bad({ kind: 'gta', platform: 'ragemp', name: 'Ab', host: 'a.b', port: 22005, statusSource: 'ping' }), 'ping у RAGE MP не поддерживается');
ok(bad({ kind: 'gta', platform: 'fivem', name: 'Ab', host: 'a.b', port: 30120, cmd: 'rm -rf' }, { strictFields: true }), 'неизвестное поле');
ok(bad({ kind: 'gta', platform: 'fivem', name: 'Ab', host: 'a.b', port: 30120, params: { exec: 'x' } }), 'опасный параметр');
ok(!bad({ kind: 'minecraft', platform: 'paper', name: 'Ab', host: 'play.example.com', port: 25565 }), 'корректная карточка');

// пробы
const pm = await S.pingMinecraft('127.0.0.1', mcPort); ok(pm.online && pm.players === 7 && pm.max === 50 && pm.motd === 'Hello Sky', 'Minecraft ping');
const pf = await S.pingFivem('127.0.0.1', fvPort); ok(pf.players === 3 && pf.max === 64, 'FiveM ping');
let refused = false; try { await S.pingMinecraft('127.0.0.1', 1); } catch { refused = true; } ok(refused, 'закрытый порт — ошибка');
process.env.LAUNCHER_ALLOW_PRIVATE = '0';

// админка: создание, дубликат, публикация, каталог
const s1 = await S.adminSaveServer(A, null, { kind: 'minecraft', platform: 'paper', name: 'Sky Craft', host: '127.0.0.1', port: mcPort, version: '1.20.1', mode: 'Survival', region: 'RU', status: 'published', statusSource: 'ping' });
ok(s1.ok, 'сервер создан'); ok((await S.adminSaveServer(A, null, { kind: 'minecraft', platform: 'paper', name: 'Dup', host: '127.0.0.1', port: mcPort })).error === 'duplicate', 'дубликат адреса');
const s2 = await S.adminSaveServer(A, null, { kind: 'gta', platform: 'fivem', name: 'RP City', host: '127.0.0.1', port: fvPort, mode: 'RP', region: 'RU', status: 'published' });
const s3 = await S.adminSaveServer(A, null, { kind: 'gta', platform: 'ragemp', name: 'Rage One', host: 'rage.example.com', port: 22005, mode: 'RP', status: 'published' });
const s4 = await S.adminSaveServer(A, null, { kind: 'minecraft', platform: 'vanilla', name: 'Hidden', host: 'h.example.com', port: 25565 });
ok(s3.ok && s4.ok, 'ещё сервера');
// без пробы — статус неизвестен
let l = await S.listServers(B, { kind: 'minecraft' }); ok(l.servers.length === 1 && l.servers[0].statusKnown === false && l.servers[0].players === null, 'до проверки числа игроков нет');
ok(!l.servers.some((x) => x.id === s4.id), 'черновик не виден людям');
// с включённой пробой (в тесте адрес приватный — разрешаем только на время пробы)
process.env.LAUNCHER_ALLOW_PRIVATE = '1'; await S.sweepServers({ force: true, intervalMin: 2 }); process.env.LAUNCHER_ALLOW_PRIVATE = '0';
l = await S.listServers(B, { kind: 'minecraft' }); ok(l.servers[0].online === true && l.servers[0].players === 7 && l.servers[0].maxPlayers === 50, 'после пробы реальные данные');
const g = await S.listServers(B, { kind: 'gta' }); const rage = g.servers.find((x) => x.id === s3.id); ok(rage.online === null && rage.players === null && !rage.statusKnown, 'RAGE MP: статус не выдумывается');
ok((await S.listServers(B, { kind: 'gta', q: 'rage' })).servers.length === 1, 'поиск'); ok((await S.listServers(B, { kind: 'gta', onlineOnly: '1' })).servers.every((x) => x.online), 'только онлайн');
ok((await S.listServers(B, { q: '%' })).servers.length === 0, 'символ % не превращается в шаблон');

// избранное, история, подключение
ok((await S.toggleFavorite(B, s1.id, true)).ok, 'в избранное'); ok((await S.listServers(B, { kind: 'minecraft', favoritesOnly: '1' })).servers.length === 1, 'фильтр избранного');
ok((await S.toggleFavorite(B, s4.id, true)).error === 'not_found', 'нельзя избрать неопубликованный');
const c1 = await S.connectInfo(B, s2.id); ok(c1.uri === null && !c1.launchSupported && c1.address === `127.0.0.1:${fvPort}`, 'FiveM: только данные подключения');
const c2 = await S.connectInfo(B, s3.id); ok(c2.uri === null && !c2.launchSupported, 'RAGE MP: автозапуск не обещаем');
const c3 = await S.connectInfo(B, s1.id); ok(!c3.launchSupported && /официальный/.test(c3.instructions), 'Minecraft: через официальный лаунчер');
ok((await S.connectInfo(B, s4.id)).error === 'not_found', 'подключиться к черновику нельзя');
await S.connectInfo(B, s2.id); ok((await S.listHistory(B)).history.find((h) => h.id === s2.id).count === 2, 'история');
ok((await S.listHistory(A)).history.length === 0, 'чужая история не видна');

// профили
ok((await S.saveProfile(B, { kind: 'minecraft', name: 'Main', data: { version: '1.20.1', memoryMb: 4096, jvmArgs: ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50'] } })).ok, 'профиль Minecraft');
ok((await S.saveProfile(B, { kind: 'minecraft', name: 'X', data: { version: '1.20.1', memoryMb: 4096, jvmArgs: ['-javaagent:evil.jar'] } })).error === 'bad_jvm_args', 'опасные JVM-аргументы');
ok((await S.saveProfile(B, { kind: 'minecraft', name: 'X', data: { version: '1.20.1', memoryMb: 999999 } })).error === 'bad_memory', 'память вне пределов');
ok((await S.saveProfile(B, { kind: 'minecraft', name: 'X', data: { version: '../../x' } })).error === 'bad_version', 'версия с путём');
const gp = await S.saveProfile(B, { kind: 'gta', name: 'GTA', data: { platform: 'fivem', gamePath: 'C:\\Games\\GTA V' } }); ok(gp.ok, 'профиль GTA');
ok((await S.saveProfile(B, { kind: 'gta', name: 'GTA2', data: { platform: 'fivem', gamePath: 'C:\\x|y' } })).error === 'bad_path', 'путь с запрещёнными символами');
const pl = await S.listProfiles(B); ok(pl.profiles.length === 2, 'два профиля'); ok((await S.listProfiles(A)).profiles.length === 0, 'профили чужого не видны');
ok((await S.deleteProfile(A, gp.id)).ok === false, 'чужой профиль не удалить'); ok((await S.resetProfile(A, gp.id)).error === 'not_found', 'чужой не сбросить');
ok((await S.resetProfile(B, gp.id)).ok && (await S.listProfiles(B, 'minecraft')).profiles[0].data.memoryMb === 4096, 'сброс одного профиля не трогает другие');

// импорт с предпросмотром и откатом
const doc = { schema: 1, servers: [{ kind: 'minecraft', platform: 'fabric', name: 'Fab', host: 'fab.example.com', port: 25565, status: 'draft' }, { kind: 'minecraft', platform: 'paper', name: 'Sky Craft 2', host: '127.0.0.1', port: mcPort, mode: 'Creative' }] };
const pv = await S.planImport(doc); ok(pv.ok && pv.counts.create === 1 && pv.counts.update === 1, 'предпросмотр: 1 новая, 1 правка');
ok((await query(`SELECT count(*)::int AS n FROM launcher_servers WHERE host='fab.example.com'`)).rows[0].n === 0, 'предпросмотр ничего не пишет');
ok((await S.planImport({ schema: 1, servers: [{ kind: 'minecraft', platform: 'paper', name: 'Bad', host: 'a.b', port: 1, shell: 'x' }] })).ok === false, 'неизвестное поле отклоняет файл');
ok((await S.planImport({ schema: 2, servers: [] })).error === 'invalid', 'неверная схема');
ok((await S.planImport({ schema: 1, servers: Array(201).fill(doc.servers[0]) })).error === 'invalid', 'слишком много записей');
const ap = await S.applyImport(A, doc); ok(ap.ok && ap.batch, 'импорт применён');
ok((await query(`SELECT mode FROM launcher_servers WHERE id=$1`, [s1.id])).rows[0].mode === 'Creative', 'правка применена');
const rb = await S.rollbackBatch(A, ap.batch); ok(rb.ok && rb.reverted === 2, 'откат импорта');
ok((await query(`SELECT mode FROM launcher_servers WHERE id=$1`, [s1.id])).rows[0].mode === 'Survival', 'прежнее значение возвращено');
ok((await query(`SELECT count(*)::int AS n FROM launcher_servers WHERE host='fab.example.com'`)).rows[0].n === 0, 'созданная запись удалена откатом');
ok((await S.rollbackBatch(A, ap.batch)).error === 'already_rolled_back', 'повторный откат отклонён');
// правка вручную → откат невозможен
const ap2 = await S.applyImport(A, doc); await S.adminSaveServer(A, s1.id, { region: 'EU' }); ok((await S.rollbackBatch(A, ap2.batch)).error === 'changed_since', 'откат после последующей правки отклонён');
ok((await S.adminDeleteServer(A, s4.id)).ok, 'удаление'); ok((await S.serverLog()).log.length > 5, 'журнал изменений');

// SSRF: без LAUNCHER_ALLOW_PRIVATE внутренние адреса недоступны (отдельный процесс)
const { execFileSync } = await import('node:child_process');
const out = execFileSync(process.execPath, ['-e', "import('./server/lservers.mjs').then(async S=>{const r=[];for(const h of ['127.0.0.1','10.0.0.5','169.254.169.254','localhost']){try{await S.pingMinecraft(h,25565);r.push('open')}catch(e){r.push(e.message)}}console.log(r.join());process.exit(0)})"], { env: { ...process.env, LAUNCHER_ALLOW_PRIVATE: '' }, encoding: 'utf8', cwd: process.cwd() }).trim();
ok(out === 'internal_address,internal_address,internal_address,internal_address', 'внутренние адреса не проверяются');
mc.close(); fv.close(); await pool.end();
console.log(`lservers-test: ${n} проверок пройдено`);
