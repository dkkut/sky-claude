/**
 * Sky Stories по HTTP — тот же принцип раздачи медиа и загрузки, что и
 * в routes/bloom.mjs (сниффинг магических байт, а не Content-Type от
 * клиента; requireProfile + Vary: Authorization на потоковой раздаче).
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  STORY_ID_RE, MEDIA_ID_RE,
  feed, authorStories, archive, getStory,
  createStory, deleteStory, toggleLike, recordView, votePoll, answerQuestion,
  getCloseFriends, setCloseFriends, mediaMimeOf,
} from './../stories.mjs';
import { saveStream, openStream, sizeOf, newMediaId } from './../storystore.mjs';
import { parseRange } from './../skyvideostore.mjs';

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

const streamMedia = async (req, res, mediaId) => {
  const mime = await mediaMimeOf(mediaId);
  if (!mime) return json(res, 404, { error: 'not_found' });
  const size = await sizeOf(mediaId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const common = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600, immutable',
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

export const storiesRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/stories')) return false;
  const path = url.split('?')[0];

  const mediaMatch = /^\/api\/stories\/media\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && mediaMatch && MEDIA_ID_RE.test(mediaMatch[1])) {
    const session = await requireProfile(req, res);
    if (!session) return true;
    if (!rateLimit(`stories:stream:${session.profileId}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return streamMedia(req, res, mediaMatch[1]);
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && path === '/api/stories/feed') {
    if (!rateLimit(`stories:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { stories: await feed(me) });
  }

  if (req.method === 'GET' && path === '/api/stories/archive') {
    if (!rateLimit(`stories:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { stories: await archive(me) });
  }

  if (req.method === 'GET' && path === '/api/stories/close-friends') {
    if (!rateLimit(`stories:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { friendIds: await getCloseFriends(me) });
  }

  if (req.method === 'POST' && path === '/api/stories/close-friends') {
    if (!rateLimit(`stories:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    return json(res, 200, await setCloseFriends(me, Array.isArray(body?.friendIds) ? body.friendIds : []));
  }

  const authorMatch = /^\/api\/stories\/author\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && authorMatch) {
    if (!rateLimit(`stories:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { stories: await authorStories(authorMatch[1], me) });
  }

  if (req.method === 'POST' && path === '/api/stories/media') {
    if (!rateLimitPerHour(`stories:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
    const head = await peek(req, 32);
    const sniffed = sniffMedia(head);
    if (!sniffed) return rejectBody(req, res, 415, { error: 'unsupported_media' });
    const limit = sniffed.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const mediaId = newMediaId();
    const saved = await saveStream(mediaId, withHead(head, req), limit);
    if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 400, saved);
    return json(res, 200, { mediaId, mime: sniffed.mime, kind: sniffed.kind, bytes: saved.bytes });
  }

  if (req.method === 'POST' && path === '/api/stories') {
    if (!rateLimit(`stories:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createStory(me, body ?? {});
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  const storyMatch = /^\/api\/stories\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (storyMatch) {
    const id = storyMatch[1];
    const tail = storyMatch[2] ?? '';
    if (!STORY_ID_RE.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`stories:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const story = await getStory(id, me);
      if (!story) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { story });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`stories:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteStory(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/like') {
      if (!rateLimit(`stories:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await toggleLike(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/view') {
      if (!rateLimit(`stories:react:${me}`, REACT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await recordView(id, me);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/vote') {
      if (!rateLimit(`stories:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await votePoll(id, me, String(body?.optionId ?? ''));
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/answer') {
      if (!rateLimit(`stories:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await answerQuestion(id, me, body?.text ?? '');
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }

    return json(res, 404, { error: 'not_found' });
  }

  return false;
};
