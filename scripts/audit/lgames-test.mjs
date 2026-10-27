// Sky Game Launcher: сервер на настоящей базе — карточки, загрузка сборок, оплата 499 ₽, модерация, библиотека, доступ к файлам.
// DATABASE_URL=… REDIS_URL=… LAUNCHER_DIR=/tmp/lch node scripts/audit/lgames-test.mjs
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
process.env.LAUNCHER_DIR = process.env.LAUNCHER_DIR || '/tmp/lch';
const { query, pool } = await import('../../server/db.mjs');
const G = await import('../../server/lgames.mjs');
const { wallet } = await import('../../server/wallet.mjs');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };
const sfx = Date.now().toString(36);
const mkP = async (t, funds = 0) => { const id = `acc-g${t}${sfx}`; await query(`INSERT INTO sky_ids (id, email) VALUES ($1,$2)`, [`sky-${id}`, `${id}@t.test`]); await query(`INSERT INTO profiles (id, username, name, sky_id) VALUES ($1,$2,$3,$4)`, [id, `g${t}${sfx}`, `G${t}`, `sky-${id}`]);
  if (funds) { await query(`INSERT INTO wallet_accounts (user_id, balance) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET balance=$2`, [id, funds]); } return id; };
const owner = await mkP('o', 1000); const dev = await mkP('d'); const pub = await mkP('p'); const ana = await mkP('a'); const stranger = await mkP('s'); const admin = await mkP('m'); const player = await mkP('y');
const bal = async (u) => Number((await query('SELECT balance FROM wallet_accounts WHERE user_id=$1', [u])).rows[0]?.balance ?? 0);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50, 1)]);
const up = (u, bid, path, content) => G.receiveFile(u, bid, path, Readable.from([Buffer.from(content)]), Buffer.byteLength(content));

// пути
for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'C:/x', 'a\\b', 'con.txt', 'a/./b', 'x/', '', 'a'.repeat(300), 'a/b.', 'a\u0000b']) ok(G.safeRelPath(bad) === null, `путь отклонён: ${JSON.stringify(bad).slice(0, 20)}`);
ok(G.safeRelPath('bin/game.exe') === 'bin/game.exe', 'нормальный путь');

// карточка
const c = await G.createGame(owner, { title: 'Space Test', descr: 'Описание игры подлиннее тридцати знаков.', genres: ['Экшен', 'Нет такого'], developer: 'Dev', os: ['windows', 'amiga'], requirements: { cpu: 'i5', ram: '8 GB', disk: '5 GB', evil: 'x' }, links: { site: 'https://example.com' } });
ok(c.ok, 'игра создана'); const gid = c.id;
const g1 = await G.myGame(owner, gid); ok(g1.game.genres.join() === 'Экшен' && g1.game.os.join() === 'windows' && !g1.game.requirements.evil, 'поля очищены по списку');
ok((await G.saveGame(owner, gid, { links: { site: 'http://x.y' } })).error === 'invalid', 'ссылки только https'); ok((await G.saveGame(stranger, gid, { title: 'Hack' })).error === 'not_found', 'чужую карточку не править');
ok((await G.myGame(stranger, gid)).error === 'not_found', 'чужой кабинет закрыт');
ok((await G.addMember(owner, gid, `g${'d'}${sfx}`, 'developer')).ok && (await G.addMember(owner, gid, `g${'p'}${sfx}`, 'publisher')).ok && (await G.addMember(owner, gid, `g${'a'}${sfx}`, 'analyst')).ok, 'участники');
ok((await G.addMember(dev, gid, 'x', 'developer')).error === 'not_found', 'разработчик не управляет командой');
ok((await G.saveGame(ana, gid, { title: 'Nope' })).error === 'not_found', 'аналитик не правит карточку');
ok((await G.addMedia(owner, gid, 'cover', Buffer.from('not an image'))).error === 'bad_image', 'не картинка');
ok((await G.addMedia(owner, gid, 'cover', PNG)).ok && (await G.addMedia(owner, gid, 'screenshot', PNG)).ok, 'обложка и скриншот');

// сборка
const bd = await G.createBuild(dev, gid, { version: '1.0.0' }); ok(bd.ok, 'сборка создана'); ok((await G.createBuild(dev, gid, { version: '../1' })).error === 'bad_version', 'версия с путём');
ok((await G.createBuild(stranger, gid, { version: '9' })).error === 'not_found', 'чужой не создаёт сборки'); ok((await G.createBuild(pub, gid, { version: '9' })).error === 'not_found', 'менеджер публикаций не грузит файлы');
const f1 = await up(dev, bd.id, 'bin/game.exe', 'EXE-CONTENT'); const f2 = await up(dev, bd.id, 'data/a.pak', 'DATA-1');
ok(f1.sha256 === createHash('sha256').update('EXE-CONTENT').digest('hex') && f1.size === 11, 'хеш и размер считает сервер');
ok((await readFile(`${process.env.LAUNCHER_DIR}/blobs/${f1.sha256.slice(0, 2)}/${f1.sha256}`, 'utf8')) === 'EXE-CONTENT', 'файл на диске по хешу');
ok((await up(dev, bd.id, '../evil.exe', 'x')).error === 'bad_path', 'выход за каталог'); ok((await up(dev, bd.id, 'Bin/GAME.exe', 'x')).error === 'path_case_conflict', 'конфликт регистра');
ok((await G.receiveFile(dev, bd.id, 'x.bin', Readable.from([Buffer.from('abc')]), 99)).error === 'size_mismatch', 'размер не совпал с заявленным');
ok((await G.finalizeBuild(dev, bd.id, { launchExe: 'bin/missing.exe' })).error === 'bad_launch_exe', 'exe должен быть в сборке');
ok((await G.finalizeBuild(dev, bd.id, { launchExe: 'bin/game.exe', launchArgs: ['--x; rm -rf /'] })).error === 'bad_launch_args', 'аргументы по шаблону');
const fin = await G.finalizeBuild(dev, bd.id, { launchExe: 'bin/game.exe', launchArgs: ['-windowed'] }); ok(fin.ok && fin.scan.status === 'not_run', 'сборка закрыта, антивирус не настроен — честный статус');
ok((await up(dev, bd.id, 'late.txt', 'x')).error === 'build_closed', 'после закрытия файлы не принимаются');

// оплата и заявка
const pl = await G.placementState(owner, gid); ok(pl.priceRub === 499 && pl.terms.refund, 'условия и цена');
ok((await G.submitGame(dev, gid, 'idem-aaaaaaaa')).error === 'not_found', 'подать заявку может только владелец');
ok((await G.submitGame(owner, gid, 'short')).error === 'idem_required', 'нужен ключ идемпотентности');
const poor = await mkP('poor', 100); const pg = (await G.createGame(poor, { title: 'Poor Game', descr: 'Описание игры подлиннее тридцати знаков.', genres: ['Инди'], developer: 'P', os: ['windows'], requirements: { cpu: 'x' } })).id;
await G.addMedia(poor, pg, 'cover', PNG); await G.addMedia(poor, pg, 'screenshot', PNG); const pb = (await G.createBuild(poor, pg, { version: '1' })).id; await G.receiveFile(poor, pb, 'g.exe', Readable.from([Buffer.from('x')]), 1); await G.finalizeBuild(poor, pb, { launchExe: 'g.exe' });
const nf = await G.submitGame(poor, pg, 'idem-poorpoor'); ok(nf.error === 'insufficient_funds' && (await bal(poor)) === 100, 'нехватка средств: деньги не списаны');
ok((await query(`SELECT count(*)::int AS n FROM launcher_orders WHERE game_id=$1`, [pg])).rows[0].n === 0, 'заказ не остался после отказа в оплате');
const miss = await G.createGame(owner, { title: 'Empty One' }); ok((await G.submitGame(owner, miss.id, 'idem-incomplete')).error === 'incomplete', 'неполная карточка не принимается');
const before = await bal(owner);
const s1 = await G.submitGame(owner, gid, 'idem-owner-001'); ok(s1.ok && s1.charged && (await bal(owner)) === before - 499, 'списано ровно 499');
const s2 = await G.submitGame(owner, gid, 'idem-owner-001'); ok(s2.duplicate && (await bal(owner)) === before - 499, 'повтор того же ключа не списывает');
ok((await G.submitGame(owner, gid, 'idem-owner-002')).error === 'bad_status', 'вторая заявка в проверке отклонена');
const paralel = await Promise.all([G.submitGame(poor, pg, 'idem-par-0001'), G.submitGame(poor, pg, 'idem-par-0001')]); ok(paralel.every((r) => r.error === 'insufficient_funds' || r.duplicate), 'параллельные повторы безопасны');
ok((await G.getManifest(player, gid)).error === 'not_available', 'неопубликованное недоступно');
ok((await G.listCatalog(player)).games.length === 0, 'в каталоге пока пусто');

// модерация
ok((await G.decideGame(owner, gid, 'approve')).error === 'self_review', 'свою игру не одобряют');
ok((await G.decideGame(admin, gid, 'needs_changes', 'x')).error === 'reason_required', 'причина обязательна');
ok((await G.decideGame(admin, gid, 'needs_changes', 'Добавьте больше скриншотов')).ok, 'вернули на доработку'); ok((await bal(owner)) === before - 499, 'доработка деньги не возвращает');
const s3 = await G.submitGame(owner, gid, 'idem-owner-003'); ok(s3.ok && s3.charged === false && (await bal(owner)) === before - 499, 'после доработки повторно не списывается');
const ap = await G.decideGame(admin, gid, 'approve'); ok(ap.ok, 'одобрено'); const live = await G.gameDetail(player, gid); ok(live.game.status === 'published' && live.game.build.version === '1.0.0', 'игра опубликована');
ok((await G.getManifest(player, gid)).error === 'not_in_library', 'без библиотеки манифест не выдаётся'); ok((await G.addToLibrary(player, gid)).ok, 'в библиотеку');
const mf = (await G.getManifest(player, gid)).manifest; ok(mf.files.length === 2 && mf.launch.exe === 'bin/game.exe' && mf.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)), 'манифест');
ok((await G.blobAccess(player, mf.buildId, f1.sha256)) !== null, 'игрок получает файл'); ok((await G.blobAccess(stranger, mf.buildId, f1.sha256)) === null, 'чужой без библиотеки — нет'); ok((await G.blobAccess(player, mf.buildId, 'a'.repeat(64))) === null, 'файл не из сборки — нет');
ok((await G.listCatalog(player)).games.length === 1 && (await G.listCatalog(player, { q: 'space' })).games.length === 1 && (await G.listCatalog(player, { q: '%' })).games.length === 0, 'каталог и поиск');

// новая версия: без автозамены; публикация; откат; блок
const b2 = (await G.createBuild(dev, gid, { version: '1.1.0', notes: 'Новая версия' })).id; await up(dev, b2, 'bin/game.exe', 'EXE-V2'); await up(dev, b2, 'data/a.pak', 'DATA-1'); await G.finalizeBuild(dev, b2, { launchExe: 'bin/game.exe' });
ok((await G.getManifest(player, gid)).manifest.version === '1.0.0', 'загрузка новой версии ничего не заменила'); ok((await G.publishBuild(pub, b2)).error === 'not_approved', 'без одобрения не опубликовать');
ok((await G.submitBuild(dev, b2)).error === 'forbidden', 'разработчик не отправляет на проверку'); ok((await G.submitBuild(owner, b2)).ok, 'владелец отправил');
ok((await G.decideBuild(admin, b2, 'approve')).ok, 'сборка одобрена'); ok((await G.getManifest(player, gid)).manifest.version === '1.0.0', 'одобрение само не публикует');
ok((await G.publishBuild(dev, b2)).error === 'not_found', 'разработчик не публикует'); ok((await G.publishBuild(pub, b2)).ok, 'менеджер публикаций выпустил');
ok((await G.getManifest(player, gid)).manifest.version === '1.1.0', 'версия обновилась'); ok((await G.getManifest(player, gid)).manifest.files.find((f) => f.path === 'data/a.pak').sha256 === f2.sha256, 'неизменённый файл тот же хеш (дельта)');
const old = (await query(`SELECT id FROM launcher_builds WHERE game_id=$1 AND version='1.0.0'`, [gid])).rows[0].id; ok((await G.publishBuild(pub, old)).ok && (await G.getManifest(player, gid)).manifest.version === '1.0.0', 'откат на прежнюю одобренную');
await G.publishBuild(pub, b2); ok((await G.decideBuild(admin, b2, 'block', 'Найден вирус')).ok && (await G.getManifest(player, gid)).manifest.version === '1.0.0', 'остановка опасной сборки откатывает на прежнюю');
ok((await G.blobAccess(player, b2, (await query(`SELECT sha256 FROM launcher_build_files WHERE build_id=$1 AND path='bin/game.exe'`, [b2])).rows[0].sha256)) === null, 'заблокированная сборка недоступна');
ok((await G.publishBuild(pub, b2)).error === 'build_blocked', 'заблокированную не выпустить');

// события, библиотека, статистика
ok((await G.recordEvent(player, gid, 'launch')).ok && (await G.recordEvent(player, gid, 'install_ok')).ok, 'события'); ok((await G.recordEvent(stranger, gid, 'launch')).error === 'not_found', 'события только от игроков библиотеки'); ok((await G.recordEvent(player, gid, 'rm')).error === 'bad_kind', 'неизвестный вид события');
ok((await G.gameStats(ana, gid)).events.launch === 1, 'аналитик видит статистику'); ok((await G.gameStats(stranger, gid)).error === 'not_found', 'чужая статистика закрыта'); ok(JSON.stringify(await G.gameStats(ana, gid)).indexOf(player) < 0, 'статистика без личных данных');
ok((await G.setFavorite(player, gid, true)).ok && (await G.listLibrary(player)).library[0].favorite && (await G.listLibrary(player)).library[0].playCount === 1, 'избранное и счётчик запусков');
ok((await G.removeFromLibrary(player, gid)).ok && (await G.addToLibrary(player, gid)).ok, 'удаление из библиотеки — отдельное явное действие, вернуть можно');

// снятие, блокировка, отклонение с возвратом
ok((await G.decideGame(admin, gid, 'unpublish', 'Временно снято')).ok && (await G.listCatalog(player)).games.length === 0, 'снято с публикации'); ok((await G.listLibrary(player)).library.length === 1, 'право игрока в библиотеке сохранилось');
ok((await G.decideGame(admin, gid, 'republish', '')).ok && (await G.listCatalog(player)).games.length === 1, 'возвращена');
const rj = (await G.createGame(owner, { title: 'Reject Me', descr: 'Описание игры подлиннее тридцати знаков.', genres: ['Инди'], developer: 'R', os: ['windows'], requirements: { cpu: 'x' } })).id;
await G.addMedia(owner, rj, 'cover', PNG); await G.addMedia(owner, rj, 'screenshot', PNG); const rb = (await G.createBuild(owner, rj, { version: '1' })).id; await G.receiveFile(owner, rb, 'g.exe', Readable.from([Buffer.from('r')]), 1); await G.finalizeBuild(owner, rb, { launchExe: 'g.exe' });
const b0 = await bal(owner); await G.submitGame(owner, rj, 'idem-reject-01'); ok((await bal(owner)) === b0 - 499, 'списано за вторую игру');
ok((await G.decideGame(admin, rj, 'reject', 'Нет прав на распространение')).ok && (await bal(owner)) === b0, 'отказ возвращает 499 полностью');
ok((await query(`SELECT status FROM launcher_orders WHERE game_id=$1`, [rj])).rows[0].status === 'refunded', 'заказ помечен возвращённым');
ok((await G.decideGame(admin, rj, 'reject', 'Нет прав на распространение')).error === 'bad_status' && (await bal(owner)) === b0, 'повторный возврат невозможен');
const bl = await G.decideGame(admin, gid, 'block', 'Нарушение правил'); ok(bl.ok, 'блокировка'); ok((await G.createBuild(dev, gid, { version: '2.0' })).error === 'blocked', 'у заблокированной игры нет новых сборок');

// передача владения
const g2 = (await G.createGame(owner, { title: 'Transfer Me' })).id;
ok((await G.proposeTransfer(owner, g2, `g${'s'}${sfx}`, 'Wrong title')).error === 'confirm_title', 'нужно подтвердить названием'); const tr = await G.proposeTransfer(owner, g2, `g${'s'}${sfx}`, 'Transfer Me'); ok(tr.ok, 'предложено');
ok((await G.answerTransfer(owner, tr.id, true)).error === 'not_found', 'принять может только получатель'); ok((await G.answerTransfer(stranger, tr.id, true)).ok, 'принято'); ok((await G.roleOf(g2, stranger)) === 'owner' && (await G.roleOf(g2, owner)) === 'developer', 'владелец сменился, прежний — разработчик');
// админ-списки
ok((await G.adminGames()).games.length > 0 && (await G.adminOwners()).owners.length > 0 && (await G.adminQueues()).storage.blobs > 0, 'админские списки');
ok((await G.adminGame(gid)).log.length > 3, 'журнал модерации');
await pool.end(); console.log(`lgames-test: ${n} проверок пройдено`);
