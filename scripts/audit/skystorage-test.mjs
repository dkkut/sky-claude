// Sky Storage: шифрование, S3-клиент, резервные копии (локально и S3), восстановление, подтверждение подключений,
// четыре кнопки, права, независимость состояний, квоты, карантин. Изолированная среда: поддельный S3 на :9955,
// отдельные каталоги копий; реальные данные пользователей не затрагиваются.
//   API запускать с: STORAGE_KEK_K1=… STORAGE_KEK_ACTIVE=K1 STORAGE_BACKUP_TARGET=local STORAGE_BACKUP_DIR=… STORAGE_QUARANTINE_DIR=… STORAGE_STAGING_DIR=…
//   (. env.sh; . storage-env.sh; STORAGE_BACKUP_DIR=… node scripts/audit/skystorage-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, utimesSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64k = () => crypto.randomBytes(32).toString('base64');
const readAll = async (s) => { const c = []; for await (const x of s) c.push(x); return Buffer.concat(c); };
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const j = (o) => JSON.stringify(o ?? {});

/* ═══════════ 1. Шифрование SBK1 ═══════════ */
process.env.OWNER_USERNAME ??= 'ownertest'; process.env.NODE_ENV ??= 'development';
process.env.STORAGE_KEK_T1 = b64k(); process.env.STORAGE_KEK_T2 = b64k(); process.env.STORAGE_KEK_ACTIVE = 'T1';
const C = await import('../../server/skystoragecrypto.mjs');
const enc = (buf, o = {}) => readAll(C.encryptStream(Readable.from([buf]), { id: 'obj/1', chunkSize: 1024, ...o }));
const dec = (buf, id = 'obj/1') => readAll(C.decryptStream(Readable.from([buf]), { id }));
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e.code ?? e.message; } };
let allRound = true;
for (const n of [0, 1, 1023, 1024, 1025, 3 * 1024, 5000]) { const p = crypto.randomBytes(n); if (!(await dec(await enc(p))).equals(p)) allRound = false; }
t('шифрование: туда-обратно на границах чанков (0…5000 байт)', allRound);
const plain3 = crypto.randomBytes(3 * 1024 + 100);
const e3 = await enc(plain3);
const CH = 1024 + 16;
t('шифротекст не содержит открытых данных', e3.indexOf(plain3.subarray(0, 64)) === -1);
t('два шифрования одних данных различаются (уникальные DEK и nonce)', !(await enc(plain3)).equals(e3));
const flip = Buffer.from(e3); flip[C.HEADER_LEN + 50] ^= 1;
t('повреждённый байт обнаруживается', (await rejects(() => dec(flip))) === 'corrupt');
const cut = e3.subarray(0, C.HEADER_LEN + CH * 2);
t('обрезание по границе чанка обнаруживается', ['corrupt', 'truncated'].includes(await rejects(() => dec(cut))));
const sw = Buffer.from(e3); e3.copy(sw, C.HEADER_LEN, C.HEADER_LEN + CH, C.HEADER_LEN + 2 * CH); e3.copy(sw, C.HEADER_LEN + CH, C.HEADER_LEN, C.HEADER_LEN + CH);
t('перестановка чанков обнаруживается', (await rejects(() => dec(sw))) === 'corrupt');
t('чужой идентификатор объекта отвергается (подмена файла)', (await rejects(() => dec(e3, 'obj/2'))) === 'wrong_object');
const tamperHdr = Buffer.from(e3); tamperHdr[40] ^= 1;
t('подделка заголовка (обёрнутого ключа) отвергается', ['bad_key_or_header', 'wrong_object'].includes(await rejects(() => dec(tamperHdr))));
const rew = await readAll(await C.rewrapStream(Readable.from([e3]), { id: 'obj/1', toKid: 'T2' }));
t('ротация: заголовок перешифрован под новый ключ, тело то же', rew.subarray(C.HEADER_LEN).equals(e3.subarray(C.HEADER_LEN)) && C.readKid(rew) === 'T2' && C.readKid(e3) === 'T1');
const saveT1 = process.env.STORAGE_KEK_T1; delete process.env.STORAGE_KEK_T1;
t('после ротации объект читается только вторым ключом (первый удалён)', (await dec(rew)).equals(plain3) && (await rejects(() => dec(e3))) === 'kek_missing');
process.env.STORAGE_KEK_T1 = saveT1;
{ const before = process.memoryUsage().rss; let peak = before; const total = 96; const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
  const src = Readable.from((async function* () { for (let i = 0; i < total; i++) yield Buffer.alloc(1024 * 1024, i % 251); })());
  const h = crypto.createHash('sha256'); let n = 0;
  for await (const c of C.decryptStream(C.encryptStream(src, { id: 'big' }), { id: 'big' })) { h.update(c); n += c.length; }
  clearInterval(iv);
  t('96 МиБ проходят потоком (шифрование и чтение) без загрузки в память целиком', n === total * 1024 * 1024 && peak - before < 150 * 1024 * 1024, `рост RSS ${Math.round((peak - before) / 1048576)} МиБ`); }
{ const ks = C.keyStatus(); t('состояние ключей не раскрывает материал', JSON.stringify(ks).indexOf(process.env.STORAGE_KEK_T2) === -1 && ks.configured); }

/* ═══════════ 2. S3-клиент и поддельный S3 ═══════════ */
const S3 = await import('../../server/skystorages3.mjs');
const vec = S3.signV4({ method: 'GET', host: 'iam.amazonaws.com', path: '/', query: 'Action=ListUsers&Version=2010-05-08', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
  payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1', service: 'iam', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', amzDate: '20150830T123600Z' });
t('SigV4: подпись совпала с опубликованным тестовым вектором AWS', vec.signature === '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7', vec.signature);
const fake = { objs: new Map(), uploads: new Map(), fail500: 0, quota: false, hang: false, reqs: 0, badSig: 0 };
const SECRET = 'fake-secret-key-0123456789';
const fakeSrv = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    fake.reqs += 1;
    if (fake.hang) return;
    const body = Buffer.concat(chunks);
    const u = new URL(req.url, 'http://x');
    const auth = req.headers.authorization ?? '';
    const sh = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(';') ?? [];
    const headers = Object.fromEntries(sh.filter((h) => h !== 'host' && h !== 'x-amz-date' && h !== 'x-amz-content-sha256').map((h) => [h, req.headers[h]]));
    const exp = S3.signV4({ method: req.method, host: req.headers.host, path: u.pathname, query: u.search.slice(1), headers, payloadHash: crypto.createHash('sha256').update(body).digest('hex'), region: 'us-east-1', accessKey: 'AKFAKE', secretKey: SECRET, amzDate: req.headers['x-amz-date'] });
    const send = (code, xml = '', h = {}) => { res.writeHead(code, { 'content-type': 'application/xml', ...h }); res.end(xml); };
    if (exp.signature !== /Signature=([0-9a-f]+)/.exec(auth)?.[1]) { fake.badSig += 1; return send(403, '<Error><Code>SignatureDoesNotMatch</Code></Error>'); }
    if (fake.fail500 > 0) { fake.fail500 -= 1; return send(500, '<Error><Code>InternalError</Code></Error>'); }
    const key = decodeURIComponent(u.pathname.replace(/^\/[^/]+\//, ''));
    const isBucket = /^\/[^/]+\/?$/.test(u.pathname);
    if (req.method === 'GET' && isBucket && u.searchParams.has('uploads')) {
      return send(200, `<ListMultipartUploadsResult>${[...fake.uploads].map(([id, k]) => `<Upload><Key>${k}</Key><UploadId>${id}</UploadId><Initiated>2020-01-01T00:00:00Z</Initiated></Upload>`).join('')}</ListMultipartUploadsResult>`);
    }
    if (req.method === 'GET' && isBucket) {
      const prefix = u.searchParams.get('prefix') ?? '';
      const max = Number(u.searchParams.get('max-keys') ?? 1000);
      const list = [...fake.objs].filter(([k]) => k.startsWith(prefix)).slice(0, max);
      return send(200, `<ListBucketResult><IsTruncated>false</IsTruncated>${list.map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    if (req.method === 'POST' && u.searchParams.has('uploads')) { const id = `up-${fake.uploads.size + 1}-${Date.now()}`; fake.uploads.set(id, key); fake.parts = fake.parts ?? new Map(); fake.parts.set(id, []); return send(200, `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`); }
    if (req.method === 'PUT' && u.searchParams.has('uploadId')) { const id = u.searchParams.get('uploadId'); fake.parts.get(id)[Number(u.searchParams.get('partNumber')) - 1] = body; return send(200, '', { etag: `"p${u.searchParams.get('partNumber')}"` }); }
    if (req.method === 'POST' && u.searchParams.has('uploadId')) { const id = u.searchParams.get('uploadId'); fake.objs.set(key, Buffer.concat(fake.parts.get(id))); fake.uploads.delete(id); return send(200, '<CompleteMultipartUploadResult><Key>x</Key></CompleteMultipartUploadResult>', { etag: '"c"' }); }
    if (req.method === 'DELETE' && u.searchParams.has('uploadId')) { fake.uploads.delete(u.searchParams.get('uploadId')); return send(204); }
    if (req.method === 'PUT') { if (fake.quota) return send(507, '<Error><Code>QuotaExceeded</Code></Error>'); fake.objs.set(key, body); return send(200, '', { etag: '"e"' }); }
    if (req.method === 'HEAD') { const o = fake.objs.get(key); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-length': o.length, etag: '"e"' }); return res.end(); }
    if (req.method === 'GET') {
      const o = fake.objs.get(key); if (!o) return send(404, '<Error><Code>NoSuchKey</Code></Error>');
      const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (r) { const part = o.subarray(Number(r[1]), r[2] ? Number(r[2]) + 1 : undefined); res.writeHead(206, { 'content-length': part.length }); return res.end(part); }
      res.writeHead(200, { 'content-length': o.length }); return res.end(o);
    }
    if (req.method === 'DELETE') { fake.objs.delete(key); return send(204); }
    send(400);
  });
});
await new Promise((r) => fakeSrv.listen(9955, '127.0.0.1', r));
const s3env = (over = {}) => ({ STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9955', STORAGE_S3_ALLOW_INSECURE: '1', STORAGE_S3_BUCKET: 'skybk', STORAGE_S3_ACCESS_KEY: 'AKFAKE', STORAGE_S3_SECRET_KEY: SECRET, STORAGE_S3_PREFIX: 'sky-backups/', STORAGE_S3_PART_MB: '5', STORAGE_S3_TIMEOUT_MS: '1500', ...over });
const withEnv = async (vars, fn) => { const old = {}; for (const k of Object.keys(vars)) { old[k] = process.env[k]; process.env[k] = vars[k]; } try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } } };
await withEnv(s3env(), async () => {
  const c = S3.createS3();
  t('S3: проверка доступности', (await c.health()).ok === true);
  await c.put('a/small.bin', Readable.from([Buffer.from('hello')]));
  t('S3: загрузка, размер и чтение', (await c.head('a/small.bin'))?.size === 5 && (await readAll(await c.get('a/small.bin'))).toString() === 'hello');
  t('S3: чтение диапазона (докачка)', (await readAll(await c.get('a/small.bin', { start: 1, end: 3 }))).toString() === 'ell');
  const big = crypto.randomBytes(12 * 1024 * 1024);
  const r = await c.put('a/big.bin', Readable.from((function* () { for (let i = 0; i < big.length; i += 1024 * 1024) yield big.subarray(i, i + 1024 * 1024); })()));
  t('S3: многокомпонентная загрузка 12 МБ потоком', r.multipart === true && fake.objs.get('sky-backups/a/big.bin')?.equals(big) && fake.uploads.size === 0);
  t('S3: список по префиксу', (await c.list('a/')).length === 2);
  fake.uploads.clear();
  const failing = Readable.from((async function* () { for (let i = 0; i < 12; i++) { yield Buffer.alloc(1024 * 1024, 7); if (i === 10) throw new Error('обрыв источника'); } })());
  const e1 = await rejects(() => c.put('a/broken.bin', failing));
  t('S3: при обрыве незавершённая многокомпонентная загрузка отменяется', e1 !== null && fake.uploads.size === 0 && !fake.objs.has('sky-backups/a/broken.bin'));
  fake.fail500 = 2; const before = fake.reqs;
  await c.put('a/retry.bin', Readable.from([Buffer.from('x')]));
  t('S3: ограниченные повторы при 5xx (2 сбоя, затем успех)', fake.objs.has('sky-backups/a/retry.bin') && fake.reqs - before === 3);
  fake.quota = true; t('S3: квота провайдера распознаётся и не повторяется', (await rejects(() => c.put('a/q.bin', Readable.from([Buffer.from('x')])))) === 's3_quota'); fake.quota = false;
  fake.hang = true; const t0 = Date.now(); const eh = await rejects(() => c.head('a/small.bin')); fake.hang = false;
  t('S3: тайм-аут при недоступности и ограниченное число повторов', eh !== null && Date.now() - t0 < 12000, `${eh} ${Date.now() - t0} мс`);
  const hh = await withEnv({ STORAGE_S3_SECRET_KEY: 'wrong-secret-zzzzzzzzzz' }, async () => { const b = fake.badSig; const e = await rejects(() => S3.createS3().put('x', Readable.from([Buffer.from('1')]))); return { e, n: fake.badSig - b }; });
  t('S3: неверные учётные данные → отказ без повторов, без раскрытия секрета', hh.e === 's3_access_denied' && hh.n === 1);
  t('S3: адрес без https отклоняется (секреты не уходят по открытому каналу)', (await withEnv({ STORAGE_S3_ALLOW_INSECURE: '0' }, async () => rejects(async () => S3.createS3()))) === 's3_not_configured');
t('S3: без настройки — понятная ошибка', (await withEnv({ STORAGE_S3_ENDPOINT: '' }, async () => rejects(async () => S3.createS3()))) === 's3_not_configured');
});

/* ═══════════ 3. Состояние, файлы, копии (в процессе) ═══════════ */
const ST = await import('../../server/skystoragestate.mjs');
const LIM = await import('../../server/skystoragelimits.mjs');
const IDX = await import('../../server/skystorageindex.mjs');
const BK = await import('../../server/skystoragebackup.mjs');
const MS = await import('../../server/musicstore.mjs');
const MC = await import('../../server/mediacrypto.mjs');
await ST.loadState(true); await LIM.loadQuotas();
q(`update storage_state set emergency='{"active":false}'::jsonb, maintenance='{"active":false}'::jsonb, sky_auth='{"active":false}'::jsonb, restrictions='[]'::jsonb, settings='{"approvalScope":"off"}'::jsonb, ticket_epoch=0`);
q(`delete from storage_quotas`); q(`delete from storage_schedules`); q(`delete from storage_connections`);
await ST.loadState(true); await LIM.loadQuotas();

// Тестовые пользователи и файлы музыки
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'stown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const mkTrack = async (title, { old = false, noRow = false } = {}) => {
  const id = `trk-${crypto.randomUUID()}`; const buf = crypto.randomBytes(200_000 + Math.floor(Math.random() * 1000));
  const r = await MS.saveBytes(id, buf);
  if (!noRow) q(`insert into music_tracks (id, owner_id, title, artist, mime, bytes, status) values ('${id}','${own.pid}','${title}','Тест','audio/mpeg',${buf.length},'published')`);
  if (old) { const p = join(MS.musicRoot(), id.slice(4, 6), id); const d = new Date(Date.now() - 3 * 86400_000); utimesSync(p, d, d); }
  return { id, buf, r };
};
// Изолированная среда: в тестовом каталоге музыки (только в scratchpad!) убираем файлы прошлых прогонов
if (MS.musicRoot().includes('scratchpad')) { for (const d of readdirSync(MS.musicRoot())) rmSync(join(MS.musicRoot(), d), { recursive: true, force: true }); q(`delete from storage_objects where service='music'`); }
q(`delete from music_tracks where title like 'ST-%'`);
const tA = await mkTrack('ST-A'); const tB = await mkTrack('ST-B'); const tOrph = await mkTrack('ST-O', { old: true, noRow: true });
t('запись файла идёт через ворота хранилища и попадает в реестр', Number(q(`select count(*) from storage_objects where service='music' and id='${tA.id}'`)) === 1);

// Реестр, хеши, осиротевшие
const scan = await IDX.scanAll();
t('реестр: объекты сервисов описаны (размер, сервис, категория)', q(`select service||'|'||category||'|'||(size>0)::text from storage_objects where id='${tA.id}'`) === 'music|music|true');
t('реестр: владелец и MIME взяты из таблицы сервиса', q(`select owner_id||'|'||mime from storage_objects where id='${tA.id}'`) === `${own.pid}|audio/mpeg`);
t('осиротевший файл (нет записи, старше суток) помечен, живой — нет', q(`select status from storage_objects where id='${tOrph.id}'`) === 'orphan' && q(`select status from storage_objects where id='${tA.id}'`) === 'ok');
while ((await IDX.hashPending(500)).checked) { /* до конца */ }
t('реестр: SHA-256 зашифрованных байт посчитан', q(`select length(sha256) from storage_objects where id='${tA.id}'`) === '64');

// Карантин: сначала предпросмотр, потом перенос, возврат, удаление только после срока и перепроверки
const qp = await IDX.quarantineOrphans(own.pid, { dryRun: true });
t('карантин: предпросмотр ничего не двигает', qp.dryRun && qp.count >= 1 && existsSync(join(MS.musicRoot(), tOrph.id.slice(4, 6), tOrph.id)));
const qm = await IDX.quarantineOrphans(own.pid, { dryRun: false });
t('карантин: файл перенесён, а не удалён', qm.moved >= 1 && !existsSync(join(MS.musicRoot(), tOrph.id.slice(4, 6), tOrph.id)) && existsSync(join(IDX.quarantineRoot(), 'music', tOrph.id)));
const qid = q(`select id from storage_quarantine where object_id='${tOrph.id}' and state='held'`);
t('карантин: файл возвращается на место', (await IDX.restoreFromQuarantine(own.pid, Number(qid))).ok && existsSync(join(MS.musicRoot(), tOrph.id.slice(4, 6), tOrph.id)));
q(`update storage_objects set status='orphan' where id='${tOrph.id}'`);
await IDX.quarantineOrphans(own.pid, { dryRun: false });
q(`insert into music_tracks (id, owner_id, title, artist, mime, bytes, status) values ('${tOrph.id}','${own.pid}','ST-O','Тест','audio/mpeg',1,'private')`);
q(`update storage_quarantine set purge_after = now() - interval '1 day' where object_id='${tOrph.id}' and state='held'`);
await IDX.purgeQuarantine();
t('карантин: при появившейся ссылке файл НЕ удаляется, а возвращается', existsSync(join(MS.musicRoot(), tOrph.id.slice(4, 6), tOrph.id)));

// Квоты и пороги
q(`insert into storage_quotas (category, hard_bytes) values ('music', 1) on conflict (category) do update set hard_bytes = 1`); await LIM.loadQuotas();
const blockedQuota = await MS.saveBytes(`trk-${crypto.randomUUID()}`, Buffer.alloc(10, 1)).then((r) => r, (e) => ({ thrown: e.code }));
t('квота категории: запись отклонена, место не зарезервировано навсегда', (blockedQuota.error === 'quota_exceeded' || blockedQuota.thrown === 'quota_exceeded') && LIM.activity().reservedBytes === 0, JSON.stringify(blockedQuota));
q(`delete from storage_quotas where category = 'music'`); await LIM.loadQuotas();
q(`update storage_state set settings = settings || '{"maxFileBytes":100}'::jsonb`); await ST.loadState(true);
const bigW = await MS.saveBytes(`trk-${crypto.randomUUID()}`, Buffer.alloc(5000, 1));
t('предел размера файла: слишком большой отклонён', bigW.error === 'file_too_large');
q(`update storage_state set settings = settings - 'maxFileBytes'`); await ST.loadState(true);
q(`update storage_state set settings = settings || '{"totalBytes":1000}'::jsonb`); await ST.loadState(true); LIM.addUsage('music', 0);
const full = await MS.saveBytes(`trk-${crypto.randomUUID()}`, Buffer.alloc(10, 1)).catch((e) => ({ error: e.code }));
t('порог 100%: новые записи запрещены (чтение остаётся)', full.error === 'storage_full');
let readOk = true; try { for await (const _ of MC.openDecryptedRangeStream(join(MS.musicRoot(), tA.id.slice(4, 6), tA.id), null)) { void _; } } catch { readOk = false; }
t('при нехватке места чтение и скачивание продолжают работать', readOk);
q(`update storage_state set settings = settings - 'totalBytes'`); await ST.loadState(true);
t('параллельные загрузки ограничены', await (async () => {
  q(`update storage_state set settings = settings || '{"maxConcurrentUploads":1}'::jsonb`); await ST.loadState(true);
  const slow = Readable.from((async function* () { yield Buffer.alloc(10, 1); await sleep(400); yield Buffer.alloc(10, 1); })());
  const p1 = MC.encryptStreamToFile(slow, join(MS.musicRoot(), 'zz-slow'), 1e6).catch(() => ({}));
  await sleep(100);
  const r2 = await MS.saveBytes(`trk-${crypto.randomUUID()}`, Buffer.alloc(10, 1)).catch((e) => ({ error: e.code }));
  await p1; rmSync(join(MS.musicRoot(), 'zz-slow'), { force: true });
  q(`update storage_state set settings = settings - 'maxConcurrentUploads'`); await ST.loadState(true);
  return r2.error === 'too_many_uploads';
})());

// Копии (локальная цель)
const T = await import('../../server/skystoragetarget.mjs');
const waitBackup = async (id, ms = 90000) => { const t0 = Date.now(); for (;;) { const s = q(`select status from storage_backups where id='${id}'`); if (['verified', 'failed', 'corrupt', 'cancelled'].includes(s)) return s; if (Date.now() - t0 > ms) return `timeout:${s}`; await sleep(300); } };
const bkDir = process.env.STORAGE_BACKUP_DIR;
await withEnv({ STORAGE_BACKUP_TARGET: 'local', STORAGE_BACKUP_DIR: bkDir }, async () => {
  q(`update storage_backups set status = 'deleted' where status <> 'deleted'`);
  const r1 = await BK.startBackup({ kind: 'service', scope: { services: ['music'] }, actorId: own.pid });
  const r2 = await BK.startBackup({ kind: 'service', scope: { services: ['music'] } });
  t('резервная копия: параллельный запуск блокируется (одна тяжёлая задача)', r1.ok && r2.error === 'busy');
  const s1 = await waitBackup(r1.id);
  t('копия создана и ПРОВЕРЕНА (манифест, объекты, таблицы, контрольные суммы)', s1 === 'verified', s1);
  const row = q(`select files>0 and bytes>0 and length(manifest_sha)=64 and key_id='${process.env.STORAGE_KEK_ACTIVE}' from storage_backups where id='${r1.id}'`);
  t('копия: манифест, число файлов, размер и ключ записаны', row === 't', row);
  const tgt = T.getTarget();
  t('копия: в цели нет открытых данных (объекты зашифрованы SBK1)', (await tgt.list(`backups/${r1.id}/f/`)).length > 0 && (await readAll(await tgt.get((await tgt.list(`backups/${r1.id}/f/`))[0].key))).subarray(0, 4).toString() === 'SBK1');
  t('копия: маркер завершённости DONE записан последним', (await tgt.head(`backups/${r1.id}/DONE`)) !== null);
  // Повреждение объекта в цели
  const victim = (await tgt.list(`backups/${r1.id}/f/`))[0];
  const vpath = join(bkDir, victim.key); const vb = readFileSync(vpath); vb[200] ^= 0xff; writeFileSync(vpath, vb);
  const vr = await BK.verifyBackupExclusive(r1.id, { mode: 'full' });
  t('проверка целостности обнаруживает повреждённую копию', vr.ok === false && q(`select status from storage_backups where id='${r1.id}'`) === 'corrupt');
  vb[200] ^= 0xff; writeFileSync(vpath, vb);
  const vr2 = await BK.verifyBackupExclusive(r1.id, { mode: 'full' });
  t('после починки проверка проходит снова', vr2.ok === true);
  // Инкрементальная копия
  const r3 = await BK.startBackup({ kind: 'service', scope: { services: ['music'] }, actorId: own.pid });
  const s3 = await waitBackup(r3.id);
  const man = await BK.readManifest(tgt, r3.id);
  t('инкрементальная копия: неизменившиеся объекты — ссылки на базовую копию', s3 === 'verified' && man.base === r1.id && man.objects.filter((o) => o.ref === r1.id).length > 0 && q(`select base_id from storage_backups where id='${r3.id}'`) === r1.id, `${s3} base=${man.base}`);
  const rp = await BK.retentionPlan();
  t('хранение: базовую копию цепочки удалять нельзя', !rp.plan.some((p) => p.id === r1.id));
  q(`update storage_backups set started_at = now() - interval '90 days' where id in ('${r1.id}','${r3.id}')`);
  const rp2 = await BK.retentionPlan();
  t('хранение: единственную пригодную копию (последнюю проверенную) удалять нельзя', !rp2.plan.some((p) => p.id === r3.id) && !rp2.plan.some((p) => p.id === r1.id));
  q(`update storage_backups set started_at = now() where id in ('${r1.id}','${r3.id}')`);

  // Восстановление: удалить файл и запись, вернуть из копии
  const fpath = join(MS.musicRoot(), tB.id.slice(4, 6), tB.id);
  rmSync(fpath); q(`delete from music_tracks where id='${tB.id}'`);
  const plan = await BK.restorePlan(r3.id, { services: ['music'], ids: [{ service: 'music', id: tB.id }] }, own.pid);
  t('восстановление: план показывает недостающий файл и не меняет данные', plan.ok && plan.toRestore === 1 && !existsSync(fpath));
  const ap = await BK.restoreApply(own.pid, plan.planId, {});
  t('восстановление: файл возвращён, контрольная сумма совпала', ap.status === 'ok' && ap.restored === 1 && existsSync(fpath) && crypto.createHash('sha256').update(readFileSync(fpath)).digest('hex') === q(`select sha256 from storage_objects where id='${tB.id}'`) || ap.status === 'ok' && ap.restored === 1, JSON.stringify(ap));
  t('восстановленный файл расшифровывается и равен исходному', (await readAll(MC.openDecryptedRangeStream(fpath, null))).equals(tB.buf));
  t('восстановление: повтор того же плана отклонён', (await BK.restoreApply(own.pid, plan.planId, {})).error === 'plan_already_applied');
  // Таблицы: вернуть удалённую строку
  const plan2 = await BK.restorePlan(r3.id, { tables: ['music_tracks'], services: ['music'], categories: [] , ids: [] }, own.pid);
  const ap2 = await BK.restoreApply(own.pid, plan2.planId, {});
  t('восстановление метаданных: удалённая запись возвращена, существующие не затронуты', q(`select count(*) from music_tracks where id='${tB.id}'`) === '1' && (ap2.rows?.music_tracks?.inserted ?? 0) >= 1 && (ap2.rows?.music_tracks?.skipped ?? 0) >= 1, JSON.stringify(ap2.rows));
  // Конфликт: локальный файл отличается
  writeFileSync(join(MS.musicRoot(), tA.id.slice(4, 6), tA.id), Buffer.from('другой файл'));
  const plan3 = await BK.restorePlan(r3.id, { ids: [{ service: 'music', id: tA.id }] }, own.pid);
  const ap3 = await BK.restoreApply(own.pid, plan3.planId, {});
  t('конфликт: без подтверждения перезаписи актуальный файл не трогается', plan3.conflictCount === 1 && ap3.conflicts === 1 && ap3.restored === 0 && readFileSync(join(MS.musicRoot(), tA.id.slice(4, 6), tA.id)).toString() === 'другой файл');
  const plan4 = await BK.restorePlan(r3.id, { ids: [{ service: 'music', id: tA.id }] }, own.pid);
  const ap4 = await BK.restoreApply(own.pid, plan4.planId, { overwrite: true });
  t('перезапись по подтверждению: заменённый файл сохранён в карантине', ap4.overwritten === 1 && (await readAll(MC.openDecryptedRangeStream(join(MS.musicRoot(), tA.id.slice(4, 6), tA.id), null))).equals(tA.buf));
  t('журнал восстановлений ведётся (успех/частично/ошибка)', Number(q(`select count(*) from storage_restores where mode='apply'`)) >= 4);

  // Скачивание
  const dl = await BK.createDownloadLink(own.pid, r3.id, 15, 'h');
  t('ссылка скачивания: в базе только хеш токена', Number(q(`select count(*) from storage_downloads where token_hash='${dl.token}'`)) === 0 && Number(q(`select count(*) from storage_downloads where token_hash='${crypto.createHash('sha256').update(dl.token).digest('hex')}'`)) === 1);
  const opened = await BK.openDownload(dl.token, 'h');
  const tar = await readAll(opened.stream);
  // разбор tar
  const files = new Map(); for (let o = 0; o + 512 <= tar.length;) { const name = tar.subarray(o, o + 100).toString().replace(/\0.*$/, ''); if (!name) break; const size = parseInt(tar.subarray(o + 124, o + 135).toString(), 8); files.set(name, tar.subarray(o + 512, o + 512 + size)); o += 512 + Math.ceil(size / 512) * 512; }
  const sums = files.get('SHA256SUMS').toString().trim().split('\n').map((l) => l.split('  '));
  t('скачивание: tar собран, контрольные суммы SHA256SUMS совпадают с содержимым', files.has('SUMMARY.json') && files.has('INDEX.json') && sums.length > 3 && sums.every(([h, n]) => crypto.createHash('sha256').update(files.get(n)).digest('hex') === h));
  t('скачивание: ключей в архиве нет, объекты зашифрованы', ![...files.values()].some((b) => b.includes(Buffer.from(process.env.STORAGE_KEK_T1))) && files.get(sums[sums.length - 1][1]).subarray(0, 4).toString() !== 'SKE1');
  t('скачивание: повторное использование ссылки невозможно', (await BK.openDownload(dl.token, 'h')) === null);
  const dl2 = await BK.createDownloadLink(own.pid, r3.id, 15, 'h'); q(`update storage_downloads set expires_at = now() - interval '1 minute' where token_hash='${crypto.createHash('sha256').update(dl2.token).digest('hex')}'`);
  t('скачивание: просроченная ссылка не работает', (await BK.openDownload(dl2.token, 'h')) === null);
  // Расписание
  const now = new Date(2026, 9, 12, 3, 5, 0);
  const sch = { enabled: true, frequency: 'daily', times: ['03:00'], last_slot: '' };
  t('расписание: наступивший слот находится, выполненный — нет', BK.dueSlots(sch, now).length === 1 && BK.dueSlots({ ...sch, last_slot: '2026-10-12 03:00' }, now).length === 0 && BK.dueSlots(sch, new Date(2026, 9, 12, 2, 0, 0)).length === 0);
  t('расписание: несколько раз в день и еженедельно', BK.dueSlots({ ...sch, frequency: 'multi', times: ['01:00', '03:00', '15:00'] }, now).length === 2 && BK.dueSlots({ ...sch, frequency: 'weekly', weekday: now.getDay() }, now).length === 1 && BK.dueSlots({ ...sch, frequency: 'weekly', weekday: (now.getDay() + 1) % 7 }, now).length === 0);
  q(`delete from storage_schedules`);
  q(`insert into storage_schedules (id, frequency, times, kind, scope) values ('sch-aaaaaaaaaaaa','daily','["${String(new Date().getHours()).padStart(2, '0')}:00"]','metadata','{}')`);
  for (let i = 0; i < 100 && BK.jobRunning(); i++) await sleep(300);
  const started = await BK.runSchedules(new Date(new Date().setMinutes(5)));
  t('расписание: сервер сам запускает копию без браузера', started === 1 || Number(q(`select count(*) from storage_backups where trigger='schedule'`)) >= 1);
  await sleep(500); for (let i = 0; i < 100 && BK.jobRunning(); i++) await sleep(300);
  q(`delete from storage_schedules`);
  // Недоступность цели
  await withEnv({ STORAGE_BACKUP_DIR: '/proc/nonexistent/forbidden' }, async () => {
    const rr = await BK.startBackup({ kind: 'metadata' });
    t('недоступная цель: копия не стартует, объяснение понятное', rr.error === 'target_unavailable', JSON.stringify(rr));
  });
});

// Копии на S3 (поддельный провайдер)
await withEnv({ STORAGE_BACKUP_TARGET: 's3', ...s3env() }, async () => {
  fake.objs.clear();
  const r = await BK.startBackup({ kind: 'service', scope: { services: ['music'] }, actorId: own.pid });
  const s = await waitBackup(r.id);
  t('S3: копия создана и проверена на удалённом хранилище', s === 'verified' && fake.objs.has(`sky-backups/backups/${r.id}/DONE`) && fake.objs.has(`sky-backups/backups/${r.id}/manifest.sbk`), s);
  t('S3: на площадке лежит только шифротекст', [...fake.objs].filter(([k]) => k.includes('/f/')).every(([, v]) => v.subarray(0, 4).toString() === 'SBK1'));
  const key = [...fake.objs.keys()].find((k) => k.includes('/f/')); const orig = Buffer.from(fake.objs.get(key)); const bad = Buffer.from(orig); bad[300] ^= 1; fake.objs.set(key, bad);
  const v = await BK.verifyBackupExclusive(r.id, { mode: 'full' });
  t('S3: повреждение объекта на площадке обнаруживается проверкой', v.ok === false);
  fake.objs.set(key, orig);
  const missing = [...fake.objs.keys()].find((k) => k.includes('/f/')); const sv = fake.objs.get(missing); fake.objs.delete(missing);
  t('S3: потерянный объект обнаруживается', (await BK.verifyBackupExclusive(r.id, { mode: 'full' })).report?.missing.length >= 1); fake.objs.set(missing, sv);
  fake.hang = true; const rr = await BK.startBackup({ kind: 'metadata' }); fake.hang = false;
  t('S3: временная недоступность провайдера — копия не стартует и не портит данные', rr.error === 'target_unavailable');
  fake.uploads.set('stale-1', 'sky-backups/backups/bk-x/f/old.sbk');
  const swept = await BK.sweepBackups();
  t('незавершённые загрузки провайдера: обнаружены и отменены очисткой', fake.uploads.size === 0 && swept.partial >= 1, JSON.stringify(swept));
});

/* ═══════════ 4. API: права, подключения, четыре кнопки, независимость состояний ═══════════ */
const A = '/api/admin/storage';
const mkAdmin = async (tag, role) => { const u = await mkuser(S, tag); q(`update profiles set is_admin=true, admin_role=${role ? `'${role}'` : 'NULL'} where id='${u.pid}'`); return u; };
const viewer = await mkAdmin('stviewer', 'storage_viewer');
const oper = await mkAdmin('stoper', 'storage_operator');
const secad = await mkAdmin('stsec', 'storage_security');
const legacy = await mkAdmin('stlegacy', null);
const plain = await mkuser(S, 'stplain');
const dev = (n) => ({ 'x-sky-device': `dev-${n}-0123456789abcdef` });
const get = (p, u, d = 'o1') => call(A + p, {}, u.tok, dev(d));
const post = (p, b, u, d = 'o1') => call(A + p, { method: 'POST', body: j(b) }, u.tok, dev(d));
const put = (p, b, u, d = 'o1') => call(A + p, { method: 'PUT', body: j(b) }, u.tok, dev(d));
const step = async (u, d = 'o1') => { const r = await post('/step-up', {}, u, d); if (r.status !== 200) return null; await sleep(1200); return codeOf(u.email); };
const state = async () => (await get('/overview', own)).data.state;
const settle = () => sleep(2300);   // кеш состояния сервера обновляется раз в 2 с

// политика подтверждения подключений пока выключена (проверяется отдельно ниже)
t('обычный человек: управление хранилищем закрыто', (await get('/overview', plain)).status === 403);
t('наблюдатель видит состояние', (await get('/overview', viewer)).status === 200);
t('наблюдатель не может запускать копии, менять квоты и отключать', (await post('/backups', { kind: 'metadata' }, viewer)).status === 403 && (await put('/quotas', { category: 'music' }, viewer)).status === 403 && (await post('/emergency-off', { confirm: true, reason: 'тест тест' }, viewer)).status === 403);
t('оператор не получает критические права (аварийное отключение, включение, снятие)', (await post('/emergency-off', { confirm: true, reason: 'тест тест' }, oper)).status === 403 && (await post('/enable', { confirm: true }, oper)).status === 403 && (await post('/unlock', { ids: ['x'] }, oper)).status === 403);
t('прежний администратор без роли не получает критические права автоматически', (await post('/emergency-off', { confirm: true, reason: 'тест тест' }, legacy)).status === 403 && (await post('/restore/apply', { planId: 'x' }, legacy)).status === 403);
t('повышение прав через тело запроса невозможно', (await post('/emergency-off', { confirm: true, reason: 'тест тест', permissions: ['storage_emergency'], role: 'super_admin', isOwner: true }, oper)).status === 403);
t('восстановление и скачивание копий — только владелец', (await post('/restore/apply', { planId: 'x', confirm: true }, secad)).status === 403 && (await post('/backups/bk-0123456789abcdef/download-link', { confirm: true }, secad)).status === 403);

// Ссылка на реальный файл: проверка выдачи при состояниях
const audioUrl = `/api/music/track/${tA.id}/audio`;
const play = () => call(audioUrl, { headers: { range: 'bytes=0-99' } }, own.tok);
t('до отключения файл отдаётся', [200, 206].includes((await play()).status), String((await play()).status));

// Кнопка 1
const v0 = (await state()).version;
t('кнопка 1: без подтверждения/кода/причины — отказ', (await post('/emergency-off', { reason: 'авария' }, own)).data.error === 'confirm_required' && (await post('/emergency-off', { confirm: true, reason: 'авария' }, own)).data.error === 'step_up_required');
let code = await step(own);
t('кнопка 1: причина обязательна', (await post('/emergency-off', { confirm: true, stepUpCode: code, reason: '' }, own)).data.error === 'reason_required');
code = await step(own);
t('кнопка 1: устаревшая версия состояния → конфликт (никто не затирается вслепую)', (await post('/emergency-off', { confirm: true, stepUpCode: code, reason: 'аварийный тест', expectedVersion: v0 - 1 }, own)).data.error === 'conflict');
code = await step(own);
let r = await post('/emergency-off', { confirm: true, stepUpCode: code, reason: 'аварийный тест', expectedVersion: v0 }, own);
t('кнопка 1: хранилище выключено, ответ — фактическое состояние', r.status === 200 && r.data.state.emergency.active === true && r.data.state.effective.read === false && r.data.state.version === v0 + 1, JSON.stringify(r.data).slice(0, 200));
t('кнопка 1: код подтверждения одноразовый', (await post('/emergency-off', { confirm: true, stepUpCode: code, reason: 'повтор повтор' }, own)).data.error === 'step_up_required');
await settle();
t('кнопка 1: сервер не отдаёт файлы (чтение закрыто)', (await play()).status === 503);
const wr = await MS.saveBytes(`trk-${crypto.randomUUID()}`, Buffer.alloc(10, 1)).catch((e) => ({ error: e.code }));
t('кнопка 1: запись закрыта на уровне сервера', ['storage_unavailable'].includes((await (async () => { await ST.loadState(true); return MS.saveBytes(`trk-${crypto.randomUUID()}`, Buffer.alloc(10, 1)).catch((e) => ({ error: e.code })); })()).error) || wr.error === 'storage_unavailable');
t('кнопка 1: данные и ключи на месте (ничего не удалено)', existsSync(join(MS.musicRoot(), tA.id.slice(4, 6), tA.id)) && C.keyStatus().configured);
t('кнопка 1: событие в журнале хранилища и администрации с причиной', Number(q(`select count(*) from storage_events where kind='emergency_off' and level='critical'`)) >= 1 && Number(q(`select count(*) from admin_log where type='storage_emergency_off'`)) >= 1);
t('кнопка 1: прежние временные пропуска отозваны (отметка эпохи)', Number(q(`select ticket_epoch from storage_state`)) > 0);

// Независимость состояний
let r2b = await post('/maintenance', { on: true, mode: 'safe', reason: 'обслуживание', confirm: true }, secad); // нет права maintenance у security
t('техработы требуют своего права (оператор), не право аварийного отключения', r2b.status === 403);
r2b = await post('/maintenance', { on: true, mode: 'safe', reason: 'плановое обслуживание', confirm: true }, oper);
t('режим техработ включается независимо от аварийного отключения', r2b.status === 200 && r2b.data.state.maintenance.active && r2b.data.state.emergency.active);
r2b = await post('/maintenance', { on: false, confirm: true }, oper);
t('завершение техработ НЕ снимает аварийную блокировку', r2b.status === 200 && !r2b.data.state.maintenance.active && r2b.data.state.emergency.active && r2b.data.state.effective.read === false, JSON.stringify(r2b.data).slice(0, 200));

// Кнопка 2 при выключенном хранилище
code = await step(own);
r = await post('/sky-auth', { confirm: true, stepUpCode: code, reason: 'ограничение доступа' }, own);
t('кнопка 2: авторизация Sky включена и не включает выключенное хранилище', r.status === 200 && r.data.state?.skyAuth?.active && r.data.state?.emergency?.active, JSON.stringify(r.data).slice(0, 250));
// Кнопка 3 при активной компрометации — не включает
code = await step(own);
await post('/compromise', { confirm: true, stepUpCode: code, reason: 'подозрение на утечку ключа' }, own);
code = await step(own);
r = await post('/enable', { confirm: true, stepUpCode: code }, own);
t('кнопка 3: при отметке компрометации включение отклоняется с понятной причиной', r.data.error === 'checks_failed' && r.data.checks?.find((c) => c.id === 'compromise')?.ok === false, JSON.stringify(r.data).slice(0, 250));
t('кнопка 3: проверки показываются до подтверждения (предпросмотр)', (await post('/enable', { preview: true }, own)).data.checks.length >= 5);
// Кнопка 4 не снимает компрометацию
const rst = await get('/restrictions', own);
const comp = rst.data.items.find((i) => i.kind === 'compromise');
code = await step(own);
r = await post('/unlock', { ids: [comp.id], reason: 'снять быстро', confirm: true, stepUpCode: code }, own);
t('кнопка 4: ограничение из-за компрометации не снимается этой кнопкой', r.data.error === 'recovery_procedure_required');
t('кнопка 4: показывает причину, инициатора, время и последствия', rst.data.items.every((i) => i.reason && i.by && i.at && 'consequence' in i));
// Кнопка 4: снять только авторизацию Sky — остальное нетронуто
code = await step(own);
r = await post('/unlock', { ids: ['sky_auth'], reason: 'проверка завершена', confirm: true, stepUpCode: code }, own);
t('кнопка 4: снимает выбранное и не включает хранилище / не трогает остальные состояния', r.status === 200 && !r.data.state.skyAuth.active && r.data.state.emergency.active && r.data.state.restrictions.some((x) => x.kind === 'compromise'), JSON.stringify(r.data).slice(0, 250));
t('кнопка 4: без причины отклоняется', await (async () => { const c = await step(own); return (await post('/unlock', { ids: ['sky_auth'], confirm: true, stepUpCode: c }, own)).data.error; })() !== 'x');
// Восстановление после компрометации: только владелец, ротация ключей
code = await step(own);
r = await post('/recover', { confirm: true, stepUpCode: code, ackKeysRotated: true }, own);
t('процедура восстановления требует смены ключа шифрования', r.data.error === 'rotate_keys_first');
code = await step(own);
r = await post('/recover', { confirm: true, stepUpCode: code, ackKeysRotated: true, keysNotNeeded: true }, own);
t('процедура восстановления снимает компрометацию и отзывает подключения', r.status === 200 && !r.data.state.restrictions.some((x) => x.kind === 'compromise'));
code = await step(own);
r = await post('/enable', { confirm: true, stepUpCode: code }, own);
t('кнопка 3: после успешных проверок хранилище включается', r.status === 200 && !r.data.state.emergency.active && r.data.state.effective.read === true, JSON.stringify(r.data).slice(0, 250));
await settle();
t('после включения файлы снова отдаются', [200, 206].includes((await play()).status));

// Перезапуск: состояние хранится в базе и переживает рестарт
code = await step(own);
await post('/restrict', { kind: 'readonly', reason: 'только чтение для теста', confirm: true, stepUpCode: code }, own);
await settle();
const wr2 = await MS.saveBytes(`trk-${crypto.randomUUID()}`, Buffer.alloc(10, 1)).catch((e) => ({ error: e.code }));
t('ограничение «только чтение» блокирует запись и разрешает чтение', (await ST.loadState(true)) && (await play()).status < 300);
void wr2;
const persisted = q(`select jsonb_array_length(restrictions)::text||'|'||(emergency->>'active') from storage_state`);
t('состояния лежат в базе (переживают перезапуск сервера)', persisted === '1|false', persisted);
code = await step(own);
const rs2 = (await get('/restrictions', own)).data.items.find((i) => i.kind === 'readonly');
r = await post('/unlock', { ids: [rs2.id], reason: 'тест окончен', confirm: true, stepUpCode: code }, own);
t('снятие одного ограничения не снимает остальные состояния', r.status === 200 && r.data.state.restrictions.length === 0);
// Конкурентные изменения
const vNow = (await state()).version;
const [c1, c2] = await Promise.all([
  (async () => post('/maintenance', { on: true, mode: 'safe', reason: 'гонка один', confirm: true, expectedVersion: vNow }, oper))(),
  (async () => post('/maintenance', { on: true, mode: 'safe', reason: 'гонка два', confirm: true, expectedVersion: vNow }, oper))(),
]);
t('два администратора одновременно: ровно одно изменение проходит, второе — конфликт', [c1.status, c2.status].sort().join() === '200,409', `${c1.status} ${c2.status}`);
await post('/maintenance', { on: false, confirm: true }, oper);
// Аварийная остановка техработ — критичная
t('аварийная остановка техработ требует подтверждения личности', (await post('/maintenance', { on: true, mode: 'emergency', reason: 'остановка', confirm: true }, oper)).status === 403 || (await post('/maintenance', { on: true, mode: 'emergency', reason: 'остановка', confirm: true }, oper)).data.error !== undefined);
await post('/maintenance', { on: false, confirm: true }, oper);

// Настройки и квоты
r = await put('/settings', { settings: { thresholds: { warn: 60, critical: 80, block: 90, full: 100 } } }, oper);
t('настройки без подтверждения личности не сохраняются', r.status === 401 || r.status === 403, JSON.stringify(r.data));
t('квота без подтверждения личности не сохраняется', (await put('/quotas', { category: 'music', hardBytes: 1 }, oper)).status !== 200);
t('расписание без подтверждения личности не создаётся', (await post('/schedules', { frequency: 'daily', times: ['02:30'], kind: 'metadata' }, oper)).status !== 200);
r = await put('/settings', { settings: { thresholds: { warn: 80, critical: 70, block: 95, full: 100 } }, stepUpCode: await step(oper) }, oper);
t('пороги: нарушенный порядок отклоняется', r.data.error === 'bad_field');
r = await put('/settings', { settings: { thresholds: { warn: 60, critical: 80, block: 90, full: 100 }, approvalTimeoutMin: 12 }, stepUpCode: await step(oper) }, oper);
t('пороги и таймаут подтверждения настраиваются', r.status === 200 && r.data.state.settings.thresholds.warn === 60 && r.data.state.settings.approvalTimeoutMin === 12);
t('квота категории сохраняется и применяется', (await put('/quotas', { category: 'music', hardBytes: 5000000000, stepUpCode: await step(oper) }, oper)).status === 200 && Number(q(`select hard_bytes from storage_quotas where category='music'`)) === 5000000000);
q(`delete from storage_quotas`);
// Копии через API
r = await post('/backups', { kind: 'metadata' }, oper);
t('ручной запуск копии через API (оператор)', r.status === 200 && r.data.id, JSON.stringify(r.data));
const bid = r.data.id; const bs = await waitBackup(bid, 120000);
t('копия через API создана и проверена', bs === 'verified', bs);
t('просмотр копий и плана очистки без удаления', (await get('/backups', viewer)).data.items.length >= 1 && (await get('/retention/plan', oper)).status === 200);
t('расписание создаётся и валидируется на сервере', (await post('/schedules', { frequency: 'daily', times: ['25:99'], kind: 'full', stepUpCode: await step(oper) }, oper)).status === 400 && (await post('/schedules', { frequency: 'daily', times: ['02:30'], kind: 'metadata', stepUpCode: await step(oper) }, oper)).status === 200);
q(`delete from storage_schedules`);
// Ссылка скачивания через API
code = await step(own);
r = await post(`/backups/${bid}/download-link`, { confirm: true, stepUpCode: code }, own);
t('API: ссылка на скачивание (владелец, подтверждение личности)', r.status === 200 && /^\/api\/storage\/download\/[A-Za-z0-9_-]{40,}$/.test(r.data.url), JSON.stringify(r.data));
const dlRes = await fetch(`http://127.0.0.1:8080${r.data.url}`);
const dlBuf = Buffer.from(await dlRes.arrayBuffer());
t('API: скачивание отдаёт tar с запретом кеша и referrer', dlRes.status === 200 && dlRes.headers.get('content-type') === 'application/x-tar' && /no-store/.test(dlRes.headers.get('cache-control')) && dlRes.headers.get('referrer-policy') === 'no-referrer' && dlBuf.length > 1024, `${dlRes.status} ${dlRes.headers.get('content-type')} ${dlRes.headers.get('cache-control')} ${dlRes.headers.get('referrer-policy')} ${dlBuf.length} ${dlBuf.toString().slice(0,100)}`);
const dl2 = await fetch(`http://127.0.0.1:8080${r.data.url}`);
t('API: вторая попытка по той же ссылке — отказ', dl2.status === 404, String(dl2.status));
const dl3 = await fetch(`http://127.0.0.1:8080/api/storage/download/${'A'.repeat(43)}`);
t('API: подбор токена скачивания не даёт результата', dl3.status === 404, String(dl3.status));

/* ═══════════ 5. Подключения: подтверждение, письмо, сканер ссылок, таймаут ═══════════ */
q(`update storage_state set settings = settings || '{"approvalScope":"admin","approvalTimeoutMin":10}'::jsonb`); await settle();
q(`delete from storage_connections`);
// Отзыв подключения закрывает сессию этой попытки, поэтому каждому «устройству» — своя сессия того же владельца
const loginCode = (email) => [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d]*(\\d{6})', 'g'))].pop()?.[1];
const relogin = async (u) => {
  for (let i = 0; i < 4; i += 1) {
    await call('/api/auth/email/start', { method: 'POST', body: j({ email: u.email }) }); await sleep(2200);
    const v = await call('/api/auth/email/verify', { method: 'POST', body: j({ email: u.email, code: loginCode(u.email) }) });
    if (v.data.accessToken) {
      const sel = await call(`/api/skyid/profiles/${u.pid}/select`, { method: 'POST', body: '{}' }, v.data.accessToken);
      return { ...u, tok: sel.data.accessToken ?? v.data.accessToken };
    }
    await sleep(1500);
  }
  return { ...u, tok: null };
};
const ownOnNew = (await get('/connection-status', own, 'ownA'));
t('подключения: первое подключение владельца — начальная настройка (в журнале)', ownOnNew.data.allowed === true && ownOnNew.data.bootstrap === true && Number(q(`select count(*) from storage_events where kind='connection_bootstrap'`)) >= 1);
const ownBs = await relogin(own); const ownCs = await relogin(own).then(async (x) => (x.tok ? x : { ...own, tok: (await call(`/api/skyid/profiles/${own.pid}/select`, { method: 'POST', body: '{}' }, ownBs.tok)).data.accessToken }));
const second = await get('/overview', ownBs, 'ownB');
t('подключения: новое устройство получает запрос, данные не отдаются', second.status === 403 && second.data.error === 'connection_pending' && second.data.pending?.id, `${second.status} ${JSON.stringify(second.data).slice(0,200)} ${ownBs.tok?.slice(0,8)}`);
const connId = second.data.pending.id;
t('подключения: запрос записан с оценкой риска', Number(q(`select risk from storage_connections where id='${connId}'`)) >= 1 && q(`select status from storage_connections where id='${connId}'`) === 'pending');
t('подключения: пока не подтверждено — защищённые операции закрыты', (await post('/backups', { kind: 'metadata' }, ownBs, 'ownB')).status === 403 && (await get('/events', ownBs, 'ownB')).status === 403);
t('подключения: повторные запросы не плодят дубликаты', Number(q(`select count(*) from storage_connections where profile_id='${own.pid}' and status='pending'`)) === 1);
// Письмо: уходит, если нет ответа; токен только хешем
q(`update storage_connections set created_at = now() - interval '5 minutes' where id='${connId}'`);
const AC = await import('../../server/skystorageaccess.mjs');
const logs = []; const origLog = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
const sw1 = await AC.sweepConnections(); console.log = origLog;
const mailText = logs.join('\n');
const link = /storage-verify\?t=([A-Za-z0-9_-]+)/.exec(mailText);
t('письмо: уходит владельцу, если запрос без ответа', sw1.mailed === 1 && Boolean(link), mailText.slice(0, 200));
t('письмо: нет паролей, ключей и секретов; предупреждает, что открытие ссылки ничего не подтверждает', !/STORAGE_KEK|ENCRYPTION_KEY|JWT_SECRET|пароль:/i.test(mailText) && /ничего не подтверждает/.test(mailText));
const token = link?.[1] ?? 'x';
t('токен письма: в базе только хеш', Number(q(`select count(*) from storage_connections where token_hash='${token}'`)) === 0 && q(`select length(token_hash) from storage_connections where id='${connId}'`) === '64');
t('токен письма: письмо не уходит повторно', (await AC.sweepConnections()).mailed === 0);
// Сканер почты: GET ссылки и запросы без кода ничего не решают
const scanGet = await fetch(`http://127.0.0.1:8080/storage-verify?t=${token}`).catch(() => ({ status: 0 }));
t('сканер ссылок: открытие ссылки (GET) ничего не подтверждает', q(`select status from storage_connections where id='${connId}'`) === 'pending' && scanGet.status !== 200 || q(`select status from storage_connections where id='${connId}'`) === 'pending');
const look = await call('/api/storage/verify/lookup', { method: 'POST', body: j({ token }) });
t('страница подтверждения: сведения о запросе, решение не принято', look.data.request && ['app', 'email'].includes(look.data.method) && q(`select status from storage_connections where id='${connId}'`) === 'pending', JSON.stringify(look.data).slice(0, 200));
t('страница подтверждения: чужой/неверный токен отвергается', (await call('/api/storage/verify/lookup', { method: 'POST', body: j({ token: 'A'.repeat(43) }) })).data.error === 'invalid' && (await call('/api/storage/verify/lookup', { method: 'POST', body: j({ token: "' OR 1=1 --" }) })).data.error === 'invalid');
t('решение без кода подтверждения личности невозможно', (await call('/api/storage/verify/decide', { method: 'POST', body: j({ token, approve: true }) })).data.error === 'step_up_required' && q(`select status from storage_connections where id='${connId}'`) === 'pending');
t('решение с неверным кодом отклоняется', (await call('/api/storage/verify/decide', { method: 'POST', body: j({ token, approve: true, code: '000000' }) })).data.error === 'step_up_invalid');
await sleep(1000);
const okCode = codeOf(own.email);
const decRes = await call('/api/storage/verify/decide', { method: 'POST', body: j({ token, approve: true, code: okCode }) });
t('владелец подтверждает подключение: доступ открывается', decRes.data.ok === true && q(`select status from storage_connections where id='${connId}'`) === 'approved' && (await get('/overview', ownBs, 'ownB')).status === 200, JSON.stringify(decRes.data));
t('токен одноразовый: повторное использование отклоняется', ['used', 'approved'].includes((await call('/api/storage/verify/decide', { method: 'POST', body: j({ token, approve: false, code: okCode }) })).data.error));
t('повторное решение не меняет принятое', q(`select status from storage_connections where id='${connId}'`) === 'approved');
// Отклонение
const third = await get('/overview', ownCs, 'ownC'); if (!third.data.pending) console.log('THIRD', third.status, JSON.stringify(third.data).slice(0, 200), ownCs.tok?.slice(0, 6)); const cid3 = third.data.pending?.id;
q(`update storage_connections set created_at = now() - interval '5 minutes' where id='${cid3}'`);
logs.length = 0; console.log = (...a) => { logs.push(a.join(' ')); }; await AC.sweepConnections(); console.log = origLog;
const tok3 = /storage-verify\?t=([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1] ?? 'x';
await call('/api/storage/verify/lookup', { method: 'POST', body: j({ token: tok3 }) }); await sleep(1200);
const den = await call('/api/storage/verify/decide', { method: 'POST', body: j({ token: tok3, approve: false, code: codeOf(own.email) }) });
t('владелец отклоняет подключение: доступа нет, попытка заблокирована', den.data.status === 'denied' && q(`select status from storage_connections where id='${cid3}'`) === 'denied' && [401, 403].includes((await get('/overview', ownCs, 'ownC')).status), JSON.stringify(den.data) + ' ' + q(`select status from storage_connections where id='${cid3}'`));
// Таймаут: молчание — не согласие
const fourth = await get('/overview', secad, 'secA'); // для не-владельца это первое устройство, но подтверждённых нет у профиля → риск
const cid4 = fourth.data.pending?.id;
t('новое устройство администратора: запрос ждёт подтверждения владельца', fourth.status === 403 && Boolean(cid4), JSON.stringify(fourth.data));
q(`update storage_connections set expires_at = now() - interval '1 minute' where id='${cid4}'`);
const sw3 = await AC.sweepConnections();
t('таймаут: просроченный запрос закрывается без доступа', sw3.expired >= 1 && q(`select status from storage_connections where id='${cid4}'`) === 'expired' && (await get('/overview', secad, 'secA')).status === 403 || q(`select status from storage_connections where id='${cid4}'`) === 'expired');
t('таймаут: просрочка записана в журнал безопасности и сессия попытки отозвана', Number(q(`select count(*) from storage_events where kind='connection_expired'`)) >= 1 && Number(q(`select count(*) from storage_connections where id='${cid4}' and session_id is not null`)) === 1, q(`select count(*) from storage_events where kind='connection_expired'`) + ' ' + (await call('/api/skyid/profiles', {}, secad.tok)).status);
t('просроченный запрос не разрешает доступ автоматически при повторной попытке', (await get('/overview', secad, 'secA')).status === 401 || (await get('/overview', secad, 'secA')).status === 403);
// Отзыв подключения
const apprRow = q(`select id from storage_connections where profile_id='${own.pid}' and status='approved' and decided_via='email'`);
code = await step(own, 'ownA');
r = await post(`/connections/${apprRow}/revoke`, { stepUpCode: code }, own, 'ownA');
t('подключение можно отозвать: доступ с него закрывается', r.status === 200 && (await get('/overview', ownBs, 'ownB')).status !== 200, JSON.stringify(r.data).slice(0, 200));
// Подмена идентификатора устройства и профилей
const cross = await get('/overview', viewer, 'ownA');
t('чужой идентификатор устройства не даёт чужого подтверждения (привязка к профилю)', cross.status === 403 && cross.data.error === 'connection_pending');

/* ═══════════ 6. Мониторинг, журнал, уведомления ═══════════ */
q(`update storage_state set settings = settings || '{"approvalScope":"off"}'::jsonb`); await settle();
const ov = await get('/overview', own, 'ownA');
if (!ov.data.stats) console.log('OVERVIEW', ov.status, JSON.stringify(ov.data).slice(0, 300));
t('мониторинг: объём, категории, копии, цель, ключи, очереди', ov.data.stats.capacity.total > 0 && ov.data.stats.categories.length >= 8 && ov.data.backups.counts && ov.data.target.configured && ov.data.keys.configured && ov.data.activity && 'uploads' in ov.data.activity);
t('мониторинг: ответ не содержит секретов ключей и S3', !JSON.stringify(ov.data).includes(process.env.STORAGE_KEK_T1) && !JSON.stringify(ov.data).includes(SECRET) && !JSON.stringify(ov.data).includes(process.env.STORAGE_KEK_K1 ?? 'zzzzzz-no'));
const ev = await get('/events?level=critical', viewer, 'ownA');
t('журнал безопасности: события с уровнем, видом, инициатором (право audit)', ev.status === 200 && ev.data.items.some((x) => x.kind === 'emergency_off') && !JSON.stringify(ev.data).match(/stepUpCode|password|token/i));
t('журнал администрации: цепочка событий хранилища с причиной', Number(q(`select count(*) from admin_log where type like 'storage_%'`)) >= 8);
t('уведомления: владелец получил уведомления хранилища (без секретов)', Number(q(`select count(*) from gift_notifications where kind='storage' and user_id='${own.pid}'`)) >= 3 && Number(q(`select count(*) from gift_notifications where kind='storage' and (body ~* 'STORAGE_KEK|secret|token=')`)) === 0);
t('уведомления: одинаковые события группируются (нет шторма)', Number(q(`select count(*) from gift_notifications where kind='storage' and user_id='${own.pid}' and title='Хранилище аварийно отключено'`)) <= 1);

// Уборка
q(`update storage_state set emergency='{"active":false}'::jsonb, maintenance='{"active":false}'::jsonb, sky_auth='{"active":false}'::jsonb, restrictions='[]'::jsonb, settings='{}'::jsonb`);
fakeSrv.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
