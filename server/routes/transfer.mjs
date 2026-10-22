import { json, requireSkyId, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as T from './../transfer.mjs';

const STATUS = {
  not_found: 404, unknown_device: 403, device_not_approved: 403, device_revoked: 403, recipient_not_trusted: 409, same_device: 400, recipient_cannot_receive: 409,
  transfers_disabled: 403, type_not_allowed: 415, file_too_large: 413, too_many_active: 429, hash_mismatch: 422, bad_chunk_size: 400, not_uploading: 409, bad_state: 409,
  awaiting_accept: 409, not_ready: 409, integrity_failed: 422, storage_unavailable: 503, still_active: 409,
};

/** Тело куска в память (до 4 МБ + запас) — кусок хешируется целиком до записи. */
const readChunk = (req, limit) => new Promise((resolve) => {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) { req.destroy(); resolve(null); return; }
  const parts = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(); resolve(null); return; } parts.push(c); });
  req.on('end', () => resolve(Buffer.concat(parts)));
  req.on('error', () => resolve(null));
});

/**
 * /api/transfer/* — Sky Transfer. Только вошедший Sky ID; устройство определяется заголовком X-Sky-Device и должно быть подтверждено.
 * Права проверяются на сервере: передачу видит и меняет только отправитель/получатель из этого же Sky ID.
 */
export const transferRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/transfer')) return false;
  const s = await requireSkyId(req, res); if (!s) return true;
  const { skyId } = s;
  const reply = (r) => json(res, r.error ? (STATUS[r.error] ?? 400) : 200, r);
  const m = req.method;
  const rest = path.slice('/api/transfer'.length);

  // Кусок — тяжёлые запросы: свой, щедрый предел (по Sky ID).
  const chunk = /^\/t\/(xfr-[0-9a-f-]{36})\/chunk\/(\d{1,6})$/.exec(rest);
  if (chunk) {
    if (!rateLimit(`xfer:chunk:${skyId}`, 1500)) return json(res, 429, { error: 'rate_limited' });
    if (m === 'PUT') {
      const buf = await readChunk(req, T.LIMITS.maxChunk + 16);
      if (!buf) return json(res, 413, { error: 'bad_chunk_size' });
      return reply(await T.putChunk(skyId, req, chunk[1], chunk[2], buf));
    }
    if (m === 'GET') {
      const r = await T.openForDownload(skyId, req, chunk[1], chunk[2]);
      if (r.error) return reply(r);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(r.size), 'X-Chunk-Sha256': r.hash, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      let sent = 0;
      r.stream.on('data', (c) => { sent += c.length; });
      r.stream.on('error', () => res.destroy());
      res.on('close', () => { r.stream.destroy(); if (sent) void T.noteDownloaded(r.t.id, sent); });
      r.stream.pipe(res);
      return true;
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!rateLimit(`xfer:api:${skyId}`, 240)) return json(res, 429, { error: 'rate_limited' });
  const b = (m === 'GET' || m === 'DELETE') ? {} : ((await parseBody(req).catch(() => ({}))) ?? {});

  if (m === 'GET' && rest === '') return json(res, 200, await T.overview(skyId, req));
  if (m === 'POST' && rest === '/devices/register') return reply(await T.registerDevice(skyId, req, b));
  if (m === 'POST' && rest === '/devices/heartbeat') return reply(await T.heartbeat(skyId, req));
  let mm = /^\/devices\/(dev-[0-9a-f-]{36})(?:\/(approve))?$/.exec(rest);
  if (mm) {
    if (m === 'POST' && mm[2] === 'approve') return reply(await T.approveDevice(skyId, req, mm[1]));
    if (m === 'DELETE' && !mm[2]) return reply(await T.removeDevice(skyId, req, mm[1]));
    if (m === 'PATCH' && !mm[2]) return reply(await T.renameDevice(skyId, req, mm[1], b.name));
  }
  if (rest === '/prefs') { if (m === 'GET') return json(res, 200, await T.getPrefs(skyId)); if (m === 'PUT') return json(res, 200, await T.setPrefs(skyId, b)); }
  if (m === 'POST' && rest === '/send') { if (!rateLimit(`xfer:send:${skyId}`, 40)) return json(res, 429, { error: 'rate_limited' }); return reply(await T.createTransfer(skyId, req, b)); }
  if (m === 'DELETE' && rest === '/history') return reply(await T.clearHistory(skyId, req));
  mm = /^\/t\/(xfr-[0-9a-f-]{36})(?:\/(status|accept|reject|cancel|complete|fail))?$/.exec(rest);
  if (mm) {
    const id = mm[1], act = mm[2];
    if (m === 'GET' && act === 'status') return reply(await T.statusOf(skyId, req, id));
    if (m === 'POST' && act === 'accept') return reply(await T.accept(skyId, req, id));
    if (m === 'POST' && act === 'reject') return reply(await T.reject(skyId, req, id));
    if (m === 'POST' && act === 'cancel') return reply(await T.cancel(skyId, req, id));
    if (m === 'POST' && act === 'complete') return reply(await T.complete(skyId, req, id, b.digest));
    if (m === 'POST' && act === 'fail') return reply(await T.fail(skyId, req, id, b.reason));
    if (m === 'DELETE' && !act) return reply(await T.deleteRecord(skyId, req, id));
  }
  return json(res, 404, { error: 'not_found' });
};
