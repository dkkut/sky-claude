/**
 * Sky Books по HTTP.
 *
 * То же устройство, что у Sky Podcasts:
 *
 * 1. Озвучка главы отдаётся потоком с поддержкой Range — плеер просит
 *    куски по мере прослушивания и при перемотке.
 * 2. Загрузка тоже потоком, предел размера считается по фактически
 *    пришедшим байтам, а не по присланному заголовку.
 * 3. Тип файла определяется по первым байтам, не по Content-Type.
 * 4. Права проверяются в слое данных (books.mjs), а не здесь.
 *
 * Текст главы, в отличие от озвучки, — обычное поле в ответе JSON:
 * он не весит как медиа, и тащить его через отдельный файловый путь
 * было бы лишней сущностью.
 */
import { hasPrime } from './../skyid.mjs';
import { can } from './../admin.mjs';
import { archiveByOwner } from './../contentarchive.mjs';
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession, mediaBody } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  listBooks, listCategories, listMine, readBook, visibleBook,
  createBook, updateBook, deleteBook, setBookCover,
  listChapters, readChapter, createChapter, updateChapter, deleteChapter,
  ownedChapterRow, visibleChapterRow, finishChapterAudio, dropChapterAudio,
  submitBook, moderationQueue, moderateBook,
  getProgress, setProgress, notePlayed,
  listShelf, setShelf,
} from './../books.mjs';
import {
  saveStream, saveBytes, sizeOf, openStream, parseRange,
  audioIdFor, coverIdFor, remove as removeFile,
  removeChapterAudio, removeBookFiles,
} from './../bookstore.mjs';
import { ticketCookie, ticketFromCookies, issueTicket, readTicket } from './../bookticket.mjs';

const MAX_AUDIO_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.BOOKS_AUDIO_MAX_BYTES) || 512 * 1024 * 1024,
);
const MAX_COVER_BYTES = 5 * 1024 * 1024;

const STREAM_PER_MIN = 1200;
const READ_PER_MIN = 300;
const WRITE_PER_MIN = 120;
const UPLOAD_PER_HOUR = 30;

const BOOK_ID = /^bok-[0-9a-f-]{36}$/;
const CH_ID = /^bch-[0-9a-f-]{36}$/;

const AUDIO_SIGNATURES = [
  { mime: 'audio/mpeg', test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' },
  { mime: 'audio/mpeg', test: (b) => b[0] === 0xff && (b[1] & 0xe0) === 0xe0 },
  { mime: 'audio/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'audio/ogg', test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  { mime: 'audio/wav', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { mime: 'audio/flac', test: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC' },
  { mime: 'audio/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

/**
 * Озвучку главы нередко записывают на телефон видео-камерой — файл
 * приходит контейнером видео, а звучит в нём только голос. Тег
 * <audio> прекрасно проигрывает звуковую дорожку такого файла, так
 * что video/* здесь такой же законный источник, как чистое аудио.
 */
const VIDEO_SIGNATURES = [
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'video/ogg', test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  { mime: 'video/quicktime', test: (b) => b.subarray(4, 12).toString('latin1') === 'ftypqt  ' },
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

const sendFile = async (req, res, fileId, type) => {
  const size = await sizeOf(fileId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const common = {
    'Content-Type': type,
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

const codeFor = (error) => (
  error === 'not_allowed' ? 403
    : error === 'not_found' ? 404
      : error === 'too_many' ? 409
        : error === 'already_pending' || error === 'already_published' || error === 'no_chapters' || error === 'not_pending' ? 409
          : 400);

export const bookRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/books')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const isMedia = /^\/api\/books\/(chapter\/[^/]+\/audio|book\/[^/]+\/cover)$/.test(path)
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

  /* Раздел входит в подписку Sky Prime. Проверка здесь, а не на экране: клиент можно переписать.
     Без подписки проходит тот, кто отвечает за содержимое (право `content`) — иначе некому разбирать заявки. */
  if (!(await hasPrime(me)) && !(await can(me, 'content'))) {
    return json(res, 403, { error: 'prime_required' });
  }

  if (req.method === 'POST' && path === '/api/books/ticket') {
    const ticket = issueTicket(me);
    res.setHeader('Set-Cookie', ticketCookie(me, ticket));
    return json(res, 200, mediaBody(req, { ok: true }, { ticket }));
  }

  /* ── Каталог ───────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/books/catalog') {
    if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      books: await listBooks(me, {
        q: params.get('q') ?? undefined,
        category: params.get('category') ?? undefined,
        limit: params.get('limit'),
        offset: params.get('offset'),
        sort: params.get('sort') ?? undefined,
        hideExplicit: params.get('hideExplicit') === '1',
      }),
    });
  }

  if (req.method === 'GET' && path === '/api/books/categories') {
    if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { categories: await listCategories() });
  }

  if (req.method === 'GET' && path === '/api/books/mine') {
    if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { books: await listMine(me) });
  }

  /* ── Полка ─────────────────────────────────────────────────── */

  if (path === '/api/books/shelf') {
    if (req.method === 'GET') {
      if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { books: await listShelf(me) });
    }
    if (req.method === 'POST') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setShelf(String(body?.bookId ?? ''), me, body?.on === true);
      return r.error ? json(res, 404, r) : json(res, 200, { books: await listShelf(me) });
    }
  }

  /* ── Очередь проверки ──────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/books/moderation') {
    if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await moderationQueue(me);
    if (r?.error) return json(res, 403, r);
    return json(res, 200, { books: r });
  }

  /* ── Создание книги ────────────────────────────────────────── */

  if (req.method === 'POST' && path === '/api/books/book') {
    if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createBook(me, body ?? {});
    if (r.error) return json(res, codeFor(r.error), r);
    return json(res, 201, { book: await readBook(r.id, me) });
  }

  /* ── Одна книга ─────────────────────────────────────────────── */

  const bookMatch = path.match(/^\/api\/books\/book\/([^/]+)(\/[a-z]+)?$/);
  if (bookMatch) {
    const id = bookMatch[1];
    const tail = bookMatch[2] ?? '';
    if (!BOOK_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const b = await readBook(id, me);
      return b ? json(res, 200, { book: b }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updateBook(id, me, body ?? {});
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { book: await readBook(id, me) });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const ar = await archiveByOwner('book', id, me);
      if (ar.ok) return json(res, 200, { ok: true, archived: true, purgeAt: ar.purgeAt });
      const r = await deleteBook(id, me);
      if (r.error) return json(res, codeFor(r.error), r);
      await removeBookFiles(id);
      for (const chId of r.chapterIds ?? []) await removeChapterAudio(chId);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && tail === '/chapters') {
      if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const chapters = await listChapters(id, me);
      return chapters ? json(res, 200, { chapters }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'POST' && tail === '/chapter') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await createChapter(id, me, body ?? {});
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 201, { id: r.id, number: r.number });
    }

    if (req.method === 'POST' && tail === '/submit') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await submitBook(id, me);
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { book: await readBook(id, me) });
    }

    if (req.method === 'POST' && tail === '/moderate') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await moderateBook(me, id, body?.approve === true, body?.reason);
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/cover') {
      if (!rateLimitPerHour(`bok:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const buf = await readBytes(req, MAX_COVER_BYTES);
      if (!buf) return json(res, 413, { error: 'file_too_large' });
      const mime = sniff(buf, IMAGE_SIGNATURES);
      if (!mime) return json(res, 400, { error: 'unsupported_type' });
      if (!(await setBookCover(id, me, mime))) return json(res, 403, { error: 'not_allowed' });
      await saveBytes(coverIdFor(id), buf);
      return json(res, 200, { ok: true });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && tail === '/cover') {
      if (!rateLimit(`bok:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const row = await visibleBook(id, me);
      if (!row || !row.has_cover) return json(res, 404, { error: 'not_found' });
      return sendFile(req, res, coverIdFor(id), row.cover_mime || 'image/jpeg');
    }

    if (req.method === 'GET' && tail === '/progress') {
      if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { progress: await getProgress(id, me) });
    }

    if (req.method === 'POST' && tail === '/progress') {
      if (!rateLimit(`bok:progress:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setProgress(id, me, body ?? {});
      return r.error ? json(res, 404, r) : json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && (tail === '/read' || tail === '/listen')) {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      if (!(await visibleBook(id, me))) return json(res, 404, { error: 'not_found' });
      await notePlayed(id, tail === '/listen' ? 'audio' : 'text');
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not_found' });
  }

  /* ── Одна глава ─────────────────────────────────────────────── */

  const chMatch = path.match(/^\/api\/books\/chapter\/([^/]+)(\/[a-z]+)?$/);
  if (chMatch) {
    const id = chMatch[1];
    const tail = chMatch[2] ?? '';
    if (!CH_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`bok:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const ch = await readChapter(id, me);
      return ch ? json(res, 200, { chapter: ch }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updateChapter(id, me, body ?? {});
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { chapter: await readChapter(id, me) });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteChapter(id, me);
      if (r.error) return json(res, codeFor(r.error), r);
      await removeChapterAudio(id);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/audio') {
      if (!rateLimitPerHour(`bok:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });

      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_AUDIO_BYTES) return rejectBody(req, res, 413, { error: 'file_too_large' });

      const owned = await ownedChapterRow(id, me);
      if (!owned) return rejectBody(req, res, 404, { error: 'not_found' });

      const head = await peek(req, 32);
      const mime = sniff(head, [...AUDIO_SIGNATURES, ...VIDEO_SIGNATURES]);
      if (!mime) return rejectBody(req, res, 400, { error: 'unsupported_type' });

      const fileId = audioIdFor(id);
      const saved = await saveStream(fileId, withHead(head, req), MAX_AUDIO_BYTES);
      if (saved.error) {
        await removeFile(fileId).catch(() => {});
        const code = saved.error === 'file_too_large' ? 413
          : saved.error === 'storage_unavailable' ? 507 : 400;
        return json(res, code, saved);
      }

      const ok = await finishChapterAudio(id, me, params.get('duration'), mime);
      if (ok.error) {
        await removeFile(fileId).catch(() => {});
        return json(res, codeFor(ok.error), ok);
      }
      return json(res, 201, { chapter: await readChapter(id, me) });
    }

    if (req.method === 'DELETE' && tail === '/audio') {
      if (!rateLimit(`bok:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await dropChapterAudio(id, me);
      if (r.error) return json(res, codeFor(r.error), r);
      await removeChapterAudio(id);
      return json(res, 200, { ok: true });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && tail === '/audio') {
      if (!rateLimit(`bok:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const row = await visibleChapterRow(id, me);
      if (!row || !row.has_audio) return json(res, 404, { error: 'not_found' });
      return sendFile(req, res, audioIdFor(id), row.audio_mime || 'audio/mpeg');
    }

    return json(res, 404, { error: 'not_found' });
  }

  return json(res, 404, { error: 'not_found' });
};
