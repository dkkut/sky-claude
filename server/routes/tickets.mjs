/**
 * Sky Tickets по HTTP.
 *
 * Здесь только вход: кто спрашивает, не слишком ли часто, той ли формы
 * идентификатор. Ни одна ручка не решает сама, можно ли этому человеку
 * это мероприятие, этот заказ или этот билет — за это отвечают
 * tickets.mjs и ticketorders.mjs.
 *
 * Три вещи, которые в этом файле не читаются НИКОГДА, даже если клиент
 * их пришлёт:
 *
 *   · цена и итог заказа — их считает сервер по своей таблице;
 *   · идентификатор покупателя и организатора — они берутся из сессии;
 *   · статус подписки и её срок — они вычисляются по базе.
 *
 * Соответственно, подменить их нечем: таких входных данных нет.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can } from './../admin.mjs';
import {
  listCatalog, listCities, readEvent, listMine, createEvent, updateEvent,
  submitEvent, setEventStatus, publishProblems, moderationQueue, moderateEvent,
  createType, updateType, deleteType,
  setCover, coverMime, addImage, imageMime,
  setFavorite, listFavorites,
  organizerState, setOrganizerName, isOrganizer,
  CATEGORIES, EVENT_ID_RE,
} from './../tickets.mjs';
import {
  payOrganizer, organizerPayments,
  buyTickets, readOrder, listOrders, listMyTickets,
  inspectTicket, useTicket, setTicketStatus, expireRemaining,
  eventTickets, eventOrders, eventStats, organizerSummary,
} from './../ticketorders.mjs';
import {
  saveStream, sizeOf, openStream, coverIdFor, imageIdFor,
} from './../ticketstore.mjs';

/* ─── Потолки ──────────────────────────────────────────────────────── */
const READ_PER_MIN = 300;
const WRITE_PER_MIN = 60;
/** Покупка и контроль — операции с деньгами и с очередью на входе. */
const BUY_PER_MIN = 20;
const SCAN_PER_MIN = 240;
const UPLOAD_PER_HOUR = 60;

/** Афиша — картинка, а не фильм: держим скромно. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * Опознание по первым байтам. Присланный Content-Type здесь не значит
 * ничего: его пишет клиент. Список ровно тот, что обещан на экране
 * загрузки, и ни байтом шире — сохранённый неизвестный файл рано или
 * поздно кто-нибудь откроет.
 */
const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

const sniff = (buf) => {
  if (!buf || buf.length < 16) return null;
  for (const s of IMAGE_SIGNATURES) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};

/** Первые байты потока — чтобы опознать тип до записи на диск. */
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

const DRAIN_LIMIT = MAX_IMAGE_BYTES + 1024 * 1024;
const DRAIN_MS = 10_000;

/**
 * Отказ, когда тело ещё идёт.
 *
 * Клиент в этот момент пишет файл и ответ не читает. Если оборвать
 * соединение сразу, его запись падает с EPIPE, и вместо «файл слишком
 * большой» человек видит «соединение разорвано» — причина отказа до
 * него не доходит. Поэтому остаток дочитываем и выбрасываем.
 *
 * Заголовка Connection: close здесь нет намеренно: с ним Node рвёт
 * сокет сразу после отправки ответа, и получается ровно тот обрыв,
 * которого мы избегаем.
 *
 * Дочитываем не сколько угодно: предел взят чуть выше разрешённого
 * размера афиши. Этого хватает тому, кто просто промахнулся с файлом,
 * и не хватает тому, кто решил занять канал гигабайтом.
 */
const rejectBody = (req, res, code, body) => {
  json(res, code, body);

  let drained = 0;
  let done = false;
  let timer = null;

  const finish = (hard) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    req.off('data', onData);
    /* Рвём только того, кто вышел за предел: дочитанный до конца
       запрос закрывать незачем — соединение переиспользуется. */
    if (hard === true) req.destroy();
  };

  const onData = (chunk) => {
    drained += chunk.length;
    if (drained > DRAIN_LIMIT) finish(true);
  };

  timer = setTimeout(() => finish(true), DRAIN_MS);
  timer.unref();
  req.on('data', onData);
  req.once('end', () => finish(false));
  req.once('error', () => finish(false));
  req.once('close', () => finish(false));
  return true;
};

const codeFor = (error) => (
  error === 'not_found' ? 404
    : error === 'subscription_required' ? 402
      : error === 'not_allowed' ? 403
        : error === 'sold_out' || error === 'per_user_limit' || error === 'not_on_sale'
          || error === 'sale_not_started' || error === 'sale_ended' || error === 'event_started'
          || error === 'already_pending' || error === 'already_published' || error === 'event_closed'
          || error === 'too_many' || error === 'too_many_types' || error === 'has_sales'
          || error === 'below_sold' || error === 'bad_transition' || error === 'incomplete'
          || error === 'insufficient_funds' ? 409
          : error === 'payments_not_configured' ? 501
            : 400);

/** Отдача картинки. Без Range: афиша — не фильм. */
const sendImage = async (res, fileId, mime) => {
  const size = await sizeOf(fileId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  res.writeHead(200, {
    'Content-Type': mime || 'image/jpeg',
    'Content-Length': String(size),
    /* Никакого угадывания типа браузером: файл прислал человек. */
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    /* Афиша опубликованного мероприятия видна всем, но между нами и
       гостем бывают общие кэши — держим ответ приватным. */
    'Cache-Control': 'private, max-age=600',
  });
  const stream = openStream(fileId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

export const ticketRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/tickets')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Афиши браузер тянет сам тегом <img>, заголовок Authorization он
     туда не подставит. Обложка опубликованного мероприятия — вещь
     открытая, поэтому для неё достаточно быть в сети Sky; всё
     остальное требует обычной сессии. */
  const isPublicImage = /^\/api\/tickets\/event\/(tev-[0-9a-f-]{36})\/(cover|image\/\d{1,2})$/.test(path)
    && req.method === 'GET';

  let me = null;
  if (isPublicImage) {
    const session = await readSession(req);
    me = session?.profileId ?? null;
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  /* ══ Картинки ═══════════════════════════════════════════════════ */

  const coverMatch = /^\/api\/tickets\/event\/(tev-[0-9a-f-]{36})\/cover$/.exec(path);
  if (req.method === 'GET' && coverMatch) {
    const found = await coverMime(coverMatch[1]);
    if (!found) return json(res, 404, { error: 'not_found' });
    /* Черновик чужой афиши не показываем даже картинкой. */
    if (!['published', 'paused', 'completed', 'cancelled'].includes(found.status)) {
      const ev = await readEvent(coverMatch[1], me);
      if (!ev) return json(res, 404, { error: 'not_found' });
    }
    return sendImage(res, coverIdFor(coverMatch[1]), found.mime);
  }

  const imgMatch = /^\/api\/tickets\/event\/(tev-[0-9a-f-]{36})\/image\/(\d{1,2})$/.exec(path);
  if (req.method === 'GET' && imgMatch) {
    const mime = await imageMime(imgMatch[1], Number(imgMatch[2]));
    if (!mime) return json(res, 404, { error: 'not_found' });
    /* Та же проверка, что и у обложки: черновик чужого мероприятия не
       показываем и картинкой. Идентификатор случайный, но «его никто
       не угадает» — это не право доступа. */
    const ev = await readEvent(imgMatch[1], me);
    if (!ev) return json(res, 404, { error: 'not_found' });
    return sendImage(res, imageIdFor(imgMatch[1], Number(imgMatch[2])), mime);
  }

  /* Дальше — только со своей сессией. */
  if (!me) return json(res, 401, { error: 'unauthorized' });

  /* ══ Афиша ══════════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/tickets/catalog') {
    if (!rateLimit(`tix:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const result = await listCatalog(me, {
      q: params.get('q') ?? '',
      city: params.get('city') ?? '',
      category: params.get('category') ?? '',
      from: params.get('from'),
      to: params.get('to'),
      priceMin: params.get('priceMin'),
      priceMax: params.get('priceMax'),
      available: params.get('available') === '1',
      period: params.get('period') ?? '',
      limit: params.get('limit'),
      offset: params.get('offset'),
    });
    return json(res, 200, { ...result, categories: CATEGORIES, cities: await listCities() });
  }

  if (req.method === 'GET' && path === '/api/tickets/favorites') {
    if (!rateLimit(`tix:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { events: await listFavorites(me) });
  }

  /* ══ Мои билеты и заказы ════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/tickets/my') {
    if (!rateLimit(`tix:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { tickets: await listMyTickets(me, params.get('scope') ?? 'active') });
  }

  if (req.method === 'GET' && path === '/api/tickets/orders') {
    if (!rateLimit(`tix:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { orders: await listOrders(me, params.get('limit')) });
  }

  const orderMatch = /^\/api\/tickets\/order\/(tor-[0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && orderMatch) {
    const found = await readOrder(orderMatch[1], me);
    if (!found) return json(res, 404, { error: 'not_found' });
    return json(res, 200, found);
  }

  /*
   * Покупка.
   *
   * Из тела берутся только «что» и «сколько». Цену, остаток и лимит
   * сервер узнаёт сам, в транзакции с блокировкой строки.
   */
  if (req.method === 'POST' && path === '/api/tickets/buy') {
    if (!rateLimit(`tix:buy:${me}`, BUY_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await buyTickets(me, body.typeId, body.quantity, body.idemKey);
    if (result?.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  /* ══ Подписка организатора ══════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/tickets/organizer') {
    if (!rateLimit(`tix:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const state = await organizerState(me);
    return json(res, 200, {
      subscription: state,
      /* Сводка — только тем, кому кабинет открыт. */
      summary: state.active ? await organizerSummary(me) : null,
      payments: await organizerPayments(me),
    });
  }

  if (req.method === 'POST' && path === '/api/tickets/organizer/pay') {
    if (!rateLimitPerHour(`tix:pay:${me}`, 12)) return json(res, 429, { error: 'too_many_requests' });
    const body = await parseBody(req);
    const result = await payOrganizer(me, body.idemKey);
    if (result?.error) return json(res, codeFor(result.error), result);
    return json(res, 200, { ...result, subscription: await organizerState(me) });
  }

  if (req.method === 'POST' && path === '/api/tickets/organizer/name') {
    if (!rateLimit(`tix:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    if (!(await isOrganizer(me))) return json(res, 402, { error: 'subscription_required' });
    const body = await parseBody(req);
    return json(res, 200, { subscription: await setOrganizerName(me, body.name) });
  }

  /* ══ Кабинет: мероприятия ═══════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/tickets/mine') {
    if (!rateLimit(`tix:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    /*
     * Список своих мероприятий открыт и без подписки: по окончании
     * срока данные не пропадают, и человек должен их видеть. Закрыты
     * только действия — создание, правка, публикация.
     */
    return json(res, 200, {
      events: await listMine(me, params.get('status') ?? 'all'),
      subscription: await organizerState(me),
    });
  }

  if (req.method === 'POST' && path === '/api/tickets/events') {
    if (!rateLimit(`tix:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await createEvent(me, body);
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 201, result);
  }

  /* ══ Контроль на входе ══════════════════════════════════════════ */

  /*
   * Проверка и отметка. Право отмечать проверяется по мероприятию из
   * самого билета, а не по тому, что прислали: чужой билет неотличим
   * от несуществующего.
   */
  if (req.method === 'POST' && path === '/api/tickets/scan') {
    if (!rateLimit(`tix:scan:${me}`, SCAN_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = body.mark === true
      ? await useTicket(me, { qr: body.qr, code: body.code })
      : await inspectTicket(me, { qr: body.qr, code: body.code });
    return json(res, 200, result);
  }

  if (req.method === 'POST' && path === '/api/tickets/ticket/status') {
    if (!rateLimit(`tix:scan:${me}`, SCAN_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await setTicketStatus(me, body.ticketId, body.status);
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  /* ══ Модерация ══════════════════════════════════════════════════ */

  if (path === '/api/tickets/moderation') {
    /* Право на билеты, а не «администратор вообще»: разбирать заявки
       организаторов должен тот, кому это поручено. Владелец имеет все
       права, так что отдельной проверки на него не нужно. */
    if (!(await can(me, 'tickets'))) return json(res, 403, { error: 'not_allowed' });
    if (req.method === 'GET') return json(res, 200, { events: await moderationQueue() });
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const result = await moderateEvent(body.eventId, body.approve === true, body.reason);
      if (result.error) return json(res, codeFor(result.error), result);
      return json(res, 200, { ok: true });
    }
  }

  /* ══ Типы билетов (по своему идентификатору) ════════════════════ */

  const typeMatch = /^\/api\/tickets\/type\/(ttp-[0-9a-f-]{36})$/.exec(path);
  if (typeMatch) {
    if (!rateLimit(`tix:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    if (req.method === 'PATCH') {
      const body = await parseBody(req);
      const result = await updateType(typeMatch[1], me, body);
      if (result.error) return json(res, codeFor(result.error), result);
      return json(res, 200, result);
    }
    if (req.method === 'DELETE') {
      const result = await deleteType(typeMatch[1], me);
      if (result.error) return json(res, codeFor(result.error), result);
      return json(res, 200, result);
    }
  }

  /* ══ Одно мероприятие ═══════════════════════════════════════════ */

  /* Дефис в классе обязателен: без него /publish-check и
     /expire-remaining не совпадали и отвечали «не найдено». */
  const one = /^\/api\/tickets\/event\/(tev-[0-9a-f-]{36})(\/[a-z-]+)?$/.exec(path);
  if (!one) return json(res, 404, { error: 'not_found' });

  const eventId = one[1];
  const tail = one[2] ?? '';
  if (!EVENT_ID_RE.test(eventId)) return json(res, 404, { error: 'not_found' });

  /* Карточка. Черновик чужого сюда не попадёт — это решает readEvent. */
  if (req.method === 'GET' && tail === '') {
    if (!rateLimit(`tix:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const event = await readEvent(eventId, me, { countView: true });
    if (!event) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { event });
  }

  if (req.method === 'POST' && tail === '/favorite') {
    const body = await parseBody(req);
    const result = await setFavorite(eventId, me, body.on === true);
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  /*
   * Дальше — только владельцу.
   *
   * Одна проверка на все оставшиеся ветки: так её нельзя забыть в
   * какой-то одной. Право «моё» и право «подписка жива» разделены:
   * чужое мероприятие — это 404, а своё без подписки — 402, и человеку
   * надо сказать, что именно не так.
   */
  if (req.method !== 'GET' && !rateLimit(`tix:write:${me}`, WRITE_PER_MIN)) {
    return json(res, 429, { error: 'rate_limited' });
  }

  if (req.method === 'PATCH' && tail === '') {
    const body = await parseBody(req);
    const result = await updateEvent(eventId, me, body);
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  if (req.method === 'POST' && tail === '/types') {
    const body = await parseBody(req);
    const result = await createType(eventId, me, body);
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 201, result);
  }

  /* Чего не хватает до публикации. Чужое мероприятие сюда не пускаем:
     список пробелов — это уже сведения о чужой афише. */
  if (req.method === 'GET' && tail === '/publish-check') {
    const own = await readEvent(eventId, me);
    if (!own || !own.own) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { problems: await publishProblems(eventId) });
  }

  if (req.method === 'POST' && tail === '/submit') {
    const result = await submitEvent(eventId, me, { moderated: true });
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  if (req.method === 'POST' && tail === '/status') {
    const body = await parseBody(req);
    const result = await setEventStatus(eventId, me, String(body.status ?? ''));
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  if (req.method === 'GET' && tail === '/tickets') {
    const result = await eventTickets(me, eventId, {
      status: params.get('status') ?? 'all',
      q: params.get('q') ?? '',
      limit: params.get('limit'),
      offset: params.get('offset'),
    });
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  if (req.method === 'GET' && tail === '/orders') {
    const result = await eventOrders(me, eventId, params.get('limit'));
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, { orders: result });
  }

  if (req.method === 'GET' && tail === '/stats') {
    const result = await eventStats(me, eventId);
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  if (req.method === 'POST' && tail === '/expire-remaining') {
    const result = await expireRemaining(me, eventId);
    if (result.error) return json(res, codeFor(result.error), result);
    return json(res, 200, result);
  }

  /* ══ Загрузка афиши ═════════════════════════════════════════════ */

  if (req.method === 'POST' && (tail === '/cover' || tail === '/image')) {
    if (!rateLimitPerHour(`tix:upload:${me}`, UPLOAD_PER_HOUR)) {
      return rejectBody(req, res, 429, { error: 'too_many_requests' });
    }

    /* Заявленный размер — слова клиента: по ним можно отказать сразу,
       но верить им нельзя, поэтому предел считается и по факту. */
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_IMAGE_BYTES) {
      return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_IMAGE_BYTES });
    }

    const head = await peek(req, 32);
    const mime = sniff(head);
    /* Тип определяется по первым байтам. Присланный Content-Type и имя
       файла здесь не значат ничего — и имя файла не используется
       вообще нигде: путь собирается из идентификатора сервера. */
    if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_image' });

    if (tail === '/cover') {
      const allowed = await setCover(eventId, me, mime);
      if (allowed.error) return rejectBody(req, res, codeFor(allowed.error), allowed);

      req.resume();
      const saved = await saveStream(coverIdFor(eventId), withHead(head, req), MAX_IMAGE_BYTES);
      if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
      return json(res, 200, { ok: true, bytes: saved.bytes });
    }

    const added = await addImage(eventId, me, mime);
    if (added.error) return rejectBody(req, res, codeFor(added.error), added);

    req.resume();
    const saved = await saveStream(imageIdFor(eventId, added.idx), withHead(head, req), MAX_IMAGE_BYTES);
    if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
    return json(res, 200, { ok: true, idx: added.idx, bytes: saved.bytes });
  }

  return json(res, 404, { error: 'not_found' });
};
