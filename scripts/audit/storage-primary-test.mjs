// Sky Storage: основное хранение медиа в S3. Поддельный S3 на :9956, отдельный каталог данных.
//   . env.sh; node scripts/audit/storage-primary-test.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync, existsSync, utimesSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const readAll = async (s) => { const c = []; for await (const x of s) c.push(x); return Buffer.concat(c); };
const dir = mkdtempSync(join(tmpdir(), 'primary-'));
process.env.MUSIC_DIR = join(dir, 'music');
process.env.STORAGE_PRIMARY = 's3';
process.env.STORAGE_PRIMARY_CACHE_DAYS = '1';
Object.assign(process.env, { STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9956', STORAGE_S3_BUCKET: 'skymedia', STORAGE_S3_ACCESS_KEY: 'AKFAKE', STORAGE_S3_SECRET_KEY: 'fake-secret-0123456789', STORAGE_S3_PREFIX: 'sky/', STORAGE_S3_TIMEOUT_MS: '1500' });

const fake = { objs: new Map(), down: false, ranges: [], bytesServed: 0, gets: 0 };
const srv = http.createServer((req, res) => {
  const ch = []; req.on('data', (c) => ch.push(c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const body = Buffer.concat(ch);
    const send = (c, x = '', h = {}) => { res.writeHead(c, h); res.end(x); };
    if (fake.down) return send(503, '<Error><Code>ServiceUnavailable</Code></Error>');
    const key = decodeURIComponent(u.pathname.replace(/^\/[^/]+\//, ''));
    const isBucket = /^\/[^/]+\/?$/.test(u.pathname);
    if (req.method === 'GET' && isBucket) {
      const prefix = u.searchParams.get('prefix') ?? '';
      return send(200, `<ListBucketResult><IsTruncated>false</IsTruncated>${[...fake.objs].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    if (req.method === 'PUT') { fake.objs.set(key, body); return send(200, '', { etag: '"e"' }); }
    if (req.method === 'HEAD') { const o = fake.objs.get(key); return o ? send(200, '', { 'content-length': o.length }) : send(404); }
    if (req.method === 'GET') {
      const o = fake.objs.get(key); if (!o) return send(404, '<Error><Code>NoSuchKey</Code></Error>');
      fake.gets += 1;
      const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (r) { const part = o.subarray(Number(r[1]), r[2] ? Number(r[2]) + 1 : undefined); fake.ranges.push(req.headers.range); fake.bytesServed += part.length; return send(206, part, { 'content-length': part.length }); }
      fake.bytesServed += o.length; return send(200, o, { 'content-length': o.length });
    }
    if (req.method === 'DELETE') { fake.objs.delete(key); return send(204); }
    send(400);
  });
});
await new Promise((r) => srv.listen(9956, '127.0.0.1', r));

const MS = await import('../../server/musicstore.mjs');
const P = await import('../../server/skystorageprimary.mjs');
const MC = await import('../../server/mediacrypto.mjs');
const L = await import('../../server/skystoragelimits.mjs');
const newId = () => `trk-${crypto.randomUUID()}`;
const pathOf = (id) => join(MS.musicRoot(), id.slice(4, 6), id);
const BIG = crypto.randomBytes(12 * 1024 * 1024);

t('режим включён только при STORAGE_PRIMARY=s3 и настроенном S3', P.enabled() === true);
const a = newId();
const r = await MS.saveStream(a, Readable.from([BIG]), 100 * 1024 * 1024);
t('запись: файл сохранён', !r.error && r.bytes === BIG.length, JSON.stringify(r));
const key = P.keyFor(pathOf(a));
t('запись: объект лежит в S3 под ключом media/…', fake.objs.has(`sky/${key}`) && key.startsWith('media/'), key);
t('запись: объект в S3 — шифротекст (открытых данных нет)', fake.objs.get(`sky/${key}`).indexOf(BIG.subarray(1000, 1064)) === -1);
t('запись: размер в S3 равен локальному', fake.objs.get(`sky/${key}`).length === (await (await import('node:fs/promises')).stat(pathOf(a))).size);

// «Убрали с диска» — читаем из S3
rmSync(pathOf(a));
t('чтение без локального файла: размер верный', (await MS.sizeOf(a)) === BIG.length);
fake.ranges = []; fake.bytesServed = 0;
const mid = await readAll(MS.openStream(a, { start: 5_000_000, end: 5_000_999 }));
t('чтение без локального файла: диапазон расшифровывается верно', mid.equals(BIG.subarray(5_000_000, 5_001_000)));
t('перемотка не скачивает файл целиком (диапазонные запросы)', fake.ranges.length > 0 && fake.bytesServed < 12 * 1024 * 1024 / 2, `${fake.bytesServed}`);
const whole = await readAll(MS.openStream(a, null));
t('полное чтение из S3 совпадает с оригиналом', whole.equals(BIG));
t('локальный файл при чтении не воскрешается (кэш не раздувается)', !existsSync(pathOf(a)));
t('поиск файла находит объект, которого нет на диске', (await L.locateFile('music', a)) === pathOf(a));

// Повреждение в S3 обнаруживается
const b = newId();
await MS.saveStream(b, Readable.from([Buffer.alloc(300000, 7)]), 1e8);
const kb = `sky/${P.keyFor(pathOf(b))}`; const o = Buffer.from(fake.objs.get(kb)); o[200000] ^= 1; fake.objs.set(kb, o); rmSync(pathOf(b));
let corrupt = false; try { await readAll(MS.openStream(b, null)); } catch { corrupt = true; }
t('подмена байта в S3 обнаруживается при чтении', corrupt);

// Сбой S3 при записи — файл не остаётся, ошибка видна
fake.down = true;
const c = newId();
const rc = await MS.saveStream(c, Readable.from([Buffer.alloc(5000, 1)]), 1e8);
t('S3 недоступен при записи: отказ с понятным кодом', rc.error === 'storage_provider_unavailable', JSON.stringify(rc));
t('S3 недоступен при записи: локальный файл не оставлен', !existsSync(pathOf(c)));
// Сбой при чтении (кэш блоков сброшен, иначе ответ придёт из памяти)
P._reset();
let blocked = ''; try { await readAll(MS.openStream(a, { start: 0, end: 10 })); } catch (e) { blocked = e.code ?? e.name; }
t('S3 недоступен при чтении: ошибка хранилища, а не «файла нет»', blocked === 'storage_provider_unavailable', blocked);
fake.down = false;

// Удаление
const d = newId();
await MS.saveStream(d, Readable.from([Buffer.alloc(2000, 3)]), 1e8);
await MS.remove(d);
t('удаление: убрано и с диска, и из S3', !existsSync(pathOf(d)) && !fake.objs.has(`sky/${P.keyFor(pathOf(d))}`));
fake.down = true; const e2 = newId(); fake.down = false;
await MS.saveStream(e2, Readable.from([Buffer.alloc(2000, 4)]), 1e8);
fake.down = true; let rmErr = ''; try { await MS.remove(e2); } catch (e) { rmErr = e.code; } fake.down = false;
t('удаление при недоступном S3: ошибка и локальный файл цел (не рассинхронизируем)', rmErr === 'storage_provider_unavailable' && existsSync(pathOf(e2)));

// Синхронизация и вытеснение кэша
process.env.STORAGE_PRIMARY = '';
const f = newId();
await MS.saveStream(f, Readable.from([Buffer.alloc(4000, 9)]), 1e8);   // записан «до включения режима»
t('до включения режима объекта в S3 нет', !fake.objs.has(`sky/${P.keyFor(pathOf(f))}`));
process.env.STORAGE_PRIMARY = 's3';
const old = new Date(Date.now() - 3 * 86400_000);
for (const id of [f, e2]) utimesSync(pathOf(id), old, old);
const sres = await P.syncAndEvict([MS.musicRoot()]);
t('синхронизация догружает старые файлы в S3', fake.objs.has(`sky/${P.keyFor(pathOf(f))}`) && sres.uploaded >= 1, JSON.stringify(sres));
t('кэш: давние файлы убраны с диска только после подтверждения в S3', !existsSync(pathOf(f)) && sres.evicted >= 1);
t('кэш: убранный файл читается из S3', (await readAll(MS.openStream(f, null))).equals(Buffer.alloc(4000, 9)));
const g = newId();
await MS.saveStream(g, Readable.from([Buffer.alloc(100, 5)]), 1e8);
await P.syncAndEvict([MS.musicRoot()]);
t('кэш: свежие файлы остаются на диске', existsSync(pathOf(g)));
// Возврат на диск (перед отключением режима)
t('возврат на диск: файл из S3 скачивается и читается локально', (await P.ensureLocal(pathOf(f))) === true && existsSync(pathOf(f)) && (await readAll(MS.openStream(f, null))).equals(Buffer.alloc(4000, 9)));
// Список в S3
const rem = await P.listRemote(MS.musicRoot());
t('реестр видит файлы, которых нет на диске', rem.some((x) => x.path === pathOf(f)));
// Выключено — прежнее поведение
process.env.STORAGE_PRIMARY = '';
const h = newId(); const before = fake.objs.size;
await MS.saveStream(h, Readable.from([Buffer.alloc(100, 6)]), 1e8);
t('режим выключен: запись только на диск, как раньше', fake.objs.size === before && existsSync(pathOf(h)));

rmSync(dir, { recursive: true, force: true });
srv.close();
console.log(`\nитого: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
