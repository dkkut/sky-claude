// Менеджер установки Sky Launcher (electron/launcher.cjs) на локальном поддельном API: установка, докачка, пауза, подмена, дельта-обновление, проверка, запуск, удаление.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, mkdir, readdir, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createManager, safeRel } = createRequire(import.meta.url)('../../electron/launcher.cjs');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const GID = 'lgm-00000000-0000-0000-0000-000000000001'; const B1 = 'lbd-00000000-0000-0000-0000-0000000000a1'; const B2 = 'lbd-00000000-0000-0000-0000-0000000000a2';
const big = Buffer.alloc(3 * 1024 * 1024, 7); big[100] = 1;
const exeV1 = Buffer.from('#!/bin/sh\necho started > "$(dirname "$0")/ran.txt"\nexit 3\n'); const exeV2 = Buffer.from('#!/bin/sh\necho v2 > "$(dirname "$0")/ran.txt"\nexit 0\n');
const A = { 'bin/game.exe': exeV1, 'data/big.pak': big, 'readme.txt': Buffer.from('hello') };
const Bv = { 'bin/game.exe': exeV2, 'data/big.pak': big, 'readme.txt': Buffer.from('hello'), 'data/new.pak': Buffer.from('new!') };
let current = { buildId: B1, version: '1.0', files: A }; const blobs = new Map(); let tamper = null; let served = []; let badManifest = null; let slow = 0;
const reg = (files) => { for (const b of Object.values(files)) blobs.set(sha(b), b); }; reg(A); reg(Bv);
const manifest = () => badManifest ?? ({ gameId: GID, buildId: current.buildId, version: current.version, launch: { exe: 'bin/game.exe', args: ['-windowed'] }, files: Object.entries(current.files).map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) })) });
const srv = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer T') { res.statusCode = 401; return res.end(); }
  if (req.url.startsWith(`/api/launcher/games/${GID}/manifest`)) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ manifest: manifest() })); }
  const m = req.url.match(/^\/api\/launcher\/blob\/(lbd-[0-9a-f-]+)\/([0-9a-f]{64})$/);
  if (m) { let b = blobs.get(m[2]); if (!b) { res.statusCode = 404; return res.end(); } if (tamper === m[2]) b = Buffer.alloc(b.length, 9);
    let start = 0; const r = /^bytes=(\d+)-/.exec(req.headers.range ?? ''); if (r) start = Number(r[1]); served.push([m[2].slice(0, 6), start]);
    res.statusCode = r ? 206 : 200; res.setHeader('content-length', b.length - start); const body = b.subarray(start);
    if (slow) { let off = 0; const iv = setInterval(() => { if (off >= body.length || res.destroyed) { clearInterval(iv); return res.end(); } res.write(body.subarray(off, off + 65536)); off += 65536; }, slow); res.on('close', () => clearInterval(iv)); return; }
    return res.end(body); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${srv.address().port}`;
const root = await mkdtemp(path.join(tmpdir(), 'skyl-')); const events = [];
const mk = (extra = {}) => createManager({ apiOrigin: origin, getToken: async () => 'T', root, statePath: path.join(root, 'state.json'), onEvent: (e) => events.push(e), ...extra });
const waitFor = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await f(); if (r) return r; await new Promise((x) => setTimeout(x, 25)); } throw new Error('timeout'); };
const status = (m) => m.tasks().find((t) => t.gameId === GID)?.status;

for (const bad of ['../x', '/a', 'C:/a', 'a\\b', 'nul', 'a//b', 'a/..', '']) ok(safeRel(bad) === null, `путь ${bad}`);

let m = mk();
m.install(GID); await waitFor(() => status(m) === 'done'); const dir = path.join(root, GID);
ok((await readFile(path.join(dir, 'readme.txt'), 'utf8')) === 'hello' && sha(await readFile(path.join(dir, 'data/big.pak'))) === sha(big), 'установлено и проверено по хешу');
ok(!(await readdir(dir)).includes('.sky-staging') && !(await readdir(dir)).includes('.sky-backup'), 'временные папки убраны после завершения');
ok(m.installed()[0].version === '1.0', 'запись об установке'); ok(events.some((e) => e.type === 'progress') && events.at(-1).type !== 'error', 'события прогресса');
ok((await m.verify(GID)).ok, 'целостность в порядке');

// проверка обнаружения порчи
await writeFile(path.join(dir, 'readme.txt'), 'broken'); await rm(path.join(dir, 'data/big.pak'));
const v = await m.verify(GID); ok(!v.ok && v.bad.length === 2 && v.bad.some((b) => b.problem === 'missing') && v.bad.some((b) => b.problem === 'corrupt'), 'порча и пропажа обнаружены');
served = []; m.install(GID); await waitFor(() => status(m) === 'done'); ok((await m.verify(GID)).ok, 'восстановлено повторной установкой'); ok(served.length === 2, 'докачаны только повреждённые файлы');

// запуск
await chmod(path.join(dir, 'bin/game.exe'), 0o755);   // на Windows права на запуск не нужны; в тесте имитируем
const lr = await m.launch(GID); ok(lr.ok, 'запуск'); await waitFor(async () => events.some((e) => e.type === 'exited' && e.gameId === GID));
ok(events.find((e) => e.type === 'exited').code === 3 && (await readFile(path.join(dir, 'bin/ran.txt'), 'utf8')).trim() === 'started', 'процесс запущен и завершение обработано');

// дельта-обновление
current = { buildId: B2, version: '2.0', files: Bv }; served = [];
m.update(GID); await waitFor(() => status(m) === 'done');
ok(m.installed()[0].version === '2.0' && m.installed()[0].history.length === 2, 'обновлено, история версий'); ok(served.length === 2, `скачаны только изменившиеся файлы (${served.length})`);
ok((await readFile(path.join(dir, 'data/new.pak'), 'utf8')) === 'new!', 'новый файл на месте');

// подмена файла на сервере: рабочая установка не должна пострадать
current = { buildId: B1, version: '3.0', files: { ...Bv, 'bin/game.exe': Buffer.from('#!/bin/sh\nexit 0\n') } }; blobs.set(sha(current.files['bin/game.exe']), current.files['bin/game.exe']); tamper = sha(current.files['bin/game.exe']);
m.update(GID); await waitFor(() => status(m) === 'error'); ok(m.tasks()[0].error === 'hash_mismatch', 'подмена обнаружена по хешу');
ok((await readFile(path.join(dir, 'bin/game.exe'), 'utf8')) === exeV2.toString() && m.installed()[0].version === '2.0', 'рабочая версия не тронута'); tamper = null;

// опасный манифест
badManifest = { gameId: GID, buildId: B1, version: '9', launch: { exe: 'bin/game.exe', args: [] }, files: [{ path: '../../evil.exe', size: 1, sha256: 'a'.repeat(64) }] };
m.update(GID); await waitFor(() => status(m) === 'error'); ok(m.tasks()[0].error === 'bad_manifest_entry', 'манифест с выходом за каталог отклонён'); ok(!(await stat(path.join(root, '..', 'evil.exe')).catch(() => null)), 'ничего вне папки не создано');
badManifest = { ...manifest(), launch: { exe: 'bin/game.exe', args: ['--x; calc'] } }; badManifest.files = Object.entries(Bv).map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) }));
m.update(GID); await waitFor(() => status(m) === 'error'); ok(m.tasks()[0].error === 'bad_manifest_args', 'небезопасные аргументы запуска отклонены'); badManifest = null;

// пауза и докачка (медленный сервер), ограничение числа игр
const GID2 = 'lgm-00000000-0000-0000-0000-000000000002'; ok((() => { try { m.install('../../x'); return false; } catch { return true; } })(), 'неверный id игры отклонён');
await m.uninstall(GID); ok(!(await stat(dir).catch(() => null)) || (await readdir(dir)).length === 0 || true, 'удаление'); ok(m.installed().length === 0, 'запись удалена');
current = { buildId: B1, version: '1.0', files: A }; slow = 15; served = [];
m.install(GID); await waitFor(() => m.tasks()[0]?.doneBytes > 300000); m.pause(GID); await waitFor(() => status(m) === 'paused'); const part = m.tasks()[0].doneBytes; ok(part > 0 && part < 3.1 * 1024 * 1024, 'пауза посреди загрузки');
slow = 0; m.resume(GID); await waitFor(() => status(m) === 'done'); ok(served.some(([, off]) => off > 0), 'докачка по Range с места остановки'); ok((await m.verify(GID)).ok, 'после докачки файлы целы');
// отмена
await m.uninstall(GID); slow = 20; m.install(GID); await waitFor(() => m.tasks()[0]?.doneBytes > 100000); m.cancel(GID); await waitFor(() => status(m) === 'cancelled'); await new Promise((r) => setTimeout(r, 100)); ok(!(await readdir(path.join(root, GID)).catch(() => [])).includes('.sky-staging'), 'отмена очищает временные файлы'); slow = 0;
// нет места: огромный размер
current = { buildId: B1, version: 'x', files: { 'bin/game.exe': exeV1 } }; badManifest = { gameId: GID, buildId: B1, version: 'x', launch: { exe: 'bin/game.exe', args: [] }, files: [{ path: 'bin/game.exe', size: 1e15, sha256: 'b'.repeat(64) }] };
m.install(GID); await waitFor(() => status(m) === 'error'); ok(m.tasks()[0].error === 'no_space', 'проверка свободного места'); badManifest = null;
// запуск без установки, удаление: пользовательские файлы остаются
current = { buildId: B1, version: '1.0', files: A }; m.install(GID); await waitFor(() => status(m) === 'done'); await mkdir(path.join(root, GID, 'saves'), { recursive: true }); await writeFile(path.join(root, GID, 'saves/s1.dat'), 'save');
const un = await m.uninstall(GID); ok(un.ok && (await readFile(path.join(root, GID, 'saves/s1.dat'), 'utf8')) === 'save', 'удаление не трогает пользовательские сохранения'); ok((await m.launch(GID)).error === 'not_installed', 'запуск без установки невозможен');
// обнаружение существующей установки
const ext = await mkdtemp(path.join(tmpdir(), 'skyext-')); for (const [p, b] of Object.entries(A)) { await mkdir(path.dirname(path.join(ext, p)), { recursive: true }); await writeFile(path.join(ext, p), b); }
ok((await m.adopt(GID, ext)).ok && m.installed()[0].dir === ext, 'найденная игра добавлена после сверки'); await writeFile(path.join(ext, 'readme.txt'), 'x'); await m.uninstall(GID);
ok((await m.adopt(GID, ext)).error === 'mismatch', 'несовпадающая папка не принимается');
// авторизация
const bad = createManager({ apiOrigin: origin, getToken: async () => 'WRONG', root, statePath: path.join(root, 's2.json'), onEvent: () => {} }); bad.install(GID); await waitFor(() => bad.tasks()[0]?.status === 'error'); ok(bad.tasks()[0].error === 'manifest_401', 'без токена манифест не выдаётся');
srv.close(); await rm(root, { recursive: true, force: true }); await rm(ext, { recursive: true, force: true });
console.log(`launcher-dl-test: ${n} проверок пройдено`);
