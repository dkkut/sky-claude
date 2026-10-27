/* Minecraft-менеджер (electron/mclauncher.cjs) на поддельном Mojang и поддельном Microsoft. Запуск: node scripts/audit/mclauncher-test.mjs */
import { createRequire } from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createMc, allowed, safeRel } = require('../../electron/mclauncher.cjs');
let fails = 0; const ok = (c, n) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fails += 1; };
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mct-'));

// ── поддельный Mojang и Microsoft на одном порту ──
const files = new Map(); let port; const hits = [];
const put = (p, buf) => { files.set(p, buf); return { url: `http://127.0.0.1:${port}${p}`, sha1: sha1(buf), size: buf.length }; };
let profileStatus = 200; let polls = 0;
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    hits.push(req.method + ' ' + req.url);
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/devicecode') return j(200, { device_code: 'DC', user_code: 'ABCD-1234', verification_uri: 'https://microsoft.com/link', expires_in: 60, interval: 1 });
    if (req.url === '/token') { const p = new URLSearchParams(body); if (p.get('grant_type') === 'refresh_token') return j(200, { access_token: 'MSA2', refresh_token: 'RT2' }); polls += 1; return polls < 2 ? j(400, { error: 'authorization_pending' }) : j(200, { access_token: 'MSA', refresh_token: 'RT' }); }
    if (req.url === '/xbl') return j(200, { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS' }] } });
    if (req.url === '/xsts') return j(200, { Token: 'XSTS' });
    if (req.url === '/mcauth') { const b = JSON.parse(body); return b.identityToken === 'XBL3.0 x=UHS;XSTS' ? j(200, { access_token: 'MCTOKEN', expires_in: 86400 }) : j(401, {}); }
    if (req.url === '/profile') return req.headers.authorization === 'Bearer MCTOKEN' ? (profileStatus === 200 ? j(200, { id: 'abc123', name: 'Steve' }) : j(404, {})) : j(401, {});
    const f = files.get(req.url); if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-length': f.length }); res.end(f);
  });
}); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;

const jar = crypto.randomBytes(5000);
const libA = crypto.randomBytes(3000); const libMac = crypto.randomBytes(100);
const objs = [crypto.randomBytes(50), crypto.randomBytes(60), crypto.randomBytes(70)].map((b) => ({ b, h: sha1(b) }));
const idx = { objects: Object.fromEntries(objs.map((o, i) => ['f' + i, { hash: o.h, size: o.b.length }])) };
for (const o of objs) put(`/${o.h.slice(0, 2)}/${o.h}`, o.b);
const aiMeta = put('/idx.json', Buffer.from(JSON.stringify(idx)));
const vjson = (extra = {}) => ({
  id: '1.20.4', type: 'release', mainClass: 'net.minecraft.client.main.Main', javaVersion: { majorVersion: 17 }, assetIndex: { id: '12', ...aiMeta },
  downloads: { client: put('/client.jar', jar) },
  libraries: [
    { name: 'a:b:1', downloads: { artifact: { path: 'a/b/1/b-1.jar', ...put('/libA.jar', libA) } } },
    { name: 'mac:c:1', rules: [{ action: 'allow', os: { name: 'osx' } }], downloads: { artifact: { path: 'm/c.jar', ...put('/libM.jar', libMac) } } },
  ],
  arguments: {
    jvm: ['-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}', '-cp', '${classpath}'],
    game: ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetIndex', '${assets_index_name}',
      { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
      { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }],
  }, ...extra,
});
const v1 = put('/v1.json', Buffer.from(JSON.stringify(vjson())));
const vBadHash = vjson({ id: 'bad', downloads: { client: { ...put('/bad.jar', Buffer.from('xx')), sha1: '0'.repeat(40) } } });
const vEvil = vjson({ id: 'evil', downloads: { client: { url: 'https://evil.example/c.jar', sha1: sha1(jar), size: jar.length } } });
const vLegacy = vjson({ id: 'old', libraries: [{ name: 'x', natives: { windows: 'natives-windows' }, downloads: {} }] });
const vMod = vjson({ id: 'fabric', inheritsFrom: '1.20.4' });
const mk = (id, v) => ({ id, type: 'release', releaseTime: '2024-01-01', url: put(`/v-${id}.json`, Buffer.from(JSON.stringify(v))).url });
files.set('/manifest.json', Buffer.from(JSON.stringify({ latest: { release: '1.20.4' }, versions: [{ id: '1.20.4', type: 'release', releaseTime: 't', url: v1.url }, mk('bad', vBadHash), mk('evil', vEvil), mk('old', vLegacy), mk('fabric', vMod), { id: 'x/../y', type: 'release', url: v1.url }] })));

// поддельная Java
const fakeJava = path.join(tmp, 'fakejava.sh'); const argsOut = path.join(tmp, 'args.txt');
fs.writeFileSync(fakeJava, `#!/bin/sh\nif [ "$1" = "-version" ]; then echo 'openjdk version "17.0.9" 2023' 1>&2; exit 0; fi\nprintf '%s\\n' "$@" > ${argsOut}\n`, { mode: 0o755 });
const oldJava = path.join(tmp, 'oldjava.sh'); fs.writeFileSync(oldJava, `#!/bin/sh\necho 'java version "1.8.0_301"' 1>&2\n`, { mode: 0o755 });

let secret = ''; const events = [];
const mk2 = (extra = {}) => createMc({
  root: path.join(tmp, 'mc'), fetchImpl: fetch, hostAllowed: (u) => u.startsWith(`http://127.0.0.1:${port}/`), manifestUrl: `http://127.0.0.1:${port}/manifest.json`, assetsBase: `http://127.0.0.1:${port}`,
  clientId: 'CID', pollMs: 50, javaPath: fakeJava, onEvent: (e) => events.push(e), secretStore: { get: () => secret, set: (x) => { secret = x; } },
  endpoints: { device: `http://127.0.0.1:${port}/devicecode`, token: `http://127.0.0.1:${port}/token`, xbl: `http://127.0.0.1:${port}/xbl`, xsts: `http://127.0.0.1:${port}/xsts`, mc: `http://127.0.0.1:${port}/mcauth`, profile: `http://127.0.0.1:${port}/profile` }, ...extra,
});
const mc = mk2();

// правила и пути
ok(allowed([{ action: 'allow', os: { name: 'windows' } }]) && !allowed([{ action: 'allow', os: { name: 'osx' } }]) && allowed(undefined), 'правила по ОС');
ok(!allowed([{ action: 'allow', features: { is_demo_user: true } }], {}) && allowed([{ action: 'allow', features: { is_demo_user: true } }], { is_demo_user: true }), 'правила по возможностям');
ok(safeRel('a/b.jar') && !safeRel('../x') && !safeRel('/etc/x') && !safeRel('C:/x') && !safeRel('a\\b'), 'безопасные пути');

// список версий: мусорный id отброшен
const vl = await mc.versions();
ok(vl.versions.length === 5 && !vl.versions.some((v) => v.id.includes('/')), 'список версий: опасный id отброшен');

// установка
let r = await mc.install('1.20.4');
ok(r.ok && r.javaMajor === 17, 'установка 1.20.4');
const R = path.join(tmp, 'mc');
ok(fs.existsSync(path.join(R, 'versions/1.20.4/1.20.4.jar')) && fs.existsSync(path.join(R, 'libraries/a/b/1/b-1.jar')), 'клиент и библиотека на месте');
ok(!fs.existsSync(path.join(R, 'libraries/m/c.jar')), 'библиотека для macOS пропущена по правилам');
ok(objs.every((o) => fs.existsSync(path.join(R, 'assets/objects', o.h.slice(0, 2), o.h))), 'все ассеты скачаны и сверены');
ok(events.some((e) => e.type === 'mc:progress' && e.stage === 'assets') && events.some((e) => e.type === 'mc:installed'), 'события хода и завершения');
ok((await mc.installed()).some((v) => v.id === '1.20.4'), 'видна в списке установленных');
const before = hits.length; await mc.install('1.20.4');
ok(!hits.slice(before).some((h) => /libA|client\.jar|\/[0-9a-f]{2}\/[0-9a-f]{40}/.test(h)), 'повторная установка не качает готовое заново');
ok((await mc.verify('1.20.4')).ok, 'проверка целостности: чисто');
fs.appendFileSync(path.join(R, 'libraries/a/b/1/b-1.jar'), 'x');
ok(!(await mc.verify('1.20.4')).ok, 'проверка ловит изменённую библиотеку');
await mc.install('1.20.4'); ok((await mc.verify('1.20.4')).ok, 'установка чинит изменённый файл');

// отказы
const fail = async (id) => { try { await mc.install(id); return null; } catch (e) { return e.code; } };
ok((await fail('bad')) === 'hash_mismatch' && !(await mc.installed()).some((v) => v.id === 'bad'), 'неверный SHA-1: отказ, версия не появляется');
ok((await fail('evil')) === 'host_not_allowed', 'узел не Mojang: отказ');
ok((await fail('old')) === 'legacy_natives_unsupported', 'старая версия с распаковкой natives: честный отказ');
ok((await fail('fabric')) === 'modded_unsupported', 'моды (inheritsFrom): честный отказ');
ok((await fail('../x')) === 'bad_version' && (await fail('nope')) === 'version_not_found', 'опасный и неизвестный id');
ok(!fs.existsSync(path.join(R, 'versions/bad/bad.json')), 'описание версии не записано при сбое');

// вход и запуск
let t = null; try { await mc.launch({ version: '1.20.4' }); } catch (e) { t = e.code; }
ok(t === 'login_required', 'без входа запуск невозможен (нет офлайн-режима)');
const noId = createMc({ root: R, clientId: '', fetchImpl: fetch }); let t2 = null; try { await noId.authStart(); } catch (e) { t2 = e.code; }
ok(t2 === 'client_id_missing' && !noId.hasClientId(), 'без Client ID вход честно недоступен');
const a = await mc.authStart();
ok(a.userCode === 'ABCD-1234' && /microsoft/.test(a.url), 'код устройства получен');
ok((await mc.authStart()).userCode === 'ABCD-1234', 'повторный старт не создаёт второй вход');
for (let i = 0; i < 60 && mc.authStatus().phase === 'waiting'; i++) await new Promise((r2) => setTimeout(r2, 100));
ok(mc.authStatus().phase === 'done' && mc.account().name === 'Steve', 'вход завершён, имя профиля получено');
ok(!JSON.stringify(mc.account()).includes('MCTOKEN') && !JSON.stringify(events).includes('MCTOKEN') && !JSON.stringify(events).includes('RT'), 'токены не попадают в ответ и события');
ok(JSON.parse(secret).refresh === 'RT', 'в хранилище секретов лежит только refresh-токен');

const L = await mc.launch({ version: '1.20.4', instance: 'Моя сборка', memoryMb: 3000, server: { host: 'play.example.com', port: 25570 } });
await new Promise((r2) => setTimeout(r2, 500));
const argv = fs.readFileSync(argsOut, 'utf8').split('\n');
ok(L.ok && argv[0] === '-Xmx3000M', 'запуск: память задана');
ok(argv.includes('MCTOKEN') && argv.includes('Steve') && argv.includes('net.minecraft.client.main.Main'), 'запуск: имя, токен игры и главный класс');
ok(argv.includes('--quickPlayMultiplayer') && argv.includes('play.example.com:25570'), 'запуск: быстрое подключение к серверу');
ok(!argv.includes('--demo'), 'демо-режим не включается');
ok(argv.some((x) => x.includes(path.join('libraries', 'a', 'b', '1', 'b-1.jar'))) && !argv.some((x) => x.includes('m/c.jar')), 'classpath из подходящих библиотек');
ok(fs.existsSync(path.join(R, 'instances')) && fs.readdirSync(path.join(R, 'instances')).length === 1, 'папка профиля создана внутри instances');
let t3 = null; try { await mc.launch({ version: '1.20.4', instance: '..' }); } catch (e) { t3 = e.code; } ok(t3 === 'bad_instance' || fs.readdirSync(path.join(R, 'instances')).length === 2, 'имя профиля не выводит за пределы instances');
ok(fs.readdirSync(R).every((d) => ['versions', 'libraries', 'assets', 'instances'].includes(d)), 'за пределы корня ничего не записано');

// Java
const jv = await mk2({ javaPath: oldJava }).java(17);
ok(jv.missing ? jv.have === 8 : jv.major >= 17, 'java(): Java 8 не засчитана вместо 17 (берётся подходящая из PATH или отказ)');
const jv2 = await mk2({ javaPath: fakeJava }).java(17); ok(!jv2.missing && jv2.bin === fakeJava && jv2.major === 17, 'java(): выбрана указанная подходящая');
const jv3 = await mk2({ javaPath: oldJava }).java(99); ok(jv3.missing && jv3.need === 99, 'java(): нужной версии нет — честный отказ с номером версии');

// лицензия
mc.logout(); profileStatus = 404; polls = 0; await mc.authStart();
for (let i = 0; i < 60 && mc.authStatus().phase === 'waiting'; i++) await new Promise((r2) => setTimeout(r2, 100));
ok(mc.authStatus().phase === 'error' && mc.authStatus().error === 'no_license', 'нет лицензии на игру: вход отклонён');
ok(mc.account() === null || secret === '', 'при отказе аккаунт не сохраняется');
let t5 = null; try { await mc.launch({ version: '1.20.4' }); } catch (e) { t5 = e.code; } ok(t5 === 'login_required', 'и запуск без лицензии невозможен');

// удаление
await mc.uninstall('1.20.4'); ok(!(await mc.installed()).some((v) => v.id === '1.20.4'), 'удаление версии');
srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'mclauncher-test: всё пройдено'); process.exit(fails ? 1 : 0);
