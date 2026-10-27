// Sky Launcher по HTTP: права, потоковая загрузка сборки, Range-раздача, оплата 499 ₽, модерация, серверы, импорт.
// API: DATABASE_URL=… REDIS_URL=… ADMIN_GATE=off ADMIN_TOKEN=off OWNER_USERNAME=lnchowner LAUNCHER_DIR=/tmp/lch2 node server/server.mjs > api.log
// Тест: DATABASE_URL=… node scripts/audit/launcher-http-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0; let bad = 0; const t = (n, c, x = '') => { if (c) { ok += 1; } else { bad += 1; console.log('FAIL', n, x); } };
const sfx = Date.now().toString(36);
q("update profiles set username = 'old' || substr(id,5,8) where username = 'lnchowner'");
const OWN = await mkuser(S, 'lown'); q(`update profiles set username = 'lnchowner' where id = '${OWN.pid}'`);
const DEV = await mkuser(S, 'ldev'); const PL = await mkuser(S, 'lpl'); const ST = await mkuser(S, 'lst');
q(`insert into wallet_accounts (user_id, balance) values ('${DEV.pid}', 1000) on conflict (user_id) do update set balance = 1000`);
const me = (u, p, o = {}) => call(p, o, u.tok); const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) }); const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const raw = (u, p, body, method = 'PUT', headers = {}) => fetch(B + p, { method, body, headers: { authorization: `Bearer ${u.tok}`, ...headers } });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(60, 2)]);

t('каталог без входа закрыт', (await call('/api/launcher/catalog')).status === 401);
t('админка без права закрыта', (await me(PL, '/api/admin/launcher/games')).status === 403 && (await me(PL, '/api/admin/launcher/servers')).status === 403);

// игра, карточка, медиа
let r = await post(DEV, '/api/launcher/dev/games', { title: `HTTP Game ${sfx}`, descr: 'Достаточно длинное описание игры для проверки.', genres: ['Инди'], developer: 'Dev', os: ['windows'], requirements: { cpu: 'x' } }); t('игра создана', r.status === 200 && r.data.id, JSON.stringify(r.data)); const gid = r.data.id;
t('чужой не видит кабинет игры', (await me(ST, `/api/launcher/dev/games/${gid}`)).status === 404);
t('обложка не-картинка отклонена', (await raw(DEV, `/api/launcher/dev/games/${gid}/media/cover`, Buffer.from('hello world'))).status === 400);
t('обложка принята', (await raw(DEV, `/api/launcher/dev/games/${gid}/media/cover`, PNG)).status === 200); t('скриншот принят', (await raw(DEV, `/api/launcher/dev/games/${gid}/media/screenshot`, PNG)).status === 200);
t('слишком большая картинка отклонена', (await raw(DEV, `/api/launcher/dev/games/${gid}/media/screenshot`, Buffer.concat([PNG, Buffer.alloc(1_100_000)]))).status === 413);
const mid = (await me(DEV, `/api/launcher/dev/games/${gid}`)).data.game.cover; const mr = await fetch(B + `/api/launcher/media/${mid}`, { headers: { authorization: `Bearer ${DEV.tok}` } });
t('обложка отдаётся автору', mr.status === 200 && mr.headers.get('content-type') === 'image/png'); t('чужой не видит обложку неопубликованной игры', (await fetch(B + `/api/launcher/media/${mid}`, { headers: { authorization: `Bearer ${ST.tok}` } })).status === 404);

// сборка: потоковая загрузка
r = await post(DEV, `/api/launcher/dev/games/${gid}/builds`, { version: '1.0.0' }); const bid = r.data.id; t('сборка создана', r.status === 200 && bid, JSON.stringify(r.data));
const exe = Buffer.from('MZ-fake-exe'); const pak = Buffer.alloc(2_500_000, 5);
let u1 = await raw(DEV, `/api/launcher/dev/builds/${bid}/file?path=${encodeURIComponent('bin/game.exe')}`, exe, 'PUT', { 'content-type': 'application/octet-stream' });
const j1 = await u1.json(); t('файл принят, хеш посчитан сервером', u1.status === 200 && j1.sha256 === createHash('sha256').update(exe).digest('hex'), JSON.stringify(j1));
t('большой файл принят', (await raw(DEV, `/api/launcher/dev/builds/${bid}/file?path=data%2Fbig.pak`, pak)).status === 200);
t('выход за каталог отклонён', (await raw(DEV, `/api/launcher/dev/builds/${bid}/file?path=${encodeURIComponent('../../etc/x')}`, exe)).status === 400);
t('чужая сборка недоступна', (await raw(ST, `/api/launcher/dev/builds/${bid}/file?path=a.txt`, exe)).status === 404);
r = await post(DEV, `/api/launcher/dev/builds/${bid}/finalize`, { launchExe: 'bin/game.exe', launchArgs: ['-windowed'] }); t('сборка закрыта', r.status === 200 && r.data.ok, JSON.stringify(r.data));

// заявка и оплата
r = await me(DEV, `/api/launcher/dev/games/${gid}/placement`); t('условия: цена 499 и возврат', r.data.priceRub === 499 && /возвращ/.test(r.data.terms.refund));
t('ключ идемпотентности обязателен', (await post(DEV, `/api/launcher/dev/games/${gid}/submit`, {})).status === 400);
const key = `idem-http-${sfx}`; const bal0 = Number(q(`select balance from wallet_accounts where user_id='${DEV.pid}'`));
r = await post(DEV, `/api/launcher/dev/games/${gid}/submit`, { idemKey: key }); t('заявка подана', r.status === 200 && r.data.ok && r.data.charged, JSON.stringify(r.data));
t('списано 499', Number(q(`select balance from wallet_accounts where user_id='${DEV.pid}'`)) === bal0 - 499);
r = await post(DEV, `/api/launcher/dev/games/${gid}/submit`, { idemKey: key }); t('повтор запроса не списывает', r.status === 200 && r.data.duplicate && Number(q(`select balance from wallet_accounts where user_id='${DEV.pid}'`)) === bal0 - 499);
t('до одобрения игры нет в каталоге', (await me(PL, '/api/launcher/catalog')).data.games.length === 0);

// модерация (владелец сервиса)
const al = await me(OWN, '/api/admin/launcher/games?status=pending_review'); t('владелец видит заявки', al.status === 200 && al.data.games.some((g) => g.id === gid), JSON.stringify(al.data).slice(0, 200));
t('причина обязательна для доработки', (await post(OWN, `/api/admin/launcher/games/${gid}/decide`, { decision: 'needs_changes' })).status === 400);
r = await post(OWN, `/api/admin/launcher/games/${gid}/decide`, { decision: 'approve' }); t('игра одобрена', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('игра в каталоге', (await me(PL, '/api/launcher/catalog')).data.games.some((g) => g.id === gid));
t('манифест без библиотеки закрыт', (await me(PL, `/api/launcher/games/${gid}/manifest`)).status === 403);
t('в библиотеку', (await post(PL, `/api/launcher/library/${gid}`)).status === 200);
r = await me(PL, `/api/launcher/games/${gid}/manifest`); t('манифест выдан', r.status === 200 && r.data.manifest.files.length === 2 && r.data.manifest.launch.exe === 'bin/game.exe', JSON.stringify(r.data).slice(0, 200)); const mf = r.data.manifest; const big = mf.files.find((f) => f.path === 'data/big.pak');

// раздача файлов
const bl = `/api/launcher/blob/${mf.buildId}/${big.sha256}`; const h = { authorization: `Bearer ${PL.tok}` };
let rr = await fetch(B + bl, { headers: h }); const full = Buffer.from(await rr.arrayBuffer()); t('файл целиком, хеш совпадает', rr.status === 200 && createHash('sha256').update(full).digest('hex') === big.sha256 && rr.headers.get('accept-ranges') === 'bytes');
rr = await fetch(B + bl, { headers: { ...h, range: 'bytes=1000000-1000999' } }); t('Range: 206 и нужный кусок', rr.status === 206 && rr.headers.get('content-range') === `bytes 1000000-1000999/${big.size}` && (await rr.arrayBuffer()).byteLength === 1000);
rr = await fetch(B + bl, { headers: { ...h, range: `bytes=${big.size + 5}-` } }); t('Range за пределами: 416', rr.status === 416);
rr = await fetch(B + bl, { headers: { authorization: `Bearer ${ST.tok}` } }); t('чужому файл не выдаётся', rr.status === 404);
rr = await fetch(B + `/api/launcher/blob/${mf.buildId}/${'0'.repeat(64)}`, { headers: h }); t('несуществующий хеш — 404', rr.status === 404);
rr = await fetch(B + bl); t('без входа — 401', rr.status === 401);

// события и статистика
t('событие запуска от игрока', (await post(PL, '/api/launcher/events', { gameId: gid, kind: 'launch' })).status === 200); t('чужое событие отклонено', (await post(ST, '/api/launcher/events', { gameId: gid, kind: 'launch' })).status === 404);
r = await me(DEV, `/api/launcher/dev/games/${gid}/stats`); t('статистика у владельца', r.data.events.launch === 1 && r.data.inLibrary === 1); t('статистика у чужого закрыта', (await me(ST, `/api/launcher/dev/games/${gid}/stats`)).status === 404);

// серверы: админка + каталог
r = await post(OWN, '/api/admin/launcher/servers', { kind: 'minecraft', platform: 'paper', name: `Srv ${sfx}`, host: 'mc.example.com', port: 25565, version: '1.20.1', mode: 'Survival', region: 'RU', status: 'published', statusSource: 'ping' }); t('сервер добавлен', r.status === 200 && r.data.id, JSON.stringify(r.data)); const sid = r.data.id;
t('дубликат адреса — 409', (await post(OWN, '/api/admin/launcher/servers', { kind: 'minecraft', platform: 'paper', name: 'Dup', host: 'mc.example.com', port: 25565 })).status === 409);
r = await me(PL, '/api/launcher/servers?kind=minecraft'); t('каталог серверов', r.data.servers.some((s) => s.id === sid && s.statusKnown === false));
r = await post(PL, `/api/launcher/servers/${sid}/connect`); t('подключение: адрес и инструкция', r.status === 200 && r.data.address === 'mc.example.com:25565' && !r.data.launchSupported);
t('профиль Minecraft', (await post(PL, '/api/launcher/profiles', { kind: 'minecraft', name: 'M', data: { version: '1.20.1', memoryMb: 4096 } })).status === 200); t('опасный JVM-параметр отклонён', (await post(PL, '/api/launcher/profiles', { kind: 'minecraft', name: 'M2', data: { version: '1.20.1', memoryMb: 4096, jvmArgs: ['-javaagent:x.jar'] } })).status === 400);
r = await post(OWN, '/api/admin/launcher/import/preview', { doc: { schema: 1, servers: [{ kind: 'gta', platform: 'fivem', name: 'Imp', host: 'gta.example.com', port: 30120, shell: 'x' }] } }); t('импорт: неизвестное поле отклоняет', r.status === 400 || r.data.ok === false, JSON.stringify(r.data).slice(0, 150));
r = await post(OWN, '/api/admin/launcher/import/apply', { doc: { schema: 1, servers: [{ kind: 'gta', platform: 'fivem', name: 'Imp', host: 'gta.example.com', port: 30120 }] } }); t('импорт применён', r.status === 200 && r.data.batch, JSON.stringify(r.data)); const batch = r.data.batch;
r = await post(OWN, '/api/admin/launcher/import/rollback', { batch }); t('импорт откатан', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('обычному пользователю импорт закрыт', (await post(PL, '/api/admin/launcher/import/apply', { doc: { schema: 1, servers: [] } })).status === 403);

// блокировка и снятие
r = await post(OWN, `/api/admin/launcher/games/${gid}/decide`, { decision: 'unpublish', note: 'Проверка снятия' }); t('снята с публикации', r.status === 200);
t('игрок: манифест недоступен, но игра в библиотеке', (await me(PL, `/api/launcher/games/${gid}/manifest`)).status === 409 && (await me(PL, '/api/launcher/library')).data.library.length === 1);
console.log(`launcher-http-test: ${ok} проверок пройдено, ${bad} не пройдено`); process.exit(bad ? 1 : 0);
