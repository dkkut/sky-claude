/**
 * Музыка по HTTP.
 *
 * Три вещи, ради которых этот файл выглядит именно так:
 *
 * 1. Аудио отдаётся потоком с поддержкой Range. Браузер запрашивает
 *    куски по мере воспроизведения и при перемотке; без Range он тянул
 *    бы файл целиком с начала. Файл при этом ни разу не собирается в
 *    памяти сервера — идёт из потока чтения прямо в ответ.
 *
 * 2. Тип файла определяется по его первым байтам, а не по тому, что
 *    написал клиент. Присланный Content-Type здесь не значит ничего.
 *
 * 3. Права проверяются в слое данных (music.mjs), а не здесь. Здесь
 *    только вход: кто спрашивает, не слишком ли часто и корректен ли
 *    идентификатор.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession, appBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  listTracks, readTrack, visibleTrack, createTrack, finishTrack, updateTrack,
  submitTrack, moderationQueue, moderateTrack, toTrack,
  deleteTrack, setCover, countPlay, readLyrics,
  listPlaylists, createPlaylist, renamePlaylist, setPlaylistPublic, deletePlaylist,
  readPlaylist, addToPlaylist, removeFromPlaylist, reorderPlaylist,
  listFavorites, setFavorite, addHistory, listHistory, setProgress, listProgress,
} from './../music.mjs';
import { saveStream, saveBytes, sizeOf, openStream, remove, parseRange } from './../musicstore.mjs';
import { ticketCookie, ticketFromCookies, issueTicket, readTicket } from './../musicticket.mjs';
import { hasPrime } from './../skyid.mjs';
import { can } from './../admin.mjs';
import {
  readArtist, readArtistByName, saveArtist, followArtist,
  listFollowing, listArtists, newFromFollowed,
} from './../musicartists.mjs';

/** Потолок на трек. Больше — это уже не песня, а фильм. */
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
/** Обложка — картинка, ей столько не нужно. */
const MAX_COVER_BYTES = 3 * 1024 * 1024;

/** Сколько запросов в минуту на профиль. Прослушивание идёт кусками, поэтому щедро. */
const STREAM_PER_MIN = 600;
const WRITE_PER_MIN = 120;
const UPLOAD_PER_HOUR = 40;

const TRACK_ID = /^trk-[0-9a-f-]{36}$/;
const PLAYLIST_ID = /^pl-[0-9a-f-]{36}$/;

/**
 * Опознание аудио по сигнатуре. Список короткий намеренно: то, что
 * браузер умеет играть сам. Всё остальное — отказ, а не «сохраним и
 * посмотрим», потому что сохранённый неизвестный файл рано или поздно
 * кто-нибудь откроет.
 */
const AUDIO_SIGNATURES = [
  { mime: 'audio/mpeg', test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3'
      || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { mime: 'audio/ogg', test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  { mime: 'audio/flac', test: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC' },
  { mime: 'audio/wav', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { mime: 'audio/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
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

/** Чтение тела в память — только для обложек, они маленькие. */
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

/**
 * Первые байты потока — чтобы опознать тип до того, как писать файл.
 * Прочитанное не теряется: оно возвращается вместе с потоком и уходит
 * в файл первым куском.
 */
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

/** Поток, у которого впереди уже прочитанная голова. */
const withHead = (head, rest) => Readable.from((async function* () {
  yield head;
  for await (const chunk of rest) yield chunk;
})());

export const musicRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/music')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Выдача звука и обложек — единственное место, куда браузер ходит
     сам, тегами <audio> и <img>. Заголовок Authorization он туда не
     подставит, поэтому здесь принимается ещё и подписанный пропуск из
     куки. Всё остальное по-прежнему требует обычной сессии. */
  const isMedia = /^\/api\/music\/track\/[^/]+\/(audio|cover)$/.test(path)
    && (req.method === 'GET' || req.method === 'HEAD');

  let me;
  if (isMedia) {
    const session = await readSession(req);
    // Кука — для браузера. Родное приложение живёт на другом origin, и
    // SameSite=Strict-кука туда никогда не долетит обратно — поэтому для
    // него тот же пропуск ищем ещё и в строке адреса (?t=), куда клиент
    // сам подставил значение, полученное в теле ответа /api/music/ticket.
    me = session?.profileId ?? ticketFromCookies(req.headers.cookie) ?? readTicket(params.get('t'));
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  /* Sky Music входит в подписку Sky Prime.
     Проверка здесь, а не на экране: клиент можно переписать, поэтому
     закрытым должен быть сам доступ к данным и файлам. Без подписки
     проходит тот, кто отвечает за содержимое: иначе некому разбирать
     заявки. Остальным администраторам бесплатный Prime не полагается —
     право на очередь и право слушать даром это разные вещи. */
  if (!(await hasPrime(me)) && !(await can(me, 'content'))) {
    return json(res, 403, { error: 'prime_required' });
  }

  /* Пропуск выдаётся отдельной ручкой: клиент просит его один раз при
     открытии музыки, обычным запросом с токеном. */
  if (req.method === 'POST' && path === '/api/music/ticket') {
    const ticket = issueTicket(me);
    res.setHeader('Set-Cookie', ticketCookie(me, ticket));
    return json(res, 200, appBody(req, { ok: true }, { ticket }));
  }

  /* ── Каталог и поиск ───────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/music/tracks') {
    if (!rateLimit(`music:read:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      tracks: await listTracks(me, {
        q: params.get('q') ?? undefined,
        limit: params.get('limit'),
        offset: params.get('offset'),
        mine: params.get('mine') === '1',
      }),
    });
  }

  /* ── Артисты и подписки ────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/music/artists') {
    if (!rateLimit(`music:read:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { artists: await listArtists(me, { limit: params.get('limit') }) });
  }

  if (req.method === 'GET' && path === '/api/music/following') {
    if (!rateLimit(`music:read:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { artists: await listFollowing(me) });
  }

  if (req.method === 'GET' && path === '/api/music/feed') {
    if (!rateLimit(`music:read:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const rows = await newFromFollowed(me, { limit: params.get('limit') });
    // Лента — только опубликованное, поэтому личных полей в ней нет.
    return json(res, 200, { tracks: rows.map((r) => toTrack(r)) });
  }

  if (req.method === 'PUT' && path === '/api/music/artist') {
    if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await saveArtist(me, body ?? {});
    if (r.error) return json(res, 400, r);
    return json(res, 200, { artist: await readArtist(me, me) });
  }

  if (req.method === 'GET' && path === '/api/music/artist') {
    if (!rateLimit(`music:read:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const byName = params.get('name');
    const a = byName ? await readArtistByName(byName, me) : await readArtist(me, me);
    return a ? json(res, 200, { artist: a }) : json(res, 404, { error: 'not_found' });
  }

  const artistMatch = path.match(/^\/api\/music\/artist\/([^/]+)(\/[a-z]+)?$/);
  if (artistMatch) {
    const artistId = artistMatch[1];
    const tail = artistMatch[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      const a = await readArtist(artistId, me);
      return a ? json(res, 200, { artist: a }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'POST' && tail === '/follow') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await followArtist(artistId, me, body?.on !== false);
      if (r.error) return json(res, r.error === 'not_found' ? 404 : 403, r);
      return json(res, 200, r);
    }

    return json(res, 404, { error: 'not_found' });
  }

  /* ── Очередь проверки ──────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/music/moderation') {
    if (!rateLimit(`music:read:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await moderationQueue(me, { limit: params.get('limit') });
    if (r.error) return json(res, 403, r);
    return json(res, 200, r);
  }

  /* ── Один трек ─────────────────────────────────────────────── */

  const trackMatch = path.match(/^\/api\/music\/track\/([^/]+)(\/[a-z]+)?$/);
  if (trackMatch) {
    const id = trackMatch[1];
    const tail = trackMatch[2] ?? '';
    if (!TRACK_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      const t = await readTrack(id, me);
      return t ? json(res, 200, { track: t }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updateTrack(id, me, body ?? {});
      if (r.error) return json(res, r.error === 'not_allowed' ? 403 : 400, r);
      return json(res, 200, { track: await readTrack(id, me) });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteTrack(id, me);
      if (r.error) return json(res, r.error === 'not_allowed' ? 403 : 404, r);
      await remove(id).catch(() => {});
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && tail === '/lyrics') {
      const l = await readLyrics(id, me);
      return l ? json(res, 200, l) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'POST' && tail === '/submit') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await submitTrack(id, me);
      if (r.error) {
        const code = r.error === 'not_allowed' ? 403 : r.error === 'not_found' ? 404 : 409;
        return json(res, code, r);
      }
      return json(res, 200, { track: await readTrack(id, me) });
    }

    if (req.method === 'POST' && tail === '/moderate') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await moderateTrack(id, me, {
        approve: body?.approve === true,
        reason: body?.reason,
      });
      if (r.error) {
        const code = r.error === 'not_allowed' ? 403 : r.error === 'not_found' ? 404 : 409;
        return json(res, code, r);
      }
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/play') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await addHistory(me, id);
      if (r.error) return json(res, 404, r);
      await countPlay(id);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/cover') {
      if (!rateLimit(`music:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const buf = await readBytes(req, MAX_COVER_BYTES);
      if (!buf) return json(res, 413, { error: 'file_too_large' });
      const mime = sniff(buf, IMAGE_SIGNATURES);
      if (!mime) return json(res, 400, { error: 'unsupported_type' });
      const coverId = `cov-${id.slice(4)}`;
      if (!(await setCover(id, me, mime))) return json(res, 403, { error: 'not_allowed' });
      await saveBytes(coverId, buf);
      return json(res, 200, { ok: true });
    }

    /* Обложка и звук — потоком. */
    if (req.method === 'GET' && (tail === '/cover' || tail === '/audio')) {
      if (!rateLimit(`music:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const row = await visibleTrack(id, me);
      if (!row) return json(res, 404, { error: 'not_found' });

      const cover = tail === '/cover';
      if (cover && !row.has_cover) return json(res, 404, { error: 'not_found' });
      const fileId = cover ? `cov-${id.slice(4)}` : id;
      const size = await sizeOf(fileId);
      if (size === null) return json(res, 404, { error: 'not_found' });

      const type = cover ? (row.cover_mime || 'image/jpeg') : (row.mime || 'audio/mpeg');
      const common = {
        'Content-Type': type,
        // Никакого угадывания типа браузером: файл прислал человек.
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
      const stream = openStream(fileId);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return true;
    }
  }

  /* ── Загрузка трека ────────────────────────────────────────── */

  if (req.method === 'POST' && path === '/api/music/upload') {
    if (!rateLimit(`music:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_AUDIO_BYTES) return json(res, 413, { error: 'file_too_large' });

    // Метаданные приходят строкой запроса: тело занято самим файлом.
    const meta = {
      title: params.get('title'),
      artist: params.get('artist'),
      album: params.get('album'),
      genre: params.get('genre'),
      year: params.get('year'),
      duration: params.get('duration'),
    };

    const head = await peek(req, 32);
    const mime = sniff(head, AUDIO_SIGNATURES);
    if (!mime) {
      req.destroy();
      return json(res, 400, { error: 'unsupported_type' });
    }

    const created = await createTrack(me, { ...meta, mime });
    if (created.error) { req.destroy(); return json(res, 400, created); }

    // resume() здесь звать нельзя: поток снова пошёл бы в режим потока
    // без единого слушателя, и всё, что успело прийти, утекло бы в
    // никуда — файл сохранился бы обрезанным. Чтение продолжит сам
    // асинхронный обход внутри withHead.
    const saved = await saveStream(created.id, withHead(head, req), MAX_AUDIO_BYTES);
    if (saved.error) {
      await deleteTrack(created.id, me);
      return json(res, 413, saved);
    }
    await finishTrack(created.id, me, { bytes: saved.bytes, mime });
    return json(res, 201, { track: await readTrack(created.id, me) });
  }

  /* ── Плейлисты ─────────────────────────────────────────────── */

  if (path === '/api/music/playlists') {
    if (req.method === 'GET') return json(res, 200, { playlists: await listPlaylists(me) });
    if (req.method === 'POST') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await createPlaylist(me, body?.name);
      return r.error ? json(res, 400, r) : json(res, 201, r);
    }
  }

  const plMatch = path.match(/^\/api\/music\/playlist\/([^/]+)(\/[a-z]+)?$/);
  if (plMatch) {
    const id = plMatch[1];
    const tail = plMatch[2] ?? '';
    if (!PLAYLIST_ID.test(id)) return json(res, 404, { error: 'not_found' });
    const write = req.method !== 'GET';
    if (write && !rateLimit(`music:write:${me}`, WRITE_PER_MIN)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    if (req.method === 'GET' && tail === '') {
      const pl = await readPlaylist(id, me);
      return pl ? json(res, 200, { playlist: pl }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      const body = await parseBody(req);
      let r = { ok: true };
      if (body?.name !== undefined) r = await renamePlaylist(id, me, body.name);
      if (!r.error && body?.isPublic !== undefined) r = await setPlaylistPublic(id, me, body.isPublic);
      if (r.error) return json(res, r.error === 'not_allowed' ? 403 : 404, r);
      return json(res, 200, r);
    }

    if (req.method === 'DELETE' && tail === '') {
      const r = await deletePlaylist(id, me);
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 404, r) : json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/tracks') {
      const body = await parseBody(req);
      const r = await addToPlaylist(id, me, String(body?.trackId ?? ''));
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 404, r) : json(res, 200, r);
    }

    if (req.method === 'DELETE' && tail === '/tracks') {
      const body = await parseBody(req);
      const r = await removeFromPlaylist(id, me, String(body?.trackId ?? ''));
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 404, r) : json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/order') {
      const body = await parseBody(req);
      const r = await reorderPlaylist(id, me, body?.order);
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
    }
  }

  /* ── Избранное, история, позиция ───────────────────────────── */

  if (path === '/api/music/favorites') {
    if (req.method === 'GET') return json(res, 200, { tracks: await listFavorites(me) });
    if (req.method === 'POST') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setFavorite(me, String(body?.trackId ?? ''), Boolean(body?.on));
      return r.error ? json(res, 404, r) : json(res, 200, { tracks: await listFavorites(me) });
    }
  }

  if (req.method === 'GET' && path === '/api/music/history') {
    return json(res, 200, { tracks: await listHistory(me) });
  }

  if (path === '/api/music/progress') {
    if (req.method === 'GET') return json(res, 200, { progress: await listProgress(me) });
    if (req.method === 'POST') {
      if (!rateLimit(`music:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setProgress(me, String(body?.trackId ?? ''), body?.position);
      return r.error ? json(res, 404, r) : json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'not_found' });
};
