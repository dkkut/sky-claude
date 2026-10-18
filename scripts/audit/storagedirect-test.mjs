// Sky Storage: прямой доступ через S3-шлюз после подтверждения владельцем.
// API: STORAGE_S3_ENDPOINT=http://127.0.0.1:9956 STORAGE_S3_ALLOW_INSECURE=1 STORAGE_S3_BUCKET=skymedia STORAGE_S3_ACCESS_KEY=AKFAKE STORAGE_S3_SECRET_KEY=fake-secret-0123456789 STORAGE_S3_PREFIX=sky/ OWNER_USERNAME=ownertest ADMIN_GATE=off STORAGE_RATE_MULT=1000 DOMAIN=sky.test
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
import { signV4, canonQuery, encPath } from '../../server/skystorages3.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 240) : JSON.stringify(x).slice(0, 240)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });

/* поддельный S3 хостера */
const fake = { objs: new Map() };
const srv = http.createServer((req, res) => {
  const ch = []; req.on('data', (c) => ch.push(c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const body = Buffer.concat(ch);
    const send = (c, x = '', h = {}) => { res.writeHead(c, h); res.end(x); };
    const key = decodeURIComponent(u.pathname.replace(/^\/[^/]+\//, ''));
    if (req.method === 'GET' && /^\/[^/]+\/?$/.test(u.pathname)) { const p = u.searchParams.get('prefix') ?? ''; return send(200, `<ListBucketResult><IsTruncated>false</IsTruncated>${[...fake.objs].filter(([k]) => k.startsWith(p)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>"e"</ETag><Size>${v.length}</Size></Contents>`).join('')}</ListBucketResult>`); }
    if (req.method === 'PUT') { fake.objs.set(key, body); return send(200, '', { etag: '"e"' }); }
    if (req.method === 'HEAD') { const o = fake.objs.get(key); return o ? send(200, '', { 'content-length': o.length, etag: '"e"' }) : send(404); }
    if (req.method === 'GET') { const o = fake.objs.get(key); if (!o) return send(404, '<Error><Code>NoSuchKey</Code></Error>'); const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? ''); if (r) { const part = o.subarray(Number(r[1]), r[2] ? Number(r[2]) + 1 : undefined); return send(206, part, { 'content-length': part.length }); } return send(200, o, { 'content-length': o.length }); }
    if (req.method === 'DELETE') { fake.objs.delete(key); return send(204); }
    send(400);
  });
});
await new Promise((r) => srv.listen(9956, '127.0.0.1', r));
fake.objs.set('sky/media/aa/trk-1', Buffer.from('ШИФРОТЕКСТ-0123456789')); fake.objs.set('sky/media/bb/trk-2', Buffer.from('x'.repeat(100)));

const logTxt = () => readFileSync(S + '/api.log', 'utf8');
const tokenFrom = (afterLen) => { const m = [...logTxt().matchAll(/storage-verify\?t=(dx_[A-Za-z0-9_-]+)/g)]; return m.length > afterLen ? m[m.length - 1][1] : null; };
const codeOf = (email) => { const m = [...logTxt().matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };

/* клиент S3 с подписью */
const s3 = async (method, key, { query = '', body = null, keys, payloadHash, dateShift = 0, tamper = false, range, extra = {} } = {}) => {
  const path = `/api/storage/s3/sky-storage${key ? `/${encPath(key)}` : ''}`;
  const buf = body ?? Buffer.alloc(0);
  const ph = payloadHash ?? crypto.createHash('sha256').update(buf).digest('hex');
  const amzDate = new Date(Date.now() + dateShift).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const host = new URL(B).host;
  const sig = signV4({ method, host, path, query: canonQuery(query), headers: {}, payloadHash: ph, region: 'us-east-1', accessKey: keys.accessKeyId, secretKey: keys.secretAccessKey, amzDate });
  const url = B + (tamper ? path + 'x' : path) + (query ? `?${query}` : '');
  const r = await fetch(url, { method, headers: { 'x-amz-date': amzDate, 'x-amz-content-sha256': ph, authorization: sig.authorization, ...(range ? { range } : {}), ...extra }, body: method === 'PUT' ? buf : undefined });
  const buffer = Buffer.from(await r.arrayBuffer());
  return { status: r.status, text: buffer.toString('utf8'), buffer, headers: r.headers };
};

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='ownertest'`);
q(`delete from storage_direct_requests`);
const OWN = await mkuser(S, 'sdOwn'); q(`update profiles set username='ownertest' where id='${OWN.pid}'`);
const SEC = await mkuser(S, 'sdSec'); q(`update profiles set is_admin=true, admin_role='storage_security' where id='${SEC.pid}'`);
const USR = await mkuser(S, 'sdUsr');
const R = (p, o, tok) => call('/api/admin/storage/direct' + p, o ?? {}, tok);
q(`update storage_state set emergency='{"active":false}'::jsonb, restrictions='[]'::jsonb`);

/* кто вправе просить */
let r = await R('/request', J({ scope: 'read', minutes: 15, note: 'Проверка файлов' }), USR.tok); t('обычный человек не просит', r.status === 403, r.data);
r = await R('/request', J({ scope: 'read', minutes: 15, note: 'Проверка файлов' }), SEC.tok); t('админ безопасности БЕЗ права storage_direct — нет', r.status === 403, r.data);
r = await R('/request', J({ scope: 'all', minutes: 15, note: 'Проверка файлов' }), OWN.tok); t('неверный режим', r.data.error === 'bad_scope', r.data);
r = await R('/request', J({ scope: 'read', minutes: 999, note: 'Проверка файлов' }), OWN.tok); t('срок больше 60 минут нельзя', r.data.error === 'bad_minutes', r.data);
r = await R('/request', J({ scope: 'read', minutes: 15, note: 'x' }), OWN.tok); t('без причины нельзя', r.data.error === 'reason_required', r.data);

/* запрос без подтверждения ключей не даёт */
let before = [...logTxt().matchAll(/storage-verify\?t=dx_/g)].length;
r = await R('/request', J({ scope: 'read', minutes: 15, note: 'Проверка файлов хранилища' }), OWN.tok); t('запрос создан', r.data.ok && r.data.id, r.data); const id1 = r.data.id;
r = await R('/request', J({ scope: 'read', minutes: 15, note: 'Ещё один запрос сразу' }), OWN.tok); t('второй открытый запрос нельзя', r.status === 409, r.data);
await sleep(1200);
const tok1 = tokenFrom(before); t('письмо владельцу со ссылкой ушло', !!tok1);
t('токен в базе — только хеш', !q(`select token_hash from storage_direct_requests where id='${id1}'`).includes('dx_'));
r = await R(`/${id1}/claim`, { method: 'POST' }, OWN.tok); t('до подтверждения ключей нет', r.data.status === 'pending' && !r.data.accessKeyId, r.data);
r = await R(`/${id1}/claim`, { method: 'POST' }, USR.tok); t('чужой запрос — 404', r.status === 404, r.data);
t('в базе нет ключа до подтверждения', q(`select coalesce(access_key_id,'') || coalesce(secret_enc,'') from storage_direct_requests where id='${id1}'`) === '');
let g = await s3('GET', '', { query: 'list-type=2', keys: { accessKeyId: 'SKYD0123456789ABCDEF', secretAccessKey: 'zzz' } }); t('шлюз: выдуманный ключ — отказ', g.status === 403 && /InvalidAccessKeyId/.test(g.text), g.text);
g = await fetch(`${B}/api/storage/s3/sky-storage?list-type=2`); t('шлюз: без подписи — отказ', g.status === 403);

/* страница подтверждения: неверный код, потом верный */
let lk = await call('/api/storage/verify/lookup', J({ token: tok1 })); t('страница: сведения о запросе, решения нет', lk.data.request?.reasons?.[0] === 'Проверка файлов хранилища' && /чтение/.test(lk.data.request.ua), lk.data);
await sleep(1300);
let dc = await call('/api/storage/verify/decide', J({ token: tok1, approve: true, code: '000000' })); t('неверный код — не подтверждает', dc.status === 400 && dc.data.error, dc.data);
t('после неверного кода ключей нет', q(`select status from storage_direct_requests where id='${id1}'`) === 'pending');
const code = codeOf(OWN.email); t('код владельцу пришёл', !!code);
dc = await call('/api/storage/verify/decide', J({ token: tok1, approve: true, code })); t('владелец подтвердил с кодом', dc.data.ok && dc.data.status === 'approved', dc.data);
dc = await call('/api/storage/verify/decide', J({ token: tok1, approve: true, code })); t('ссылка одноразовая', dc.status === 400, dc.data);
t('секрет в базе зашифрован', !/^[A-Za-z0-9_-]{40}$/.test(q(`select secret_enc from storage_direct_requests where id='${id1}'`)) && q(`select length(secret_enc) from storage_direct_requests where id='${id1}'`) > 40);

r = await R(`/${id1}/claim`, { method: 'POST' }, OWN.tok); t('запросивший получил ключи', r.data.accessKeyId?.startsWith('SKYD') && r.data.secretAccessKey?.length >= 30 && /\/api\/storage\/s3$/.test(r.data.endpoint), { ...r.data, secretAccessKey: '…' });
const K1 = { accessKeyId: r.data.accessKeyId, secretAccessKey: r.data.secretAccessKey };
r = await R(`/${id1}/claim`, { method: 'POST' }, OWN.tok); t('второй раз ключи не показываются', r.data.error === 'already_shown', r.data);
r = await R('/', null, OWN.tok); t('в списке секрета нет', !JSON.stringify(r.data).includes(K1.secretAccessKey), r.data.items?.length);

/* чтение через шлюз */
g = await s3('GET', '', { query: 'list-type=2&prefix=media%2F', keys: K1 }); t('список объектов', g.status === 200 && /media\/aa\/trk-1/.test(g.text) && !/sky\//.test(g.text.replace(/<Name>.*?<\/Name>/, '')), g.text.slice(0, 300));
g = await s3('HEAD', 'media/aa/trk-1', { keys: K1 }); t('HEAD объекта', g.status === 200 && g.headers.get('content-length') === String(Buffer.from('ШИФРОТЕКСТ-0123456789').length), g.status);
g = await s3('GET', 'media/aa/trk-1', { keys: K1 }); t('GET объекта', g.status === 200 && g.text === 'ШИФРОТЕКСТ-0123456789', g.status);
g = await s3('GET', 'media/bb/trk-2', { keys: K1, range: 'bytes=10-19' }); t('Range → 206, 10 байт', g.status === 206 && g.buffer.length === 10 && /bytes 10-19\/100/.test(g.headers.get('content-range')), g.status);
g = await s3('GET', 'media/zz/none', { keys: K1 }); t('нет объекта — 404', g.status === 404, g.text);
g = await s3('PUT', 'media/aa/new', { keys: K1, body: Buffer.from('evil') }); t('запись при доступе «чтение» запрещена', g.status === 403 && /AccessDenied/.test(g.text), g.text);
g = await s3('DELETE', 'media/aa/trk-1', { keys: K1 }); t('удаление при «чтение» запрещено', g.status === 403 && fake.objs.has('sky/media/aa/trk-1'));
g = await s3('GET', 'media/aa/trk-1', { keys: K1, tamper: true }); t('подмена пути ломает подпись', g.status === 403 && /SignatureDoesNotMatch/.test(g.text), g.text);
g = await s3('GET', 'media/aa/trk-1', { keys: { ...K1, secretAccessKey: K1.secretAccessKey + 'x' } }); t('чужой секрет — неверная подпись', g.status === 403 && /SignatureDoesNotMatch/.test(g.text), g.text);
g = await s3('GET', 'media/aa/trk-1', { keys: K1, dateShift: 20 * 60_000 }); t('старая/будущая подпись (расхождение часов) отклонена', g.status === 403 && /Skewed/.test(g.text), g.text);
g = await s3('GET', 'media/aa/trk-1', { keys: K1, payloadHash: 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD' }); t('потоковая подпись — понятная ошибка 501', g.status === 501, g.text);
g = await s3('GET', 'media/../../etc/passwd', { keys: K1 }); t('выход из префикса невозможен', g.status === 400 || g.status === 403 || g.status === 404, g.status);
t('операции записаны в журнал', Number(q(`select count(*) from storage_direct_log where request_id='${id1}'`)) >= 5 && q(`select count(*) from storage_direct_log where request_id='${id1}' and net like '%/24'`) !== '0');

/* отзыв */
r = await R(`/${id1}/revoke`, { method: 'POST' }, USR.tok); t('чужой отзыв — 404', r.status === 404, r.data);
r = await R(`/${id1}/revoke`, { method: 'POST' }, OWN.tok); t('владелец отозвал доступ', r.data.ok, r.data);
g = await s3('GET', 'media/aa/trk-1', { keys: K1 }); t('после отзыва шлюз закрыт', g.status === 403 && /InvalidAccessKeyId/.test(g.text), g.text);
t('секрет стёрт из базы', q(`select coalesce(secret_enc,'-') from storage_direct_requests where id='${id1}'`) === '-');

/* чтение и запись + срок */
before = [...logTxt().matchAll(/storage-verify\?t=dx_/g)].length;
r = await R('/request', J({ scope: 'readwrite', minutes: 10, note: 'Загрузка тестового файла' }), OWN.tok); const id2 = r.data.id; await sleep(1200);
const tok2 = tokenFrom(before); await call('/api/storage/verify/lookup', J({ token: tok2 })); await sleep(1300);
dc = await call('/api/storage/verify/decide', J({ token: tok2, approve: true, code: codeOf(OWN.email) })); t('второй запрос подтверждён', dc.data.ok, dc.data);
r = await R(`/${id2}/claim`, { method: 'POST' }, OWN.tok); const K2 = { accessKeyId: r.data.accessKeyId, secretAccessKey: r.data.secretAccessKey }; t('ключи на чтение и запись', r.data.scope === 'readwrite');
g = await s3('PUT', 'media/aa/new', { keys: K2, body: Buffer.from('загруженный файл') }); t('PUT с хешем содержимого', g.status === 200 && fake.objs.get('sky/media/aa/new')?.toString() === 'загруженный файл', g.status);
g = await s3('PUT', 'media/aa/new2', { keys: K2, body: Buffer.from('abc'), payloadHash: 'UNSIGNED-PAYLOAD' }); t('PUT UNSIGNED-PAYLOAD', g.status === 200 && fake.objs.has('sky/media/aa/new2'), g.status);
g = await s3('PUT', 'media/aa/bad', { keys: K2, body: Buffer.from('abc'), payloadHash: crypto.createHash('sha256').update('other').digest('hex') }); t('несовпадение хеша содержимого отклонено', g.status === 400 && !fake.objs.has('sky/media/aa/bad'), g.text);
g = await s3('PUT', 'media/aa/mp', { keys: K2, body: Buffer.from('abc'), query: 'partNumber=1&uploadId=x' }); t('многокомпонентная загрузка — 501', g.status === 501, g.text);
g = await s3('DELETE', 'media/aa/new', { keys: K2 }); t('DELETE', g.status === 204 && !fake.objs.has('sky/media/aa/new'));
q(`update storage_direct_requests set access_until = now() - interval '1 minute' where id='${id2}'`);
g = await s3('GET', 'media/aa/trk-1', { keys: K2 }); t('срок вышел — доступ закрыт', g.status === 403, g.text);

/* отказ владельца */
before = [...logTxt().matchAll(/storage-verify\?t=dx_/g)].length;
r = await R('/request', J({ scope: 'read', minutes: 5, note: 'Этот запрос будет отклонён' }), OWN.tok); const id3 = r.data.id; await sleep(1200);
const tok3 = tokenFrom(before); await call('/api/storage/verify/lookup', J({ token: tok3 })); await sleep(1300);
dc = await call('/api/storage/verify/decide', J({ token: tok3, approve: false, code: codeOf(OWN.email) })); t('владелец отклонил', dc.data.status === 'denied', dc.data);
r = await R(`/${id3}/claim`, { method: 'POST' }, OWN.tok); t('после отказа ключей нет', r.data.status === 'denied' && !r.data.accessKeyId, r.data);

/* молчание — не согласие */
r = await R('/request', J({ scope: 'read', minutes: 5, note: 'Владелец не ответит' }), OWN.tok); const id4 = r.data.id;
q(`update storage_direct_requests set expires_at = now() - interval '1 minute' where id='${id4}'`);
r = await R(`/${id4}/claim`, { method: 'POST' }, OWN.tok); t('просроченный запрос ключей не даёт', r.data.status === 'expired' && !r.data.accessKeyId, r.data);
r = await R(`/${id1}/log`, null, OWN.tok); t('журнал операций виден владельцу', r.data.items?.length >= 5 && r.data.items.every((x) => 'op' in x), r.data.items?.length);
r = await R(`/${id1}/log`, null, USR.tok); t('чужой журнал — 404', r.status === 404, r.data);
srv.close(); console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
