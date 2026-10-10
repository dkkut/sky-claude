/**
 * Sky Film по HTTP.
 *
 * Четыре вещи, ради которых этот файл выглядит именно так:
 *
 * 1. Видео отдаётся потоком с поддержкой Range. Проигрыватель просит
 *    куски по мере просмотра и при перемотке; без Range он тянул бы
 *    файл с начала целиком — а это гигабайты. Файл ни разу не
 *    собирается в памяти сервера: из потока чтения прямо в ответ. У
 *    контейнера api памяти гигабайт, и иначе первый же зритель
 *    полуторачасового фильма положил бы сервер.
 *
 * 2. Загрузка тоже идёт потоком, и предел размера считается по
 *    фактически пришедшим байтам. Присланный Content-Length — это
 *    слова клиента: по ним можно отказать сразу, но верить им нельзя.
 *
 * 3. Тип файла определяется по его первым байтам. Присланный
 *    Content-Type здесь не значит ничего.
 *
 * 4. Права проверяются в слое данных (film.mjs), а не здесь. Здесь
 *    только вход: кто спрашивает, не слишком ли часто, той ли формы
 *    идентификатор. Ни одна ручка не решает сама, можно ли этому
 *    человеку этот фильм.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession, mediaBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  listCatalog, listCategories, listShorts, listMine, readMovie, visibleMovie,
  createMovie, finishMovie, updateMovie, deleteMovie, setPoster,
  submitMovie, moderationQueue, moderateMovie,
  listSaved, setSaved, countView, rateMovie,
  setProgress, listProgress, listContinue, posterIdFor,
} from './../film.mjs';
import { saveStream, saveBytes, sizeOf, openStream, parseRange } from './../filmstore.mjs';
import { ticketCookie, ticketFromCookies, issueTicket, readTicket } from './../filmticket.mjs';
import { hasPrime } from './../skyid.mjs';
import { can } from './../admin.mjs';
import { checkQuota, touchOwnerUsage, setRetentionKeep } from './../storagequota.mjs';

/**
 * Потолок на фильм. Настраивается: сколько поместится, знает тот, кто
 * видит диск сервера, а не этот файл. По умолчанию четыре гигабайта —
 * это полтора часа в хорошем качестве.
 *
 * Важно: это предел записи на диск, а не расход памяти. Память от
 * размера фильма не зависит совсем.
 */
const MAX_VIDEO_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.FILM_MAX_BYTES) || 4 * 1024 * 1024 * 1024,
);
/** Постер — картинка, ей столько не нужно. */
const MAX_POSTER_BYTES = 5 * 1024 * 1024;

/**
 * Сколько запросов в минуту на профиль. Просмотр идёт кусками, и при
 * перемотке их становится особенно много, поэтому здесь щедро.
 */
const STREAM_PER_MIN = 1200;
const READ_PER_MIN = 300;
const WRITE_PER_MIN = 120;
const UPLOAD_PER_HOUR = 20;

const MOVIE_ID = /^mov-[0-9a-f-]{36}$/;

/**
 * Опознание видео по сигнатуре. Список ровно тот, что обещан на экране
 * загрузки, и ни байтом шире: сохранённый неизвестный файл рано или
 * поздно кто-нибудь откроет.
 */
const VIDEO_SIGNATURES = [
  // MP4 и MOV: размер коробки, затем 'ftyp'.
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  // WebM и MKV — оба Matroska, заголовок EBML один и тот же.
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

/** Чтение тела в память — только для постеров, они маленькие. */
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
 * Дочитывать гигабайты, которые уже решено не сохранять, — пустая
 * трата связи и времени, поэтому соединение надо оборвать. Но оборвать
 * его раньше ответа нельзя: тогда вместо причины отказа человек увидит
 * «соединение разорвано», а следующий запрос по тому же соединению
 * упрётся в уже закрытый сокет — именно так и вышло при проверке.
 *
 * Поэтому порядок такой: сначала ответ с пометкой, что соединение
 * закрывается, и только когда он ушёл целиком — обрыв.
 */
const rejectBody = (req, res, code, body) => {
  json(res, code, body, { Connection: 'close' });
  res.once('finish', () => req.destroy());
  return true;
};

export const filmRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/film')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Выдача видео и постеров — единственное место, куда браузер ходит
     сам, тегами <video> и <img>. Заголовок Authorization он туда не
     подставит, поэтому здесь принимается ещё и подписанный пропуск из
     куки. Всё остальное по-прежнему требует обычной сессии. */
  const isMedia = /^\/api\/film\/movie\/[^/]+\/(video|poster)$/.test(path)
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

  /* Sky Film входит в подписку Sky Prime.
     Проверка здесь, а не на экране: клиент можно переписать, поэтому
     закрытым должен быть сам доступ к данным и файлам. Без подписки
     проходит тот, кто отвечает за содержимое: иначе некому разбирать
     заявки. Остальным администраторам бесплатный Prime не полагается —
     право на очередь и право смотреть даром это разные вещи. */
  if (!(await hasPrime(me)) && !(await can(me, 'content'))) {
    return json(res, 403, { error: 'prime_required' });
  }

  /* Пропуск выдаётся отдельной ручкой: клиент просит его один раз при
     открытии кино, обычным запросом с токеном. */
  if (req.method === 'POST' && path === '/api/film/ticket') {
    const ticket = issueTicket(me);
    res.setHeader('Set-Cookie', ticketCookie(me, ticket));
    return json(res, 200, mediaBody(req, { ok: true }, { ticket }));
  }

  /* ── Каталог ───────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/film/catalog') {
    if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      movies: await listCatalog(me, {
        q: params.get('q') ?? undefined,
        category: params.get('category') ?? undefined,
        limit: params.get('limit'),
        offset: params.get('offset'),
        sort: params.get('sort') ?? undefined,
      }),
    });
  }

  /* Лента короткого кино. Отдельная ручка, а не отсев каталога на
     экране: лента бесконечна, а каталог отдаётся первой сотней. */
  if (req.method === 'GET' && path === '/api/film/shorts') {
    if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      movies: await listShorts(me, {
        limit: params.get('limit'),
        before: params.get('before') ?? undefined,
      }),
    });
  }

  if (req.method === 'GET' && path === '/api/film/categories') {
    if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { categories: await listCategories() });
  }

  /* ── Личная коллекция ──────────────────────────────────────── */

  /* Владелец берётся из сессии. Ручки «покажи коллекцию такого-то»
     здесь нет вовсе — не потому, что она закрыта проверкой, а потому,
     что её незачем заводить. */
  if (req.method === 'GET' && path === '/api/film/mine') {
    if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      movies: await listMine(me, {
        q: params.get('q') ?? undefined,
        limit: params.get('limit'),
        offset: params.get('offset'),
      }),
    });
  }

  /* ── Закладки, продолжение, прогресс ───────────────────────── */

  if (path === '/api/film/saved') {
    if (req.method === 'GET') {
      if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { movies: await listSaved(me) });
    }
    if (req.method === 'POST') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setSaved(me, String(body?.movieId ?? ''), body?.on === true);
      return r.error ? json(res, 404, r) : json(res, 200, { movies: await listSaved(me) });
    }
  }

  if (req.method === 'GET' && path === '/api/film/continue') {
    if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { movies: await listContinue(me, { limit: params.get('limit') }) });
  }

  if (path === '/api/film/progress') {
    if (req.method === 'GET') {
      if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { progress: await listProgress(me) });
    }
    if (req.method === 'POST') {
      // Позицию шлют часто — раз в несколько секунд просмотра, и с
      // каждого устройства. Предел здесь свой, повыше обычной записи.
      if (!rateLimit(`film:progress:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setProgress(me, String(body?.movieId ?? ''), {
        position: body?.position, duration: body?.duration,
      });
      return r.error ? json(res, 404, r) : json(res, 200, { ok: true });
    }
  }

  /* ── Очередь проверки ──────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/film/moderation') {
    if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await moderationQueue(me, { limit: params.get('limit') });
    if (r.error) return json(res, 403, r);
    return json(res, 200, r);
  }

  /* ── Загрузка ──────────────────────────────────────────────── */

  if (req.method === 'POST' && path === '/api/film/upload') {
    if (!rateLimit(`film:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });

    // По заголовку можно отказать сразу, не принимая гигабайты. Но
    // решает не он: настоящий предел считает saveStream по факту.
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_VIDEO_BYTES) return rejectBody(req, res, 413, { error: 'file_too_large' });

    // Метаданные приходят строкой запроса: тело занято самим фильмом.
    const meta = {
      title: params.get('title'),
      description: params.get('description'),
      category: params.get('category'),
      genre: params.get('genre'),
      year: params.get('year'),
      country: params.get('country'),
      director: params.get('director'),
      ageRating: params.get('ageRating'),
      duration: params.get('duration'),
      // Размер кадра нужен, чтобы отличить короткометражку от просто
      // короткого видео: в вертикальной ленте горизонтальный ролик
      // выглядит обрезком. Числа приходят из браузера — соврать ими
      // можно только себе же.
      width: params.get('width'),
      height: params.get('height'),
      isShort: params.get('isShort'),
    };

    const head = await peek(req, 32);
    const mime = sniff(head, VIDEO_SIGNATURES);
    if (!mime) return rejectBody(req, res, 400, { error: 'unsupported_type' });

    const created = await createMovie(me, { ...meta, mime });
    if (created.error) {
      return rejectBody(req, res, created.error === 'too_many' ? 409 : 400, created);
    }

    // Квота личного хранилища — кино и музыка вместе, см. storagequota.mjs.
    // Резерв ставится заявленным размером (а если его не прислали —
    // предельным для одного файла): так второй одновременный аплоуд той
    // же квоты увидит резерв этого в сумме, а не старое значение. Файл
    // ещё не записан ни байтом — отказ здесь ничего не оставляет на диске.
    const reserve = declared > 0 ? declared : MAX_VIDEO_BYTES;
    const quota = await checkQuota(me, reserve);
    if (!quota.ok) {
      await deleteMovie(created.id, me);
      return rejectBody(req, res, 507, {
        error: 'quota_exceeded', quotaBytes: quota.quota, usedBytes: quota.used,
      });
    }
    await finishMovie(created.id, me, { bytes: reserve, mime });

    // resume() здесь звать нельзя: поток снова пошёл бы в режим потока
    // без единого слушателя, и всё, что успело прийти, утекло бы в
    // никуда — файл сохранился бы обрезанным. Чтение продолжит сам
    // асинхронный обход внутри withHead.
    const saved = await saveStream(created.id, withHead(head, req), MAX_VIDEO_BYTES);
    if (saved.error) {
      // Записи без файла быть не должно: она показалась бы в коллекции
      // как фильм, который не открывается.
      await deleteMovie(created.id, me);
      return json(res, saved.error === 'file_too_large' ? 413 : 400, saved);
    }
    // Резерв уточняется реальным размером — обычно меньше него: выше
    // предел одного файла всё равно не даёт уйти saveStream.
    await finishMovie(created.id, me, { bytes: saved.bytes, mime });
    return json(res, 201, { movie: await readMovie(created.id, me) });
  }

  /* ── Один фильм ────────────────────────────────────────────── */

  const movieMatch = path.match(/^\/api\/film\/movie\/([^/]+)(\/[a-z-]+)?$/);
  if (movieMatch) {
    const id = movieMatch[1];
    const tail = movieMatch[2] ?? '';
    // Идентификатор сверяется с образцом до любого обращения к базе и
    // к диску: ни «../», ни чужой формы строка дальше не пройдёт.
    if (!MOVIE_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`film:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const m = await readMovie(id, me);
      return m ? json(res, 200, { movie: m }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updateMovie(id, me, body ?? {});
      if (r.error) return json(res, r.error === 'not_allowed' ? 403 : r.error === 'not_found' ? 404 : 400, r);
      return json(res, 200, { movie: await readMovie(id, me) });
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteMovie(id, me);
      if (r.error) return json(res, r.error === 'not_allowed' ? 403 : 404, r);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/submit') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await submitMovie(id, me, {
        license: body?.license,
        explicit: body?.explicit === true,
        ageRestricted18: body?.ageRestricted18 === true,
      });
      if (r.error) {
        const code = r.error === 'not_allowed' ? 403 : r.error === 'not_found' ? 404 : 409;
        return json(res, code, r);
      }
      return json(res, 200, { movie: await readMovie(id, me) });
    }

    if (req.method === 'POST' && tail === '/moderate') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await moderateMovie(id, me, { approve: body?.approve === true, reason: body?.reason });
      if (r.error) {
        const code = r.error === 'not_allowed' ? 403 : r.error === 'not_found' ? 404 : 409;
        return json(res, code, r);
      }
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/view') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const row = await visibleMovie(id, me);
      if (!row) return json(res, 404, { error: 'not_found' });
      await countView(id);
      // Личный файл живёт ещё RETENTION_DAYS, только если смотрит сам
      // владелец — просмотр гостем в сеансе «Вместе» на этот срок не влияет.
      if (row.owner_id === me) await touchOwnerUsage('movie', id, me);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/retention-keep') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const ok = await setRetentionKeep('movie', id, me, body?.keep === true);
      if (!ok) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/rate') {
      if (!rateLimit(`film:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await rateMovie(me, id, body?.score);
      if (r.error) {
        const code = r.error === 'not_found' ? 404 : r.error === 'not_allowed' ? 403 : 400;
        return json(res, code, r);
      }
      return json(res, 200, { movie: await readMovie(id, me) });
    }

    if (req.method === 'POST' && tail === '/poster') {
      if (!rateLimit(`film:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'rate_limited' });
      const buf = await readBytes(req, MAX_POSTER_BYTES);
      if (!buf) return json(res, 413, { error: 'file_too_large' });
      const mime = sniff(buf, IMAGE_SIGNATURES);
      if (!mime) return json(res, 400, { error: 'unsupported_type' });
      // Право сначала, запись на диск потом: иначе чужим постером можно
      // было бы занять место, не имея права на фильм.
      if (!(await setPoster(id, me, mime))) return json(res, 403, { error: 'not_allowed' });
      await saveBytes(posterIdFor(id), buf);
      return json(res, 200, { ok: true });
    }

    /* Постер и видео — потоком. */
    if ((req.method === 'GET' || req.method === 'HEAD') && (tail === '/poster' || tail === '/video')) {
      if (!rateLimit(`film:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      // Право на каждый кусок, а не один раз в начале просмотра: снятый
      // с публикации фильм должен переставать отдаваться сразу.
      const row = await visibleMovie(id, me);
      if (!row) return json(res, 404, { error: 'not_found' });

      const poster = tail === '/poster';
      if (poster && !row.has_poster) return json(res, 404, { error: 'not_found' });
      const fileId = poster ? posterIdFor(id) : id;
      const size = await sizeOf(fileId);
      if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

      const type = poster ? (row.poster_mime || 'image/jpeg') : (row.mime || 'video/mp4');
      const common = {
        'Content-Type': type,
        // Никакого угадывания типа браузером: файл прислал человек.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Accept-Ranges': 'bytes',
        // private: между зрителем и нами бывают общие кэши, и чужой
        // фильм в них попадать не должен.
        'Cache-Control': 'private, max-age=600',
        // Пропуск — в куке, а не в заголовке Authorization (тег <video>
        // его не отправит). Без Vary браузер отдал бы кино, закешированное
        // под пропуском одного профиля, другому профилю того же Sky ID,
        // открывшему тот же адрес в том же браузере после переключения.
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
        // Зритель закрыл вкладку или перемотал — чтение с диска надо
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
    }

    return json(res, 404, { error: 'not_found' });
  }

  return json(res, 404, { error: 'not_found' });
};
