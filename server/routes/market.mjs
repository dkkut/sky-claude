/**
 * Sky Market по HTTP.
 *
 * Здесь только вход: кто спрашивает, не слишком ли часто и той ли формы
 * идентификатор. Кому что можно — решают market.mjs, marketorders.mjs,
 * marketchat.mjs и marketdelivery.mjs, и решают один раз для всех
 * входов.
 *
 * Чего этот файл не читает из запроса никогда:
 *   · кто спрашивает — это берётся из токена;
 *   · признаки вроде isSeller, sellerActive, subscriptionActive — право
 *     торговать спрашивается у базы, потому что подписку оплачивают
 *     деньгами, а не полем в запросе;
 *   · цену товара и продавца — они берутся из строки товара;
 *   · состояние заказа — клиент присылает название действия, а новое
 *     состояние выбирает машина переходов;
 *   · трек-номер и состояние посылки — их присылает перевозчик, и
 *     только с подписью.
 *
 * Денег через эти ручки не проходит, кроме одной: подписки продавца.
 * Ни выплаты, ни вывода, ни баланса продавца здесь нет, потому что их
 * нет в Sky.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { isAdmin } from './../admin.mjs';
import {
  SELLER_PRICE, SELLER_DAYS, CATEGORIES, GAME_CATEGORIES, MARKET_TYPES,
  SERVICE_CATEGORIES, SERVICE_LEVELS, setServicePackages,
  PROMO_PLANS, buyPromotion, listPromotions,
  readSeller, readMySeller, createSeller, updateSeller, setSellerAvatar, sellerAvatarMime,
  paySellerSubscription, listGames, createGame, updateGame,
  setGameCover, gameCoverMime, readProduct, listCatalog, listMyProducts,
  listFavorites, setFavorite, createProduct, updateProduct, archiveProduct,
  addProductImage, readProductImage, deleteProductImage, listReviews,
  setProductLogo, productLogoMime, dropProductLogo,
} from './../market.mjs';
import {
  saveStream, sizeOf, openStream, remove,
  sellerAvatarIdFor, gameCoverIdFor, productLogoIdFor,
} from './../marketstore.mjs';
import {
  createOrder, actOnOrder, cancelOrder, openDispute, resolveDispute,
  markPacking, listOrders, accessOrder, orderHistory, toOrder,
  leaveReview, sellerStats, listNotifications, readNotification, readAllNotifications,
  orderPaymentDetails, putOrderInSupply, ordersInSupply,
} from './../marketorders.mjs';
import {
  listChats, readChat, sendMessage, markRead, unreadCount, chatOfOrder,
} from './../marketchat.mjs';
import {
  listPickupPoints, listCarriers, shipOrder, readShipment,
  sellerMoveShipment, carrierWebhook, upsertPickupPoint, upsertCarrier,
  listCarrierShipments, listMyCarriers,
} from './../marketdelivery.mjs';

/* ─── Потолки ──────────────────────────────────────────────────────
   Чтение щедрое: каталог листают. Заказы и сообщения — скупее: они
   создают строки в базе и уведомления другому человеку.            */
const READ_PER_MIN = 120;
const WRITE_PER_MIN = 60;
const ORDER_PER_HOUR = 60;
const MESSAGE_PER_MIN = 30;
const UPLOAD_PER_HOUR = 120;
const WEBHOOK_PER_MIN = 600;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_WEBHOOK_BYTES = 64 * 1024;

/** Один список кодов на весь файл: иначе они расходятся между ручками. */
const CODES = {
  not_found: 404,
  not_allowed: 403,
  not_your_step: 403,
  carrier_owns_status: 403,
  bad_signature: 401,
  unknown_carrier: 404,
  unknown_tracking: 404,
  subscription_required: 402,
  payment_details_required: 409,
  seller_has_no_payment_details: 409,
  insufficient_funds: 402,
  seller_suspended: 403,
  seller_pending: 403,
  not_a_seller: 403,
  already_seller: 409,
  already_reviewed: 409,
  already_shipped: 409,
  order_closed: 409,
  order_not_completed: 409,
  already_closed: 409,
  too_late_to_cancel: 409,
  wrong_state: 409,
  out_of_stock: 409,
  own_product: 409,
  too_many_open_orders: 409,
  too_many_products: 409,
  too_many_images: 409,
  stale_status: 409,
  slug_taken: 409,
  not_applicable: 409,
  use_deal_chat: 409,
  carrier_has_no_payment_details: 409,
  not_a_service: 409,
  bad_plan: 400,
  product_archived: 409,
  not_warehouse_mode: 409,
  no_such_supply: 404,
  supply_closed: 409,
  not_in_supply: 409,
  supply_not_arrived: 409,
  warehouse_ships_itself: 409,
  warehouse_required: 400,
  not_your_warehouse: 403,
  no_packages: 400,
  bad_package: 400,
  bad_package_price: 400,
  bad_package_title: 400,
  bad_service_category: 400,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

/* ─── Загрузка картинок ────────────────────────────────────────────
   Тип определяется по первым байтам файла. Присланный Content-Type и
   имя файла не значат здесь ничего, и имя файла не используется нигде:
   путь собирается из идентификатора, который выдал сервер.          */

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
 * Клиент в этот момент пишет файл и ответ не читает. Оборвать
 * соединение сразу — значит уронить его запись с EPIPE, и вместо
 * «файл слишком большой» человек увидит «соединение разорвано».
 * Поэтому остаток дочитываем и выбрасываем — но не сколько угодно.
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

/** Отдача картинки. Без Range: это не фильм. */
const sendImage = async (res, fileId, mime) => {
  const size = await sizeOf(fileId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });
  res.writeHead(200, {
    'Content-Type': mime || 'image/jpeg',
    'Content-Length': String(size),
    /* Никакого угадывания типа браузером: файл прислал человек. */
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=600',
  });
  const stream = openStream(fileId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

/** Тело вебхука целиком — подпись считается по тем же байтам. */
const readRaw = (req, limit) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) { req.destroy(); resolve(null); return; }
    chunks.push(c);
  });
  req.once('end', () => resolve(Buffer.concat(chunks)));
  req.once('error', () => resolve(null));
});

/* ═══ Маршруты ═════════════════════════════════════════════════════ */

export const marketRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/market')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* ══ Вебхук перевозчика ═════════════════════════════════════════
     Единственная ручка модуля без входа: перевозчик не человек и
     токена у него нет. Вместо токена — подпись тела его секретом,
     и она проверяется до всего остального.                        */
  const hook = path.match(/^\/api\/market\/webhook\/([a-z]+)$/);
  if (hook) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const ip = req.socket.remoteAddress || 'unknown';
    if (!rateLimit(`mk:hook:${ip}`, WEBHOOK_PER_MIN)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const raw = await readRaw(req, MAX_WEBHOOK_BYTES);
    if (!raw) return json(res, 413, { error: 'too_large' });

    let payload;
    try { payload = JSON.parse(raw.toString('utf8') || '{}'); }
    catch { return json(res, 400, { error: 'invalid_json' }); }

    const signature = req.headers['x-market-signature'];
    const done = await carrierWebhook(hook[1], raw, signature, payload);
    if (done.error) return fail(res, done);
    return json(res, 200, done);
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const readOk = () => rateLimit(`mk:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`mk:w:${me}`, WRITE_PER_MIN);

  /* ══ Что умеет сервер ═══════════════════════════════════════════
     Списки и цены отдаются экрану, чтобы он не выдумывал свои.
     Источником правды всё равно остаётся сервер: присланное сверх
     списка он отклонит, даже если экран покажет другое.            */
  if (req.method === 'GET' && path === '/api/market/config') {
    return json(res, 200, {
      categories: CATEGORIES,
      gameCategories: GAME_CATEGORIES,
      serviceCategories: SERVICE_CATEGORIES,
      serviceLevels: SERVICE_LEVELS,
      marketTypes: MARKET_TYPES,
      sellerPrice: SELLER_PRICE,
      sellerDays: SELLER_DAYS,
      /* Открыто и прямо: Sky не держит деньги сделки. */
      moneyModel: 'direct',
    });
  }

  /* ══ Каталог ════════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/market/catalog') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const items = await listCatalog(me, {
      marketType: params.get('type') ?? 'standard',
      q: params.get('q'),
      category: params.get('category'),
      gameId: params.get('gameId'),
      gameCategory: params.get('gameCategory'),
      serviceCategory: params.get('serviceCategory'),
      sellerId: params.get('sellerId'),
      sort: params.get('sort'),
      limit: params.get('limit'),
      offset: params.get('offset'),
      minPrice: params.get('minPrice'),
      maxPrice: params.get('maxPrice'),
    });
    return json(res, 200, { items });
  }

  if (req.method === 'GET' && path === '/api/market/games') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { games: await listGames({ all: await isAdmin(me) }) });
  }

  const gameCover = path.match(/^\/api\/market\/games\/(mg-[0-9a-f-]{36})\/cover$/);
  if (req.method === 'GET' && gameCover) {
    const mime = await gameCoverMime(gameCover[1]);
    if (!mime) return json(res, 404, { error: 'not_found' });
    return sendImage(res, gameCoverIdFor(gameCover[1]), mime);
  }

  /* ══ Товар ══════════════════════════════════════════════════════ */

  const productPath = path.match(/^\/api\/market\/products\/(mp-[0-9a-f-]{36})(\/[a-z]+)?$/);
  if (productPath) {
    const productId = productPath[1];
    const tail = productPath[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const product = await readProduct(productId, me);
      if (!product) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { product });
    }

    if (req.method === 'GET' && tail === '/reviews') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { reviews: await listReviews(productId, { limit: params.get('limit') }) });
    }

    if (req.method === 'PATCH' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const body = await parseBody(req);
      const done = await updateProduct(productId, me, body);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await archiveProduct(productId, me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    /* Пакеты услуги. Цену пакета решает продавец, а проверяет сервер:
       из запроса берутся только уровень, название, цена и срок. */
    if (req.method === 'PUT' && tail === '/packages') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const body = await parseBody(req);
      const done = await setServicePackages(productId, me, body.packages);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    /* Логотип товара: одна квадратная марка, отдельно от фотографий. */
    if (req.method === 'GET' && tail === '/logo') {
      const mime = await productLogoMime(productId, me);
      if (!mime) return json(res, 404, { error: 'not_found' });
      return sendImage(res, productLogoIdFor(productId), mime);
    }

    if (req.method === 'POST' && tail === '/logo') {
      if (!rateLimitPerHour(`mk:upload:${me}`, UPLOAD_PER_HOUR)) {
        return rejectBody(req, res, 429, { error: 'too_many_requests' });
      }
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_IMAGE_BYTES) {
        return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_IMAGE_BYTES });
      }
      const head = await peek(req, 32);
      const mime = sniff(head);
      if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_image' });

      const allowed = await setProductLogo(productId, me, mime);
      if (allowed.error) return rejectBody(req, res, CODES[allowed.error] ?? 400, allowed);

      req.resume();
      const saved = await saveStream(productLogoIdFor(productId), withHead(head, req), MAX_IMAGE_BYTES);
      if (saved.error) {
        await dropProductLogo(productId, me);
        return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
      }
      return json(res, 200, { ok: true, bytes: saved.bytes });
    }

    if (req.method === 'DELETE' && tail === '/logo') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      if (!(await dropProductLogo(productId, me))) return json(res, 404, { error: 'not_found' });
      await remove(productLogoIdFor(productId));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && tail === '/images') {
      if (!rateLimitPerHour(`mk:upload:${me}`, UPLOAD_PER_HOUR)) {
        return rejectBody(req, res, 429, { error: 'too_many_requests' });
      }
      /* Заявленный размер — слова клиента: по ним можно отказать
         сразу, но верить им нельзя, поэтому предел считается и по
         факту, по мере поступления байтов. */
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_IMAGE_BYTES) {
        return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_IMAGE_BYTES });
      }
      const head = await peek(req, 32);
      const mime = sniff(head);
      if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_image' });

      const added = await addProductImage(productId, me, mime);
      if (added.error) return rejectBody(req, res, CODES[added.error] ?? 400, added);

      req.resume();
      const saved = await saveStream(added.imageId, withHead(head, req), MAX_IMAGE_BYTES);
      if (saved.error) {
        await deleteProductImage(added.imageId, me);
        return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
      }
      return json(res, 200, { ok: true, imageId: added.imageId, bytes: saved.bytes });
    }
  }

  const imagePath = path.match(/^\/api\/market\/images\/(mpi-[0-9a-f-]{36})$/);
  if (imagePath) {
    if (req.method === 'GET') {
      const found = await readProductImage(imagePath[1], me);
      if (!found) return json(res, 404, { error: 'not_found' });
      return sendImage(res, imagePath[1], found.mime);
    }
    if (req.method === 'DELETE') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await deleteProductImage(imagePath[1], me);
      if (done.error) return fail(res, done);
      await remove(imagePath[1]);
      return json(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && path === '/api/market/products') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const body = await parseBody(req);
    const done = await createProduct(me, body);
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  /* ══ Избранное ══════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/market/favorites') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await listFavorites(me, { limit: params.get('limit') }) });
  }

  const favPath = path.match(/^\/api\/market\/favorites\/(mp-[0-9a-f-]{36})$/);
  if (favPath && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await setFavorite(me, favPath[1], req.method === 'POST');
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Продавец ═══════════════════════════════════════════════════ */

  if (path === '/api/market/seller') {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { seller: await readMySeller(me) });
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await createSeller(me, await parseBody(req));
      return done.error ? fail(res, done) : json(res, 201, done);
    }
    if (req.method === 'PATCH') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateSeller(me, await parseBody(req));
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* Подписка. Единственные деньги модуля — и они наши, за место на
     витрине, а не часть чьей-то сделки. */
  if (req.method === 'POST' && path === '/api/market/seller/subscription') {
    if (!rateLimitPerHour(`mk:sub:${me}`, 20)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const done = await paySellerSubscription(me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (req.method === 'POST' && path === '/api/market/seller/avatar') {
    if (!rateLimitPerHour(`mk:upload:${me}`, UPLOAD_PER_HOUR)) {
      return rejectBody(req, res, 429, { error: 'too_many_requests' });
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_IMAGE_BYTES) {
      return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_IMAGE_BYTES });
    }
    const head = await peek(req, 32);
    const mime = sniff(head);
    if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_image' });

    if (!(await setSellerAvatar(me, mime))) {
      return rejectBody(req, res, 403, { error: 'not_a_seller' });
    }
    req.resume();
    const saved = await saveStream(sellerAvatarIdFor(me), withHead(head, req), MAX_IMAGE_BYTES);
    if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
    return json(res, 200, { ok: true, bytes: saved.bytes });
  }

  if (req.method === 'GET' && path === '/api/market/seller/products') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      items: await listMyProducts(me, { limit: params.get('limit'), offset: params.get('offset') }),
    });
  }

  /* ══ Продвижение товара ═════════════════════════════════════════
     Плата Sky за своё же место на витрине — как подписка. К деньгам
     сделки отношения не имеет: те идут продавцу напрямую. */

  if (req.method === 'GET' && path === '/api/market/promotions') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      plans: Object.entries(PROMO_PLANS).map(([id, p]) => ({ id, ...p })),
      items: await listPromotions(me),
    });
  }

  if (req.method === 'POST' && path === '/api/market/promotions') {
    if (!rateLimitPerHour(`mk:promo:${me}`, 30)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const body = await parseBody(req);
    const done = await buyPromotion(me, body.productId, body.plan);
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  if (req.method === 'GET' && path === '/api/market/seller/stats') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const stats = await sellerStats(me);
    if (!stats) return json(res, 404, { error: 'not_a_seller' });
    return json(res, 200, { stats });
  }

  const sellerPath = path.match(/^\/api\/market\/sellers\/(acc-[0-9a-f-]{36})(\/avatar)?$/);
  if (req.method === 'GET' && sellerPath) {
    if (sellerPath[2]) {
      const mime = await sellerAvatarMime(sellerPath[1]);
      if (!mime) return json(res, 404, { error: 'not_found' });
      return sendImage(res, sellerAvatarIdFor(sellerPath[1]), mime);
    }
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const seller = await readSeller(sellerPath[1], me);
    if (!seller) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { seller });
  }

  /* ══ Справочники доставки ═══════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/market/pickup-points') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      points: await listPickupPoints({ city: params.get('city'), limit: params.get('limit') }),
    });
  }

  if (req.method === 'GET' && path === '/api/market/carriers') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { carriers: await listCarriers({ city: params.get('city') }) });
  }

  /* ══ Своя транспортная компания ═════════════════════════════════
     Компанию заводит администрация, но возит она сама: ей нужен свой
     список поручений и право двигать то, что она везёт. Состояние
     чужих отправлений отсюда не меняется — проверка внутри. */

  if (req.method === 'GET' && path === '/api/market/carrier') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { carriers: await listMyCarriers(me) });
  }

  if (req.method === 'GET' && path === '/api/market/carrier/shipments') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      shipments: await listCarrierShipments(me, { limit: params.get('limit') }),
    });
  }

  /* ══ Заказы ═════════════════════════════════════════════════════ */

  if (req.method === 'POST' && path === '/api/market/orders') {
    if (!rateLimitPerHour(`mk:order:${me}`, ORDER_PER_HOUR)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const done = await createOrder(me, await parseBody(req));
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  const supplyOrders = path.match(/^\/api\/market\/supplies\/(ls-[0-9a-f-]{36})\/orders$/);
  if (req.method === 'GET' && supplyOrders) {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await ordersInSupply(supplyOrders[1], me) });
  }

  if (req.method === 'GET' && path === '/api/market/orders') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const items = await listOrders(me, {
      side: params.get('side') === 'seller' ? 'seller' : 'buyer',
      status: params.get('status'),
      limit: params.get('limit'),
      offset: params.get('offset'),
    });
    return json(res, 200, { items });
  }

  const orderPath = path.match(/^\/api\/market\/orders\/(mo-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (orderPath) {
    const orderId = orderPath[1];
    const tail = orderPath[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const found = await accessOrder(orderId, me);
      if (!found) return json(res, 404, { error: 'not_found' });
      return json(res, 200, {
        order: toOrder(found.order, found.role),
        shipment: await readShipment(orderId, me),
        /* Куда переводить. Приходит с сервера, а не из переписки:
           реквизиты, присланные в чат, подменяет тот, кто в чат попал. */
        paymentDetails: await orderPaymentDetails(orderId, me),
      });
    }

    if (req.method === 'GET' && tail === '/history') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const events = await orderHistory(orderId, me);
      if (!events) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { events });
    }

    if (req.method === 'GET' && tail === '/shipment') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const shipment = await readShipment(orderId, me);
      if (!shipment) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { shipment });
    }

    if (req.method === 'GET' && tail === '/chat') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const found = await chatOfOrder(orderId, me);
      if (!found) return json(res, 404, { error: 'not_found' });
      return json(res, 200, await readChat(found.chat.id, me, { limit: params.get('limit') }));
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const body = await parseBody(req);

    /* Действие сделки. Клиент называет действие, а не новое состояние:
       состояние выбирает машина переходов по типу маркета и тому, где
       заказ сейчас. */
    if (tail === '/action') {
      const done = await actOnOrder(orderId, me, body.action, body);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (tail === '/cancel') {
      const done = await cancelOrder(orderId, me, body.reason);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (tail === '/dispute') {
      const done = await openDispute(orderId, me, body.reason);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (tail === '/resolve') {
      const done = await resolveDispute(orderId, me, body.outcome, body.note);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (tail === '/packing') {
      const done = await markPacking(orderId, me, body.done === true);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (tail === '/review') {
      const done = await leaveReview(orderId, me, body);
      return done.error ? fail(res, done) : json(res, 201, done);
    }
    /* Режим «через свой склад»: заказ кладётся в поставку, поставка
       едет на склад, а уже оттуда продавец везёт покупателю сам. */
    if (tail === '/supply') {
      const done = await putOrderInSupply(orderId, me, body.supplyId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (tail === '/ship') {
      const done = await shipOrder(orderId, me, body);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (tail === '/shipment-status') {
      const done = await sellerMoveShipment(orderId, me, body.status, body.note);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ══ Чат сделки ═════════════════════════════════════════════════
     Отдельная система. Ни один из этих путей не ведёт в мессенджер,
     и ни один чат мессенджера сюда не попадает.                    */

  if (req.method === 'GET' && path === '/api/market/chats') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { chats: await listChats(me, { limit: params.get('limit') }) });
  }

  if (req.method === 'GET' && path === '/api/market/unread') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { unread: await unreadCount(me) });
  }

  const chatPath = path.match(/^\/api\/market\/chats\/(mc-[0-9a-f-]{36})(\/[a-z]+)?$/);
  if (chatPath) {
    const chatId = chatPath[1];
    const tail = chatPath[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const found = await readChat(chatId, me, {
        limit: params.get('limit'), before: params.get('before'),
      });
      if (!found) return json(res, 404, { error: 'not_found' });
      return json(res, 200, found);
    }

    if (req.method === 'POST' && tail === '/messages') {
      if (!rateLimit(`mk:msg:${me}`, MESSAGE_PER_MIN)) {
        return json(res, 429, { error: 'too_many_requests' });
      }
      const body = await parseBody(req);
      const done = await sendMessage(chatId, me, body.text);
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'POST' && tail === '/read') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await markRead(chatId, me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Уведомления ════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/market/notifications') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await listNotifications(me, { limit: params.get('limit') }) });
  }

  if (req.method === 'POST' && path === '/api/market/notifications/read') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const body = await parseBody(req);
    if (body.all === true) return json(res, 200, { marked: await readAllNotifications(me) });
    return json(res, 200, { ok: await readNotification(me, body.id) });
  }

  /* ══ Администрация ══════════════════════════════════════════════
     Право проверяется внутри каждой из этих функций, а не здесь:
     проверка на входе — это ещё одно место, где её можно забыть.   */

  if (path.startsWith('/api/market/admin/')) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });

    if (req.method === 'POST' && path === '/api/market/admin/games') {
      const done = await createGame(me, await parseBody(req));
      return done.error ? fail(res, done) : json(res, 201, done);
    }
    const adminGame = path.match(/^\/api\/market\/admin\/games\/(mg-[0-9a-f-]{36})$/);
    if (req.method === 'PATCH' && adminGame) {
      const done = await updateGame(me, adminGame[1], await parseBody(req));
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    const adminCover = path.match(/^\/api\/market\/admin\/games\/(mg-[0-9a-f-]{36})\/cover$/);
    if (req.method === 'POST' && adminCover) {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_IMAGE_BYTES) {
        return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_IMAGE_BYTES });
      }
      const head = await peek(req, 32);
      const mime = sniff(head);
      if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_image' });
      if (!(await setGameCover(me, adminCover[1], mime))) {
        return rejectBody(req, res, 403, { error: 'not_allowed' });
      }
      req.resume();
      const saved = await saveStream(gameCoverIdFor(adminCover[1]), withHead(head, req), MAX_IMAGE_BYTES);
      if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
      return json(res, 200, { ok: true, bytes: saved.bytes });
    }
    if (req.method === 'POST' && path === '/api/market/admin/pickup-points') {
      const done = await upsertPickupPoint(me, await parseBody(req));
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && path === '/api/market/admin/carriers') {
      const done = await upsertCarrier(me, await parseBody(req));
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  return json(res, 404, { error: 'not_found' });
};
