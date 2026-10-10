/**
 * Sky Ads по HTTP.
 *
 * /api/ads/media — тот же приём, что у Bloom/Sky Video: MIME по первым
 * байтам, а не по словам клиента; путь на диске никогда не собирается
 * из присланного имени файла (server/adstore.mjs).
 *
 * Все решающие проверки — в server/ads.mjs (Prime, регион, площадка,
 * статус/период кампании, бюджет/лимит, частота). Здесь только
 * маршрутизация, лимиты запросов и запись в уже существующий admin_log.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession, mediaBody } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  PLACEMENT_KEYS, createCampaign, myCampaigns, campaignDetail,
  pauseCampaign, resumeCampaign, cancelCampaign, reportCampaign,
  resolveAdForPlacement, recordImpression, recordClick, recentAdEvents,
  adminListCampaigns, adminApprove, adminReject, adminPause, adminResume, adminComplete, adminCancel,
} from './../ads.mjs';
import { saveStream, openStream, sizeOf, newMediaId } from './../adstore.mjs';
import { parseRange } from './../skyvideostore.mjs';
import { ticketCookie, ticketFromCookies, issueTicket, readTicket } from './../adticket.mjs';
import { logAdmin } from './../adminsec.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 30;
const STREAM_PER_MIN = 600;
const UPLOAD_PER_HOUR = 30;
const TRACK_PER_MIN = 300;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
const VIDEO_SIGNATURES = [
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

const sniff = (buf, table) => {
  if (!buf || buf.length < 16) return null;
  for (const s of table) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};
const sniffMedia = (buf) => {
  const img = sniff(buf, IMAGE_SIGNATURES);
  if (img) return { mime: img, kind: 'image' };
  const vid = sniff(buf, VIDEO_SIGNATURES);
  return vid ? { mime: vid, kind: 'video' } : null;
};

const peek = (req, bytes) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  const onData = (c) => {
    chunks.push(c);
    size += c.length;
    if (size >= bytes) { req.pause(); req.off('data', onData); resolve(Buffer.concat(chunks)); }
  };
  const onEnd = () => { req.off('data', onData); resolve(Buffer.concat(chunks)); };
  req.on('data', onData);
  req.once('end', onEnd);
});
const withHead = (head, rest) => Readable.from((async function* () {
  yield head;
  for await (const chunk of rest) yield chunk;
})());
const rejectBody = (req, res, code, body) => {
  json(res, code, body, { Connection: 'close' });
  res.once('finish', () => req.destroy());
  return true;
};

const errCode = (error) => (
  error === 'not_found' ? 404
    : error === 'not_allowed' ? 403
      : error === 'insufficient_funds' ? 402
        : error === 'bad_status' ? 409
          : 400
);

const streamMedia = async (req, res, mediaId) => {
  const size = await sizeOf(mediaId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  // MIME по кампании, которая ссылается на этот файл — сохранён при
  // загрузке (см. POST /media), не выдумывается заново на раздаче.
  const { query } = await import('./../db.mjs');
  const { rows } = await query('SELECT format FROM ad_campaigns WHERE media_id = $1 LIMIT 1', [mediaId]);
  const contentType = rows[0]?.format === 'video' ? 'video/mp4' : 'image/jpeg';

  const common = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    // См. film.mjs — тот же пропуск-в-куке, тот же риск межпрофильной
    // путаницы без Vary.
    'Vary': 'Cookie',
  };
  const range = parseRange(req.headers.range, size);
  if (range?.invalid) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` });
    res.end();
    return true;
  }
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, { ...common, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(length) });
    if (req.method === 'HEAD') { res.end(); return true; }
    const stream = openStream(mediaId, range);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
  }
  res.writeHead(200, { ...common, 'Content-Length': String(size) });
  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = openStream(mediaId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

export const adsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/ads')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Медиа — единственное место, куда браузер ходит сам, тегами <img>/
     <video>: заголовок Authorization он туда не подставит, только
     пропуск (см. server/adticket.mjs), как и у Sky Video/кино. */
  const mediaMatch = /^\/api\/ads\/media\/([^/]+)$/.exec(path);
  const isMedia = mediaMatch && (req.method === 'GET' || req.method === 'HEAD');

  let me;
  if (isMedia) {
    const session = await readSession(req);
    me = session?.profileId ?? ticketFromCookies(req.headers.cookie) ?? readTicket(params.get('t'));
    if (!me) return json(res, 401, { error: 'unauthorized' });
    if (!rateLimit(`ads:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return streamMedia(req, res, mediaMatch[1]);
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  me = session.profileId;

  if (req.method === 'POST' && path === '/api/ads/ticket') {
    const ticket = issueTicket(me);
    res.setHeader('Set-Cookie', ticketCookie(me, ticket));
    return json(res, 200, mediaBody(req, { ok: true }, { ticket }));
  }

  if (req.method === 'POST' && path === '/api/ads/media') {
    if (!rateLimitPerHour(`ads:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
    const head = await peek(req, 32);
    const sniffed = sniffMedia(head);
    if (!sniffed) return rejectBody(req, res, 415, { error: 'unsupported_media' });
    const limit = sniffed.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const mediaId = newMediaId();
    const saved = await saveStream(mediaId, withHead(head, req), limit);
    if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 400, saved);
    return json(res, 200, { mediaId, mime: sniffed.mime, kind: sniffed.kind, bytes: saved.bytes });
  }

  /* ── Реклама для показа (пункт 7) ─────────────────────────────── */

  if (req.method === 'GET' && path === '/api/ads/serve') {
    if (!rateLimit(`ads:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const placement = String(params.get('placement') ?? '');
    if (!PLACEMENT_KEYS.includes(placement)) return json(res, 400, { error: 'bad_placement' });
    const ad = await resolveAdForPlacement(me, placement);
    return json(res, 200, { ad });
  }

  if (req.method === 'POST' && path === '/api/ads/impression') {
    if (!rateLimit(`ads:track:${me}`, TRACK_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await recordImpression(me, String(body?.campaignId ?? ''), String(body?.placement ?? ''));
    if (r.error) return json(res, r.error === 'not_found' ? 404 : 409, r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/ads/click') {
    if (!rateLimit(`ads:track:${me}`, TRACK_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await recordClick(
      me, String(body?.campaignId ?? ''), String(body?.impressionId ?? ''), String(body?.placement ?? ''),
    );
    if (r.error) return json(res, r.error === 'not_found' ? 404 : 409, r);
    return json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/ads/events') {
    if (!rateLimit(`ads:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const sinceMs = Math.max(Date.now() - 24 * 3_600_000, Number(params.get('since')) || 0);
    const events = await recentAdEvents(me, new Date(sinceMs).toISOString());
    return json(res, 200, { events, now: Date.now() });
  }

  /* ── Рекламодатель ─────────────────────────────────────────────── */

  if (req.method === 'POST' && path === '/api/ads/campaigns') {
    if (!rateLimit(`ads:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createCampaign(me, body ?? {});
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/ads/campaigns') {
    if (!rateLimit(`ads:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { items: await myCampaigns(me) });
  }

  const campMatch = /^\/api\/ads\/campaigns\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (campMatch) {
    const id = campMatch[1];
    const tail = campMatch[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`ads:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await campaignDetail(me, id);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/pause') {
      if (!rateLimit(`ads:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await pauseCampaign(me, id);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/resume') {
      if (!rateLimit(`ads:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await resumeCampaign(me, id);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/cancel') {
      if (!rateLimit(`ads:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await cancelCampaign(me, id);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/report') {
      if (!rateLimit(`ads:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await reportCampaign(me, id, body?.reason);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ── Админка (пункты 3, 15) ────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/ads/admin/campaigns') {
    if (!rateLimit(`ads:admin:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminListCampaigns(me, {
      status: params.get('status') || undefined, q: params.get('q') || undefined, limit: params.get('limit'),
    });
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  const adminMatch = /^\/api\/ads\/admin\/campaigns\/([^/]+)\/([a-z]+)$/.exec(path);
  if (req.method === 'POST' && adminMatch) {
    const [, id, action] = adminMatch;
    if (!rateLimit(`ads:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req).catch(() => ({}));

    const ACTIONS = {
      approve: () => adminApprove(me, id),
      reject:  () => adminReject(me, id, body?.reason),
      pause:   () => adminPause(me, id),
      resume:  () => adminResume(me, id),
      complete:() => adminComplete(me, id),
      cancel:  () => adminCancel(me, id),
    };
    const fn = ACTIONS[action];
    if (!fn) return json(res, 404, { error: 'not_found' });

    const r = await fn();
    if (r.error) return json(res, errCode(r.error), r);
    await logAdmin({
      actorId: me, targetId: id, targetType: 'ad_campaign', type: `ad_campaign_${action}`, result: 'ok',
      detail: body?.reason ? String(body.reason).slice(0, 300) : '',
    });
    return json(res, 200, r);
  }

  return false;
};
