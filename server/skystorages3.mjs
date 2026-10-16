/**
 * Sky Storage — клиент S3-совместимого хранилища (AWS Signature V4), без внешних зависимостей.
 *
 * Конфигурация — ТОЛЬКО из защищённого окружения сервера (в браузер и журналы не попадает):
 *   STORAGE_S3_ENDPOINT   https://s3.example.com   (обязательно)
 *   STORAGE_S3_REGION     us-east-1                 (по умолчанию us-east-1)
 *   STORAGE_S3_BUCKET     имя бакета               (обязательно)
 *   STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY   ключ с минимальными правами на ЭТОТ бакет
 *   STORAGE_S3_PREFIX     префикс ключей (по умолчанию sky-backups/)
 *   STORAGE_S3_PATH_STYLE 1 — адрес вида endpoint/bucket/key (по умолчанию 1; 0 — bucket.endpoint)
 *   STORAGE_S3_PART_MB    размер части многокомпонентной загрузки, МБ (по умолчанию 8, не меньше 5)
 *   STORAGE_S3_TIMEOUT_MS тайм-аут запроса (по умолчанию 30000)
 *
 * Потоковая загрузка: поток режется на части (в памяти — одна часть); повторы ограничены (3) только
 * для сетевых сбоев и 5xx; 4xx (права, квота, нет бакета) не повторяются и возвращаются как есть.
 */
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { Readable } from 'node:stream';

export class S3Error extends Error {
  constructor(code, status = 0, detail = '') { super(code); this.code = code; this.status = status; this.detail = detail; }
}

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const encPath = (p) => p.split('/').map(enc).join('/');

/** Подпись SigV4. Экспортируется отдельно, чтобы проверяться по опубликованному тестовому вектору AWS. */
export const signV4 = ({ method, host, path, query = '', headers = {}, payloadHash, region, service = 's3', accessKey, secretKey, amzDate }) => {
  const date = amzDate.slice(0, 8);
  const h = { host, 'x-amz-date': amzDate, ...(payloadHash && service === 's3' ? { 'x-amz-content-sha256': payloadHash } : {}), ...headers };
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const kDate = hmac(`AWS4${secretKey}`, date);
  const key = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { signature, signedHeaders, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, canonical };
};

/** Канонический запрос: параметры отсортированы по имени (требование SigV4), пустое значение — `k=`. */
export const canonQuery = (q) => (q ? q.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]; })
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&') : '');

export const s3Config = () => {
  const e = process.env;
  const endpoint = (e.STORAGE_S3_ENDPOINT ?? '').trim().replace(/\/+$/, '');
  const missing = [];
  if (!endpoint) missing.push('STORAGE_S3_ENDPOINT');
  if (!e.STORAGE_S3_BUCKET) missing.push('STORAGE_S3_BUCKET');
  if (!e.STORAGE_S3_ACCESS_KEY) missing.push('STORAGE_S3_ACCESS_KEY');
  if (!e.STORAGE_S3_SECRET_KEY) missing.push('STORAGE_S3_SECRET_KEY');
  return {
    ok: missing.length === 0, missing, endpoint, bucket: e.STORAGE_S3_BUCKET ?? '', region: e.STORAGE_S3_REGION || 'us-east-1',
    accessKey: e.STORAGE_S3_ACCESS_KEY ?? '', secretKey: e.STORAGE_S3_SECRET_KEY ?? '',
    prefix: (e.STORAGE_S3_PREFIX ?? 'sky-backups/').replace(/^\/+/, ''),
    pathStyle: e.STORAGE_S3_PATH_STYLE !== '0',
    partBytes: Math.max(5, Number(e.STORAGE_S3_PART_MB) || 8) * 1024 * 1024,
    timeoutMs: Math.max(1000, Number(e.STORAGE_S3_TIMEOUT_MS) || 30000),
  };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const createS3 = (cfg = s3Config()) => {
  if (!cfg.ok) throw new S3Error('s3_not_configured', 0, cfg.missing.join(','));
  const base = new URL(cfg.endpoint);
  const lib = base.protocol === 'https:' ? https : http;
  const virtualHost = cfg.pathStyle ? base.host : `${cfg.bucket}.${base.host}`;

  const objPath = (key) => `${cfg.pathStyle ? `/${enc(cfg.bucket)}` : ''}/${encPath(cfg.prefix + key)}`;
  const bucketPath = () => (cfg.pathStyle ? `/${enc(cfg.bucket)}` : '/');

  /** Один запрос. body — Buffer (подписывается целиком) или null. Возвращает {status, headers, stream|buffer}. */
  const raw = (method, path, { query: q0 = '', headers = {}, body = null, stream = false } = {}) => new Promise((resolve, reject) => {
    const query = canonQuery(q0);
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = sha256hex(payload);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const sig = signV4({ method, host: virtualHost, path, query, headers, payloadHash, region: cfg.region, accessKey: cfg.accessKey, secretKey: cfg.secretKey, amzDate });
    const req = lib.request({
      protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, method, path: query ? `${path}?${query}` : path,
      headers: { host: virtualHost, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, ...headers, 'content-length': payload.length, authorization: sig.authorization },
      timeout: cfg.timeoutMs,
    }, (res) => {
      if (stream && res.statusCode < 300) return resolve({ status: res.statusCode, headers: res.headers, stream: res });
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new S3Error('s3_timeout')));
    req.on('error', (e) => reject(e instanceof S3Error ? e : new S3Error('s3_network', 0, e.code ?? e.message)));
    req.end(payload);
  });

  /** Запрос с ограниченными повторами (сеть и 5xx). */
  const call = async (method, path, opts = {}) => {
    let last;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const r = await raw(method, path, opts);
        if (r.status >= 500 && r.status !== 507) { last = new S3Error('s3_server_error', r.status); await sleep(200 * (attempt + 1) ** 2); continue; }
        return r;
      } catch (e) { last = e; if (attempt < 2) await sleep(200 * (attempt + 1) ** 2); }
    }
    throw last;
  };

  const fail = (r, what) => {
    const text = r.buffer ? r.buffer.toString('utf8').slice(0, 400) : '';
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? '';
    if (r.status === 403 || code === 'AccessDenied' || code === 'SignatureDoesNotMatch') throw new S3Error('s3_access_denied', r.status, code);
    if (r.status === 404 && code === 'NoSuchBucket') throw new S3Error('s3_no_bucket', 404, code);
    if (code === 'QuotaExceeded' || code === 'EntityTooLarge' || r.status === 507) throw new S3Error('s3_quota', r.status, code);
    throw new S3Error(`s3_${what}_failed`, r.status, code);
  };

  const readAll = async (stream) => { const c = []; for await (const x of stream) c.push(x); return Buffer.concat(c); };

  return {
    cfg,
    async head(key) {
      const r = await call('HEAD', objPath(key));
      if (r.status === 404) return null;
      if (r.status >= 300) fail(r, 'head');
      return { size: Number(r.headers['content-length'] ?? 0), etag: r.headers.etag };
    },
    async get(key, { start, end } = {}) {
      const headers = start !== undefined ? { range: `bytes=${start}-${end ?? ''}` } : {};
      const r = await call('GET', objPath(key), { headers, stream: true });
      if (r.status === 404) throw new S3Error('s3_not_found', 404);
      if (r.status >= 300) fail(r, 'get');
      return r.stream;
    },
    async del(key) {
      const r = await call('DELETE', objPath(key));
      if (r.status >= 300 && r.status !== 404) fail(r, 'delete');
    },
    /** Потоковая загрузка: до одной части — обычный PUT, иначе многокомпонентная; при сбое — Abort. */
    async put(key, source) {
      const part = cfg.partBytes;
      let buf = Buffer.alloc(0); let uploadId = null; const etags = []; let total = 0;
      const sendPart = async (data) => {
        const n = etags.length + 1;
        const r = await call('PUT', objPath(key), { query: `partNumber=${n}&uploadId=${enc(uploadId)}`, body: data });
        if (r.status >= 300) fail(r, 'part');
        etags.push(r.headers.etag);
      };
      try {
        for await (const c of source) {
          buf = buf.length ? Buffer.concat([buf, c]) : Buffer.from(c);
          total += c.length;
          while (buf.length >= part * 2) {            // держим не больше двух частей, последняя часть может быть любой длины
            if (!uploadId) uploadId = await this.initiate(key);
            await sendPart(buf.subarray(0, part)); buf = buf.subarray(part);
          }
        }
        if (!uploadId) {
          const r = await call('PUT', objPath(key), { body: buf });
          if (r.status >= 300) fail(r, 'put');
          return { size: total, etag: r.headers.etag };
        }
        if (buf.length) await sendPart(buf);
        const xml = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
        const r = await call('POST', objPath(key), { query: `uploadId=${enc(uploadId)}`, body: Buffer.from(xml) });
        if (r.status >= 300 || /<Error>/.test(r.buffer?.toString() ?? '')) fail(r, 'complete');
        return { size: total, etag: r.headers.etag, multipart: true };
      } catch (e) {
        if (uploadId) await this.abort(key, uploadId).catch(() => {});
        throw e;
      }
    },
    async initiate(key) {
      const r = await call('POST', objPath(key), { query: 'uploads=' });
      if (r.status >= 300) fail(r, 'initiate');
      const id = /<UploadId>([^<]+)<\/UploadId>/.exec(r.buffer.toString())?.[1];
      if (!id) throw new S3Error('s3_bad_answer');
      return id;
    },
    async abort(key, uploadId) {
      const r = await call('DELETE', objPath(key), { query: `uploadId=${enc(uploadId)}` });
      if (r.status >= 300 && r.status !== 404) fail(r, 'abort');
    },
    /** Незавершённые многокомпонентные загрузки под нашим префиксом. */
    async listUploads() {
      const r = await call('GET', bucketPath(), { query: `prefix=${enc(cfg.prefix)}&uploads=` });
      if (r.status >= 300) fail(r, 'list_uploads');
      const x = r.buffer.toString();
      return [...x.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)].map((m) => ({
        key: /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1] ?? '', uploadId: /<UploadId>([^<]+)<\/UploadId>/.exec(m[1])?.[1] ?? '',
        initiated: /<Initiated>([^<]+)<\/Initiated>/.exec(m[1])?.[1] ?? '',
      })).map((u) => ({ ...u, key: u.key.startsWith(cfg.prefix) ? u.key.slice(cfg.prefix.length) : u.key }));
    },
    async list(prefix = '') {
      const out = []; let token = '';
      for (;;) {
        const q = `list-type=2&prefix=${enc(cfg.prefix + prefix)}${token ? `&continuation-token=${enc(token)}` : ''}`;
        const r = await call('GET', bucketPath(), { query: q });
        if (r.status >= 300) fail(r, 'list');
        const x = r.buffer.toString();
        for (const m of x.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const k = /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1] ?? '';
          out.push({ key: k.startsWith(cfg.prefix) ? k.slice(cfg.prefix.length) : k, size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0) });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(x) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(x)?.[1] ?? '') : '';
        if (!token) break;
      }
      return out;
    },
    /** Доступность: список из одного ключа. Возвращает {ok, ms, code}. */
    async health() {
      const t0 = Date.now();
      try {
        const r = await call('GET', bucketPath(), { query: `list-type=2&max-keys=1&prefix=${enc(cfg.prefix)}` });
        if (r.status >= 300) fail(r, 'health');
        return { ok: true, ms: Date.now() - t0 };
      } catch (e) { return { ok: false, ms: Date.now() - t0, code: e.code ?? 'error', status: e.status ?? 0 }; }
    },
    readAll,
    toReadable: (b) => Readable.from(b),
  };
};
