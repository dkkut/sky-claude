/**
 * Логистика Sky Market по HTTP.
 *
 * Здесь только вход: кто спрашивает, не слишком ли часто и той ли формы
 * идентификатор. Кому что можно — решают logistics.mjs, warehouses.mjs,
 * passes.mjs и transportco.mjs.
 *
 * Чего этот файл не читает из запроса никогда:
 *   · кто спрашивает — это берётся из токена;
 *   · роль на складе и принадлежность компании — они берутся из базы;
 *   · чужой курьерский профиль — «на связи» и точку на карте каждый
 *     ставит только про себя.
 *
 * Денег через эти ручки не проходит вовсе: за доставку платят напрямую,
 * Sky её оплату не принимает и не хранит.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { ticketFromCookies } from './../marketticket.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  registerCourier, updateCourier, myCourier, setCourierPresence,
  listCouriers, readCourier, setCourierFavorite,
  sendCollab, respondCollab, listCollabs,
  courierChat, sendCourierMessage,
  assignCourier, setAssignmentStatus, listAssignments, reportAssignmentProblem,
  listLogiNotifications, readLogiNotification,
  addCourierReview, listCourierReviews,
  decideCourierApplication, setCourierAdminStatus, adminListCouriers,
  postOrderToPool, cancelPoolPosting, listOpenOrders, takeOrder,
  courierStats, courierEarningsHistory,
} from './../logistics.mjs';
import {
  setDateOfBirth, submitVerification, attachVerificationDoc, myVerification,
  decideVerification, verificationQueue, verificationDocBytes, MAX_DOC_BYTES,
} from './../courierverify.mjs';
import { confirmPickup, confirmDelivery } from './../courierdelivery.mjs';
import {
  listWarehouses, listSortingCenters, createWarehouse, updateWarehouse, deleteWarehouse,
  addWarehousePhoto, readWarehousePhoto, deleteWarehousePhoto,
  listStock, warehouseFill, setStock,
  listTransfers, createTransfer, advanceTransfer, cancelTransfer,
  listStaff, addStaff, removeStaff, listWarehouseLog,
} from './../warehouses.mjs';
import {
  listPasses, createPass, updatePass, deletePass, scanPass,
  listVisits, logPassSend, listPassSends,
  listSupplies, findSupplies, readSupply, createSupply, updateSupply,
  setSupplyStatus, setSupplyCenter, deleteSupply, listSupplyLog,
} from './../passes.mjs';
import {
  myCompany, createCompany, updateCompany, listCompanies, setCompanyVerified,
  listVehicles, addVehicle, setVehicleStatus, assignDriver, removeVehicle,
  setVehiclePosition,
  listTeam, addMember, toggleMember, removeMember,
  createTcOrder, listCompanyOrders, listSellerTcOrders, listExchange,
  acceptExchangeOrder, proposePrice, answerOffer, assignTcOrder,
  advanceTcOrder, cancelTcOrder,
  listTariffs, addTariff, removeTariff, listFinance,
  listCompanyWarehouses, linkCompanyWarehouse, unlinkCompanyWarehouse,
} from './../transportco.mjs';
import { saveStream, sizeOf, openStream, remove } from './../marketstore.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 60;
const MESSAGE_PER_MIN = 30;
const UPLOAD_PER_HOUR = 120;
/* Сканирование пропуска — то место, где подбирают код. Предел ниже
   остальных: живой человек прикладывает пропуск единицы раз в минуту. */
const SCAN_PER_MIN = 20;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const CODES = {
  not_found: 404,
  not_allowed: 403,
  no_collab: 403,
  not_a_courier: 403,
  no_company: 403,
  already_courier: 409,
  already_asked: 409,
  already_have_company: 409,
  already_taken: 409,
  already_closed: 409,
  already_in_progress: 409,
  wrong_state: 409,
  over_capacity: 409,
  not_enough_stock: 409,
  too_many_warehouses: 409,
  /* Внутри лежит чужой товар — это отказ, а не кривой запрос. */
  warehouse_rented: 409,
  too_many_photos: 409,
  too_heavy: 409,
  vehicle_unavailable: 409,
  order_closed: 409,
  owner_already: 409,
  same_warehouse: 409,
  self_collab: 409,
  no_such_user: 404,
  no_such_driver: 404,
  no_such_vehicle: 404,
  no_such_company: 404,
  target_not_found: 404,
  bad_position: 400,
  no_offer: 409,
  offer_taken: 409,
  underage: 403,
  passport_unverified: 403,
  not_approved: 403,
  suspended: 403,
  courier_not_approved: 403,
  no_document: 409,
  not_online: 409,
  bad_date: 400,
  already_pending: 409,
  unsupported_media: 415,
  too_large: 413,
  empty_file: 400,
  no_birth_date: 409,
  bad_code: 400,
  not_courier_shipment: 409,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

/* ─── Загрузка фотографий ──────────────────────────────────────────── */

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

const DRAIN_LIMIT = MAX_IMAGE_BYTES + 1024 * 1024;
const DRAIN_MS = 10_000;

/** Отказ, когда тело ещё идёт: остаток дочитываем, иначе клиент видит обрыв. */
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

const sendImage = async (res, fileId, mime) => {
  const size = await sizeOf(fileId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });
  res.writeHead(200, {
    'Content-Type': mime || 'image/jpeg',
    'Content-Length': String(size),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=600',
    // См. server/routes/film.mjs — пропуск в куке, без Vary браузер мог
    // бы отдать фото, закешированное под одним профилем, другому профилю
    // того же Sky ID в том же браузере.
    'Vary': 'Cookie',
  });
  const stream = openStream(fileId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

/* ═══ Маршруты ═════════════════════════════════════════════════════ */

export const logisticsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/logistics')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Фотографию склада браузер тянет тегом <img>, а заголовок туда не
     подставить — принимаем подписанный пропуск, как и в маркете. Права
     на саму фотографию всё равно проверяются по базе. */
  const isPicture = (req.method === 'GET' || req.method === 'HEAD')
    && /^\/api\/logistics\/photos\/lwp-[0-9a-f-]{36}$/.test(path);

  let me;
  if (isPicture) {
    const session = await readSession(req);
    me = session?.profileId ?? ticketFromCookies(req.headers.cookie);
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  const readOk = () => rateLimit(`lg:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`lg:w:${me}`, WRITE_PER_MIN);
  const body = async () => parseBody(req);

  /* ══ Курьеры ════════════════════════════════════════════════════ */

  if (path === '/api/logistics/courier/me') {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { courier: await myCourier(me) });
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await registerCourier(me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
    if (req.method === 'PATCH') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateCourier(me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* «На связи» и точка на карте — только про себя. */
  if (req.method === 'POST' && path === '/api/logistics/courier/presence') {
    if (!rateLimit(`lg:geo:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    const done = await setCourierPresence(me, await body());
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (req.method === 'GET' && path === '/api/logistics/couriers') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      couriers: await listCouriers(me, {
        cityId: params.get('cityId'),
        district: params.get('district'),
        vehicle: params.get('vehicle'),
        online: params.get('online') === '1',
        q: params.get('q'),
        limit: params.get('limit'),
      }),
    });
  }

  const courierPath = path.match(/^\/api\/logistics\/couriers\/(lc-[0-9a-f-]{36})(\/[a-z]+)?$/);
  if (courierPath) {
    const courierId = courierPath[1];
    const tail = courierPath[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const courier = await readCourier(courierId, me);
      if (!courier) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { courier });
    }

    if (req.method === 'GET' && tail === '/reviews') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { reviews: await listCourierReviews(courierId, { limit: params.get('limit') }) });
    }

    if (req.method === 'GET' && tail === '/chat') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const messages = await courierChat(courierId, me, params.get('sellerId'));
      if (messages === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { messages });
    }

    if (req.method === 'POST' && tail === '/chat') {
      if (!rateLimit(`lg:msg:${me}`, MESSAGE_PER_MIN)) {
        return json(res, 429, { error: 'too_many_requests' });
      }
      const b = await body();
      const done = await sendCourierMessage(courierId, me, b.text, b.sellerId);
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'POST' && tail === '/collab') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await sendCollab(me, courierId, (await body()).message);
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'POST' && tail === '/review') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await addCourierReview(me, courierId, b.rating, b.text);
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if ((req.method === 'POST' || req.method === 'DELETE') && tail === '/favorite') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await setCourierFavorite(me, courierId, req.method === 'POST');
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  if (req.method === 'GET' && path === '/api/logistics/collabs') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { collabs: await listCollabs(me) });
  }

  const collabPath = path.match(/^\/api\/logistics\/collabs\/(lcb-[0-9a-f-]{36})$/);
  if (req.method === 'POST' && collabPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await respondCollab(me, collabPath[1], (await body()).status);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (req.method === 'GET' && path === '/api/logistics/assignments') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      assignments: await listAssignments(me, { as: params.get('as') === 'courier' ? 'courier' : 'seller' }),
    });
  }

  if (req.method === 'POST' && path === '/api/logistics/assignments') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await assignCourier(me, b.orderId, b.courierId);
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  const assignPath = path.match(/^\/api\/logistics\/assignments\/(lca-[0-9a-f-]{36})(\/problem)?$/);
  if (req.method === 'POST' && assignPath && !assignPath[2]) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await setAssignmentStatus(me, assignPath[1], (await body()).status);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  if (req.method === 'POST' && assignPath && assignPath[2] === '/problem') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await reportAssignmentProblem(me, assignPath[1], (await body()).reason);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Пул заказов: продавец выставляет, курьер берёт сам ═══════════ */

  if (req.method === 'GET' && path === '/api/logistics/pool') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await listOpenOrders(me, { limit: params.get('limit') });
    return done?.error ? fail(res, done) : json(res, 200, { items: done });
  }

  const poolPath = path.match(/^\/api\/logistics\/pool\/(mo-[0-9a-f-]{36})(\/take)?$/);
  if (poolPath) {
    const orderId = poolPath[1];
    if (req.method === 'POST' && !poolPath[2]) {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await postOrderToPool(me, orderId, { priceKop: b.priceKop, cityId: b.cityId, district: b.district });
      return done.error ? fail(res, done) : json(res, 201, done);
    }
    if (req.method === 'DELETE' && !poolPath[2]) {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await cancelPoolPosting(me, orderId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && poolPath[2] === '/take') {
      if (!rateLimit(`lg:take:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      const done = await takeOrder(me, orderId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Получение от продавца / доставка покупателю ══════════════════ */

  const pickupPath = path.match(/^\/api\/logistics\/orders\/(mo-[0-9a-f-]{36})\/(courier-pickup|courier-delivery)$/);
  if (req.method === 'POST' && pickupPath) {
    if (!rateLimit(`lg:scan:${me}`, SCAN_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const proof = (await body()).proof;
    const done = pickupPath[2] === 'courier-pickup'
      ? await confirmPickup(me, pickupPath[1], proof)
      : await confirmDelivery(me, pickupPath[1], proof);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Возраст и проверка паспорта ═══════════════════════════════════ */

  if (req.method === 'POST' && path === '/api/logistics/courier/birthdate') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await setDateOfBirth(me, (await body()).dateOfBirth);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (path === '/api/logistics/courier/verification') {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { verification: await myVerification(me) });
    }
    if (req.method === 'POST') {
      if (!rateLimitPerHour(`lg:verify:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
      const done = await submitVerification(me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  const verifyDocPath = path.match(/^\/api\/logistics\/courier\/verification\/(cvr-[0-9a-f-]{36})\/doc$/);
  if (req.method === 'POST' && verifyDocPath) {
    if (!rateLimitPerHour(`lg:vdoc:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_DOC_BYTES) return rejectBody(req, res, 413, { error: 'too_large' });
    const chunks = [];
    let size = 0;
    let denied = false;
    await new Promise((resolve) => {
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_DOC_BYTES) { denied = true; req.pause(); return resolve(); }
        chunks.push(c);
      });
      req.once('end', resolve);
    });
    if (denied) return rejectBody(req, res, 413, { error: 'too_large' });
    const done = await attachVerificationDoc(verifyDocPath[1], me, Buffer.concat(chunks), req.headers['content-type']);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (req.method === 'GET' && path === '/api/logistics/courier/stats') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const stats = await courierStats(me);
    if (!stats) return json(res, 404, { error: 'not_a_courier' });
    return json(res, 200, { stats });
  }

  if (req.method === 'GET' && path === '/api/logistics/courier/earnings') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await courierEarningsHistory(me, { limit: params.get('limit') }) });
  }

  /* ══ Админка: заявки курьеров и проверка паспорта ═════════════════ */

  if (req.method === 'GET' && path === '/api/logistics/admin/couriers') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const items = await adminListCouriers(me, {
      status: params.get('status'), q: params.get('q'), limit: params.get('limit'),
    });
    if (items === null) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { items });
  }

  const adminCourierPath = path.match(/^\/api\/logistics\/admin\/couriers\/(lc-[0-9a-f-]{36})\/(decide|status)$/);
  if (req.method === 'POST' && adminCourierPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = adminCourierPath[2] === 'decide'
      ? await decideCourierApplication(me, adminCourierPath[1], Boolean(b.approve), b.reason)
      : await setCourierAdminStatus(me, adminCourierPath[1], b.status, b.reason);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (req.method === 'GET' && path === '/api/logistics/admin/verification-queue') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const items = await verificationQueue(me, { limit: params.get('limit') });
    if (items === null) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { items });
  }

  const adminVerifyPath = path.match(/^\/api\/logistics\/admin\/verification\/(cvr-[0-9a-f-]{36})(\/decide|\/doc)?$/);
  if (adminVerifyPath) {
    if (req.method === 'POST' && adminVerifyPath[2] === '/decide') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await decideVerification(adminVerifyPath[1], me, Boolean(b.approve), b.reason);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'GET' && adminVerifyPath[2] === '/doc') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const doc = await verificationDocBytes(adminVerifyPath[1], me);
      if (!doc) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, {
        'Content-Type': doc.mime,
        'Content-Length': doc.data.length,
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      return res.end(doc.data);
    }
  }

  if (req.method === 'GET' && path === '/api/logistics/notifications') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await listLogiNotifications(me, { limit: params.get('limit') }) });
  }

  if (req.method === 'POST' && path === '/api/logistics/notifications/read') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { ok: await readLogiNotification(me, (await body()).id) });
  }

  /* ══ Склады ═════════════════════════════════════════════════════ */

  if (path === '/api/logistics/warehouses') {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { warehouses: await listWarehouses(me) });
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await createWarehouse(me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  if (req.method === 'GET' && path === '/api/logistics/sorting-centers') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { centers: await listSortingCenters() });
  }

  const whPath = path.match(/^\/api\/logistics\/warehouses\/(lw-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (whPath) {
    const warehouseId = whPath[1];
    const tail = whPath[2] ?? '';

    if (req.method === 'PATCH' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateWarehouse(warehouseId, me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'DELETE' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await deleteWarehouse(warehouseId, me);
      if (done.error) return fail(res, done);
      for (const id of done.photos ?? []) await remove(id);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && tail === '/stock') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const stock = await listStock(warehouseId, me);
      if (stock === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { stock, fill: await warehouseFill(warehouseId, me) });
    }
    if (req.method === 'POST' && tail === '/stock') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await setStock(warehouseId, me, b.productId, b.productTitle, b.quantity);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    if (req.method === 'GET' && tail === '/transfers') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const transfers = await listTransfers(warehouseId, me);
      if (transfers === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { transfers });
    }

    if (req.method === 'GET' && tail === '/staff') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const staff = await listStaff(warehouseId, me);
      if (staff === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { staff });
    }
    if (req.method === 'POST' && tail === '/staff') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await addStaff(warehouseId, me, b.username, b.role);
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'GET' && tail === '/log') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const entries = await listWarehouseLog(warehouseId, me, { limit: params.get('limit') });
      if (entries === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { entries });
    }

    if (req.method === 'GET' && tail === '/passes') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const passes = await listPasses(warehouseId, me);
      if (passes === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { passes });
    }
    if (req.method === 'POST' && tail === '/passes') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await createPass(warehouseId, me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'GET' && tail === '/visits') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const visits = await listVisits(warehouseId, me, {
        passId: params.get('passId'), limit: params.get('limit') });
      if (visits === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { visits });
    }

    /* Сканирование: свой предел, ниже остальных. Это то место, где
       подбирают код от чужого склада. */
    if (req.method === 'POST' && tail === '/scan') {
      if (!rateLimit(`lg:scan:${me}`, SCAN_PER_MIN)) {
        return json(res, 429, { error: 'too_many_requests' });
      }
      const result = await scanPass((await body()).code, me, warehouseId);
      return json(res, 200, result);
    }

    if (req.method === 'POST' && tail === '/photos') {
      if (!rateLimitPerHour(`lg:upload:${me}`, UPLOAD_PER_HOUR)) {
        return rejectBody(req, res, 429, { error: 'too_many_requests' });
      }
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_IMAGE_BYTES) {
        return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_IMAGE_BYTES });
      }
      const head = await peek(req, 32);
      const mime = sniff(head);
      if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_image' });

      const added = await addWarehousePhoto(warehouseId, me, mime);
      if (added.error) return rejectBody(req, res, CODES[added.error] ?? 400, added);

      req.resume();
      const saved = await saveStream(added.photoId, withHead(head, req), MAX_IMAGE_BYTES);
      if (saved.error) {
        await deleteWarehousePhoto(added.photoId, me);
        return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
      }
      return json(res, 200, { ok: true, photoId: added.photoId, bytes: saved.bytes });
    }
  }

  const photoPath = path.match(/^\/api\/logistics\/photos\/(lwp-[0-9a-f-]{36})$/);
  if (photoPath) {
    if (req.method === 'GET') {
      const found = await readWarehousePhoto(photoPath[1], me);
      if (!found) return json(res, 404, { error: 'not_found' });
      return sendImage(res, photoPath[1], found.mime);
    }
    if (req.method === 'DELETE') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await deleteWarehousePhoto(photoPath[1], me);
      if (done.error) return fail(res, done);
      await remove(photoPath[1]);
      return json(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && path === '/api/logistics/transfers') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await createTransfer(me, await body());
    return done.error ? fail(res, done) : json(res, 201, done);
  }

  const transferPath = path.match(/^\/api\/logistics\/transfers\/(lt-[0-9a-f-]{36})\/([a-z]+)$/);
  if (req.method === 'POST' && transferPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = transferPath[2] === 'advance'
      ? await advanceTransfer(transferPath[1], me)
      : transferPath[2] === 'cancel'
        ? await cancelTransfer(transferPath[1], me)
        : { error: 'not_found' };
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  const staffPath = path.match(/^\/api\/logistics\/staff\/(lws-[0-9a-f-]{36})$/);
  if (req.method === 'DELETE' && staffPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await removeStaff(staffPath[1], me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Пропуска ═══════════════════════════════════════════════════ */

  const passPath = path.match(/^\/api\/logistics\/passes\/(lp-[0-9a-f-]{36})(\/[a-z]+)?$/);
  if (passPath) {
    const passId = passPath[1];
    const tail = passPath[2] ?? '';

    if (req.method === 'PATCH' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updatePass(passId, me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'DELETE' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await deletePass(passId, me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'GET' && tail === '/sends') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const sends = await listPassSends(passId, me);
      if (sends === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { sends });
    }
    if (req.method === 'POST' && tail === '/send') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await logPassSend(passId, me, b.channel, b.target);
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  /* ══ Поставки ═══════════════════════════════════════════════════ */

  if (path === '/api/logistics/supplies') {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const q = params.get('q');
      return json(res, 200, {
        supplies: q ? await findSupplies(me, q) : await listSupplies(me, { limit: params.get('limit') }),
      });
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await createSupply(me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  const supplyPath = path.match(/^\/api\/logistics\/supplies\/(ls-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (supplyPath) {
    const supplyId = supplyPath[1];
    const tail = supplyPath[2] ?? '';

    if (req.method === 'GET' && tail === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const supply = await readSupply(supplyId, me);
      if (!supply) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { supply });
    }
    if (req.method === 'GET' && tail === '/log') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const entries = await listSupplyLog(supplyId, me);
      if (entries === null) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { entries });
    }
    if (req.method === 'PATCH' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateSupply(supplyId, me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'DELETE' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await deleteSupply(supplyId, me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/status') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await setSupplyStatus(supplyId, me, (await body()).status);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/sorting-center') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await setSupplyCenter(supplyId, me, (await body()).sortingCenterId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ══ Транспортные компании ══════════════════════════════════════ */

  if (path === '/api/logistics/company') {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { company: await myCompany(me) });
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await createCompany(me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  if (req.method === 'GET' && path === '/api/logistics/companies') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, {
      companies: await listCompanies(me, { city: params.get('city'), limit: params.get('limit') }),
    });
  }

  if (req.method === 'GET' && path === '/api/logistics/exchange') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const orders = await listExchange(me);
    if (orders === null) return json(res, 403, { error: 'no_company' });
    return json(res, 200, { orders });
  }

  const companyPath = path.match(/^\/api\/logistics\/companies\/(ltc-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (companyPath) {
    const companyId = companyPath[1];
    const tail = companyPath[2] ?? '';
    const listOr404 = (data, key) =>
      data === null ? json(res, 404, { error: 'not_found' }) : json(res, 200, { [key]: data });

    if (req.method === 'PATCH' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateCompany(companyId, me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/verify') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await setCompanyVerified(me, companyId, (await body()).verified === true);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    if (req.method === 'GET' && tail === '/vehicles') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return listOr404(await listVehicles(companyId, me), 'vehicles');
    }
    if (req.method === 'POST' && tail === '/vehicles') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await addVehicle(companyId, me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'GET' && tail === '/team') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return listOr404(await listTeam(companyId, me), 'team');
    }
    if (req.method === 'POST' && tail === '/team') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await addMember(companyId, me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'GET' && tail === '/orders') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return listOr404(await listCompanyOrders(companyId, me), 'orders');
    }

    if (req.method === 'GET' && tail === '/tariffs') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return listOr404(await listTariffs(companyId, me), 'tariffs');
    }
    if (req.method === 'POST' && tail === '/tariffs') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await addTariff(companyId, me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'GET' && tail === '/finance') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return listOr404(await listFinance(companyId, me), 'entries');
    }

    if (req.method === 'GET' && tail === '/warehouses') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return listOr404(await listCompanyWarehouses(companyId, me), 'warehouses');
    }
    if (req.method === 'POST' && tail === '/warehouses') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await linkCompanyWarehouse(companyId, me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  const vehiclePath = path.match(/^\/api\/logistics\/vehicles\/(ltv-[0-9a-f-]{36})(\/[a-z]+)?$/);
  if (vehiclePath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const vehicleId = vehiclePath[1];
    const tail = vehiclePath[2] ?? '';
    if (req.method === 'POST' && tail === '/status') {
      const done = await setVehicleStatus(vehicleId, me, (await body()).status);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && tail === '/driver') {
      const done = await assignDriver(vehicleId, me, (await body()).driverId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    /* Где машина сейчас. Только за свою: чужую на карте не подвинешь. */
    if (req.method === 'POST' && tail === '/position') {
      const done = await setVehiclePosition(vehicleId, me, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'DELETE' && tail === '') {
      const done = await removeVehicle(vehicleId, me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  const memberPath = path.match(/^\/api\/logistics\/members\/(ltm-[0-9a-f-]{36})(\/[a-z]+)?$/);
  if (memberPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'POST' && memberPath[2] === '/toggle') {
      const done = await toggleMember(memberPath[1], me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'DELETE' && (memberPath[2] ?? '') === '') {
      const done = await removeMember(memberPath[1], me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  const tariffPath = path.match(/^\/api\/logistics\/tariffs\/(ltt-[0-9a-f-]{36})$/);
  if (req.method === 'DELETE' && tariffPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await removeTariff(tariffPath[1], me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  const linkPath = path.match(/^\/api\/logistics\/company-warehouses\/(ltw-[0-9a-f-]{36})$/);
  if (req.method === 'DELETE' && linkPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await unlinkCompanyWarehouse(linkPath[1], me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ══ Заказы на доставку ═════════════════════════════════════════ */

  if (path === '/api/logistics/delivery-orders') {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { orders: await listSellerTcOrders(me) });
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await createTcOrder(me, await body());
      return done.error ? fail(res, done) : json(res, 201, done);
    }
  }

  const tcOrderPath = path.match(/^\/api\/logistics\/delivery-orders\/(lto-[0-9a-f-]{36})\/([a-z-]+)$/);
  if (req.method === 'POST' && tcOrderPath) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const orderId = tcOrderPath[1];
    const action = tcOrderPath[2];
    const b = await body();
    const done =
      action === 'accept' ? await acceptExchangeOrder(orderId, me)
        : action === 'propose' ? await proposePrice(orderId, me, b.price)
          : action === 'offer' ? await answerOffer(orderId, me, b.approve === true)
            : action === 'assign' ? await assignTcOrder(orderId, me, b.vehicleId, b.driverId)
              : action === 'advance' ? await advanceTcOrder(orderId, me)
                : action === 'cancel' ? await cancelTcOrder(orderId, me)
                  : { error: 'not_found' };
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  return json(res, 404, { error: 'not_found' });
};
