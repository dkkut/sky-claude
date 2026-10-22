/**
 * Sky Video / Studio по HTTP.
 *
 * Устройство то же, что у Sky Film (routes/film.mjs): видео отдаётся
 * потоком с Range, загрузка идёт потоком с пределом по факту принятых
 * байт, тип файла определяется по первым байтам, а не по словам
 * клиента, и ни одна ручка не решает сама, можно ли этому человеку
 * это видео — решает слой данных (skyvideo.mjs).
 *
 * Отличие от кино: доступ не завязан на Sky Prime. Studio — открытая
 * площадка для собственного контента, а не Prime-каталог, и подписка
 * здесь ни при чём.
 */
import { archiveByOwner } from './../contentarchive.mjs';
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession, mediaBody } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  listFeed, listCategories, listMine, readVideo, visibleVideo,
  createDraft, finishUpload, updateVideo, deleteVideo, setThumbnail, publishVideo,
  countView, setLiked, listComments, addComment, removeComment,
  requestMonetization, listMonetizationHistory, monetizationQueue, decideMonetization,
  listRevenue, adminSearchVideos, setVideoRegions, channelInfo, listChannels, channelAnalytics,
} from './../skyvideo.mjs';
import { saveStream, saveBytes, sizeOf, openStream, parseRange, thumbnailIdFor } from './../skyvideostore.mjs';
import { ticketCookie, ticketFromCookies, issueTicket, readTicket } from './../skyvideoticket.mjs';
import { logAdmin } from './../adminsec.mjs';

/** Четыре гигабайта по умолчанию — настраивается тем, кто видит диск сервера. */
const MAX_VIDEO_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.SKYVIDEO_MAX_BYTES) || 4 * 1024 * 1024 * 1024,
);
const MAX_THUMB_BYTES = 5 * 1024 * 1024;

const STREAM_PER_MIN = 1200;
const READ_PER_MIN = 300;
const WRITE_PER_MIN = 120;
const UPLOAD_PER_HOUR = 20;

const VIDEO_ID = /^svid-[0-9a-f-]{36}$/;
const COMMENT_ID = /^svc-[0-9a-f-]{36}$/;
const REQUEST_ID = /^svmr-[0-9a-f-]{36}$/;
const AUTHOR_ID = /^acc-[0-9a-f-]{36}$/;

const VIDEO_SIGNATURES = [
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'video/x-msvideo', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'AVI ' },
  { mime: 'video/ogg', test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
];
const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

const sniff = (buf, table) => {
  if (!buf || buf.length < 16) return null;
  for (const s of table) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};

const readBytes = (req, limit) => new Promise((resolve, reject) => {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) { resolve(null); return; }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) { req.destroy(); resolve(null); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const peek = (req, bytes) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  const onData = (c) => {
    chunks.push(c);
    size += c.length;
    if (size >= bytes) {
      req.pause();
      req.off('data', onData);
      resolve(Buffer.concat(chunks));
    }
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
  error === 'not_allowed' ? 403
    : error === 'not_found' ? 404
      : error === 'already_pending' ? 409
        : error === 'not_pending' ? 409
          : error === 'too_many' ? 409
            : 400
);

/** Потоковая выдача файла (видео или обложка) с поддержкой Range. */
const streamFile = async (req, res, fileId, mime) => {
  const size = await sizeOf(fileId);
  if (size === null || size === 0) { json(res, 404, { error: 'not_found' }); return true; }

  const common = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600',
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
    res.writeHead(206, { ...common,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': String(length) });
    if (req.method === 'HEAD') { res.end(); return true; }
    const stream = openStream(fileId, range);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
  }
  res.writeHead(200, { ...common, 'Content-Length': String(size) });
  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = openStream(fileId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

export const skyVideoRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/skyvideo')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Видео и обложка — единственное место, куда браузер ходит сам,
     тегами <video> и <img>. Заголовок Authorization он туда не
     подставит, поэтому здесь принимается ещё и подписанный пропуск. */
  const isMedia = /^\/api\/skyvideo\/video\/[^/]+\/(video|thumbnail)$/.test(path)
    && (req.method === 'GET' || req.method === 'HEAD');

  let me;
  if (isMedia) {
    const session = await readSession(req);
    // Родное приложение — другой origin, SameSite=Strict-кука туда не
    // дойдёт обратно, поэтому тот же пропуск ищем ещё и в ?t= (см.
    // musicticket.mjs — тот же приём).
    me = session?.profileId ?? ticketFromCookies(req.headers.cookie) ?? readTicket(params.get('t'));
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  if (req.method === 'POST' && path === '/api/skyvideo/ticket') {
    const ticket = issueTicket(me);
    res.setHeader('Set-Cookie', ticketCookie(me, ticket));
    return json(res, 200, mediaBody(req, { ok: true }, { ticket }));
  }

  /* ── Лента и категории ─────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/skyvideo/feed') {
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      videos: await listFeed(me, {
        q: params.get('q') ?? undefined,
        category: params.get('category') ?? undefined,
        limit: params.get('limit'),
        offset: params.get('offset'),
        sort: params.get('sort') ?? undefined,
      }),
    });
  }

  if (req.method === 'GET' && path === '/api/skyvideo/channels') {
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      channels: await listChannels({ limit: params.get('limit'), offset: params.get('offset') }),
    });
  }

  if (req.method === 'GET' && path === '/api/skyvideo/analytics') {
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await channelAnalytics(me, { days: params.get('days') }));
  }

  const channelMatch = path.match(/^\/api\/skyvideo\/channel\/([^/]+)$/);
  if (req.method === 'GET' && channelMatch) {
    const authorId = channelMatch[1];
    if (!AUTHOR_ID.test(authorId)) return json(res, 404, { error: 'not_found' });
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const channel = await channelInfo(authorId);
    if (!channel) return json(res, 404, { error: 'not_found' });
    return json(res, 200, {
      channel,
      videos: await listFeed(me, {
        authorId,
        limit: params.get('limit'),
        offset: params.get('offset'),
        sort: params.get('sort') ?? undefined,
      }),
    });
  }

  if (req.method === 'GET' && path === '/api/skyvideo/categories') {
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { categories: listCategories() });
  }

  /* ── Кабинет автора ────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/skyvideo/mine') {
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      videos: await listMine(me, { limit: params.get('limit'), offset: params.get('offset') }),
    });
  }

  /* ── Очередь монетизации: право content, не «свой»/«чужой» ───── */

  if (req.method === 'GET' && path === '/api/skyvideo/monetization/queue') {
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await monetizationQueue(me, { limit: params.get('limit') });
    if (r?.error) return json(res, 403, r);
    return json(res, 200, { requests: r });
  }

  const decideMatch = path.match(/^\/api\/skyvideo\/monetization\/([^/]+)\/decide$/);
  if (req.method === 'POST' && decideMatch) {
    if (!REQUEST_ID.test(decideMatch[1])) return json(res, 404, { error: 'not_found' });
    if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await decideMonetization(decideMatch[1], me, {
      approve: body?.approve === true, reason: body?.reason });
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  /* ── Загрузка ──────────────────────────────────────────────── */

  if (req.method === 'POST' && path === '/api/skyvideo/upload') {
    if (!rateLimitPerHour(`svid:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_VIDEO_BYTES) return rejectBody(req, res, 413, { error: 'file_too_large' });

    const meta = {
      title: params.get('title'),
      description: params.get('description'),
      category: params.get('category'),
      tags: params.get('tags'),
      duration: params.get('duration'),
      width: params.get('width'),
      height: params.get('height'),
    };

    const head = await peek(req, 32);
    const mime = sniff(head, VIDEO_SIGNATURES);
    if (!mime) return rejectBody(req, res, 400, { error: 'unsupported_type' });

    const created = await createDraft(me, { ...meta, mime });
    if (created.error) return rejectBody(req, res, errCode(created.error), created);

    const saved = await saveStream(created.id, withHead(head, req), MAX_VIDEO_BYTES);
    if (saved.error) {
      await deleteVideo(created.id, me);
      return json(res, saved.error === 'file_too_large' ? 413 : 400, saved);
    }
    await finishUpload(created.id, me, {
      bytes: saved.bytes, mime,
      duration: meta.duration, width: meta.width, height: meta.height,
    });
    return json(res, 201, { video: await readVideo(created.id, me) });
  }

  /* ── Один ролик ────────────────────────────────────────────── */

  const videoMatch = path.match(/^\/api\/skyvideo\/video\/([^/]+)(\/[a-z]+)?$/);
  if (videoMatch) {
    const id = videoMatch[1];
    const tail = videoMatch[2] ?? '';
    if (!VIDEO_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const v = await readVideo(id, me);
      return v ? json(res, 200, { video: v }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updateVideo(id, me, body ?? {});
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, { video: await readVideo(id, me) });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req).catch(() => ({}));
      const ar = await archiveByOwner('video', id, me);
      if (ar.ok) return json(res, 200, { ok: true, archived: true, purgeAt: ar.purgeAt });
      const r = await deleteVideo(id, me, body?.reason);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/publish') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await publishVideo(id, me, body?.on !== false);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, { video: await readVideo(id, me) });
    }

    if (req.method === 'POST' && tail === '/view') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      if (!(await visibleVideo(id, me))) return json(res, 404, { error: 'not_found' });
      await countView(me, id);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/like') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setLiked(me, id, body?.on !== false);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, { video: await readVideo(id, me) });
    }

    if (req.method === 'GET' && tail === '/comments') {
      if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const list = await listComments(id, me, { limit: params.get('limit') });
      return list === null ? json(res, 404, { error: 'not_found' }) : json(res, 200, { comments: list });
    }
    if (req.method === 'POST' && tail === '/comments') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await addComment(id, me, body?.body);
      return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
    }

    if (req.method === 'POST' && tail === '/monetize') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await requestMonetization(id, me);
      return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
    }
    if (req.method === 'GET' && tail === '/monetization') {
      if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const list = await listMonetizationHistory(id, me);
      return list === null ? json(res, 404, { error: 'not_found' }) : json(res, 200, { requests: list });
    }
    if (req.method === 'GET' && tail === '/revenue') {
      if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const list = await listRevenue(id, me);
      return list === null ? json(res, 404, { error: 'not_found' }) : json(res, 200, { entries: list });
    }

    if (req.method === 'POST' && tail === '/thumbnail') {
      if (!rateLimitPerHour(`svid:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const buf = await readBytes(req, MAX_THUMB_BYTES);
      if (!buf) return json(res, 413, { error: 'file_too_large' });
      const mime = sniff(buf, IMAGE_SIGNATURES);
      if (!mime) return json(res, 400, { error: 'unsupported_type' });
      if (!(await setThumbnail(id, me, mime))) return json(res, 403, { error: 'not_allowed' });
      await saveBytes(thumbnailIdFor(id), buf);
      return json(res, 200, { ok: true });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && (tail === '/video' || tail === '/thumbnail')) {
      if (!rateLimit(`svid:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      // Право на каждый кусок, а не один раз в начале просмотра.
      const row = await visibleVideo(id, me);
      if (!row) return json(res, 404, { error: 'not_found' });

      const wantThumb = tail === '/thumbnail';
      if (wantThumb && !row.has_thumbnail) return json(res, 404, { error: 'not_found' });
      const fileId = wantThumb ? thumbnailIdFor(id) : id;
      const mime = wantThumb ? (row.thumbnail_mime || 'image/jpeg') : (row.mime || 'video/mp4');
      return streamFile(req, res, fileId, mime);
    }

    if (req.method === 'POST' && tail === '/regions') {
      if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setVideoRegions(id, me, Array.isArray(body?.blockedRegions) ? body.blockedRegions : []);
      if (r.error) return json(res, errCode(r.error), r);
      await logAdmin({
        actorId: me, targetId: id, targetType: 'sky_video', type: 'skyvideo_regions', result: 'ok',
        detail: `было: ${r.before.join(',') || '—'} → стало: ${r.after.join(',') || '—'}`
          + (body?.reason ? ` · причина: ${String(body.reason).slice(0, 200)}` : ''),
      });
      return json(res, 200, { ok: true, blockedRegions: r.after });
    }

    return json(res, 404, { error: 'not_found' });
  }

  /* ── Комментарий по его собственному id ───────────────────────── */

  const commentMatch = path.match(/^\/api\/skyvideo\/comment\/([^/]+)$/);
  if (commentMatch && req.method === 'DELETE') {
    if (!COMMENT_ID.test(commentMatch[1])) return json(res, 404, { error: 'not_found' });
    if (!rateLimit(`svid:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await removeComment(commentMatch[1], me);
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  /* ── Админка: региональная доступность роликов ─────────────────── */

  if (req.method === 'GET' && path === '/api/skyvideo/admin/videos') {
    if (!rateLimit(`svid:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminSearchVideos(me, { q: params.get('q'), limit: params.get('limit') });
    if (r.error) return json(res, 403, r);
    return json(res, 200, r);
  }

  return json(res, 404, { error: 'not_found' });
};
