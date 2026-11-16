/**
 * Bloom по HTTP.
 *
 * Личных сообщений здесь нет: /write просто просит Sky Messenger
 * открыть уже существующий чат (chats.mjs) — см. в конце файла.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, clientIp } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  POST_ID_RE, COMMENT_ID_RE, MEDIA_ID_RE,
  feed, authorPosts, getPost, trending, suggestedUsers, hotComments, notificationsCount, recentEvents,
  createPost, deletePost, react, addComment, deleteComment, likeComment,
  toggleSave, toggleRepost, recordView, votePoll, toggleHide, hiddenAuthors, sendGift,
  mediaMimeOf, adminSearchPosts, setPostRegions, editPost, publicPost, publicAuthor, publicMediaMime,
} from './../bloom.mjs';
import { saveStream, openStream, sizeOf, newMediaId } from './../bloomstore.mjs';
import { parseRange } from './../skyvideostore.mjs';
import { directChatId, createChat } from './../chats.mjs';
import { userStore } from './../store.mjs';
import { recentFollowers } from './../follows.mjs';
import { logAdmin } from './../adminsec.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 40;
const REACT_PER_MIN = 60;
const UPLOAD_PER_HOUR = 40;
const STREAM_PER_MIN = 600;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/gif', test: (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a'
      || b.subarray(0, 6).toString('latin1') === 'GIF89a' },
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
      : error === 'already_voted' ? 409
        : 400
);

const streamMedia = async (req, res, mediaId, mimeOverride = null) => {
  const mime = mimeOverride ?? await mediaMimeOf(mediaId);
  if (!mime) return json(res, 404, { error: 'not_found' });
  const size = await sizeOf(mediaId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const common = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600, immutable',
    // Доступ проверяется по Authorization (requireProfile) — без Vary
    // браузер мог бы отдать медиа, закешированное под одним профилем,
    // другому профилю того же Sky ID в том же браузере.
    'Vary': 'Authorization',
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
    const stream = openStream(mediaId, range);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
  }
  res.writeHead(200, { ...common, 'Content-Length': String(size) });
  const stream = openStream(mediaId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

export const bloomRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/bloom')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const mediaMatch = /^\/api\/bloom\/media\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && mediaMatch && MEDIA_ID_RE.test(mediaMatch[1])) {
    const session = await requireProfile(req, res);
    if (!session) return true;
    if (!rateLimit(`bloom:stream:${session.profileId}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return streamMedia(req, res, mediaMatch[1]);
  }

  /* Публичные ссылки: без входа, только для постов авторов, у которых раздел «публикации» открыт всем. Пределы — по адресу. */
  if (req.method === 'GET' && path.startsWith('/api/bloom/public/')) {
    if (!rateLimit(`bloom:public:${clientIp(req)}`, 120)) return json(res, 429, { error: 'rate_limited' });
    let m;
    if ((m = /^\/api\/bloom\/public\/post\/([^/]+)$/.exec(path)) && POST_ID_RE.test(m[1])) {
      const post = await publicPost(m[1]); return post ? json(res, 200, { post }) : json(res, 404, { error: 'not_found' });
    }
    if ((m = /^\/api\/bloom\/public\/author\/([A-Za-z0-9_.-]{1,40})$/.exec(path))) {
      const a = await publicAuthor(m[1]); return a ? json(res, 200, { author: a }) : json(res, 404, { error: 'not_found' });
    }
    if ((m = /^\/api\/bloom\/public\/media\/([^/]+)$/.exec(path)) && MEDIA_ID_RE.test(m[1])) {
      const mime = await publicMediaMime(m[1]); if (!mime) return json(res, 404, { error: 'not_found' });
      return streamMedia(req, res, m[1], mime);
    }
    return json(res, 404, { error: 'not_found' });
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && path === '/api/bloom/feed') {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const tab = params.get('tab') ?? 'algo';
    if (!['algo', 'fresh', 'saved', 'mine'].includes(tab)) return json(res, 400, { error: 'bad_tab' });
    const tag = params.get('tag');
    return json(res, 200, { posts: await feed(me, tab, { tag }) });
  }

  if (req.method === 'GET' && path === '/api/bloom/trending') {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { trending: await trending() });
  }

  if (req.method === 'GET' && path === '/api/bloom/suggested') {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { userIds: await suggestedUsers(me) });
  }

  if (req.method === 'GET' && path === '/api/bloom/hot-comments') {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { items: await hotComments(me) });
  }

  if (req.method === 'GET' && path === '/api/bloom/notifications-count') {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { count: await notificationsCount(me) });
  }

  // Реальные новые события (лайк/комментарий/подписка) для пуша в
  // существующий useNotifStore — не отдельная система, просто данные
  // для неё. Окно жёстко ограничено суткой: клиент не может попросить
  // за произвольный период назад.
  if (req.method === 'GET' && path === '/api/bloom/events') {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const sinceMs = Math.max(Date.now() - 24 * 3_600_000, Number(params.get('since')) || 0);
    const sinceIso = new Date(sinceMs).toISOString();
    const [events, followers] = await Promise.all([recentEvents(me, sinceIso), recentFollowers(me, sinceIso)]);
    const all = [
      ...events,
      ...followers.map((f) => ({ kind: 'follow', actorId: f.actorId, actorName: f.actorName, createdAt: f.createdAt })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return json(res, 200, { events: all, now: Date.now() });
  }

  if (req.method === 'GET' && path === '/api/bloom/hidden') {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { hiddenIds: await hiddenAuthors(me) });
  }

  const authorMatch = /^\/api\/bloom\/author\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && authorMatch) {
    if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { posts: await authorPosts(authorMatch[1], me) });
  }

  if (req.method === 'POST' && path === '/api/bloom/media') {
    if (!rateLimitPerHour(`bloom:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
    const head = await peek(req, 32);
    const sniffed = sniffMedia(head);
    if (!sniffed) return rejectBody(req, res, 415, { error: 'unsupported_media' });
    const limit = sniffed.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const mediaId = newMediaId();
    const saved = await saveStream(mediaId, withHead(head, req), limit);
    if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 400, saved);
    return json(res, 200, { mediaId, mime: sniffed.mime, kind: sniffed.kind, bytes: saved.bytes });
  }

  if (req.method === 'POST' && path === '/api/bloom/post') {
    if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createPost(me, body ?? {});
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  const postMatch = /^\/api\/bloom\/post\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (postMatch) {
    const id = postMatch[1];
    const tail = postMatch[2] ?? '';
    if (!POST_ID_RE.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`bloom:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const post = await getPost(id, me);
      if (!post) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { post });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await editPost(id, me, body ?? {});
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deletePost(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/react') {
      if (!rateLimit(`bloom:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await react(id, me, String(body?.emoji ?? ''));
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/comment') {
      if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await addComment(id, me, body?.text ?? '');
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/save') {
      if (!rateLimit(`bloom:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await toggleSave(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/repost') {
      if (!rateLimit(`bloom:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await toggleRepost(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/view') {
      if (!rateLimit(`bloom:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, await recordView(id, me));
    }

    if (req.method === 'POST' && tail === '/vote') {
      if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await votePoll(id, me, String(body?.optionId ?? ''));
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/gift') {
      if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await sendGift(me, id, String(body?.modelKey ?? ''));
      if (r.error) return json(res, r.error === 'not_found' ? 404 : r.error === 'insufficient_points' ? 402 : 400, r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/regions') {
      if (!rateLimit(`bloom:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setPostRegions(id, me, Array.isArray(body?.blockedRegions) ? body.blockedRegions : []);
      if (r.error) return json(res, r.error === 'not_allowed' ? 403 : 404, r);
      await logAdmin({
        actorId: me, targetId: id, targetType: 'bloom_post', type: 'bloom_post_regions', result: 'ok',
        detail: `было: ${r.before.join(',') || '—'} → стало: ${r.after.join(',') || '—'}`
          + (body?.reason ? ` · причина: ${String(body.reason).slice(0, 200)}` : ''),
      });
      return json(res, 200, { ok: true, blockedRegions: r.after });
    }

    return json(res, 404, { error: 'not_found' });
  }

  // Bloom → «Написать» → Sky Messenger. Отдельный путь, а не
  // /post/:id/write: здесь :id — это ЧЕЛОВЕК, не пост, и его нельзя
  // прогонять через POST_ID_RE. Получатель — только из проверенного
  // :id в пути, никогда из тела запроса: подменить его клиент не
  // может, что бы он ни прислал в body. Сами права (существует ли,
  // разрешает ли писать) проверяет createChat — тот же самый код,
  // что и для обычного «Написать» в мессенджере.
  const writeMatch = /^\/api\/bloom\/write\/([^/]+)$/.exec(path);
  if (req.method === 'POST' && writeMatch) {
    if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const targetId = writeMatch[1];
    if (targetId === me) return json(res, 400, { error: 'self_target' });
    const target = await userStore.findById(targetId);
    if (!target) return json(res, 404, { error: 'not_found' });
    const chatId = directChatId(me, targetId);
    const r = await createChat({ id: chatId, type: 'direct', participants: [targetId] }, me);
    if (r === null) return json(res, 400, { error: 'chat_failed' });
    if (r?.error) return json(res, 403, r);
    return json(res, 200, { chatId });
  }

  const commentMatch = /^\/api\/bloom\/comment\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (commentMatch) {
    const id = commentMatch[1];
    const tail = commentMatch[2] ?? '';
    if (!COMMENT_ID_RE.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`bloom:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteComment(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/like') {
      if (!rateLimit(`bloom:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await likeComment(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    return json(res, 404, { error: 'not_found' });
  }

  const hideMatch = /^\/api\/bloom\/hide\/([^/]+)$/.exec(path);
  if (req.method === 'POST' && hideMatch) {
    if (!rateLimit(`bloom:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const authorId = hideMatch[1];
    return json(res, 200, await toggleHide(me, authorId));
  }

  /* ── Админка: региональная доступность постов ──────────────────────
     Право проверяется внутри adminSearchPosts/setPostRegions (can(me,
     'content')) — здесь только маршрутизация и запись в уже существующий
     admin_log. Роль/право никогда не читаются из тела запроса. */

  if (req.method === 'GET' && path === '/api/bloom/admin/posts') {
    if (!rateLimit(`bloom:admin:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminSearchPosts(me, { q: params.get('q'), limit: params.get('limit') });
    if (r.error) return json(res, 403, r);
    return json(res, 200, r);
  }

  return false;
};
