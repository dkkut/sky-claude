/**
 * Sky Storage: прямой доступ. Админ-API /api/admin/storage/direct* (право storage_direct или владелец) и S3-шлюз /api/storage/s3/*
 * (вход — ТОЛЬКО по подписи SigV4 временных ключей, выданных после подтверждения владельцем). Стоит ПЕРЕД storageRoutes.
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { createS3, s3Config, listPage } from './../skystorages3.mjs';
import { snapshot, effective } from './../skystoragestate.mjs';
import * as D from './../storagedirect.mjs';

const MULT = Math.max(1, Number(process.env.STORAGE_RATE_MULT) || 1);
const MAX_PUT = 64 * 1024 * 1024;
const BUCKET = 'sky-storage';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const ipClass = (ip) => { const s = String(ip ?? ''); return s.includes(':') ? `${s.split(':').slice(0, 3).join(':')}::/48` : `${s.split('.').slice(0, 3).join('.')}.0/24`; };

const xml = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/xml', 'Cache-Control': 'no-store', ...headers }); res.end(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`); return true; };
const s3err = (res, status, code, msg) => xml(res, status, `<Error><Code>${code}</Code><Message>${msg}</Message></Error>`);

const readBody = (req, limit) => new Promise((resolve) => {
  const chunks = []; let size = 0; let dead = false;
  req.on('data', (c) => { if (dead) return; size += c.length; if (size > limit) { dead = true; resolve(null); return; } chunks.push(c); });
  req.on('end', () => { if (!dead) resolve(Buffer.concat(chunks)); });
  req.on('error', () => { if (!dead) resolve(null); });
});

/** Проверка подписи SigV4 входящего запроса. Возвращает { access } или { error:[status, code, text] }. */
export const verifySigV4 = async (req, rawUrl) => {
  const auth = String(req.headers.authorization ?? '');
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([a-z0-9;_-]+), ?Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return { error: [403, 'AccessDenied', 'Нужна подпись AWS Signature V4'] };
  const [, keyId, date, region, signedHeaders, signature] = m;
  const amzDate = String(req.headers['x-amz-date'] ?? '');
  if (!/^\d{8}T\d{6}Z$/.test(amzDate) || amzDate.slice(0, 8) !== date) return { error: [403, 'AccessDenied', 'Неверная дата подписи'] };
  const t = Date.UTC(+amzDate.slice(0, 4), +amzDate.slice(4, 6) - 1, +amzDate.slice(6, 8), +amzDate.slice(9, 11), +amzDate.slice(11, 13), +amzDate.slice(13, 15));
  if (Math.abs(Date.now() - t) > 5 * 60_000) return { error: [403, 'RequestTimeTooSkewed', 'Часы клиента расходятся с сервером более чем на 5 минут'] };
  const access = await D.authenticate(keyId);
  if (!access) return { error: [403, 'InvalidAccessKeyId', 'Ключ не найден, отозван или срок доступа истёк'] };
  const u = new URL(rawUrl, 'http://x');
  const canonQ = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const names = signedHeaders.split(';');
  if (!names.includes('host') || !names.includes('x-amz-date')) return { error: [403, 'AccessDenied', 'В подпись должны входить host и x-amz-date'] };
  const canonH = names.map((n) => `${n}:${String(req.headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const payloadHash = String(req.headers['x-amz-content-sha256'] ?? '');
  if (!payloadHash) return { error: [400, 'InvalidRequest', 'Нужен заголовок x-amz-content-sha256'] };
  if (payloadHash.startsWith('STREAMING-')) return { error: [501, 'NotImplemented', 'Потоковая подпись (aws-chunked) не поддерживается — отключите её в клиенте (для aws cli: payload_signing_enabled=true / s3.payload_signing_enabled)'] };
  const canonical = [req.method, u.pathname, canonQ, canonH, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac(`AWS4${access.secret}`, date), region), 's3'), 'aws4_request');
  const expect = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  const a = Buffer.from(expect); const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: [403, 'SignatureDoesNotMatch', 'Подпись не совпала'] };
  return { access, payloadHash };
};

const gateway = async (req, res, url) => {
  const ip = clientIp(req);
  if (!rateLimit(`s3gw:ip:${ip}`, 600 * MULT)) return s3err(res, 429, 'SlowDown', 'Слишком много запросов');
  const u = new URL(req.url, 'http://x');
  const rest = u.pathname.slice('/api/storage/s3'.length).replace(/^\/+/, '');
  const sig = await verifySigV4(req, req.url);
  if (sig.error) { if (!rateLimit(`s3gw:bad:${ip}`, 30 * MULT)) return s3err(res, 429, 'SlowDown', 'Слишком много неудачных попыток'); return s3err(res, ...sig.error); }
  const { access, payloadHash } = sig;
  if (!rateLimit(`s3gw:key:${access.id}`, 300 * MULT)) return s3err(res, 429, 'SlowDown', 'Слишком много запросов');
  const eff = effective(snapshot());
  if (!eff.read) return s3err(res, 503, 'ServiceUnavailable', 'Хранилище сейчас закрыто политикой безопасности');
  const slash = rest.indexOf('/');
  const bucket = slash < 0 ? rest : rest.slice(0, slash);
  let key = slash < 0 ? '' : decodeURIComponent(rest.slice(slash + 1));
  const net = ipClass(ip);
  const done = (op, status, bytes = 0) => D.record(access.id, op, key, status, bytes, net);
  if (bucket !== BUCKET) { await done('bad_bucket', 404); return s3err(res, 404, 'NoSuchBucket', `Имя бакета для шлюза — ${BUCKET}`); }
  if (key.length > 1024 || /(^|\/)\.\.(\/|$)/.test(key)) { await done('bad_key', 400); return s3err(res, 400, 'InvalidArgument', 'Недопустимый ключ'); }
  let s3;
  try { s3 = createS3(s3Config()); } catch { return s3err(res, 503, 'ServiceUnavailable', 'Хранилище не настроено'); }
  const write = req.method === 'PUT' || req.method === 'DELETE' || req.method === 'POST';
  if (write && (access.scope !== 'readwrite' || !eff.write)) { await done('denied_write', 403); return s3err(res, 403, 'AccessDenied', access.scope !== 'readwrite' ? 'Доступ выдан только на чтение' : 'Запись в хранилище сейчас закрыта'); }
  try {
    if (!key && req.method === 'GET') {
      if (!u.searchParams.has('list-type') && u.searchParams.size > 0 && !u.searchParams.has('prefix')) { await done('unsupported', 501); return s3err(res, 501, 'NotImplemented', 'Поддерживается только ListObjectsV2'); }
      const max = Math.min(1000, Math.max(1, Number(u.searchParams.get('max-keys')) || 1000));
      const p = await listPage(s3, { prefix: u.searchParams.get('prefix') ?? '', token: u.searchParams.get('continuation-token') ?? '', max });
      await done('list', 200);
      return xml(res, 200, `<ListBucketResult><Name>${BUCKET}</Name><Prefix>${escapeXml(u.searchParams.get('prefix') ?? '')}</Prefix><KeyCount>${p.items.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${p.truncated}</IsTruncated>${p.next ? `<NextContinuationToken>${escapeXml(p.next)}</NextContinuationToken>` : ''}${p.items.map((i) => `<Contents><Key>${escapeXml(i.key)}</Key><LastModified>${i.modified}</LastModified><ETag>${i.etag}</ETag><Size>${i.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join('')}</ListBucketResult>`);
    }
    if (!key) { await done('unsupported', 501); return s3err(res, 501, 'NotImplemented', 'Операция не поддерживается шлюзом'); }
    if (req.method === 'HEAD' || req.method === 'GET') {
      const h = await s3.head(key);
      if (!h) { await done('get', 404); return req.method === 'HEAD' ? (res.writeHead(404), res.end(), true) : s3err(res, 404, 'NoSuchKey', 'Нет такого объекта'); }
      let start; let end; let status = 200; const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', ETag: h.etag ?? '', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      const rg = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (rg && (rg[1] || rg[2])) {
        if (!rg[1]) { start = Math.max(0, h.size - Number(rg[2])); end = h.size - 1; } else { start = Number(rg[1]); end = rg[2] ? Math.min(Number(rg[2]), h.size - 1) : h.size - 1; }
        if (start >= h.size || end < start) { await done('get', 416); return s3err(res, 416, 'InvalidRange', 'Недопустимый диапазон'); }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${h.size}`; headers['Content-Length'] = end - start + 1;
      } else headers['Content-Length'] = h.size;
      if (req.method === 'HEAD') { await done('head', 200); res.writeHead(200, headers); res.end(); return true; }
      const stream = await s3.get(key, start !== undefined ? { start, end } : {});
      res.writeHead(status, headers);
      let sent = 0; stream.on('data', (c) => { sent += c.length; });
      stream.on('end', () => { void done('get', status, sent); });
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return true;
    }
    if (req.method === 'PUT') {
      if (req.headers['x-amz-copy-source']) { await done('unsupported', 501); return s3err(res, 501, 'NotImplemented', 'Копирование не поддерживается'); }
      if (u.searchParams.has('uploadId') || u.searchParams.has('partNumber')) { await done('unsupported', 501); return s3err(res, 501, 'NotImplemented', 'Многокомпонентная загрузка не поддерживается — загружайте файлы до 64 МБ обычным PUT'); }
      const buf = await readBody(req, MAX_PUT);
      if (!buf) { await done('put', 413); return s3err(res, 413, 'EntityTooLarge', 'Файл больше 64 МБ'); }
      if (payloadHash !== 'UNSIGNED-PAYLOAD' && sha256(buf) !== payloadHash) { await done('put', 400); return s3err(res, 400, 'XAmzContentSHA256Mismatch', 'Хеш содержимого не совпал'); }
      const r = await s3.put(key, Readable.from([buf]));
      await done('put', 200, buf.length);
      res.writeHead(200, { ETag: r.etag ?? '', 'Content-Length': 0 }); res.end(); return true;
    }
    if (req.method === 'DELETE') {
      await s3.del(key); await done('delete', 204);
      res.writeHead(204); res.end(); return true;
    }
    await done('unsupported', 501);
    return s3err(res, 501, 'NotImplemented', 'Операция не поддерживается шлюзом');
  } catch (e) {
    await done('error', 502);
    return s3err(res, e?.status === 404 ? 404 : 502, e?.status === 404 ? 'NoSuchKey' : 'InternalError', 'Ошибка хранилища');
  }
};
const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export const storageDirectRoutes = async (req, res, url) => {
  if (url.startsWith('/api/storage/s3/') || url === '/api/storage/s3') return gateway(req, res, url);
  if (!url.startsWith('/api/admin/storage/direct')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const meta = requestMeta(req);
  if (!rateLimit(`storage:direct:${me}`, 60 * MULT)) return json(res, 429, { error: 'too_many_attempts' });
  const path = new URL(req.url, 'http://x').pathname.slice('/api/admin/storage/direct'.length) || '/';
  const send = (r) => (r?.error ? json(res, ({ not_allowed: 403, not_found: 404, request_open: 409, not_open: 409, storage_unavailable: 503 })[r.error] ?? 400, r) : json(res, 200, r));
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && path === '/') return send(await D.list(me));
  if (req.method === 'POST' && path === '/request') { if (!rateLimit(`storage:direct:req:${me}`, 5 * MULT)) return json(res, 429, { error: 'too_many_attempts' }); return send(await D.request(me, (await parseBody(req)) ?? {}, meta)); }
  let m;
  if ((m = path.match(/^\/([\w-]+)\/claim$/)) && req.method === 'POST') return send(await D.claim(me, m[1]));
  if ((m = path.match(/^\/([\w-]+)\/revoke$/)) && req.method === 'POST') return send(await D.revoke(me, m[1], meta));
  if ((m = path.match(/^\/([\w-]+)\/log$/)) && req.method === 'GET') return send(await D.log(me, m[1]));
  return json(res, 404, { error: 'not_found' });
};
