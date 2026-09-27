/**
 * Sky Podcasts по HTTP.
 *
 * То же устройство, что у кино, и по тем же причинам:
 *
 * 1. Звук и видео отдаются потоком с поддержкой Range. Проигрыватель
 *    просит куски по мере прослушивания и при перемотке; без Range он
 *    тянул бы файл с начала целиком. Файл ни разу не собирается в
 *    памяти сервера — из потока чтения прямо в ответ.
 *
 * 2. Загрузка тоже потоком, и предел размера считается по фактически
 *    пришедшим байтам. Присланный Content-Length — слова клиента: по
 *    ним можно отказать сразу, но верить им нельзя.
 *
 * 3. Тип файла определяется по первым байтам. Присланный Content-Type
 *    здесь не значит ничего.
 *
 * 4. Права проверяются в слое данных (podcasts.mjs), а не здесь. Здесь
 *    только вход: кто спрашивает, не слишком ли часто, той ли формы
 *    идентификатор. Ни одна ручка не решает сама, можно ли этому
 *    человеку этот выпуск.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession, appBody } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  listPodcasts, listCategories, listMine, readPodcast, visiblePodcast,
  listEpisodes, readEpisode, visibleEpisode, similarEpisodes, searchEpisodes,
  createPodcast, updatePodcast, setHosts, deletePodcast,
  createEpisode, updateEpisode, finishMedia, deleteEpisode,
  setPodcastCover, setEpisodeCover,
  submitPodcast, moderationQueue, moderatePodcast,
  readTranscript, saveTranscript, readChapters, saveChapters,
  setProgress, listProgress, listContinue,
  addHistory, listHistory,
  setSubscribed, listSubscriptions, setFavorite, listFavorites, listNewFromSubscriptions,
} from './../podcasts.mjs';
import {
  saveStream, saveBytes, sizeOf, openStream, parseRange,
  audioIdFor, videoIdFor, epCoverIdFor, showCoverIdFor, remove as removeFile,
} from './../podcaststore.mjs';
import { ticketCookie, ticketFromCookies, issueTicket, readTicket } from './../podcastticket.mjs';
import { getSummary, buildSummary, dropSummary } from './../podcastsummary.mjs';

/**
 * Потолки на файлы. Настраиваются: сколько поместится, знает тот, кто
 * видит диск сервера, а не этот файл. Это предел записи на диск —
 * расход памяти от размера файла не зависит совсем.
 */
const MAX_AUDIO_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.PODCAST_AUDIO_MAX_BYTES) || 512 * 1024 * 1024,
);
const MAX_VIDEO_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.PODCAST_VIDEO_MAX_BYTES) || 4 * 1024 * 1024 * 1024,
);
const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Сколько запросов в минуту на профиль. */
const STREAM_PER_MIN = 1200;
const READ_PER_MIN = 300;
const WRITE_PER_MIN = 120;
const UPLOAD_PER_HOUR = 30;
/** Пересказ стоит денег и времени, поэтому считается отдельно и скупо. */
const SUMMARY_PER_HOUR = 20;

const POD_ID = /^pod-[0-9a-f-]{36}$/;
const EP_ID = /^pep-[0-9a-f-]{36}$/;

/**
 * Опознание по сигнатуре. Список ровно тот, что обещан на экране
 * загрузки, и ни байтом шире: сохранённый неизвестный файл рано или
 * поздно кто-нибудь откроет.
 */
const AUDIO_SIGNATURES = [
  // MP3: либо тег ID3 в начале, либо сразу кадр.
  { mime: 'audio/mpeg', test: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' },
  { mime: 'audio/mpeg', test: (b) => b[0] === 0xff && (b[1] & 0xe0) === 0xe0 },
  // M4A и MP4-звук: размер коробки, затем 'ftyp'.
  { mime: 'audio/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  // Ogg и Opus — один контейнер.
  { mime: 'audio/ogg', test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  { mime: 'audio/wav', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { mime: 'audio/flac', test: (b) => b.subarray(0, 4).toString('latin1') === 'fLaC' },
  // WebM со звуковой дорожкой: заголовок EBML тот же, что у видео.
  { mime: 'audio/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

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

/**
 * Отказ, когда тело ещё идёт.
 *
 * Дочитывать сотни мегабайт, которые уже решено не сохранять, — пустая
 * трата связи и времени, поэтому соединение надо оборвать. Но оборвать
 * его раньше ответа нельзя: тогда вместо причины отказа человек увидит
 * «соединение разорвано», а следующий запрос по тому же соединению
 * упрётся в уже закрытый сокет.
 */
const rejectBody = (req, res, code, body) => {
  json(res, code, body, { Connection: 'close' });
  res.once('finish', () => req.destroy());
  return true;
};

/** Отдача файла потоком, с Range. Одна на звук, видео и обложки. */
const sendFile = async (req, res, fileId, type) => {
  const size = await sizeOf(fileId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const common = {
    'Content-Type': type,
    // Никакого угадывания типа браузером: файл прислал человек.
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    // private: между слушателем и нами бывают общие кэши, и чужой
    // выпуск в них попадать не должен.
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
    // Слушатель закрыл вкладку или перемотал — чтение с диска надо
    // прекратить, иначе на каждой перемотке остаётся живой поток.
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
        : error === 'already_pending' || error === 'already_published' || error === 'not_pending' ? 409
          : 400);

export const podcastRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/podcasts')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Выдача файлов — единственное место, куда браузер ходит сам, тегами
     <audio>, <video> и <img>. Заголовок Authorization он туда не
     подставит, поэтому здесь принимается ещё и подписанный пропуск из
     куки. Всё остальное по-прежнему требует обычной сессии. */
  const isMedia = /^\/api\/podcasts\/(episode\/[^/]+\/(audio|video|cover)|show\/[^/]+\/cover)$/.test(path)
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

  /* Пропуск выдаётся отдельной ручкой: клиент просит его один раз при
     открытии подкастов, обычным запросом с токеном. */
  if (req.method === 'POST' && path === '/api/podcasts/ticket') {
    const ticket = issueTicket(me);
    res.setHeader('Set-Cookie', ticketCookie(me, ticket));
    return json(res, 200, appBody(req, { ok: true }, { ticket }));
  }

  /* ── Каталог ───────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/podcasts/catalog') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      podcasts: await listPodcasts(me, {
        q: params.get('q') ?? undefined,
        category: params.get('category') ?? undefined,
        limit: params.get('limit'),
        offset: params.get('offset'),
        sort: params.get('sort') ?? undefined,
      }),
    });
  }

  if (req.method === 'GET' && path === '/api/podcasts/categories') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { categories: await listCategories() });
  }

  /* Общий поиск: и передачи, и выпуски одним запросом — человек ищет
     «про что-то», а не «в разделе передач». */
  if (req.method === 'GET' && path === '/api/podcasts/search') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const q = params.get('q') ?? '';
    return json(res, 200, {
      podcasts: await listPodcasts(me, { q, limit: params.get('limit') ?? 20 }),
      episodes: await searchEpisodes(me, { q, limit: params.get('limit') ?? 20 }),
    });
  }

  if (req.method === 'GET' && path === '/api/podcasts/mine') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { podcasts: await listMine(me) });
  }

  /* ── Своё: подписки, избранное, прогресс, история ──────────── */

  if (path === '/api/podcasts/subscriptions') {
    if (req.method === 'GET') {
      if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { podcasts: await listSubscriptions(me) });
    }
    if (req.method === 'POST') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setSubscribed(me, String(body?.podcastId ?? ''), body?.on === true);
      return r.error ? json(res, 404, r) : json(res, 200, { podcasts: await listSubscriptions(me) });
    }
  }

  if (path === '/api/podcasts/favorites') {
    if (req.method === 'GET') {
      if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, await listFavorites(me));
    }
    if (req.method === 'POST') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setFavorite(me, {
        podcastId: body?.podcastId ? String(body.podcastId) : null,
        episodeId: body?.episodeId ? String(body.episodeId) : null,
      }, body?.on === true);
      return r.error ? json(res, 404, r) : json(res, 200, await listFavorites(me));
    }
  }

  if (req.method === 'GET' && path === '/api/podcasts/continue') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { episodes: await listContinue(me, { limit: params.get('limit') }) });
  }

  if (req.method === 'GET' && path === '/api/podcasts/new') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      episodes: await listNewFromSubscriptions(me, { limit: params.get('limit') }),
    });
  }

  if (req.method === 'GET' && path === '/api/podcasts/history') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { episodes: await listHistory(me, { limit: params.get('limit') }) });
  }

  if (path === '/api/podcasts/progress') {
    if (req.method === 'GET') {
      if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { progress: await listProgress(me) });
    }
    if (req.method === 'POST') {
      // Позицию шлют часто — раз в несколько секунд, и с каждого
      // устройства. Предел здесь свой, повыше обычной записи.
      if (!rateLimit(`pod:progress:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setProgress(me, String(body?.episodeId ?? ''), {
        position: body?.position, duration: body?.duration, completed: body?.completed,
      });
      return r.error ? json(res, 404, r) : json(res, 200, { ok: true });
    }
  }

  /* ── Очередь проверки ──────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/podcasts/moderation') {
    if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await moderationQueue(me, { limit: params.get('limit') });
    if (r.error) return json(res, 403, r);
    return json(res, 200, r);
  }

  /* ── Создание передачи ─────────────────────────────────────── */

  if (req.method === 'POST' && path === '/api/podcasts/show') {
    if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createPodcast(me, body ?? {});
    if (r.error) return json(res, codeFor(r.error), r);
    return json(res, 201, { podcast: await readPodcast(r.id, me) });
  }

  /* ── Одна передача ─────────────────────────────────────────── */

  const showMatch = path.match(/^\/api\/podcasts\/show\/([^/]+)(\/[a-z]+)?$/);
  if (showMatch) {
    const id = showMatch[1];
    const tail = showMatch[2] ?? '';
    // Идентификатор сверяется с образцом до любого обращения к базе и
    // к диску: ни «../», ни чужой формы строка дальше не пройдёт.
    if (!POD_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const p = await readPodcast(id, me);
      return p ? json(res, 200, { podcast: p }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updatePodcast(id, me, body ?? {});
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { podcast: await readPodcast(id, me) });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deletePodcast(id, me);
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && tail === '/episodes') {
      if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const eps = await listEpisodes(id, me, {
        q: params.get('q') ?? undefined,
        limit: params.get('limit'),
        offset: params.get('offset'),
      });
      return eps ? json(res, 200, { episodes: eps }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'POST' && tail === '/episode') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await createEpisode(id, me, body ?? {});
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 201, { episode: await readEpisode(r.id, me) });
    }

    if (req.method === 'POST' && tail === '/hosts') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setHosts(id, me, body?.hosts);
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { podcast: await readPodcast(id, me) });
    }

    if (req.method === 'POST' && tail === '/submit') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await submitPodcast(id, me);
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { podcast: await readPodcast(id, me) });
    }

    if (req.method === 'POST' && tail === '/moderate') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await moderatePodcast(id, me, { approve: body?.approve === true, reason: body?.reason });
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/cover') {
      if (!rateLimitPerHour(`pod:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const buf = await readBytes(req, MAX_COVER_BYTES);
      if (!buf) return json(res, 413, { error: 'file_too_large' });
      const mime = sniff(buf, IMAGE_SIGNATURES);
      if (!mime) return json(res, 400, { error: 'unsupported_type' });
      // Право сначала, запись на диск потом: иначе чужой обложкой можно
      // было бы занять место, не имея права на передачу.
      if (!(await setPodcastCover(id, me, mime))) return json(res, 403, { error: 'not_allowed' });
      await saveBytes(showCoverIdFor(id), buf);
      return json(res, 200, { ok: true });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && tail === '/cover') {
      if (!rateLimit(`pod:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      // Право на каждый запрос, а не один раз в начале: снятая с
      // публикации передача должна переставать отдаваться сразу.
      const row = await visiblePodcast(id, me);
      if (!row || !row.has_cover) return json(res, 404, { error: 'not_found' });
      return sendFile(req, res, showCoverIdFor(id), row.cover_mime || 'image/jpeg');
    }

    return json(res, 404, { error: 'not_found' });
  }

  /* ── Один выпуск ───────────────────────────────────────────── */

  const epMatch = path.match(/^\/api\/podcasts\/episode\/([^/]+)(\/[a-z]+)?$/);
  if (epMatch) {
    const id = epMatch[1];
    const tail = epMatch[2] ?? '';
    if (!EP_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const e = await readEpisode(id, me);
      return e ? json(res, 200, { episode: e }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updateEpisode(id, me, body ?? {});
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { episode: await readEpisode(id, me) });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteEpisode(id, me);
      if (r.error) return json(res, codeFor(r.error), r);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && tail === '/similar') {
      if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { episodes: await similarEpisodes(id, me, { limit: params.get('limit') }) });
    }

    /* Отметка о прослушивании. Ставится при начале, а не при открытии
       страницы: иначе история заполнялась бы тем, что не слушали. */
    if (req.method === 'POST' && tail === '/play') {
      if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await addHistory(me, id);
      return r.error ? json(res, 404, r) : json(res, 200, { ok: true });
    }

    /* ── Расшифровка и главы ─────────────────────────────────── */

    if (tail === '/transcript') {
      if (req.method === 'GET') {
        if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
        const cues = await readTranscript(id, me);
        return cues ? json(res, 200, { cues }) : json(res, 404, { error: 'not_found' });
      }
      if (req.method === 'PUT') {
        if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
        const body = await parseBody(req);
        const r = await saveTranscript(id, me, body?.cues);
        if (r.error) return json(res, codeFor(r.error), r);
        return json(res, 200, r);
      }
    }

    if (tail === '/chapters') {
      if (req.method === 'GET') {
        if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
        const chapters = await readChapters(id, me);
        return chapters ? json(res, 200, { chapters }) : json(res, 404, { error: 'not_found' });
      }
      if (req.method === 'PUT') {
        if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
        const body = await parseBody(req);
        const r = await saveChapters(id, me, body?.chapters);
        if (r.error) return json(res, codeFor(r.error), r);
        return json(res, 200, r);
      }
    }

    /* ── Пересказ ────────────────────────────────────────────── */

    if (tail === '/summary') {
      if (req.method === 'GET') {
        if (!rateLimit(`pod:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
        const r = await getSummary(id, me);
        return r.error ? json(res, 404, r) : json(res, 200, r);
      }
      if (req.method === 'POST') {
        // Считается редко и стоит денег — предел строже остальных.
        if (!rateLimitPerHour(`pod:summary:${me}`, SUMMARY_PER_HOUR)) {
          return json(res, 429, { error: 'rate_limited' });
        }
        // Ни модели, ни поставщика, ни подсказки из тела не берём:
        // что и чем считать, решает сервер.
        const r = await buildSummary(id, me);
        if (r.error) {
          const code = r.error === 'not_found' ? 404
            : r.error === 'no_transcript' ? 409
              : r.error === 'ai_not_configured' ? 503
                : r.error === 'ai_busy' ? 429 : 502;
          return json(res, code, r);
        }
        return json(res, 200, r);
      }
      if (req.method === 'DELETE') {
        if (!rateLimit(`pod:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
        const r = await dropSummary(id, me);
        return r.error ? json(res, 403, r) : json(res, 200, r);
      }
    }

    /* ── Загрузка звука и видео ──────────────────────────────── */

    if (req.method === 'POST' && (tail === '/audio' || tail === '/video')) {
      if (!rateLimitPerHour(`pod:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const video = tail === '/video';
      const limit = video ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;

      // По заголовку можно отказать сразу, не принимая сотни мегабайт.
      // Но решает не он: настоящий предел считает saveStream по факту.
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > limit) return rejectBody(req, res, 413, { error: 'file_too_large' });

      // Право до единого байта на диске: иначе чужим выпуском можно
      // было бы занять место.
      const row = await visibleEpisode(id, me);
      if (!row || row.own !== true) return rejectBody(req, res, 404, { error: 'not_found' });

      const head = await peek(req, 32);
      const mime = sniff(head, video ? VIDEO_SIGNATURES : AUDIO_SIGNATURES);
      if (!mime) return rejectBody(req, res, 400, { error: 'unsupported_type' });

      const fileId = video ? videoIdFor(id) : audioIdFor(id);
      // resume() здесь звать нельзя: поток снова пошёл бы в режим без
      // единого слушателя, и всё, что успело прийти, утекло бы в
      // никуда — файл сохранился бы обрезанным. Чтение продолжит сам
      // асинхронный обход внутри withHead.
      const saved = await saveStream(fileId, withHead(head, req), limit);
      if (saved.error) {
        await removeFile(fileId).catch(() => {});
        const code = saved.error === 'file_too_large' ? 413
          : saved.error === 'storage_unavailable' ? 507 : 400;
        return json(res, code, saved);
      }

      const ok = await finishMedia(id, me, video ? 'video' : 'audio', {
        bytes: saved.bytes,
        mime,
        // Размер кадра приходит из браузера. Соврать им можно только
        // себе: на права он не влияет, только на разметку плеера.
        width: params.get('width'),
        height: params.get('height'),
      });
      if (!ok) {
        // Права были в начале, но выпуск успели убрать — файл без
        // строки в базе не нужен никому.
        await removeFile(fileId).catch(() => {});
        return json(res, 404, { error: 'not_found' });
      }
      return json(res, 201, { episode: await readEpisode(id, me) });
    }

    if (req.method === 'POST' && tail === '/cover') {
      if (!rateLimitPerHour(`pod:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const buf = await readBytes(req, MAX_COVER_BYTES);
      if (!buf) return json(res, 413, { error: 'file_too_large' });
      const mime = sniff(buf, IMAGE_SIGNATURES);
      if (!mime) return json(res, 400, { error: 'unsupported_type' });
      if (!(await setEpisodeCover(id, me, mime))) return json(res, 403, { error: 'not_allowed' });
      await saveBytes(epCoverIdFor(id), buf);
      return json(res, 200, { ok: true });
    }

    /* ── Выдача звука, видео и обложки ───────────────────────── */

    if ((req.method === 'GET' || req.method === 'HEAD')
      && (tail === '/audio' || tail === '/video' || tail === '/cover')) {
      if (!rateLimit(`pod:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      // Право на каждый кусок, а не один раз в начале прослушивания:
      // снятый с публикации выпуск должен переставать отдаваться сразу.
      const row = await visibleEpisode(id, me);
      if (!row) return json(res, 404, { error: 'not_found' });

      if (tail === '/cover') {
        if (!row.has_cover) return json(res, 404, { error: 'not_found' });
        return sendFile(req, res, epCoverIdFor(id), row.cover_mime || 'image/jpeg');
      }
      if (tail === '/video') {
        if (Number(row.video_bytes ?? 0) === 0) return json(res, 404, { error: 'not_found' });
        return sendFile(req, res, videoIdFor(id), row.video_mime || 'video/mp4');
      }
      if (Number(row.audio_bytes ?? 0) === 0) return json(res, 404, { error: 'not_found' });
      return sendFile(req, res, audioIdFor(id), row.audio_mime || 'audio/mpeg');
    }

    return json(res, 404, { error: 'not_found' });
  }

  return json(res, 404, { error: 'not_found' });
};
