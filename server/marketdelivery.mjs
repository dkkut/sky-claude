/**
 * Доставка обычного маркета.
 *
 * Игровой маркет сюда не заходит вообще: там нечего везти, и попытка
 * создать отправление по игровому заказу отклоняется.
 *
 * Четыре способа довезти товар, и все четыре настоящие:
 *
 *   служба → пункт выдачи      покупатель забирает сам, есть трек
 *   служба → адрес покупателя  курьер довозит до двери, есть трек
 *   продавец сам → пункт выдачи   продавец сдаёт товар в пункт выдачи
 *   продавец сам → адрес покупателя продавец везёт лично
 *
 * Разница между «службой» и «сам» не в названии, а в том, откуда
 * берётся состояние посылки. У службы оно приходит вебхуком от самой
 * службы и ею же подтверждается. Когда продавец везёт сам, состояние
 * двигает продавец руками — и это честно отмечено в журнале заказа как
 * его действие, а не как событие перевозчика.
 *
 * Чего здесь нет: приёма трек-номера и состояния от клиента. Трек
 * выдаёт перевозчик при создании отправления, состояние приходит от
 * перевозчика. Присланный из браузера tracking или status не читается
 * ни в одной ветке — подменённый трек означает чужую посылку, выданную
 * за свою, а подменённое состояние означает «доставлено» без доставки.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { config } from './config.mjs';
import { isAdmin } from './admin.mjs';
import { logMarket, marketText as text, marketInt as int, ORDER_ID_RE, fulfilmentOf } from './market.mjs';
import { decryptContent } from './crypto.mjs';
import { applyTransition, toOrder } from './marketorders.mjs';
import { systemMessage } from './marketchat.mjs';
import { pushMarket } from './signal.mjs';

const CARRIER_ID_RE = /^mcr-[0-9a-f-]{36}$/;
const POINT_ID_RE = /^mpp-[0-9a-f-]{36}$/;

const METHODS = ['carrier', 'seller_self'];
const DESTINATIONS = ['pickup_point', 'buyer_address'];

/**
 * Состояния перевозчика, которые мы понимаем, и во что они переводят
 * заказ.
 *
 * Список закрытый. Незнакомое состояние записывается в журнал событий
 * отправления, но заказ не двигает: «перевозчик прислал слово, которого
 * мы не знаем» — не повод считать товар доставленным.
 */
const CARRIER_STATUS = {
  accepted:         { shipment: 'accepted',         order: 'seller_shipped' },
  in_transit:       { shipment: 'in_transit',       order: 'in_transit' },
  arrived:          { shipment: 'ready_for_pickup', order: 'ready_for_pickup' },
  ready_for_pickup: { shipment: 'ready_for_pickup', order: 'ready_for_pickup' },
  delivered:        { shipment: 'delivered',        order: null },
  returned:         { shipment: 'returned',         order: null },
  lost:             { shipment: 'lost',             order: null },
};

/**
 * Порядок состояний посылки.
 *
 * Нужен, чтобы запоздавшее событие не откатывало заказ назад. Вебхуки
 * приходят не в том порядке, в каком происходили события, и «выехал со
 * склада», доставленный после «приехал в пункт выдачи», не должен
 * отправлять посылку обратно в путь.
 */
const SHIPMENT_RANK = {
  created: 0, accepted: 1, in_transit: 2, ready_for_pickup: 3,
  delivered: 4, returned: 4, lost: 4,
};

/* ─── Справочники ──────────────────────────────────────────────────── */

export const listPickupPoints = async ({ city, limit } = {}) => {
  const lim = int(limit, 1, 200) ?? 100;
  const args = [lim];
  let where = 'active';
  if (city) { args.unshift(text(city, 80)); where += ' AND city = $1'; }
  const { rows } = await query(
    `SELECT id, title, city, address, phone, work_from, work_to, hold_days
       FROM market_pickup_points WHERE ${where}
      ORDER BY city, title LIMIT $${args.length}`, args);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    city: r.city,
    address: r.address,
    phone: r.phone,
    workFrom: r.work_from,
    workTo: r.work_to,
    holdDays: Number(r.hold_days),
  }));
};

export const listCarriers = async ({ city } = {}) => {
  const args = [];
  let where = 'active';
  if (city) { args.push(text(city, 80)); where += ` AND (city = '' OR city = $${args.length})`; }
  const { rows } = await query(
    `SELECT id, kind, code, title, city, min_price_kop, price_per_km_kop,
            max_weight_g, eta_hours, rating
       FROM market_carriers WHERE ${where} ORDER BY kind, title`, args);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    code: r.code,
    title: r.title,
    city: r.city,
    minPriceKop: Number(r.min_price_kop),
    minPrice: Number(r.min_price_kop) / 100,
    pricePerKmKop: Number(r.price_per_km_kop),
    maxWeightG: Number(r.max_weight_g),
    etaHours: Number(r.eta_hours),
    rating: r.rating === null ? null : Number(r.rating),
  }));
};

/* ─── Создание отправления ─────────────────────────────────────────── */

/**
 * Трек-номер внешнего перевозчика.
 *
 * У настоящего перевозчика он приходит ответом на создание отправления
 * в его системе. Пока такого договора нет, номер выдаёт сервер — но
 * именно сервер, а не клиент: от браузера трек не принимается ни при
 * каких условиях.
 */
const issueTracking = (code) => {
  const prefix = { cdek: 'CD', fivepost: 'FP', russianpost: 'RP' }[code] ?? 'SK';
  return `${prefix}${crypto.randomInt(10_000_000, 99_999_999)}`;
};

/**
 * Продавец отправляет заказ.
 *
 * Из запроса берутся только способ, назначение, служба и пункт выдачи —
 * то есть выбор из наших же справочников. Всё остальное сервер решает
 * сам.
 */
export const shipOrder = async (orderId, sellerId, input = {}) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };

  const method = METHODS.includes(String(input.method)) ? String(input.method) : null;
  const destination = DESTINATIONS.includes(String(input.destination))
    ? String(input.destination) : null;
  if (!method || !destination) return { error: 'bad_method' };

  const carrierId = text(input.carrierId, 80) || null;
  const pointId = text(input.pickupPointId, 80) || null;

  if (method === 'carrier' && !CARRIER_ID_RE.test(carrierId ?? '')) return { error: 'bad_carrier' };
  if (method === 'seller_self' && carrierId) return { error: 'bad_carrier' };
  if (destination === 'pickup_point' && !POINT_ID_RE.test(pointId ?? '')) return { error: 'bad_pickup_point' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (order.seller_id !== sellerId) {
      await client.query('ROLLBACK');
      await logMarket(sellerId, 'ship_denied', id);
      return { error: 'not_found' };
    }
    /* Игровому заказу везти нечего. */
    if (order.market_type !== 'standard') {
      await client.query('ROLLBACK');
      return { error: 'not_applicable' };
    }
    if (order.status !== 'fulfillment') {
      await client.query('ROLLBACK');
      return { error: 'wrong_state', status: order.status };
    }

    /*
     * Режим работы магазина решает, откуда едет заказ.
     *
     * Через свой склад — значит заказ сперва доезжает туда поставкой, и
     * только оттуда идёт покупателю своими силами. Пока он не на
     * складе, отправлять нечего: коробка ещё у продавца. И службу тут
     * выбрать нельзя — со склада продавец везёт сам, с тем же
     * подтверждением получения от покупателя.
     */
    const how = await fulfilmentOf(order.seller_id);
    if (how.mode === 'warehouse') {
      if (!order.at_warehouse_at) {
        await client.query('ROLLBACK');
        return { error: order.supply_id ? 'supply_not_arrived' : 'not_in_supply' };
      }
      if (method !== 'seller_self' || destination !== 'buyer_address') {
        await client.query('ROLLBACK');
        return { error: 'warehouse_ships_itself' };
      }
    }

    const { rows: has } = await client.query(
      'SELECT order_id FROM market_shipments WHERE order_id = $1', [id]);
    if (has[0]) { await client.query('ROLLBACK'); return { error: 'already_shipped' }; }

    let carrier = null;
    if (method === 'carrier') {
      const { rows: c } = await client.query(
        'SELECT * FROM market_carriers WHERE id = $1 AND active', [carrierId]);
      carrier = c[0];
      if (!carrier) { await client.query('ROLLBACK'); return { error: 'bad_carrier' }; }
    }

    let point = null;
    if (destination === 'pickup_point') {
      const { rows: p } = await client.query(
        'SELECT * FROM market_pickup_points WHERE id = $1 AND active', [pointId]);
      point = p[0];
      if (!point) { await client.query('ROLLBACK'); return { error: 'bad_pickup_point' }; }
    }
    /* Везти на адрес можно только если адрес есть. */
    if (destination === 'buyer_address' && !order.address_enc) {
      await client.query('ROLLBACK');
      return { error: 'no_address' };
    }

    /* Трек есть только у внешней службы: у своей компании и у «везу сам»
       отслеживать нечего. */
    const tracking = carrier?.kind === 'external' ? issueTracking(carrier.code) : null;
    const eta = carrier
      ? new Date(Date.now() + Number(carrier.eta_hours) * 3600_000)
      : null;

    await client.query(
      `INSERT INTO market_shipments
         (order_id, method, destination, carrier_id, pickup_point_id, tracking,
          status, status_text, eta)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted',$7,$8)`,
      [id, method, destination, carrier?.id ?? null, point?.id ?? null, tracking,
        method === 'carrier' ? 'Принято перевозчиком' : 'Продавец везёт сам', eta]);

    const extraSets = [];
    const extraArgs = [];
    if (point) {
      extraSets.push('pickup_point_id = $$', 'pickup_until = $$');
      extraArgs.push(point.id, new Date(Date.now() + Number(point.hold_days) * 86400_000));
    }

    const { row, notes } = await applyTransition(client, order, {
      to: 'seller_shipped', actorId: sellerId, actorRole: 'seller',
      detail: { method, destination, carrier: carrier?.title ?? null, hasTracking: Boolean(tracking) },
      extraSets, extraArgs,
    });

    await client.query('COMMIT');
    for (const n of notes) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
    await systemMessage(id, method === 'carrier'
      ? `Заказ передан в доставку: ${carrier.title}${tracking ? `, трек ${tracking}` : ''}.`
      : 'Продавец повезёт заказ сам.');
    await logMarket(sellerId, 'order_shipped', id, { method, destination });
    return { order: toOrder(row, 'seller'), shipment: await readShipment(id, sellerId) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Чтение отправления ───────────────────────────────────────────── */

/**
 * Отправление глазами стороны сделки.
 *
 * Посторонний не получает ничего — ровно как на несуществующий заказ:
 * по треку чужой посылки видно и маршрут, и пункт выдачи.
 */
export const readShipment = async (orderId, viewerId) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return null;
  const { rows } = await query(
    `SELECT s.*, o.buyer_id, o.seller_id, o.pickup_until,
            c.owner_id AS carrier_owner,
            c.title AS carrier_title, c.kind AS carrier_kind, c.code AS carrier_code,
            p.title AS point_title, p.city AS point_city, p.address AS point_address,
            p.work_from, p.work_to
       FROM market_shipments s
       JOIN market_orders o ON o.id = s.order_id
       LEFT JOIN market_carriers c ON c.id = s.carrier_id
       LEFT JOIN market_pickup_points p ON p.id = s.pickup_point_id
      WHERE s.order_id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  /* Видят стороны сделки, поддержка и та компания, которая эту
     посылку везёт: без этого она не знает, куда и что ей поручили. */
  const mine = row.buyer_id === viewerId || row.seller_id === viewerId
    || (row.carrier_kind === 'inhouse' && row.carrier_owner === viewerId);
  if (!mine && !(await isAdmin(viewerId))) {
    await logMarket(viewerId, 'shipment_access_denied', id);
    return null;
  }
  return {
    orderId: row.order_id,
    method: row.method,
    destination: row.destination,
    carrier: row.carrier_title ? {
      title: row.carrier_title, kind: row.carrier_kind, code: row.carrier_code,
    } : null,
    pickupPoint: row.point_title ? {
      title: row.point_title, city: row.point_city, address: row.point_address,
      workFrom: row.work_from, workTo: row.work_to,
    } : null,
    tracking: row.tracking ?? null,
    status: row.status,
    statusText: row.status_text,
    location: row.location ?? null,
    eta: row.eta?.toISOString?.() ?? null,
    pickupUntil: row.pickup_until?.toISOString?.() ?? null,
    updatedAt: row.updated_at?.toISOString?.() ?? undefined,
  };
};

/**
 * Что везёт моя транспортная компания.
 *
 * Своей компании нужен список поручений — иначе двигать посылки она
 * может, но не знает какие. Адрес и телефон покупателя здесь
 * расшифровываются: везти без адреса нельзя, а компания уже назначена
 * на это отправление продавцом.
 */
export const listCarrierShipments = async (ownerId, { limit } = {}) => {
  const lim = int(limit, 1, 200) ?? 100;
  const { rows } = await query(
    `SELECT s.order_id, s.status, s.status_text, s.destination, s.eta,
            o.title_snap, o.status AS order_status, o.address_enc, o.contact_enc,
            o.pickup_until,
            c.title AS carrier_title,
            p.title AS point_title, p.city AS point_city, p.address AS point_address
       FROM market_shipments s
       JOIN market_carriers c ON c.id = s.carrier_id
       JOIN market_orders o ON o.id = s.order_id
       LEFT JOIN market_pickup_points p ON p.id = s.pickup_point_id
      WHERE c.kind = 'inhouse' AND c.owner_id = $1
        AND o.status NOT IN ('completed', 'cancelled')
      ORDER BY s.created_at DESC LIMIT $2`,
    [ownerId, lim]);
  return rows.map((r) => ({
    orderId: r.order_id,
    title: r.title_snap,
    orderStatus: r.order_status,
    status: r.status,
    statusText: r.status_text,
    destination: r.destination,
    carrier: r.carrier_title,
    address: r.destination === 'buyer_address' ? (r.address_enc ? (decryptContent(r.address_enc) ?? '') : '') : '',
    contact: r.contact_enc ? (decryptContent(r.contact_enc) ?? '') : '',
    pickupPoint: r.point_title
      ? { title: r.point_title, city: r.point_city, address: r.point_address }
      : null,
    pickupUntil: r.pickup_until?.toISOString?.() ?? null,
    eta: r.eta?.toISOString?.() ?? null,
  }));
};

/** Свои транспортные компании — чтобы кабинет знал, есть ли они вообще. */
export const listMyCarriers = async (ownerId) => {
  const { rows } = await query(
    `SELECT id, title, city, active, eta_hours, min_price_kop
       FROM market_carriers WHERE kind = 'inhouse' AND owner_id = $1
      ORDER BY title`, [ownerId]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    city: r.city,
    active: Boolean(r.active),
    etaHours: Number(r.eta_hours),
    minPrice: Number(r.min_price_kop) / 100,
  }));
};

/* ─── Движение посылки ─────────────────────────────────────────────── */

/**
 * Перевести посылку в новое состояние.
 *
 * Общая дорога для вебхука перевозчика и для продавца, который везёт
 * сам. Отличаются они только тем, кто записан в журнале действующим
 * лицом, — сами правила перехода одни и те же.
 */
const moveShipment = async (client, order, shipment, key, { actorId, actorRole, detail = {} }) => {
  const map = CARRIER_STATUS[key];
  if (!map) return { error: 'unknown_status' };

  /* Запоздавшее событие назад не тянет. */
  if ((SHIPMENT_RANK[map.shipment] ?? 0) <= (SHIPMENT_RANK[shipment.status] ?? 0)) {
    return { stale: true };
  }

  await client.query(
    `UPDATE market_shipments
        SET status = $2, status_text = $3, location = COALESCE($4, location), updated_at = now()
      WHERE order_id = $1`,
    [order.id, map.shipment, text(detail.statusText, 200) || map.shipment,
      text(detail.location, 200) || null]);

  /* В пункт выдачи посылка приезжает, на адрес — едет до самой двери.
     Состояние ready_for_pickup для доставки на адрес бессмысленно. */
  let to = map.order;
  if (to === 'ready_for_pickup' && shipment.destination !== 'pickup_point') to = 'in_transit';
  if (!to) return { ok: true };
  if (to === order.status) return { ok: true };

  const ORDER_RANK = {
    fulfillment: 0, seller_shipped: 1, in_transit: 2, ready_for_pickup: 3,
    buyer_received: 4, completed: 5,
  };
  if ((ORDER_RANK[to] ?? -1) <= (ORDER_RANK[order.status] ?? -1)) return { ok: true };

  const { row, notes } = await applyTransition(client, order, {
    to, actorId, actorRole, detail: { ...detail, shipmentStatus: map.shipment },
  });
  return { ok: true, row, notes };
};

/**
 * Состояние посылки двигают руками — но не кто угодно и не у любой.
 *
 * Двигать может только тот, кто её реально везёт:
 *
 *   · продавец — когда везёт сам (method = 'seller_self');
 *   · владелец своей транспортной компании — когда посылку везёт его
 *     компания (carrier.kind = 'inhouse').
 *
 * У внешней службы состояние приходит вебхуком от неё самой, и руками
 * его не ставит никто: «доставлено» без доставки — это ровно то, ради
 * чего подписывают вебхуки.
 *
 * Своей компании вебхука взять неоткуда, поэтому руки — её
 * единственный способ отчитаться. Без этого её отправления застревали
 * бы на «принято» навсегда.
 */
export const moveShipmentByHand = async (orderId, actorId, key, note = '') => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  if (!['in_transit', 'arrived', 'ready_for_pickup'].includes(String(key))) {
    return { error: 'bad_status' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.*, s.method, s.destination, s.status AS shipment_status,
              c.kind AS carrier_kind, c.owner_id AS carrier_owner
         FROM market_orders o
         JOIN market_shipments s ON s.order_id = o.id
         LEFT JOIN market_carriers c ON c.id = s.carrier_id
        WHERE o.id = $1 FOR UPDATE OF o`, [id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const bySeller = order.method === 'seller_self' && order.seller_id === actorId;
    const byInhouse = order.carrier_kind === 'inhouse' && order.carrier_owner === actorId;

    if (!bySeller && !byInhouse) {
      await client.query('ROLLBACK');
      /* Стороне сделки говорим, почему нельзя; постороннему — что
         такого заказа нет. Разница в ответах сама по себе
         рассказывает, чей это заказ. */
      if (order.seller_id === actorId || order.buyer_id === actorId) {
        await logMarket(actorId, 'shipment_move_denied', id);
        return { error: 'carrier_owns_status' };
      }
      await logMarket(actorId, 'shipment_move_denied', id);
      return { error: 'not_found' };
    }

    const moved = await moveShipment(client,
      order,
      { status: order.shipment_status, destination: order.destination },
      String(key),
      {
        actorId,
        actorRole: bySeller ? 'seller' : 'system',
        detail: { statusText: text(note, 200), byCarrier: byInhouse },
      });
    if (moved.error) { await client.query('ROLLBACK'); return moved; }
    if (moved.stale) { await client.query('ROLLBACK'); return { error: 'stale_status' }; }

    await client.query('COMMIT');
    for (const n of moved.notes ?? []) {
      pushMarket([n.userId], { type: 'market-notification', payload: n.note });
    }
    await logMarket(actorId, 'shipment_moved', id, { to: String(key), byCarrier: byInhouse });
    return { ok: true, shipment: await readShipment(id, actorId) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Прежнее имя: им зовут ту же дверь маршруты продавца. */
export const sellerMoveShipment = moveShipmentByHand;

/* ─── Вебхуки перевозчиков ─────────────────────────────────────────── */

/**
 * Подпись уведомления.
 *
 * Сравнение постоянного времени: обычное сравнение строк отвечает тем
 * быстрее, чем раньше разошлись байты, и по этому времени подпись
 * подбирается посимвольно.
 */
const signatureOk = (code, raw, given) => {
  const secret = config.marketWebhookSecrets[code] ?? '';
  /* Перевозчик без секрета не подключён. Пустой секрет не должен
     означать «любая подпись подходит». */
  if (!secret) return false;
  const want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const got = String(given ?? '').trim().toLowerCase();
  if (got.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(want, 'utf8'), Buffer.from(got, 'utf8'));
  } catch {
    return false;
  }
};

/**
 * Уведомление перевозчика.
 *
 * Проверяется по порядку, и каждая проверка обязательна:
 *
 *   1. перевозчик из закрытого списка — под каждого нужен свой разбор;
 *   2. подпись тела его секретом — иначе уведомление шлёт кто угодно;
 *   3. событие ещё не приходило — перевозчик обязан повторять, пока не
 *      получит подтверждения, и одно событие приходит по нескольку раз;
 *   4. трек принадлежит отправлению именно этого перевозчика — иначе
 *      CDEK двигал бы посылку, которую везёт Почта;
 *   5. состояние из закрытого списка — незнакомое слово записывается,
 *      но заказ не двигает.
 */
export const carrierWebhook = async (code, rawBody, signature, payload) => {
  const carrierCode = String(code ?? '');
  if (!['cdek', 'fivepost', 'russianpost'].includes(carrierCode)) {
    return { error: 'unknown_carrier' };
  }
  if (!signatureOk(carrierCode, rawBody, signature)) {
    await logMarket(null, 'webhook_bad_signature', carrierCode);
    return { error: 'bad_signature' };
  }

  const eventKey = text(payload?.eventId, 120);
  const tracking = text(payload?.tracking, 120);
  const key = text(payload?.status, 60).toLowerCase();
  if (!eventKey || !tracking) return { error: 'bad_payload' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Повтор: пара «перевозчик + событие» уникальна. Если строка не
       вставилась — это событие мы уже отработали. */
    const { rowCount: fresh } = await client.query(
      `INSERT INTO market_shipment_events (order_id, carrier, event_key, status, payload)
       VALUES (NULL,$1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
      [carrierCode, eventKey, key, JSON.stringify({
        tracking, status: key,
        location: text(payload?.location, 200),
        statusText: text(payload?.statusText, 200),
      })]);
    if (fresh === 0) { await client.query('COMMIT'); return { ok: true, repeated: true }; }

    /* Трек — только вместе с перевозчиком, который его выдал. */
    const { rows } = await client.query(
      `SELECT o.*, s.method, s.destination, s.status AS shipment_status
         FROM market_shipments s
         JOIN market_carriers c ON c.id = s.carrier_id
         JOIN market_orders o ON o.id = s.order_id
        WHERE s.tracking = $1 AND c.code = $2 AND c.kind = 'external'
        FOR UPDATE OF o`,
      [tracking, carrierCode]);
    const order = rows[0];
    if (!order) {
      await client.query('COMMIT');
      await logMarket(null, 'webhook_unknown_tracking', carrierCode);
      return { error: 'unknown_tracking' };
    }

    await client.query(
      'UPDATE market_shipment_events SET order_id = $2 WHERE carrier = $1 AND event_key = $3',
      [carrierCode, order.id, eventKey]);

    const moved = await moveShipment(client,
      order,
      { status: order.shipment_status, destination: order.destination },
      key,
      {
        actorId: null,
        actorRole: 'system',
        detail: {
          carrier: carrierCode,
          location: text(payload?.location, 200),
          statusText: text(payload?.statusText, 200),
        },
      });

    await client.query('COMMIT');
    if (moved.notes) {
      for (const n of moved.notes) {
        pushMarket([n.userId], { type: 'market-notification', payload: n.note });
      }
    }
    if (moved.error) return { ok: true, ignored: 'unknown_status' };
    if (moved.stale) return { ok: true, ignored: 'stale' };
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Справочники: правка администрацией ───────────────────────────── */

export const upsertPickupPoint = async (actorId, input = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  const title = text(input.title, 120);
  const city = text(input.city, 80);
  const address = text(input.address, 300);
  if (!title || !city || !address) return { error: 'bad_point' };
  const id = POINT_ID_RE.test(String(input.id ?? '')) ? String(input.id) : `mpp-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO market_pickup_points (id, title, city, address, phone, work_from, work_to, hold_days, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, city = EXCLUDED.city,
       address = EXCLUDED.address, phone = EXCLUDED.phone, work_from = EXCLUDED.work_from,
       work_to = EXCLUDED.work_to, hold_days = EXCLUDED.hold_days, active = EXCLUDED.active
     RETURNING id`,
    [id, title, city, address, text(input.phone, 40),
      text(input.workFrom, 5) || '09:00', text(input.workTo, 5) || '21:00',
      int(input.holdDays, 1, 60) ?? 7, input.active !== false]);
  await logMarket(actorId, 'pickup_point_saved', rows[0].id);
  return { id: rows[0].id };
};

export const upsertCarrier = async (actorId, input = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  const kind = ['external', 'inhouse'].includes(String(input.kind)) ? String(input.kind) : null;
  const title = text(input.title, 120);
  if (!kind || !title) return { error: 'bad_carrier' };

  const code = kind === 'external'
    ? (['cdek', 'fivepost', 'russianpost'].includes(String(input.code)) ? String(input.code) : null)
    : null;
  if (kind === 'external' && !code) return { error: 'bad_carrier_code' };

  const ownerId = kind === 'inhouse' ? text(input.ownerId, 80) : null;
  if (kind === 'inhouse' && !ownerId) return { error: 'owner_required' };

  const id = CARRIER_ID_RE.test(String(input.id ?? '')) ? String(input.id) : `mcr-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO market_carriers
       (id, kind, code, title, owner_id, city, min_price_kop, price_per_km_kop,
        max_weight_g, eta_hours, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, city = EXCLUDED.city,
       min_price_kop = EXCLUDED.min_price_kop, price_per_km_kop = EXCLUDED.price_per_km_kop,
       max_weight_g = EXCLUDED.max_weight_g, eta_hours = EXCLUDED.eta_hours,
       active = EXCLUDED.active
     RETURNING id`,
    [id, kind, code, title, ownerId, text(input.city, 80),
      int(input.minPriceKop, 0, 10_000_000) ?? 0,
      int(input.pricePerKmKop, 0, 1_000_000) ?? 0,
      int(input.maxWeightG, 1, 1_000_000) ?? 30000,
      int(input.etaHours, 1, 24 * 60) ?? 48,
      input.active !== false]);
  await logMarket(actorId, 'carrier_saved', rows[0].id, { kind, code });
  return { id: rows[0].id };
};

/**
 * Просроченные посылки в пунктах выдачи.
 *
 * Посылка, за которой не пришли, не должна висеть «ждёт получателя»
 * вечно: срок хранения кончился — это спор, а не доставка.
 */
export const sweepPickupExpiry = async () => {
  const { rows } = await query(
    `SELECT id, buyer_id, seller_id, status FROM market_orders
      WHERE status = 'ready_for_pickup' AND pickup_until IS NOT NULL AND pickup_until <= now()`);
  let moved = 0;
  for (const order of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: locked } = await client.query(
        `SELECT * FROM market_orders WHERE id = $1 AND status = 'ready_for_pickup' FOR UPDATE`,
        [order.id]);
      if (!locked[0]) { await client.query('ROLLBACK'); continue; }
      const { notes } = await applyTransition(client, locked[0], {
        to: 'disputed', actorId: null, actorRole: 'system',
        detail: { reason: 'pickup_expired' },
      });
      await client.query('COMMIT');
      for (const n of notes) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
      moved += 1;
    } catch {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
    }
  }
  return moved;
};
