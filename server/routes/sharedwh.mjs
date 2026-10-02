/**
 * Общедоступный склад, видеообзор и согласия — по HTTP.
 *
 * Отдельным файлом от остальной логистики нарочно: здесь другой род
 * запросов. Видео идёт потоком в несколько сотен мегабайт и отдаётся
 * кусками по диапазону, а согласия вообще не про склады — их принимают
 * и продавцы, и арендаторы.
 *
 * Чего этот файл не читает из запроса никогда:
 *   · кто спрашивает — берётся из токена;
 *   · роль на складе — берётся из базы;
 *   · состояние видеообзора — его ставит только администрация;
 *   · редакция и отпечаток документа — их берёт сервер со своего диска,
 *     иначе «согласен» подписывалось бы под чем угодно;
 *   · цена ячейки при аренде — её считает сервер по своей базе.
 *
 * Денег через эти ручки не проходит: за ячейку платят владельцу склада
 * напрямую, Sky этой оплаты не принимает и не хранит.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { ticketFromCookies, readTicket } from './../marketticket.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  DOC_CODES, readDocument, acceptDocument, acceptanceState,
} from './../agreements.mjs';
import {
  startReview, finishReview, dropReview, latestReview, videoAccess, publicReview,
  pendingReviews, decideReview, MAX_VIDEO_BYTES, VIDEO_ID_RE,
} from './../videoreview.mjs';
import {
  saveStream, sizeOf, openStream, remove as removeVideo, parseRange,
} from './../videostore.mjs';
import {
  updateSharedSettings, sharedReadiness, requestShared, activateShared,
  closeShared, suspendShared, listSharedWarehouses,
  listCells, createCell, updateCell, blockCell, deleteCell, cellEvents,
  rentCell, moveRental, cancelRental, moveKey,
  myRentals, warehouseRentals, readRental,
  CELL_ID_RE, RENTAL_ID_RE,
} from './../sharedwarehouse.mjs';
import { WAREHOUSE_ID_RE } from './../warehouses.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 60;
/** Видеообзор снимают раз в жизни склада, а не раз в минуту. */
const VIDEO_PER_HOUR = 6;

const CODES = {
  not_found: 404,
  not_allowed: 403,
  unknown_document: 404,
  seller_rules_required: 403,
  warehouse_rules_required: 403,
  video_review_required: 409,
  video_review_rejected: 409,
  payment_details_required: 409,
  cell_price_required: 409,
  cells_required: 409,
  already_shared: 409,
  shared_suspended: 403,
  wrong_state: 409,
  review_pending: 409,
  already_decided: 409,
  reason_required: 400,
  number_taken: 409,
  too_many_cells: 409,
  cell_taken: 409,
  cell_blocked: 409,
  cell_rented: 409,
  not_shared: 409,
  own_warehouse: 409,
  bad_days: 400,
  bad_period: 400,
  bad_number: 400,
  bad_action: 400,
  bad_key_state: 400,
  bad_subject: 400,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

/* ─── Приём видео ──────────────────────────────────────────────────── */

const VIDEO_SIGNATURES = [
  // MP4 и MOV: размер коробки, затем 'ftyp'.
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  // WebM и MKV — оба Matroska, заголовок EBML один и тот же.
  { mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'video/quicktime', test: (b) => b.subarray(4, 12).toString('latin1') === 'ftypqt  ' },
];

const sniff = (buf) => {
  if (!buf || buf.length < 16) return null;
  for (const s of VIDEO_SIGNATURES) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};

/**
 * Первые байты потока — чтобы опознать тип до того, как писать файл.
 * Прочитанное не теряется: оно возвращается и уходит в файл первым.
 */
const peek = (req, bytes) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  const onData = (c) => {
    chunks.push(c);
    size += c.length;
    if (size >= bytes) { req.pause(); req.off('data', onData); resolve(Buffer.concat(chunks)); }
  };
  req.on('data', onData);
  req.once('end', () => { req.off('data', onData); resolve(Buffer.concat(chunks)); });
});

const withHead = (head, rest) => Readable.from((async function* () {
  yield head;
  for await (const chunk of rest) yield chunk;
})());

const DRAIN_MS = 10_000;

/** Отказ, когда тело ещё идёт: остаток дочитываем, иначе клиент видит обрыв. */
const rejectBody = (req, res, code, body) => {
  json(res, code, body);
  let done = false;
  let timer = null;
  const finish = (hard) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    req.off('data', onData);
    if (hard === true) req.destroy();
  };
  /* Видео большое: дочитывать его целиком ради вежливого отказа
     бессмысленно — обрываем сразу, дав ответу уйти. */
  const onData = () => finish(true);
  timer = setTimeout(() => finish(true), DRAIN_MS);
  timer.unref();
  req.on('data', onData);
  req.once('end', () => finish(false));
  req.once('error', () => finish(false));
  req.once('close', () => finish(false));
  return true;
};

/**
 * Отдать видео — целиком или куском.
 *
 * Кусками потому, что проигрыватель перематывает: без поддержки
 * диапазона он тянет файл с начала при каждом движении ползунка.
 */
const sendVideo = async (req, res, id, mime) => {
  const size = await sizeOf(id);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const range = parseRange(req.headers.range, size);
  if (range?.invalid) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return true;
  }

  const head = {
    'Content-Type': mime || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    /* Запись помещения — не то, что должно лежать в общих кэшах. */
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
  if (range) {
    res.writeHead(206, {
      ...head,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    });
  } else {
    res.writeHead(200, { ...head, 'Content-Length': String(size) });
  }

  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = openStream(id, range ?? undefined);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

/* ═══ Маршруты ═════════════════════════════════════════════════════ */

export const sharedWarehouseRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  const mine = path.startsWith('/api/agreements')
    || path.startsWith('/api/logistics/shared')
    || path.startsWith('/api/logistics/cells')
    || path.startsWith('/api/logistics/rentals')
    || path.startsWith('/api/logistics/video')
    || path.startsWith('/api/logistics/warehouses/');
  if (!mine) return false;

  const params = new URL(req.url, 'http://x').searchParams;

  /* Запись браузер тянет тегом <video>, и заголовок туда не подставить.
     Принимаем подписанный пропуск — право смотреть всё равно решает
     videoAccess по базе. */
  const isVideo = (req.method === 'GET' || req.method === 'HEAD')
    && /^\/api\/logistics\/video\/lvr-[0-9a-f-]{36}$/.test(path);

  let me;
  if (isVideo) {
    const got = await readSession(req);
    me = got?.profileId ?? ticketFromCookies(req.headers.cookie) ?? readTicket(params.get('t'));
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  const readOk = () => rateLimit(`sw:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`sw:w:${me}`, WRITE_PER_MIN);
  const body = async () => parseBody(req);

  /* ══ Документы и согласия ═══════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/agreements') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { documents: await acceptanceState(me) });
  }

  /* Текст документа. Код выбирается из своего списка — имя файла из
     запроса не берётся никогда. */
  const docPath = path.match(/^\/api\/agreements\/([a-z_]{1,40})$/);
  if (req.method === 'GET' && docPath) {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    if (!DOC_CODES.includes(docPath[1])) return json(res, 404, { error: 'unknown_document' });
    const doc = await readDocument(docPath[1]);
    return json(res, 200, {
      code: doc.code, title: doc.title, revision: doc.revision, text: doc.text,
    });
  }

  if (req.method === 'POST' && docPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await acceptDocument(me, docPath[1]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Витрина общих складов ══════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/logistics/shared-warehouses') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      warehouses: await listSharedWarehouses({
        city: params.get('city'), limit: params.get('limit'),
      }),
    });
  }

  /* ══ Общий режим конкретного склада ═════════════════════════════ */

  const whShared = path.match(
    /^\/api\/logistics\/warehouses\/(lw-[0-9a-f-]{36})\/shared(\/[a-z-]+)?$/);
  if (whShared) {
    const warehouseId = whShared[1];
    const tail = whShared[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const ready = await sharedReadiness(warehouseId, me);
      if (!ready) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { readiness: ready });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateSharedSettings(warehouseId, me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done =
        tail === '/request' ? await requestShared(warehouseId, me)
          : tail === '/activate' ? await activateShared(warehouseId, me)
            : tail === '/close' ? await closeShared(warehouseId, me)
              : { error: 'not_found' };
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Ячейки ═════════════════════════════════════════════════════ */

  const whCells = path.match(/^\/api\/logistics\/warehouses\/(lw-[0-9a-f-]{36})\/cells$/);
  if (whCells) {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const cells = await listCells(whCells[1], me);
      if (cells === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { cells });
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await createCell(whCells[1], me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  const whRentals = path.match(/^\/api\/logistics\/warehouses\/(lw-[0-9a-f-]{36})\/rentals$/);
  if (req.method === 'GET' && whRentals) {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const list = await warehouseRentals(whRentals[1], me, { limit: params.get('limit') });
    if (list === null) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { rentals: list });
  }

  const cellPath = path.match(/^\/api\/logistics\/cells\/(lwc-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (cellPath) {
    const cellId = cellPath[1];
    const tail = cellPath[2] ?? '';

    if (req.method === 'PATCH' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateCell(cellId, me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'DELETE' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await deleteCell(cellId, me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'GET' && tail === '/log') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const log = await cellEvents(cellId, me, { limit: params.get('limit') });
      if (log === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { events: log });
    }
    if (req.method === 'POST' && tail === '/block') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await blockCell(cellId, me, b.on !== false, b.reason);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/rent') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await rentCell(cellId, me, b.days);
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  /* ══ Аренда ═════════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/logistics/rentals') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { rentals: await myRentals(me, { limit: params.get('limit') }) });
  }

  const rentalPath = path.match(/^\/api\/logistics\/rentals\/(lcr-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (rentalPath) {
    const rentalId = rentalPath[1];
    const tail = rentalPath[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const rental = await readRental(rentalId, me);
      if (!rental) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { rental });
    }
    if (req.method === 'POST' && tail === '/cancel') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await cancelRental(rentalId, me, (await body()).reason);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/key') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await moveKey(rentalId, me, b.state, b.note);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail !== '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await moveRental(rentalId, me, tail.slice(1).replace(/-/g, '_'));
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Видеообзор ═════════════════════════════════════════════════ */

  /* Публичная витрина: одобренный обзор пункта выдачи, доступный
     любому вошедшему покупателю — не только сотруднику и не только
     администрации. Метаданные отдельно от самого файла: сам файл идёт
     по общей ручке videoAccess ниже, она уже пускает сюда кого угодно
     для status = 'approved'. */
  const publicVideo = path.match(
    /^\/api\/logistics\/video\/pickup_point\/(mpp-[0-9a-f-]{36})\/public$/);
  if (req.method === 'GET' && publicVideo) {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { review: await publicReview(publicVideo[1]) });
  }

  const videoSubject = path.match(
    /^\/api\/logistics\/video\/(warehouse|pickup_point)\/([a-z]{1,4}-[0-9a-f-]{36})$/);
  if (videoSubject) {
    const kind = videoSubject[1];
    const subjectId = videoSubject[2];

    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { review: await latestReview(kind, subjectId, me) });
    }

    if (req.method === 'POST') {
      if (!rateLimitPerHour(`sw:video:${me}`, VIDEO_PER_HOUR)) {
        return rejectBody(req, res, 429, { error: 'too_many_requests' });
      }
      /* Заявленный размер — слова клиента: по ним можно отказать сразу,
         но верить им нельзя, поэтому предел считается и по факту, по
         мере поступления байтов. */
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_VIDEO_BYTES) {
        return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_VIDEO_BYTES });
      }
      const head = await peek(req, 32);
      const mime = sniff(head);
      if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_video' });

      const started = await startReview(kind, subjectId, me, mime);
      if (started.error) {
        return rejectBody(req, res, CODES[started.error] ?? 400, started);
      }

      /* resume() здесь звать нельзя: поток снова пошёл бы без единого
         слушателя, и всё, что успело прийти, утекло бы в никуда — файл
         сохранился бы обрезанным. Чтение продолжит withHead. */
      const saved = await saveStream(started.id, withHead(head, req), MAX_VIDEO_BYTES);
      if (saved.error) {
        await dropReview(started.id);
        return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
      }
      await finishReview(started.id, saved.bytes);
      return json(res, 201, { id: started.id, bytes: saved.bytes });
    }
  }

  const videoFile = path.match(/^\/api\/logistics\/video\/(lvr-[0-9a-f-]{36})$/);
  if ((req.method === 'GET' || req.method === 'HEAD') && videoFile) {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const allowed = await videoAccess(videoFile[1], me);
    if (!allowed) return json(res, 404, { error: 'not_found' });
    return sendVideo(req, res, videoFile[1], allowed.mime);
  }

  /* ══ Очередь администрации ══════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/logistics/video-queue') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const queue = await pendingReviews(me, { limit: params.get('limit') });
    if (queue === null) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { reviews: queue });
  }

  const decide = path.match(/^\/api\/logistics\/video-queue\/(lvr-[0-9a-f-]{36})$/);
  if (req.method === 'POST' && decide) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await decideReview(decide[1], me, b.approve === true, b.reason);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  const suspend = path.match(/^\/api\/logistics\/shared-warehouses\/(lw-[0-9a-f-]{36})\/suspend$/);
  if (req.method === 'POST' && suspend) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await suspendShared(suspend[1], me, b.on !== false);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* Ничего своего не нашлось — пусть смотрят остальные маршруты
     логистики: часть путей под /warehouses/ принадлежит им. */
  return false;
};

export { VIDEO_ID_RE, WAREHOUSE_ID_RE, CELL_ID_RE, RENTAL_ID_RE, removeVideo };
