/**
 * Sky Market: сделка.
 *
 * Здесь живёт состояние заказа и все переходы между состояниями. Это
 * единственное место, где заказ меняется, — маршруты умеют только
 * попросить, а решение принимается тут.
 *
 * Чего здесь нет и не будет.
 *
 * Sky не хранит деньги. В этом файле нет баланса продавца, нет вывода
 * средств, нет комиссии, нет замороженных сумм и нет выплаты продавцу
 * через Sky. Покупатель платит продавцу напрямую, мимо нас.
 *
 * Отсюда и названия состояний. buyer_payment_declared — это «покупатель
 * сказал, что отправил деньги», а не «деньги пришли»;
 * seller_payment_confirmed — это «продавец сказал, что получил», а не
 * «Sky проверил перевод». Мы перевода не видим и делать вид, что видим,
 * не станем: подпись под сделкой ставят люди, а мы её только храним.
 *
 * Правила перехода.
 *
 *   1. Состояние меняет только сервер и только по таблице переходов
 *      ниже. Клиент присылает название действия, а не новое состояние.
 *   2. Перепрыгнуть через состояние нельзя: у каждого действия указано,
 *      из чего оно допустимо. Список «из чего» — закрытый.
 *   3. У каждого действия одна сторона. Продавец не может подтвердить
 *      получение за покупателя, покупатель не может отправить товар.
 *   4. Повторное нажатие ничего не двигает: пара «заказ + человек +
 *      действие» уникальна в базе, и второй раз строка не вставится.
 *   5. Заказ читается FOR UPDATE внутри транзакции — две одновременные
 *      кнопки выстраиваются в очередь, а не выполняются обе.
 */
import { resolveForOrder } from './marketshipping.mjs';
import { scheduleCashbackIn } from './primecashback.mjs';
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import {
  canSell, logMarket, marketText as text, marketInt as int,
  ORDER_ID_RE, PRODUCT_ID_RE, recalcRatings, paymentDetailsForOrder,
  readServicePackage, fulfilmentOf,
} from './market.mjs';
import { pushMarket } from './signal.mjs';
import { accrueCommissionIfNeeded } from './pvzops.mjs';

const MAX_ADDRESS = 400;
const MAX_CONTACT = 200;
const MAX_REASON = 300;
const MAX_REQUIREMENTS = 4000;
const MAX_REVIEW = 2000;
const MAX_QUANTITY = 100;
/** Столько незакрытых заказов человек может держать одновременно. */
const MAX_OPEN_ORDERS = 50;

const OPEN_STATUSES = [
  'created', 'payment_pending', 'buyer_payment_declared',
  'seller_payment_confirmed', 'fulfillment', 'seller_shipped',
  'in_transit', 'ready_for_pickup', 'buyer_received',
];

/** Состояния, из которых заказ уже никуда не уедет. */
const FINAL = new Set(['completed', 'cancelled']);

/* ─── Таблица переходов ────────────────────────────────────────────── */

/**
 * Что кому можно и из какого состояния.
 *
 * Два маркета — две середины. Начало общее (договорились, заплатили,
 * подтвердили), конец общий (получил, закрыт), а между ними у обычного
 * маркета едет посылка, а у игрового продавец просто выдаёт товар.
 *
 * Переходы, связанные с посылкой (fulfillment → seller_shipped →
 * in_transit → ready_for_pickup), здесь не описаны намеренно: их двигает
 * marketdelivery.mjs, потому что там они не действия человека, а
 * состояние отправления.
 */
const FLOW = {
  standard: {
    /* Продавец принял заказ и готов принять оплату. */
    accept:       { from: ['created'], to: 'payment_pending', by: 'seller' },
    /* Покупатель говорит, что перевёл деньги. Sky этого не проверяет. */
    declare_paid: { from: ['payment_pending'], to: 'buyer_payment_declared', by: 'buyer' },
    /* Продавец говорит, что деньги получил. Sky этого тоже не проверяет. */
    confirm_paid: { from: ['buyer_payment_declared'], to: 'seller_payment_confirmed', by: 'seller' },
    /* Продавец собирает заказ к отправке. */
    fulfill:      { from: ['seller_payment_confirmed'], to: 'fulfillment', by: 'seller' },
    /* Покупатель получил посылку — на руки, из пункта выдачи, неважно. */
    received:     { from: ['seller_shipped', 'in_transit', 'ready_for_pickup'], to: 'buyer_received', by: 'buyer' },
    /* Самовывоз из магазина: «Заказ готов к выдаче» (только для delivery_method = store_pickup). */
    ready_pickup: { from: ['seller_payment_confirmed', 'fulfillment'], to: 'ready_for_pickup', by: 'seller', method: 'store_pickup' },
    /* Доставка продавцом: «Передал курьеру / везу» (только для delivery_method = courier). */
    ship_own:     { from: ['seller_payment_confirmed', 'fulfillment'], to: 'seller_shipped', by: 'seller', method: ['courier', 'intl'] },
  },
  /*
   * Услуга. Путь тот же, что у игрового лота: везти нечего, исполнитель
   * сдаёт работу, заказчик принимает. Отдельной машины у неё нет
   * намеренно — второй набор правил однажды разойдётся с первым.
   */
  service: {
    accept:       { from: ['created'], to: 'payment_pending', by: 'seller' },
    declare_paid: { from: ['payment_pending'], to: 'buyer_payment_declared', by: 'buyer' },
    confirm_paid: { from: ['buyer_payment_declared'], to: 'seller_payment_confirmed', by: 'seller' },
    /* «Сдать работу». */
    fulfill:      { from: ['seller_payment_confirmed'], to: 'fulfillment', by: 'seller' },
    /* «Принимаю работу». */
    received:     { from: ['fulfillment'], to: 'buyer_received', by: 'buyer' },
  },
  game: {
    accept:       { from: ['created'], to: 'payment_pending', by: 'seller' },
    declare_paid: { from: ['payment_pending'], to: 'buyer_payment_declared', by: 'buyer' },
    confirm_paid: { from: ['buyer_payment_declared'], to: 'seller_payment_confirmed', by: 'seller' },
    /* «Выдать заказ»: продавец передаёт товар в игре. */
    fulfill:      { from: ['seller_payment_confirmed'], to: 'fulfillment', by: 'seller' },
    /* «Подтверждаю выдачу товара». */
    received:     { from: ['fulfillment'], to: 'buyer_received', by: 'buyer' },
  },
};

/** Из чего покупатель ещё может отменить заказ. */
const BUYER_MAY_CANCEL = new Set(['created', 'payment_pending']);
/** Из чего может отменить продавец. */
const SELLER_MAY_CANCEL = new Set(['created', 'payment_pending', 'buyer_payment_declared']);
/** Из чего можно открыть спор. */
const MAY_DISPUTE = new Set([
  'buyer_payment_declared', 'seller_payment_confirmed', 'fulfillment',
  'seller_shipped', 'in_transit', 'ready_for_pickup',
]);

/* ─── Уведомления ──────────────────────────────────────────────────── */

/**
 * Уведомление складывает сервер.
 *
 * Заголовок и текст не приходят от клиента: иначе страница покупателя
 * сама рисовала бы себе «продавец подтвердил оплату».
 */
const notify = async (client, userId, orderId, kind, title, body = '') => {
  const id = `mn-${generateId()}`;
  await client.query(
    `INSERT INTO market_notifications (id, user_id, order_id, kind, title, body)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, userId, orderId, kind, title, body]);
  return { id, kind, title, body, orderId };
};

const NOTES = {
  created:                  ['Новый заказ', 'Покупатель оформил заказ.'],
  payment_pending:          ['Заказ принят', 'Продавец готов принять оплату.'],
  buyer_payment_declared:   ['Покупатель отправил деньги', 'Покупатель сообщил, что перевёл оплату.'],
  seller_payment_confirmed: ['Продавец получил деньги', 'Продавец подтвердил получение оплаты.'],
  fulfillment:              ['Заказ выполняется', 'Продавец занялся заказом.'],
  seller_shipped:           ['Заказ отправлен', 'Посылка передана в доставку.'],
  in_transit:               ['Заказ в пути', 'Посылка едет к вам.'],
  ready_for_pickup:         ['Заказ ждёт в пункте выдачи', 'Посылка приехала, её можно забрать.'],
  buyer_received:           ['Покупатель получил заказ', 'Покупатель подтвердил получение.'],
  completed:                ['Заказ закрыт', 'Сделка завершена.'],
  cancelled:                ['Заказ отменён', 'Сделка отменена.'],
  disputed:                 ['Открыт спор', 'По заказу начато разбирательство.'],
};

/** Кого касается переход: покупателя, продавца или обоих. */
const AUDIENCE = {
  created: ['seller'],
  payment_pending: ['buyer'],
  buyer_payment_declared: ['seller'],
  seller_payment_confirmed: ['buyer'],
  fulfillment: ['buyer'],
  seller_shipped: ['buyer'],
  in_transit: ['buyer'],
  ready_for_pickup: ['buyer'],
  buyer_received: ['seller'],
  completed: ['buyer', 'seller'],
  cancelled: ['buyer', 'seller'],
  disputed: ['buyer', 'seller'],
};

/* ─── Роли ─────────────────────────────────────────────────────────── */

/**
 * Кто этот человек для этого заказа.
 *
 * Роль выводится из строки заказа, а не из того, кем человек себя
 * назвал в запросе. Присланного role, buyerId или sellerId здесь не
 * читается никогда.
 */
export const roleFor = async (order, userId) => {
  if (!order || !userId) return null;
  if (order.buyer_id === userId) return 'buyer';
  if (order.seller_id === userId) return 'seller';
  if (await can(userId, 'market')) return 'support';
  return null;
};

/**
 * Прочитать заказ с проверкой доступа.
 *
 * Постороннему возвращается ровно то же, что и на несуществующий заказ.
 * Разница между «нет такого» и «есть, но не твой» — это уже сведения о
 * чужих сделках.
 */
export const accessOrder = async (orderId, viewerId) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return null;
  const { rows } = await query('SELECT * FROM market_orders WHERE id = $1', [id]);
  const order = rows[0];
  if (!order) return null;
  const role = await roleFor(order, viewerId);
  if (!role) {
    await logMarket(viewerId, 'order_access_denied', id);
    return null;
  }
  return { order, role };
};

/* ─── Выдача наружу ────────────────────────────────────────────────── */

const dec = (v) => (v ? (decryptContent(v) ?? '') : '');

/**
 * Заказ для клиента.
 *
 * Адрес и контакт покупателя видят только сам покупатель, продавец
 * этого заказа и поддержка — и только после того, как заказ дошёл до
 * стадии, где адрес нужен. До оплаты продавцу адрес не показывается:
 * оформленный и тут же брошенный заказ не должен быть способом собрать
 * чужие адреса.
 */
export const toOrder = (row, role) => {
  const seeContact = role === 'buyer' || role === 'support'
    || (role === 'seller' && !['created', 'payment_pending'].includes(row.status));
  return {
    id: row.id,
    marketType: row.market_type,
    status: row.status,
    stateSeq: Number(row.state_seq ?? 0),
    productId: row.product_id,
    title: row.title_snap,
    priceKop: Number(row.price_kop),
    price: Number(row.price_kop) / 100,
    quantity: Number(row.quantity),
    totalKop: Number(row.total_kop),
    total: Number(row.total_kop) / 100,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    role,
    address: seeContact ? dec(row.address_enc) : '',
    contact: seeContact ? dec(row.contact_enc) : '',
    pickupPointId: row.pickup_point_id ?? null,
    deliveryMethod: row.delivery_method ?? null,
    deliveryCountry: row.delivery_country ?? null,
    deliveryFeeKop: Number(row.delivery_fee_kop ?? 0),
    deliveryFee: Number(row.delivery_fee_kop ?? 0) / 100,
    /* Адрес магазина для самовывоза показан покупателю (его опубликовал сам продавец). */
    delivery: row.delivery_snap ?? null,
    packingStartedAt: row.packing_started_at?.toISOString?.() ?? null,
    packedAt: row.packed_at?.toISOString?.() ?? null,
    paidDeclaredAt: row.paid_declared_at?.toISOString?.() ?? null,
    paidConfirmedAt: row.paid_confirmed_at?.toISOString?.() ?? null,
    deliveredAt: row.delivered_at?.toISOString?.() ?? null,
    completedAt: row.completed_at?.toISOString?.() ?? null,
    cancelledAt: row.cancelled_at?.toISOString?.() ?? null,
    cancelReason: row.cancel_reason ?? '',
    pickupUntil: row.pickup_until?.toISOString?.() ?? null,
    supplyId: row.supply_id ?? null,
    atWarehouseAt: row.at_warehouse_at?.toISOString?.() ?? null,
    packageLevel: row.package_level ?? null,
    packageTitle: row.package_title ?? null,
    deliveryDays: row.delivery_days ?? null,
    dueAt: row.due_at?.toISOString?.() ?? null,
    /* Требования видит исполнитель и заказчик — работать по ним и
       предстоит. Постороннему заказ вообще не открывается. */
    requirements: seeContact ? dec(row.requirements_enc) : '',
    createdAt: row.created_at?.toISOString?.() ?? undefined,
    updatedAt: row.updated_at?.toISOString?.() ?? undefined,
  };
};

/* ─── Создание заказа ──────────────────────────────────────────────── */

/**
 * Оформить заказ.
 *
 * Из запроса берутся только идентификатор товара, количество и куда
 * везти. Цена, продавец, тип маркета и название — из базы: присланная
 * цена не читается вообще, иначе товар можно было бы купить за рубль,
 * подменив поле в запросе.
 *
 * Наличие уменьшается тем же запросом, которым проверяется. «Проверил,
 * потом списал» двумя запросами — это две продажи последней штуки.
 */
const hasOptions = async (client, sellerId) =>
  (await client.query('SELECT 1 FROM market_delivery_options WHERE seller_id = $1 AND enabled LIMIT 1', [sellerId])).rows.length > 0;

export const createOrder = async (buyerId, input = {}) => {
  const productId = String(input.productId ?? '');
  if (!PRODUCT_ID_RE.test(productId)) return { error: 'not_found' };

  const qty = int(input.quantity, 1, MAX_QUANTITY) ?? 1;
  const address = text(input.address, MAX_ADDRESS);
  const contact = text(input.contact, MAX_CONTACT);
  const pickupPointId = text(input.pickupPointId, 80) || null;
  /* Требования к работе. Шифруем: там бывают домены, доступы и
     внутренняя кухня заказчика. */
  const requirements = text(input.requirements, MAX_REQUIREMENTS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: prod } = await client.query(
      `SELECT p.*, s.status AS seller_status, s.sub_status, s.sub_until,
              s.has_payment_details
         FROM market_products p
         JOIN market_sellers s ON s.profile_id = p.seller_id
        WHERE p.id = $1
        FOR UPDATE OF p`,
      [productId]);
    const product = prod[0];
    if (!product) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    /* Товар снятого с витрины продавца купить нельзя — и об этом узнают
       так же, как о несуществующем товаре. */
    if (!product.active || product.seller_status !== 'active'
        || product.sub_status !== 'active'
        || !product.sub_until || new Date(product.sub_until) <= new Date()) {
      await client.query('ROLLBACK');
      return { error: 'not_found' };
    }

    /* Платить продавцу напрямую — единственный путь оплаты, и без
       реквизитов этот путь никуда не ведёт. Заказ, по которому
       покупателю некуда перевести деньги, лучше не создавать вовсе,
       чем оставлять его висеть в ожидании оплаты. */
    if (!product.has_payment_details) {
      await client.query('ROLLBACK');
      return { error: 'seller_has_no_payment_details' };
    }

    if (product.seller_id === buyerId) {
      await client.query('ROLLBACK');
      return { error: 'own_product' };
    }

    /* Обычный маркет — нужен адрес или пункт выдачи. Игровой — ни того,
       ни другого: там нечего везти. */
    const std = product.market_type === 'standard';
    if (std && !input.deliveryMethod && !address && !pickupPointId && !(await hasOptions(client, product.seller_id))) {
      await client.query('ROLLBACK');
      return { error: 'address_required' };
    }

    if (pickupPointId) {
      const { rows: pp } = await client.query(
        'SELECT id FROM market_pickup_points WHERE id = $1 AND active AND NOT admin_blocked', [pickupPointId]);
      if (!pp[0]) { await client.query('ROLLBACK'); return { error: 'bad_pickup_point' }; }
    }

    const { rows: open } = await client.query(
      `SELECT count(*)::int AS n FROM market_orders
        WHERE buyer_id = $1 AND status = ANY($2::text[])`,
      [buyerId, OPEN_STATUSES]);
    if ((open[0]?.n ?? 0) >= MAX_OPEN_ORDERS) {
      await client.query('ROLLBACK');
      return { error: 'too_many_open_orders' };
    }

    const { rowCount: took } = await client.query(
      `UPDATE market_products SET stock = stock - $2, updated_at = now()
        WHERE id = $1 AND active AND stock >= $2`,
      [productId, qty]);
    if (took === 0) { await client.query('ROLLBACK'); return { error: 'out_of_stock' }; }

    /*
     * Услуга продаётся пакетом. Уровень пакета приходит от клиента, а
     * цена и срок — из базы: присланная цена не читается, иначе
     * премиум покупался бы по цене базового.
     */
    let pack = null;
    if (product.market_type === 'service') {
      pack = await readServicePackage(productId, input.packageLevel);
      if (!pack) { await client.query('ROLLBACK'); return { error: 'bad_package' }; }
    }

    const priceKop = BigInt(pack ? pack.priceKop : product.price_kop);
    const itemsKop = priceKop * BigInt(qty);
    /* Способ получения и плата за него — только для физических товаров; считает сервер. */
    let ship = { method: null, feeKop: 0, snap: null };
    if (std) {
      ship = await resolveForOrder(client, { sellerId: product.seller_id, subtotalKop: itemsKop, method: input.deliveryMethod, address, pickupPointId, country: input.deliveryCountry });
      if (ship.error) { await client.query('ROLLBACK'); return { error: ship.error }; }
    }
    const totalKop = itemsKop + BigInt(ship.feeKop);

    const orderId = `mo-${generateId()}`;
    const { rows: made } = await client.query(
      `INSERT INTO market_orders
         (id, buyer_id, seller_id, product_id, market_type, title_snap,
          price_kop, quantity, total_kop, status,
          address_enc, contact_enc, pickup_point_id, state_seq,
          package_level, package_title, delivery_days, requirements_enc,
          delivery_method, delivery_fee_kop, delivery_snap, delivery_country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'created',$10,$11,$12,1,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [orderId, buyerId, product.seller_id, productId, product.market_type,
        product.title, String(priceKop), qty, String(totalKop),
        address ? encryptContent(address) : null,
        contact ? encryptContent(contact) : null,
        pickupPointId,
        pack?.level ?? null, pack?.title ?? null, pack?.delivery ?? null,
        requirements ? encryptContent(requirements) : null,
        ship.method, String(ship.feeKop), ship.snap ? JSON.stringify(ship.snap) : null, ship.country ?? null]);

    await client.query(
      `INSERT INTO market_order_events (order_id, actor_id, actor_role, from_status, to_status, detail)
       VALUES ($1,$2,'buyer',NULL,'created',$3::jsonb)`,
      [orderId, buyerId, JSON.stringify({ quantity: qty })]);

    /* Чат заводится вместе с заказом: без него сторонам негде
       договориться о переводе, а переводить они будут напрямую. */
    await client.query(
      `INSERT INTO market_chats (id, order_id, buyer_id, seller_id)
       VALUES ($1,$2,$3,$4)`,
      [`mc-${generateId()}`, orderId, buyerId, product.seller_id]);

    await client.query(
      `UPDATE market_sellers SET orders_total = orders_total + 1, updated_at = now()
        WHERE profile_id = $1`, [product.seller_id]);

    const note = await notify(client, product.seller_id, orderId, 'order_created',
      NOTES.created[0], `${product.title} — ${Number(totalKop) / 100} ₽`);

    await client.query('COMMIT');
    pushMarket([product.seller_id], { type: 'market-notification', payload: note });
    await logMarket(buyerId, 'order_created', orderId, { productId, quantity: qty });
    return { order: toOrder(made[0], 'buyer') };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Переходы ─────────────────────────────────────────────────────── */

/**
 * Записать переход и разослать уведомления.
 *
 * Вынесено отдельно, потому что этим же пользуется доставка: события
 * перевозчика двигают тот же заказ по тем же правилам записи.
 */
export const applyTransition = async (client, order, {
  to, actorId, actorRole, detail = {}, extraSets = [], extraArgs = [],
}) => {
  const args = [order.id, to];
  const sets = [`status = $2`, 'state_seq = state_seq + 1', 'updated_at = now()'];

  const stamp = {
    buyer_payment_declared: 'paid_declared_at',
    seller_payment_confirmed: 'paid_confirmed_at',
    buyer_received: 'delivered_at',
    completed: 'completed_at',
    cancelled: 'cancelled_at',
  }[to];
  if (stamp) sets.push(`${stamp} = now()`);

  /* Часть дополнительных присваиваний параметра не требует
     (packing_started_at = now()), часть требует. Номер аргумента
     занимаем только под те, где стоит $$. */
  let taken = 0;
  for (const piece of extraSets) {
    if (piece.includes('$$')) {
      args.push(extraArgs[taken]);
      taken += 1;
      sets.push(piece.replace('$$', `$${args.length}`));
    } else {
      sets.push(piece);
    }
  }

  const { rows } = await client.query(
    `UPDATE market_orders SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);

  // Завершённая сделка — основание для кэшбэка Prime Points (primecashback.mjs): запись в той же транзакции, баллы зачислятся после холда
  if (to === 'completed' && rows[0]) await scheduleCashbackIn(client, rows[0]);

  await client.query(
    `INSERT INTO market_order_events (order_id, actor_id, actor_role, from_status, to_status, detail)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [order.id, actorId, actorRole, order.status, to, JSON.stringify(detail)]);

  let [title, body] = NOTES[to] ?? ['Заказ обновлён', ''];
  if (to === 'ready_for_pickup' && order.delivery_method === 'store_pickup') [title, body] = ['Заказ ждёт в магазине', 'Заказ готов к выдаче — заберите его в магазине продавца.'];
  if (to === 'seller_shipped' && order.delivery_method === 'intl') [title, body] = ['Заказ отправлен за границу', 'Продавец отправил заказ в вашу страну. Таможенное оформление и сроки зависят от перевозчика.'];
  if (to === 'seller_shipped' && order.delivery_method === 'courier') [title, body] = ['Заказ передан курьеру', 'Продавец отправил заказ с курьером — он везёт его по вашему адресу.'];
  const notes = [];
  for (const who of AUDIENCE[to] ?? []) {
    const userId = who === 'buyer' ? order.buyer_id : order.seller_id;
    notes.push({ userId, note: await notify(client, userId, order.id, `order_${to}`, title, body) });
  }
  return { row: rows[0], notes };
};

const fanout = (notes) => {
  for (const n of notes) {
    pushMarket([n.userId], { type: 'market-notification', payload: n.note });
  }
};

/**
 * Единственная дверь для действий сторон над заказом.
 *
 * Клиент присылает название действия — accept, declare_paid,
 * confirm_paid, fulfill, received. Нового состояния он не присылает
 * никогда: состояние выбирает таблица переходов по действию, типу
 * маркета и текущему состоянию.
 *
 * Ничего, кроме названия действия, отсюда не читается — и раньше
 * тело запроса сюда всё же передавалось четвёртым доводом, который
 * функция молча выбрасывала. Довод убран: код, который выглядит
 * принимающим состояние от клиента, рано или поздно начнёт его
 * принимать.
 */
export const actOnOrder = async (orderId, actorId, action) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  const act = String(action ?? '');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const role = await roleFor(order, actorId);
    if (!role || role === 'support') {
      /* Поддержка ведёт разбирательство, но не играет за стороны: она не
         может подтвердить получение вместо покупателя. */
      await client.query('ROLLBACK');
      if (!role) await logMarket(actorId, 'order_access_denied', id, { action: act });
      return { error: 'not_found' };
    }

    const flow = FLOW[order.market_type]?.[act];
    if (!flow) { await client.query('ROLLBACK'); return { error: 'unknown_action' }; }
    if (flow.method && ![].concat(flow.method).includes(order.delivery_method)) {
      await client.query('ROLLBACK');
      return { error: 'unknown_action' };
    }
    if (flow.by !== role) {
      await client.query('ROLLBACK');
      await logMarket(actorId, 'order_wrong_side', id, { action: act, role });
      return { error: 'not_your_step' };
    }
    /* Повтор того же действия тем же человеком по тому же заказу.
       Первый раз строка вставляется, второй — нет.

       Проверяется это ДО состояния, и порядок здесь важен: после
       первого нажатия заказ уже уехал вперёд, и проверка состояния
       ответила бы на второе нажатие «не то состояние». Человеку,
       нажавшему дважды, полагается его заказ, а не ошибка. */
    const { rowCount: first } = await client.query(
      `INSERT INTO market_order_actions (order_id, actor_id, action)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [id, actorId, act]);
    if (first === 0) {
      await client.query('ROLLBACK');
      return { order: toOrder(order, role), repeated: true };
    }

    if (!flow.from.includes(order.status)) {
      await client.query('ROLLBACK');
      return { error: 'wrong_state', status: order.status };
    }

    const extraSets = [];
    const extraArgs = [];
    /* Продавец, взявшийся собирать заказ, отмечает это временем сборки. */
    if (act === 'fulfill' && order.market_type === 'standard') {
      extraSets.push('packing_started_at = COALESCE(packing_started_at, now())');
    }
    /* Срок сдачи услуги считается от подтверждения оплаты и сервером:
       обещанный на витрине срок — это срок работы, а не срок ожидания
       денег. */
    if (act === 'confirm_paid' && order.market_type === 'service' && order.delivery_days) {
      extraSets.push('due_at = $$');
      extraArgs.push(new Date(Date.now() + Number(order.delivery_days) * 86400_000));
    }

    const { row, notes } = await applyTransition(client, order, {
      to: flow.to, actorId, actorRole: role,
      detail: { action: act }, extraSets, extraArgs,
    });

    let finalRow = row;
    let allNotes = notes;
    /* Покупатель подтвердил получение — держать сделку открытой больше
       не за чем. Закрываем тем же шагом, но отдельной записью в
       журнале: в истории должны остаться оба перехода. */
    if (flow.to === 'buyer_received') {
      const done = await applyTransition(client, row, {
        to: 'completed', actorId: null, actorRole: 'system', detail: { auto: true },
      });
      finalRow = done.row;
      allNotes = notes.concat(done.notes);
      await client.query(
        `UPDATE market_products SET sold = sold + $2, updated_at = now() WHERE id = $1`,
        [order.product_id, order.quantity]);
      await client.query(
        `UPDATE market_sellers SET orders_done = orders_done + 1, updated_at = now()
          WHERE profile_id = $1`, [order.seller_id]);
      /* Заказ мог дойти до пункта выдачи с владельцем и без участия
         сотрудника точки — например, покупатель сам нажал «Получил»,
         не дожидаясь сканирования. Комиссия всё равно причитается, и
         accrueCommissionIfNeeded сама решает, есть ли она вообще
         (владелец есть) и не начислена ли уже (ON CONFLICT). */
      await accrueCommissionIfNeeded(client, finalRow);
    }

    await client.query('COMMIT');
    fanout(allNotes);
    await logMarket(actorId, `order_${act}`, id, { from: order.status, to: finalRow.status });
    return { order: toOrder(finalRow, role) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Сборка заказа ────────────────────────────────────────────────── */

/**
 * Отметки сборки.
 *
 * Это не состояние сделки, а две даты внутри неё: заказ всё это время
 * остаётся там же, где был. Отдельным состоянием сборка была бы
 * лишней ступенькой, через которую пришлось бы прыгать.
 */
export const markPacking = async (orderId, sellerId, done = false) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT * FROM market_orders WHERE id = $1 AND seller_id = $2', [id, sellerId]);
  const order = rows[0];
  if (!order) return { error: 'not_found' };
  if (order.market_type !== 'standard') return { error: 'not_applicable' };
  if (!['seller_payment_confirmed', 'fulfillment'].includes(order.status)) {
    return { error: 'wrong_state', status: order.status };
  }
  const { rows: upd } = await query(
    done
      ? `UPDATE market_orders SET packed_at = now(),
           packing_started_at = COALESCE(packing_started_at, now()), updated_at = now()
          WHERE id = $1 RETURNING *`
      : `UPDATE market_orders SET packing_started_at = COALESCE(packing_started_at, now()),
           updated_at = now() WHERE id = $1 RETURNING *`,
    [id]);
  await logMarket(sellerId, done ? 'order_packed' : 'order_packing', id);
  return { order: toOrder(upd[0], 'seller') };
};

/* ─── Отмена и спор ────────────────────────────────────────────────── */

export const cancelOrder = async (orderId, actorId, reason = '') => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const role = await roleFor(order, actorId);
    if (!role) {
      await client.query('ROLLBACK');
      await logMarket(actorId, 'order_access_denied', id, { action: 'cancel' });
      return { error: 'not_found' };
    }
    if (FINAL.has(order.status)) { await client.query('ROLLBACK'); return { error: 'already_closed' }; }

    const may = role === 'support'
      || (role === 'buyer' && BUYER_MAY_CANCEL.has(order.status))
      || (role === 'seller' && SELLER_MAY_CANCEL.has(order.status));
    if (!may) { await client.query('ROLLBACK'); return { error: 'too_late_to_cancel', status: order.status }; }

    const { row, notes } = await applyTransition(client, order, {
      to: 'cancelled', actorId, actorRole: role,
      detail: { reason: text(reason, MAX_REASON) },
      extraSets: ['cancel_reason = $$'], extraArgs: [text(reason, MAX_REASON)],
    });

    /* Занятая под заказ штука возвращается на витрину. */
    await client.query(
      'UPDATE market_products SET stock = stock + $2, updated_at = now() WHERE id = $1',
      [order.product_id, order.quantity]);
    await client.query(
      `UPDATE market_sellers SET orders_cancel = orders_cancel + 1, updated_at = now()
        WHERE profile_id = $1`, [order.seller_id]);

    await client.query('COMMIT');
    fanout(notes);
    await logMarket(actorId, 'order_cancelled', id, { role, from: order.status });
    return { order: toOrder(row, role) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export const openDispute = async (orderId, actorId, reason = '') => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    const role = await roleFor(order, actorId);
    if (!role || role === 'support') { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (!MAY_DISPUTE.has(order.status)) {
      await client.query('ROLLBACK');
      return { error: 'wrong_state', status: order.status };
    }

    const { row, notes } = await applyTransition(client, order, {
      to: 'disputed', actorId, actorRole: role,
      detail: { reason: text(reason, MAX_REASON), was: order.status },
    });
    await client.query('COMMIT');
    fanout(notes);
    await logMarket(actorId, 'order_disputed', id, { from: order.status });
    return { order: toOrder(row, role) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Разбирательство закрывает поддержка — и только она.
 *
 * Ни покупатель, ни продавец не могут вывести заказ из спора сами:
 * иначе спор заканчивался бы тем, кто быстрее нажал.
 */
/**
 * Открытые споры — для раздела «Нарушения» в панели администратора.
 *
 * listOrders() выше всегда смотрит с точки зрения одной стороны
 * (buyer/seller: только свои заказы) — у администрации нет своей
 * стороны, ей нужны все споры сразу, независимо от того, кто покупатель
 * и кто продавец. role='support' даёт тот же доступ к контактам/адресу,
 * что уже есть у поддержки — медиатору спора нужно видеть то же, что ей.
 */
export const listDisputedOrders = async (actorId, { limit } = {}) => {
  if (!(await can(actorId, 'market'))) return { error: 'not_allowed' };
  const lim = int(limit, 1, 100) ?? 50;
  const { rows } = await query(
    `SELECT * FROM market_orders WHERE status = 'disputed' ORDER BY updated_at DESC LIMIT $1`, [lim]);
  return { orders: rows.map((r) => toOrder(r, 'support')) };
};

export const resolveDispute = async (orderId, actorId, outcome, note = '') => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  if (!(await can(actorId, 'market'))) {
    await logMarket(actorId, 'dispute_resolve_denied', id);
    return { error: 'not_allowed' };
  }
  if (!['completed', 'cancelled'].includes(String(outcome ?? ''))) {
    return { error: 'bad_outcome' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [id]);
    const order = rows[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (order.status !== 'disputed') {
      await client.query('ROLLBACK');
      return { error: 'wrong_state', status: order.status };
    }

    const { row, notes } = await applyTransition(client, order, {
      to: outcome, actorId, actorRole: 'support',
      detail: { note: text(note, MAX_REASON) },
    });
    if (outcome === 'cancelled') {
      await client.query(
        'UPDATE market_products SET stock = stock + $2, updated_at = now() WHERE id = $1',
        [order.product_id, order.quantity]);
      await client.query(
        `UPDATE market_sellers SET orders_cancel = orders_cancel + 1, updated_at = now()
          WHERE profile_id = $1`, [order.seller_id]);
    } else {
      await client.query(
        'UPDATE market_products SET sold = sold + $2, updated_at = now() WHERE id = $1',
        [order.product_id, order.quantity]);
      await client.query(
        `UPDATE market_sellers SET orders_done = orders_done + 1, updated_at = now()
          WHERE profile_id = $1`, [order.seller_id]);
      await accrueCommissionIfNeeded(client, row);
    }
    await client.query('COMMIT');
    fanout(notes);
    await logMarket(actorId, 'dispute_resolved', id, { outcome });
    return { order: toOrder(row, 'support') };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Работа через свой склад ──────────────────────────────────────── */

/**
 * Положить заказ в поставку на свой склад.
 *
 * Это шаг режима «через склад»: продавец собирает заказы в одну
 * поставку, отправляет её на свой склад, а уже оттуда везёт покупателю
 * своими силами.
 *
 * Проверяется всё, что можно подменить: заказ должен быть его, поставка
 * — его, склад — тот самый, который он назначил режимом работы. Иначе
 * чужой заказ уехал бы на чужой склад по присланному идентификатору.
 */
export const putOrderInSupply = async (orderId, sellerId, supplyId) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };

  const { rows } = await query(
    'SELECT * FROM market_orders WHERE id = $1 AND seller_id = $2', [id, sellerId]);
  const order = rows[0];
  if (!order) {
    await logMarket(sellerId, 'supply_put_denied', id);
    return { error: 'not_found' };
  }
  if (order.market_type !== 'standard') return { error: 'not_applicable' };

  const how = await fulfilmentOf(sellerId);
  if (how.mode !== 'warehouse') return { error: 'not_warehouse_mode' };
  if (order.status !== 'fulfillment') return { error: 'wrong_state', status: order.status };

  const { rows: sup } = await query(
    'SELECT id, status, sorting_center_id FROM logi_supplies WHERE id = $1 AND seller_id = $2',
    [String(supplyId ?? ''), sellerId]);
  const supply = sup[0];
  if (!supply) return { error: 'no_such_supply' };
  /* Уехавшую поставку доукомплектовать нельзя: коробка уже закрыта. */
  if (!['draft', 'preparing'].includes(supply.status)) return { error: 'supply_closed' };

  const { rows: upd } = await query(
    'UPDATE market_orders SET supply_id = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, supply.id]);
  await logMarket(sellerId, 'order_put_in_supply', id, { supplyId: supply.id });
  return { order: toOrder(upd[0], 'seller') };
};

/** Что лежит в этой поставке. Только своё. */
export const ordersInSupply = async (supplyId, sellerId) => {
  const { rows } = await query(
    `SELECT * FROM market_orders WHERE supply_id = $1 AND seller_id = $2
      ORDER BY created_at`, [String(supplyId ?? ''), sellerId]);
  return rows.map((r) => toOrder(r, 'seller'));
};

/**
 * Поставка доехала до склада.
 *
 * Отметку ставит сервер сразу всем заказам поставки: отдельного «этот
 * доехал, а этот нет» у одной коробки не бывает.
 */
export const markSupplyArrived = async (supplyId) => {
  const { rowCount } = await query(
    `UPDATE market_orders SET at_warehouse_at = now(), updated_at = now()
      WHERE supply_id = $1 AND at_warehouse_at IS NULL`, [String(supplyId ?? '')]);
  return rowCount;
};

/* ─── Реквизиты по заказу ──────────────────────────────────────────── */

/**
 * Куда переводить по этому заказу.
 *
 * Спрашивается отдельно от самого заказа, потому что и правило другое:
 * заказ видят обе стороны и поддержка, а реквизиты — тот, кому платить,
 * то есть покупатель. Продавец свои и так знает, и в его собственном
 * профиле они есть.
 *
 * По отменённому заказу не выдаются: платить по нему незачем.
 */
export const orderPaymentDetails = async (orderId, viewerId) => {
  const found = await accessOrder(orderId, viewerId);
  if (!found) return null;
  const { order, role } = found;
  if (order.status === 'cancelled') return null;
  if (role !== 'buyer' && role !== 'support') return null;
  return paymentDetailsForOrder(order.seller_id, { forBuyer: true });
};

/* ─── Списки ───────────────────────────────────────────────────────── */

export const listOrders = async (userId, { side = 'buyer', status, limit, offset } = {}) => {
  const lim = int(limit, 1, 100) ?? 50;
  const off = int(offset, 0, 100000) ?? 0;
  const column = side === 'seller' ? 'seller_id' : 'buyer_id';
  const args = [userId];
  let where = `${column} = $1`;
  if (status === 'open') {
    args.push(OPEN_STATUSES);
    where += ` AND status = ANY($${args.length}::text[])`;
  } else if (status === 'closed') {
    where += ` AND status IN ('completed','cancelled')`;
  } else if (typeof status === 'string' && status) {
    args.push(status);
    where += ` AND status = $${args.length}`;
  }
  args.push(lim, off);
  const { rows } = await query(
    `SELECT * FROM market_orders WHERE ${where}
      ORDER BY created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  return rows.map((r) => toOrder(r, side === 'seller' ? 'seller' : 'buyer'));
};

export const orderHistory = async (orderId, viewerId) => {
  const found = await accessOrder(orderId, viewerId);
  if (!found) return null;
  const { rows } = await query(
    `SELECT actor_role, from_status, to_status, detail, created_at
       FROM market_order_events WHERE order_id = $1 ORDER BY created_at, id`,
    [found.order.id]);
  return rows.map((r) => ({
    role: r.actor_role,
    from: r.from_status,
    to: r.to_status,
    detail: r.detail ?? {},
    at: r.created_at?.toISOString?.() ?? undefined,
  }));
};

/* ─── Отзыв ────────────────────────────────────────────────────────── */

/**
 * Отзыв оставляет покупатель и только по закрытой сделке.
 *
 * Один отзыв на заказ — это ключ в базе, а не проверка в коде: проверка
 * в коде — это гонка между двумя нажатиями, а ключ — правило.
 */
export const leaveReview = async (orderId, buyerId, { rating, text: body } = {}) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  const stars = int(rating, 1, 5);
  if (!stars) return { error: 'bad_rating' };

  const { rows } = await query(
    'SELECT * FROM market_orders WHERE id = $1 AND buyer_id = $2', [id, buyerId]);
  const order = rows[0];
  if (!order) return { error: 'not_found' };
  if (order.status !== 'completed') return { error: 'order_not_completed' };

  const { rows: made } = await query(
    `INSERT INTO market_reviews (id, order_id, product_id, seller_id, buyer_id, rating, body_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING id`,
    [`mr-${generateId()}`, id, order.product_id, order.seller_id, buyerId, stars,
      text(body, MAX_REVIEW) ? encryptContent(text(body, MAX_REVIEW)) : null]);
  if (!made[0]) return { error: 'already_reviewed' };

  await recalcRatings(order.product_id, order.seller_id);
  await logMarket(buyerId, 'review_left', id, { rating: stars });
  return { ok: true, reviewId: made[0].id };
};

/* ─── Статистика продавца ──────────────────────────────────────────── */

/**
 * Что показывается продавцу.
 *
 * Счётчики и рейтинг — и ничего про деньги. Ни оборота, ни баланса, ни
 * доступных к выводу средств: Sky денег продавца не держит и знать их
 * не может. Сумма сделок видна продавцу в его же заказах, потому что
 * там она — снимок цены, а не наш учёт его кассы.
 */
export const sellerStats = async (sellerId) => {
  const { rows } = await query(
    `SELECT s.rating, s.review_count, s.orders_total, s.orders_done, s.orders_cancel,
            (SELECT count(*)::int FROM market_products p
              WHERE p.seller_id = s.profile_id AND p.active) AS products_active,
            (SELECT count(*)::int FROM market_orders o
              WHERE o.seller_id = s.profile_id AND o.status = ANY($2::text[])) AS orders_open
       FROM market_sellers s WHERE s.profile_id = $1`,
    [sellerId, OPEN_STATUSES]);
  const r = rows[0];
  if (!r) return null;
  return {
    rating: r.rating === null ? null : Number(r.rating),
    reviewCount: Number(r.review_count),
    ordersTotal: Number(r.orders_total),
    ordersDone: Number(r.orders_done),
    ordersCancelled: Number(r.orders_cancel),
    ordersOpen: Number(r.orders_open),
    productsActive: Number(r.products_active),
  };
};

/* ─── Уведомления наружу ───────────────────────────────────────────── */

export const listNotifications = async (userId, { limit } = {}) => {
  const lim = int(limit, 1, 100) ?? 50;
  const { rows } = await query(
    `SELECT id, order_id, kind, title, body, read_at, created_at
       FROM market_notifications WHERE user_id = $1
      ORDER BY created_at DESC LIMIT $2`, [userId, lim]);
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    read: Boolean(r.read_at),
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};

export const readNotification = async (userId, notificationId) => {
  const { rowCount } = await query(
    'UPDATE market_notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
    [String(notificationId ?? ''), userId]);
  return rowCount > 0;
};

export const readAllNotifications = async (userId) => {
  const { rowCount } = await query(
    'UPDATE market_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [userId]);
  return rowCount;
};

export { OPEN_STATUSES, FLOW, canSell };
