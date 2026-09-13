/**
 * Sky Market: продавцы, товары, каталог.
 *
 * Здесь живёт всё, что можно продать, и все, кто продаёт. Сделки — в
 * marketorders.mjs, переписка — в marketchat.mjs, доставка — в
 * marketdelivery.mjs. Права решаются в этих файлах и только в них;
 * маршруты умеют лишь спросить.
 *
 * Про деньги, потому что это главное в этом модуле.
 *
 * Sky не хранит деньги ни покупателя, ни продавца. Здесь нет баланса
 * продавца, нет вывода средств, нет комиссии со сделки, нет замороженных
 * сумм. Покупатель переводит продавцу напрямую, мимо нас, и мы этого
 * перевода не видим.
 *
 * Единственные деньги, которые Sky берёт, — подписка продавца за место
 * на витрине: 79 рублей в неделю. Она платится из кошелька Sky и к
 * обороту продавца отношения не имеет. Проверяется она на сервере; в
 * запросе от клиента слов вроде is_seller или subscription_active не
 * читается никогда.
 *
 * Цену, продавца и наличие тоже определяет сервер. Клиент присылает
 * идентификатор товара и количество — всё остальное берётся из базы.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { isAdmin } from './admin.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';

/* ─── Подписка продавца ────────────────────────────────────────────── */

/** Столько стоит неделя на витрине. */
export const SELLER_PRICE = 79;
export const SELLER_DAYS = 7;

/* ─── Пределы ──────────────────────────────────────────────────────── */

const MAX_SHOP_NAME = 60;
const MAX_SHOP_DESC = 2000;
const MAX_PAYMENT_DETAILS = 600;
const MAX_TITLE = 140;
const MAX_DESC = 6000;
const MAX_PRODUCTS_PER_SELLER = 2000;
const MAX_IMAGES_PER_PRODUCT = 8;
/** Потолок цены: миллион рублей в копейках. Выше — это не товар, а опечатка. */
const MAX_PRICE_KOP = 100_000_000;

export const PRODUCT_ID_RE = /^mp-[0-9a-f-]{36}$/;
export const ORDER_ID_RE   = /^mo-[0-9a-f-]{36}$/;
export const CHAT_ID_RE    = /^mc-[0-9a-f-]{36}$/;
export const GAME_ID_RE    = /^mg-[0-9a-f-]{36}$/;

export const CATEGORIES = [
  'electronics', 'clothing', 'home', 'beauty',
  'sports', 'books', 'toys', 'food', 'other',
];

/**
 * Виды игровых лотов.
 *
 * Список закрытый и намеренно короткий: сюда попадает только то, что не
 * нарушает правил игровых площадок, издателей и платёжных систем.
 * Расширять его — отдельное решение, а не побочный эффект записи в базу.
 */
export const GAME_CATEGORIES = [
  'currency', 'items', 'skins', 'keys', 'dlc',
  'giftcards', 'topup', 'services', 'subscriptions',
];

export const MARKET_TYPES = ['standard', 'game', 'service'];

/**
 * Виды услуг.
 *
 * Свой список, а не категории товаров: «дизайн» и «продукты питания» в
 * одном списке не значат ничего ни покупателю, ни поиску.
 */
export const SERVICE_CATEGORIES = [
  'design', 'dev', 'music', 'video', 'writing', 'marketing', 'gaming', 'other',
];

export const SERVICE_LEVELS = ['basic', 'standard', 'premium'];

/* ─── Мелкие помощники ─────────────────────────────────────────────── */

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/**
 * Целое в границах — или null.
 *
 * Пустая строка, null и объект целым не считаются. Без этой проверки
 * Number('') дал бы ноль, и «не прислали цену» стало бы «прислали ноль».
 */
const int = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean' || typeof v === 'object') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
};

/**
 * Строка для поиска.
 *
 * Считается здесь, в JavaScript, а не через lower() в запросе. Для
 * кириллицы lower() зависит от локали базы: на одной машине поиск
 * работает, на другой молча не находит ничего. На этом уже обжигались
 * в афише билетов, и повторять не будем.
 */
const searchTextFor = (parts) => parts
  .filter(Boolean)
  .join(' ')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .slice(0, 2000);

export const logMarket = async (actorId, action, subject, detail = {}) => {
  try {
    await query(
      'INSERT INTO market_log (actor_id, action, subject, detail) VALUES ($1,$2,$3,$4)',
      [actorId ?? null, text(action, 64), subject ? text(subject, 128) : null, JSON.stringify(detail ?? {})],
    );
  } catch {
    /* Журнал не должен ронять то, что он описывает. */
  }
};

/* ─── Продавец ─────────────────────────────────────────────────────── */

const toSeller = (row, own = false) => row && ({
  id: row.profile_id,
  shopName: row.shop_name,
  description: row.description,
  hasAvatar: Boolean(row.has_avatar),
  status: row.status,
  rating: row.rating == null ? null : Math.round(Number(row.rating) * 10) / 10,
  reviewCount: Number(row.review_count ?? 0),
  ordersTotal: Number(row.orders_total ?? 0),
  ordersDone: Number(row.orders_done ?? 0),
  ordersCancelled: Number(row.orders_cancel ?? 0),
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  /* Есть ли куда переводить. Признак виден всем: покупателю полезно
     знать, что продавец готов принять оплату, а сами реквизиты для
     этого показывать не нужно. */
  hasPaymentDetails: Boolean(row.has_payment_details),
  /* Режим работы магазина: напрямую или через свой склад. Виден всем —
     покупателю полезно знать, что заказ поедет через склад. */
  fulfilmentMode: row.fulfilment_mode ?? 'direct',
  fulfilmentWarehouseId: own ? (row.fulfilment_warehouse_id ?? null) : undefined,
  /* Сами реквизиты — только самому продавцу. Покупателю они приходят
     иначе: по его собственному заказу, из readOrderPaymentDetails. */
  paymentDetails: own && row.payment_details_enc
    ? (decryptContent(row.payment_details_enc) ?? '')
    : undefined,
  /* Состояние подписки — разговор с самим продавцом. Покупателю в
     карточке магазина знать, до какого числа оплачено, незачем. */
  subscription: own ? subscriptionOf(row) : undefined,
});

/**
 * Подписка в том виде, в каком её честно показать.
 *
 * Срок вышел, а в колонке всё ещё «active» — это не «активна», это «мы
 * ещё не успели переписать колонку». Показываем правду.
 */
const subscriptionOf = (row) => {
  const until = row.sub_until ? new Date(row.sub_until) : null;
  const live = row.sub_status === 'active' && until !== null && until.getTime() > Date.now();
  return {
    active: live,
    status: live ? 'active' : row.sub_status === 'active' ? 'expired' : 'inactive',
    until: until ? until.toISOString() : null,
    price: SELLER_PRICE,
    days: SELLER_DAYS,
  };
};

const sellerRow = async (profileId) => {
  if (!profileId) return null;
  const { rows } = await query('SELECT * FROM market_sellers WHERE profile_id = $1', [profileId]);
  return rows[0] ?? null;
};

/**
 * Может ли этот человек торговать прямо сейчас.
 *
 * Единственное место, где отвечают на этот вопрос. Ни одна ручка не
 * решает его сама и не верит присланному признаку: проверка ходит в
 * базу, потому что подписку оплачивают деньгами, а не полем в запросе.
 */
export const canSell = async (profileId) => {
  const row = await sellerRow(profileId);
  if (!row) return { ok: false, error: 'not_a_seller' };
  if (row.status === 'suspended') return { ok: false, error: 'seller_suspended' };
  if (row.status === 'pending') return { ok: false, error: 'seller_pending' };
  if (!subscriptionOf(row).active) return { ok: false, error: 'subscription_required' };
  /* Sky денег не держит, и единственный путь оплаты — прямой перевод
     продавцу. Продавец без реквизитов получить деньги не может, а
     значит и торговать ему нечем: заказ по такому товару застрял бы
     на «покупатель не знает, куда платить». */
  if (!row.has_payment_details) return { ok: false, error: 'payment_details_required' };
  return { ok: true, row };
};

/** Профиль продавца глазами покупателя. */
export const readSeller = async (sellerId, viewerId) => {
  const row = await sellerRow(sellerId);
  if (!row) return null;
  /* Закрытый администрацией магазин виден только ему самому и
     администрации: покупателю показывать витрину, на которой нельзя
     купить, незачем. */
  if (row.status === 'suspended' && sellerId !== viewerId && !(await isAdmin(viewerId))) return null;
  return toSeller(row, sellerId === viewerId);
};

/** Свой профиль продавца — со состоянием подписки. */
export const readMySeller = async (profileId) => {
  const row = await sellerRow(profileId);
  return row ? toSeller(row, true) : null;
};

/** Завести магазин. Подписка оплачивается отдельно. */
export const createSeller = async (profileId, { shopName, description, paymentDetails } = {}) => {
  const name = text(shopName, MAX_SHOP_NAME);
  if (name.length < 2) return { error: 'bad_shop_name' };

  const exists = await sellerRow(profileId);
  if (exists) return { error: 'already_seller' };

  const details = text(paymentDetails, MAX_PAYMENT_DETAILS);
  const { rows } = await query(
    `INSERT INTO market_sellers
       (profile_id, shop_name, description, payment_details_enc, has_payment_details)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [profileId, name, text(description, MAX_SHOP_DESC),
      details ? encryptContent(details) : null, Boolean(details)],
  );
  await logMarket(profileId, 'seller_created', profileId);
  return { seller: toSeller(rows[0], true) };
};

export const updateSeller = async (profileId, patch = {}) => {
  const row = await sellerRow(profileId);
  if (!row) return { error: 'not_a_seller' };

  const sets = [];
  const args = [profileId];
  if (patch.shopName !== undefined) {
    const name = text(patch.shopName, MAX_SHOP_NAME);
    if (name.length < 2) return { error: 'bad_shop_name' };
    args.push(name); sets.push(`shop_name = $${args.length}`);
  }
  if (patch.description !== undefined) {
    args.push(text(patch.description, MAX_SHOP_DESC));
    sets.push(`description = $${args.length}`);
  }
  /*
   * Реквизиты для перевода.
   *
   * Хранятся зашифрованными и в журнал не попадают: это платёжные
   * данные живого человека. Пустая строка означает «убрать» — и тогда
   * продавец перестаёт быть в состоянии торговать, потому что деньги
   * ему переводить некуда.
   */
  /*
   * Режим работы магазина.
   *
   * Через склад — значит склад должен быть и должен быть свой: чужой
   * склад своим режимом работы не назначишь, а склад «где-то там» не
   * назначишь вовсе, потому что заказы поедут в никуда.
   */
  if (patch.fulfilmentMode !== undefined) {
    const mode = patch.fulfilmentMode === 'warehouse' ? 'warehouse' : 'direct';
    let warehouseId = null;
    if (mode === 'warehouse') {
      const wid = text(patch.fulfilmentWarehouseId, 80);
      if (!wid) return { error: 'warehouse_required' };
      const { rows: w } = await query(
        'SELECT id FROM logi_warehouses WHERE id = $1 AND seller_id = $2', [wid, profileId]);
      if (!w[0]) return { error: 'not_your_warehouse' };
      warehouseId = w[0].id;
    }
    args.push(mode); sets.push(`fulfilment_mode = $${args.length}`);
    args.push(warehouseId); sets.push(`fulfilment_warehouse_id = $${args.length}`);
  }

  if (patch.paymentDetails !== undefined) {
    const details = text(patch.paymentDetails, MAX_PAYMENT_DETAILS);
    args.push(details ? encryptContent(details) : null);
    sets.push(`payment_details_enc = $${args.length}`);
    args.push(Boolean(details));
    sets.push(`has_payment_details = $${args.length}`);
  }
  if (sets.length === 0) return { seller: toSeller(row, true) };

  const { rows } = await query(
    `UPDATE market_sellers SET ${sets.join(', ')}, updated_at = now()
      WHERE profile_id = $1 RETURNING *`, args);
  await logMarket(profileId, 'seller_updated', profileId);
  return { seller: toSeller(rows[0], true) };
};

export const setSellerAvatar = async (profileId, mime) => {
  const { rowCount } = await query(
    'UPDATE market_sellers SET has_avatar = TRUE, avatar_mime = $2, updated_at = now() WHERE profile_id = $1',
    [profileId, String(mime)]);
  return rowCount > 0;
};

export const sellerAvatarMime = async (sellerId) => {
  const { rows } = await query(
    'SELECT avatar_mime FROM market_sellers WHERE profile_id = $1 AND has_avatar', [sellerId]);
  return rows[0]?.avatar_mime ?? null;
};

/**
 * Оплатить неделю на витрине.
 *
 * Деньги списываются из кошелька Sky — это плата нам за место, а не
 * часть чьей-то сделки. Продление считается от большей из двух дат:
 * «сейчас» и «до какого числа уже оплачено», иначе оплата за неделю
 * вперёд сокращала бы срок вместо того, чтобы его продлевать.
 */
export const paySellerSubscription = async (profileId) => {
  const row = await sellerRow(profileId);
  if (!row) return { error: 'not_a_seller' };
  if (row.status === 'suspended') return { error: 'seller_suspended' };

  const paid = await wallet.spend(
    profileId, SELLER_PRICE, 'market_subscription',
    `Sky Market: место на витрине, ${SELLER_DAYS} дн.`);
  if (paid.error) return paid;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE market_sellers
          SET sub_status = 'active',
              sub_started = COALESCE(sub_started, now()),
              sub_until = GREATEST(COALESCE(sub_until, now()), now())
                          + ($2::int * interval '1 day'),
              updated_at = now()
        WHERE profile_id = $1
        RETURNING *`,
      [profileId, SELLER_DAYS],
    );
    await client.query(
      `INSERT INTO market_seller_payments (id, profile_id, amount, days, until)
       VALUES ($1,$2,$3,$4,$5)`,
      [`msp-${generateId()}`, profileId, SELLER_PRICE, SELLER_DAYS, rows[0].sub_until],
    );
    await client.query('COMMIT');
    await logMarket(profileId, 'subscription_paid', profileId, { days: SELLER_DAYS });
    return { seller: toSeller(rows[0], true), balance: paid.balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    /* Деньги списаны, а подписка не продлилась — возвращаем: платёж без
       услуги хуже, чем услуга без платежа. */
    await wallet.refund(profileId, SELLER_PRICE, 'Sky Market: возврат за место на витрине')
      .catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Погасить просроченные подписки.
 *
 * Колонка должна говорить правду и без запроса: иначе выборки по
 * sub_status = 'active' считают торгующими тех, у кого срок вышел.
 */
export const sweepSellerSubscriptions = async () => {
  const { rowCount } = await query(
    `UPDATE market_sellers SET sub_status = 'inactive', updated_at = now()
      WHERE sub_status = 'active' AND (sub_until IS NULL OR sub_until <= now())`);
  return rowCount;
};

/* ─── Игры ─────────────────────────────────────────────────────────── */

const toGame = (row) => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  description: row.description,
  hasCover: Boolean(row.has_cover),
  order: Number(row.sort_order ?? 0),
  hidden: Boolean(row.hidden),
});

export const listGames = async ({ all = false } = {}) => {
  const { rows } = await query(
    `SELECT * FROM market_games ${all ? '' : 'WHERE NOT hidden'}
      ORDER BY sort_order, title`);
  return rows.map(toGame);
};

export const readGame = async (idOrSlug) => {
  const { rows } = await query(
    'SELECT * FROM market_games WHERE id = $1 OR slug = $1', [String(idOrSlug ?? '')]);
  return rows[0] ? toGame(rows[0]) : null;
};

/** Игры заводит администрация: это витрина платформы, а не товар продавца. */
export const createGame = async (actorId, { title, slug, description, order } = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  const name = text(title, 120);
  const key = text(slug, 60).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  if (name.length < 2 || key.length < 2) return { error: 'bad_game' };

  const { rows } = await query(
    `INSERT INTO market_games (id, title, slug, description, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (slug) DO NOTHING
     RETURNING *`,
    [`mg-${generateId()}`, name, key, text(description, 2000), int(order, 0, 10000) ?? 0],
  );
  if (!rows[0]) return { error: 'slug_taken' };
  await logMarket(actorId, 'game_created', rows[0].id);
  return { game: toGame(rows[0]) };
};

export const updateGame = async (actorId, gameId, patch = {}) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  if (!GAME_ID_RE.test(String(gameId ?? ''))) return { error: 'not_found' };

  const sets = [];
  const args = [gameId];
  if (patch.title !== undefined) { args.push(text(patch.title, 120)); sets.push(`title = $${args.length}`); }
  if (patch.description !== undefined) { args.push(text(patch.description, 2000)); sets.push(`description = $${args.length}`); }
  if (patch.hidden !== undefined) { args.push(patch.hidden === true); sets.push(`hidden = $${args.length}`); }
  if (patch.order !== undefined) { args.push(int(patch.order, 0, 10000) ?? 0); sets.push(`sort_order = $${args.length}`); }
  if (sets.length === 0) return { error: 'nothing_to_change' };

  const { rows } = await query(
    `UPDATE market_games SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);
  if (!rows[0]) return { error: 'not_found' };
  await logMarket(actorId, 'game_updated', gameId);
  return { game: toGame(rows[0]) };
};

export const setGameCover = async (actorId, gameId, mime) => {
  if (!(await isAdmin(actorId))) return false;
  const { rowCount } = await query(
    'UPDATE market_games SET has_cover = TRUE, cover_mime = $2 WHERE id = $1',
    [gameId, String(mime)]);
  return rowCount > 0;
};

export const gameCoverMime = async (gameId) => {
  const { rows } = await query(
    'SELECT cover_mime FROM market_games WHERE id = $1 AND has_cover', [gameId]);
  return rows[0]?.cover_mime ?? null;
};

/* ─── Товары ───────────────────────────────────────────────────────── */

/**
 * Что уходит клиенту.
 *
 * Ни путей на диске, ни имени файла от загрузившего, ни служебных
 * отметок: по ответу не должно быть видно, как устроено хранилище.
 * Цена отдаётся и копейками, и рублями — копейки для расчётов, рубли
 * для показа, и ни одно из двух не приходит от клиента обратно.
 */
export const toProduct = (row) => ({
  id: row.id,
  sellerId: row.seller_id,
  sellerName: row.shop_name ?? undefined,
  sellerRating: row.seller_rating == null ? undefined : Math.round(Number(row.seller_rating) * 10) / 10,
  marketType: row.market_type,
  title: row.title,
  description: row.description,
  priceKop: Number(row.price_kop),
  price: Number(row.price_kop) / 100,
  oldPriceKop: row.old_price_kop == null ? undefined : Number(row.old_price_kop),
  oldPrice: row.old_price_kop == null ? undefined : Number(row.old_price_kop) / 100,
  category: row.category,
  stock: Number(row.stock ?? 0),
  inStock: Number(row.stock ?? 0) > 0,
  gameId: row.game_id ?? undefined,
  gameTitle: row.game_title ?? undefined,
  gameCategory: row.game_category ?? undefined,
  region: row.region ?? undefined,
  serviceCategory: row.service_category ?? undefined,
  tags: Array.isArray(row.tags) ? row.tags : [],
  packages: Array.isArray(row.packages) ? row.packages : undefined,
  active: Boolean(row.active),
  sold: Number(row.sold ?? 0),
  rating: row.rating == null ? null : Math.round(Number(row.rating) * 10) / 10,
  reviewCount: Number(row.review_count ?? 0),
  images: row.image_ids ?? [],
  favorite: row.favorite === true || undefined,
  own: row.own === true || undefined,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

/* Общий кусок выборки. Первым параметром всегда идёт тот, кто
   спрашивает: от него зависят «своё» и «в избранном». Порядок держим
   одинаковым во всех запросах — разъехавшаяся нумерация $-параметров
   однажды уже приводила к чужому идентификатору в чужой выборке. */
const SELECT_PRODUCT = `
  SELECT p.*,
         s.shop_name,
         s.rating AS seller_rating,
         g.title AS game_title,
         p.seller_id = $1 AS own,
         EXISTS (SELECT 1 FROM market_favorites f
                  WHERE f.product_id = p.id AND f.user_id = $1) AS favorite,
         ARRAY(SELECT i.id FROM market_product_images i
                WHERE i.product_id = p.id ORDER BY i.sort_order, i.created_at) AS image_ids,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'level', k.level, 'title', k.title, 'description', k.description,
                     'price', k.price_kop / 100.0, 'priceKop', k.price_kop,
                     'delivery', k.delivery_days, 'revisions', k.revisions,
                     'includes', k.includes) ORDER BY k.price_kop)
                    FROM market_service_packages k WHERE k.product_id = p.id),
                  '[]'::jsonb) AS packages
    FROM market_products p
    JOIN market_sellers s ON s.profile_id = p.seller_id
    LEFT JOIN market_games g ON g.id = p.game_id
`;

/**
 * Виден ли товар этому человеку.
 *
 * Снятый с витрины и товар закрытого магазина виден только своему
 * владельцу и администрации. Чужой скрытый товар неотличим от
 * несуществующего: разница в ответах сама по себе рассказывает, что
 * такой товар есть.
 */
export const readProduct = async (productId, viewerId) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return null;
  const { rows } = await query(`${SELECT_PRODUCT} WHERE p.id = $2`, [viewerId ?? '', productId]);
  const row = rows[0];
  if (!row) return null;
  const mine = row.seller_id === viewerId;
  if (!mine && (!row.active || row.status === 'suspended')) {
    if (!(await isAdmin(viewerId))) return null;
  }
  return toProduct(row);
};

/**
 * Каталог.
 *
 * Поиск идёт параметром, а не склейкой строки, поэтому кавычка в
 * запросе — это просто кавычка. ESCAPE обязателен: без него «%» из
 * запроса стал бы шаблоном и вернул весь каталог одним символом.
 */
export const listCatalog = async (viewerId, {
  marketType = 'standard', q, category, gameId, gameCategory, serviceCategory,
  sellerId, sort, limit, offset, minPrice, maxPrice,
} = {}) => {
  const lim = int(limit, 1, 100) ?? 40;
  const off = int(offset, 0, 100000) ?? 0;
  const args = [viewerId ?? ''];
  const where = ['p.active', "s.status = 'active'"];

  args.push(MARKET_TYPES.includes(marketType) ? marketType : 'standard');
  where.push(`p.market_type = $${args.length}`);

  const needle = text(q, 120).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`p.search_text LIKE $${args.length} ESCAPE '\\'`);
  }
  if (category && CATEGORIES.includes(String(category))) {
    args.push(String(category)); where.push(`p.category = $${args.length}`);
  }
  if (gameId && GAME_ID_RE.test(String(gameId))) {
    args.push(String(gameId)); where.push(`p.game_id = $${args.length}`);
  }
  if (gameCategory && GAME_CATEGORIES.includes(String(gameCategory))) {
    args.push(String(gameCategory)); where.push(`p.game_category = $${args.length}`);
  }
  if (serviceCategory && SERVICE_CATEGORIES.includes(String(serviceCategory))) {
    args.push(String(serviceCategory)); where.push(`p.service_category = $${args.length}`);
  }
  if (sellerId) { args.push(String(sellerId)); where.push(`p.seller_id = $${args.length}`); }

  const lo = int(minPrice, 0, MAX_PRICE_KOP);
  if (lo !== null) { args.push(lo); where.push(`p.price_kop >= $${args.length}`); }
  const hi = int(maxPrice, 0, MAX_PRICE_KOP);
  if (hi !== null) { args.push(hi); where.push(`p.price_kop <= $${args.length}`); }

  /* Порядок сортировки выбирается из списка, а не подставляется из
     запроса: подстановка в ORDER BY — это внедрение в запрос. */
  const order = {
    new: 'p.created_at DESC',
    cheap: 'p.price_kop ASC, p.created_at DESC',
    expensive: 'p.price_kop DESC, p.created_at DESC',
    popular: 'p.sold DESC, p.created_at DESC',
    rating: 'p.rating DESC NULLS LAST, p.created_at DESC',
  }[String(sort ?? 'new')] ?? 'p.created_at DESC';

  args.push(lim, off);
  const { rows } = await query(
    `${SELECT_PRODUCT} WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  return rows.map(toProduct);
};

/** Товары продавца, включая снятые с витрины: это его кабинет. */
export const listMyProducts = async (sellerId, { limit, offset } = {}) => {
  const lim = int(limit, 1, 200) ?? 100;
  const off = int(offset, 0, 100000) ?? 0;
  const { rows } = await query(
    `${SELECT_PRODUCT} WHERE p.seller_id = $1
      ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
    [sellerId, lim, off],
  );
  return rows.map(toProduct);
};

export const listFavorites = async (userId, { limit } = {}) => {
  const lim = int(limit, 1, 200) ?? 100;
  const { rows } = await query(
    `${SELECT_PRODUCT}
       JOIN market_favorites f2 ON f2.product_id = p.id AND f2.user_id = $1
      WHERE p.active AND s.status = 'active'
      ORDER BY f2.created_at DESC LIMIT $2`,
    [userId, lim],
  );
  return rows.map(toProduct);
};

export const setFavorite = async (userId, productId, on) => {
  const product = await readProduct(productId, userId);
  if (!product) return { error: 'not_found' };
  if (on) {
    await query(
      'INSERT INTO market_favorites (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, productId]);
  } else {
    await query('DELETE FROM market_favorites WHERE user_id = $1 AND product_id = $2',
      [userId, productId]);
  }
  return { ok: true };
};

/**
 * Проверка полей товара.
 *
 * Одна на создание и на правку: разошедшиеся проверки — это способ
 * положить через правку то, что не пустили при создании.
 */
const validateProduct = async (input, { partial = false } = {}) => {
  const out = {};

  if (!partial || input.title !== undefined) {
    const t = text(input.title, MAX_TITLE);
    if (t.length < 2) return { error: 'bad_title' };
    out.title = t;
  }
  if (!partial || input.description !== undefined) {
    out.description = text(input.description, MAX_DESC);
  }
  if (!partial || input.priceKop !== undefined) {
    const price = int(input.priceKop, 1, MAX_PRICE_KOP);
    if (price === null) return { error: 'bad_price' };
    out.price_kop = price;
  }
  if (input.oldPriceKop !== undefined) {
    out.old_price_kop = input.oldPriceKop === null ? null : int(input.oldPriceKop, 1, MAX_PRICE_KOP);
  }
  if (!partial || input.category !== undefined) {
    const c = String(input.category ?? 'other');
    out.category = CATEGORIES.includes(c) ? c : 'other';
  }
  if (!partial || input.stock !== undefined) {
    const s = int(input.stock, 0, 1_000_000);
    if (s === null) return { error: 'bad_stock' };
    out.stock = s;
  }
  if (input.active !== undefined) out.active = input.active === true;
  if (input.region !== undefined) out.region = text(input.region, 60) || null;
  if (input.serviceCategory !== undefined) {
    const c = String(input.serviceCategory ?? '');
    out.service_category = SERVICE_CATEGORIES.includes(c) ? c : null;
  }
  if (input.tags !== undefined) {
    /* Метки чистим и режем: это строка поиска, а не место для
       произвольного объёма данных от клиента. */
    const tags = Array.isArray(input.tags)
      ? input.tags.slice(0, 12).map((t) => text(t, 30)).filter(Boolean)
      : [];
    out.tags = JSON.stringify(tags);
  }

  return { fields: out };
};

/**
 * Создать товар.
 *
 * Продавец должен быть продавцом с оплаченной подпиской — и это
 * спрашивается у базы, а не у запроса. Тип товара решает, что ещё
 * обязательно: игровому лоту нужна игра и вид, обычному — ничего
 * сверх общего.
 */
export const createProduct = async (sellerId, input = {}) => {
  const allowed = await canSell(sellerId);
  if (!allowed.ok) return { error: allowed.error };

  const marketType = MARKET_TYPES.includes(String(input.marketType)) ? String(input.marketType) : 'standard';
  const checked = await validateProduct(input);
  if (checked.error) return checked;
  const f = checked.fields;

  if (marketType === 'service') {
    const c = String(input.serviceCategory ?? '');
    if (!SERVICE_CATEGORIES.includes(c)) return { error: 'bad_service_category' };
  }

  let gameId = null;
  let gameCategory = null;
  if (marketType === 'game') {
    const game = input.gameId ? await readGame(input.gameId) : null;
    if (!game) return { error: 'bad_game' };
    gameId = game.id;
    gameCategory = GAME_CATEGORIES.includes(String(input.gameCategory)) ? String(input.gameCategory) : null;
    if (!gameCategory) return { error: 'bad_game_category' };
  }

  const { rows: count } = await query(
    'SELECT count(*)::int AS n FROM market_products WHERE seller_id = $1', [sellerId]);
  if ((count[0]?.n ?? 0) >= MAX_PRODUCTS_PER_SELLER) return { error: 'too_many_products' };

  const id = `mp-${generateId()}`;
  await query(
    `INSERT INTO market_products
       (id, seller_id, market_type, title, description, price_kop, old_price_kop,
        category, stock, game_id, game_category, region, service_category, tags, search_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
    [id, sellerId, marketType, f.title, f.description, f.price_kop, f.old_price_kop ?? null,
      f.category, f.stock, gameId, gameCategory, f.region ?? null,
      f.service_category ?? null, f.tags ?? '[]',
      searchTextFor([f.title, f.description, ...(JSON.parse(f.tags ?? '[]'))])],
  );
  await logMarket(sellerId, 'product_created', id, { marketType });
  return { product: await readProduct(id, sellerId) };
};

/** Правка товара. Чужой товар не правится: сравнение идёт с владельцем из базы. */
export const updateProduct = async (productId, sellerId, patch = {}) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT seller_id, title, description FROM market_products WHERE id = $1', [productId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].seller_id !== sellerId) return { error: 'not_allowed' };

  const allowed = await canSell(sellerId);
  if (!allowed.ok) return { error: allowed.error };

  const checked = await validateProduct(patch, { partial: true });
  if (checked.error) return checked;
  const f = checked.fields;

  const sets = [];
  const args = [productId];
  for (const [col, val] of Object.entries(f)) {
    args.push(val);
    /* Метки — jsonb: без приведения Postgres примет их за строку. */
    sets.push(col === 'tags' ? `tags = $${args.length}::jsonb` : `${col} = $${args.length}`);
  }
  if (patch.gameCategory !== undefined) {
    const gc = GAME_CATEGORIES.includes(String(patch.gameCategory)) ? String(patch.gameCategory) : null;
    args.push(gc); sets.push(`game_category = $${args.length}`);
  }
  if (sets.length === 0) return { product: await readProduct(productId, sellerId) };

  /* Строку поиска пересобираем из того, что получится ПОСЛЕ правки, а
     не из присланного: иначе смена одного описания оставляла бы в
     поиске старое название. */
  const nextTitle = f.title ?? rows[0].title;
  const nextDesc = f.description ?? rows[0].description;
  args.push(searchTextFor([nextTitle, nextDesc]));
  sets.push(`search_text = $${args.length}`);

  await query(`UPDATE market_products SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  await logMarket(sellerId, 'product_updated', productId);
  return { product: await readProduct(productId, sellerId) };
};

/**
 * Снять товар с витрины.
 *
 * Именно снять, а не удалить: на товар ссылаются заказы, и удалённая
 * строка стёрла бы историю чужой покупки. Витрина при этом его больше
 * не показывает.
 */
export const archiveProduct = async (productId, actorId) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT seller_id FROM market_products WHERE id = $1', [productId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].seller_id !== actorId && !(await isAdmin(actorId))) return { error: 'not_allowed' };

  await query('UPDATE market_products SET active = FALSE, updated_at = now() WHERE id = $1', [productId]);
  await logMarket(actorId, 'product_archived', productId);
  return { ok: true };
};

/* ─── Картинки товара ──────────────────────────────────────────────── */

export const addProductImage = async (productId, sellerId, mime) => {
  const { rows } = await query('SELECT seller_id FROM market_products WHERE id = $1', [productId]);
  if (!rows[0] || rows[0].seller_id !== sellerId) return { error: 'not_allowed' };

  const { rows: count } = await query(
    'SELECT count(*)::int AS n FROM market_product_images WHERE product_id = $1', [productId]);
  if ((count[0]?.n ?? 0) >= MAX_IMAGES_PER_PRODUCT) return { error: 'too_many_images' };

  const id = `mpi-${generateId()}`;
  await query(
    `INSERT INTO market_product_images (id, product_id, mime, sort_order)
     VALUES ($1,$2,$3,$4)`,
    [id, productId, String(mime), count[0]?.n ?? 0]);
  return { imageId: id };
};

export const readProductImage = async (imageId, viewerId) => {
  const { rows } = await query(
    `SELECT i.id, i.mime, i.product_id, p.seller_id, p.active, s.status
       FROM market_product_images i
       JOIN market_products p ON p.id = i.product_id
       JOIN market_sellers s ON s.profile_id = p.seller_id
      WHERE i.id = $1`,
    [String(imageId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  /* Ту же проверку, что и у самого товара: картинка снятого с витрины
     товара не должна оставаться открытой, пока открыт её адрес. */
  if (row.seller_id !== viewerId && (!row.active || row.status !== 'active')) {
    if (!(await isAdmin(viewerId))) return null;
  }
  return { mime: row.mime };
};

export const deleteProductImage = async (imageId, sellerId) => {
  const { rows } = await query(
    `SELECT i.id FROM market_product_images i
       JOIN market_products p ON p.id = i.product_id
      WHERE i.id = $1 AND p.seller_id = $2`,
    [String(imageId ?? ''), sellerId]);
  if (!rows[0]) return { error: 'not_found' };
  await query('DELETE FROM market_product_images WHERE id = $1', [imageId]);
  return { ok: true };
};

/* ─── Пакеты услуги ────────────────────────────────────────────────── */

const MAX_PACKAGE_INCLUDES = 12;

/**
 * Задать пакеты услуги.
 *
 * Пакеты приходят разом и разом же заменяются: три строки, которые
 * всегда редактируют вместе, проще переписать целиком, чем сводить
 * частичные правки. Цена пакета — целые копейки и больше нуля; «дешевле
 * нуля» не бывает даже в подарок.
 *
 * Владелец проверяется по базе. Право торговать — тоже: пакеты меняют
 * цену услуги, а цену на витрине правит только тот, кто вправе на ней
 * стоять.
 */
export const setServicePackages = async (productId, sellerId, packages) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT seller_id, market_type FROM market_products WHERE id = $1', [productId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].seller_id !== sellerId) return { error: 'not_allowed' };
  if (rows[0].market_type !== 'service') return { error: 'not_a_service' };

  const allowed = await canSell(sellerId);
  if (!allowed.ok) return { error: allowed.error };

  const list = Array.isArray(packages) ? packages.slice(0, SERVICE_LEVELS.length) : [];
  const clean = [];
  const seen = new Set();
  for (const p of list) {
    const level = String(p?.level ?? '');
    if (!SERVICE_LEVELS.includes(level) || seen.has(level)) continue;
    const price = int(p?.priceKop, 1, MAX_PRICE_KOP);
    if (price === null) return { error: 'bad_package_price' };
    const title = text(p?.title, 80);
    if (!title) return { error: 'bad_package_title' };
    seen.add(level);
    clean.push({
      level,
      title,
      description: text(p?.description, 600),
      price,
      delivery: int(p?.delivery, 1, 365) ?? 1,
      /* -1 — «без ограничения»: так это и показывалось на экране. */
      revisions: p?.revisions === -1 ? -1 : (int(p?.revisions, 0, 99) ?? 0),
      includes: Array.isArray(p?.includes)
        ? p.includes.slice(0, MAX_PACKAGE_INCLUDES).map((x) => text(x, 80)).filter(Boolean)
        : [],
    });
  }
  if (clean.length === 0) return { error: 'no_packages' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM market_service_packages WHERE product_id = $1', [productId]);
    for (const p of clean) {
      await client.query(
        `INSERT INTO market_service_packages
           (id, product_id, level, title, description, price_kop, delivery_days, revisions, includes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [`msp-${generateId()}`, productId, p.level, p.title, p.description,
          p.price, p.delivery, p.revisions, JSON.stringify(p.includes)]);
    }
    /* Цена самой услуги — цена самого дешёвого пакета: витрина должна
       показывать «от скольки», и считать это должен сервер. */
    const cheapest = clean.reduce((a, b) => (b.price < a.price ? b : a));
    await client.query(
      'UPDATE market_products SET price_kop = $2, updated_at = now() WHERE id = $1',
      [productId, cheapest.price]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await logMarket(sellerId, 'service_packages_set', productId, { count: clean.length });
  return { product: await readProduct(productId, sellerId) };
};

/**
 * Пакет услуги для заказа.
 *
 * Цену и срок берёт отсюда сервер — присланная клиентом цена пакета не
 * читается вовсе, иначе премиум покупался бы по цене базового.
 */
export const readServicePackage = async (productId, level) => {
  const { rows } = await query(
    'SELECT * FROM market_service_packages WHERE product_id = $1 AND level = $2',
    [String(productId ?? ''), String(level ?? '')]);
  const row = rows[0];
  if (!row) return null;
  return {
    level: row.level,
    title: row.title,
    priceKop: Number(row.price_kop),
    delivery: Number(row.delivery_days),
    revisions: Number(row.revisions),
  };
};

/* ─── Отзывы и пересчёт рейтинга ───────────────────────────────────── */

/**
 * Пересчёт рейтинга товара и продавца.
 *
 * Считается в базе по строкам отзывов, а не накапливается счётчиком:
 * накопленное среднее расходится с правдой при первом же удалённом
 * отзыве, и разошедшееся уже не сойдётся.
 */
export const recalcRatings = async (productId, sellerId) => {
  await query(
    `UPDATE market_products p
        SET rating = r.avg, review_count = r.n
       FROM (SELECT avg(rating)::numeric(3,2) AS avg, count(*)::int AS n
               FROM market_reviews WHERE product_id = $1) r
      WHERE p.id = $1`, [productId]);
  await query(
    `UPDATE market_sellers s
        SET rating = r.avg, review_count = r.n, updated_at = now()
       FROM (SELECT avg(rating)::numeric(3,2) AS avg, count(*)::int AS n
               FROM market_reviews WHERE seller_id = $1) r
      WHERE s.profile_id = $1`, [sellerId]);
};

export const listReviews = async (productId, { limit } = {}) => {
  const lim = int(limit, 1, 100) ?? 50;
  const { rows } = await query(
    `SELECT r.id, r.rating, r.body_enc, r.created_at, p.name AS buyer_name
       FROM market_reviews r
       JOIN profiles p ON p.id = r.buyer_id
      WHERE r.product_id = $1
      ORDER BY r.created_at DESC LIMIT $2`,
    [String(productId ?? ''), lim]);
  return rows.map((r) => ({
    id: r.id,
    rating: Number(r.rating),
    text: r.body_enc ? (decryptContent(r.body_enc) ?? '') : '',
    buyerName: r.buyer_name,
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};

/* ─── Режим работы магазина ────────────────────────────────────────── */

/**
 * Как этот продавец отправляет заказы.
 *
 * Спрашивается у базы каждый раз, когда решается, что заказу можно
 * дальше: присланного «я работаю напрямую» здесь не читается, иначе
 * заказ уезжал бы мимо склада, а остатки на складе врали бы.
 */
export const fulfilmentOf = async (sellerId) => {
  const { rows } = await query(
    'SELECT fulfilment_mode, fulfilment_warehouse_id FROM market_sellers WHERE profile_id = $1',
    [sellerId]);
  return {
    mode: rows[0]?.fulfilment_mode ?? 'direct',
    warehouseId: rows[0]?.fulfilment_warehouse_id ?? null,
  };
};

/* ─── Реквизиты продавца по заказу ─────────────────────────────────── */

/**
 * Куда покупателю переводить деньги.
 *
 * Реквизиты берутся из профиля продавца на сервере, а не из переписки:
 * присланные в чат реквизиты подменяет тот, кто в чат попал, и
 * покупатель переводит деньги не туда, куда думает.
 *
 * Выдаются только по живому заказу и только его покупателю. Продавцу
 * свои реквизиты приходят в его же профиле, поддержке — при разборе
 * спора. Постороннему, как и на чужой заказ, — ничего.
 *
 * По отменённому заказу реквизиты не выдаются: платить по нему уже
 * незачем, а оставленный на экране номер карты — это номер карты,
 * оставленный на экране.
 */
export const paymentDetailsForOrder = async (sellerId, { forBuyer = false } = {}) => {
  if (!forBuyer) return null;
  const { rows } = await query(
    'SELECT payment_details_enc FROM market_sellers WHERE profile_id = $1 AND has_payment_details',
    [sellerId]);
  const enc = rows[0]?.payment_details_enc;
  return enc ? (decryptContent(enc) ?? null) : null;
};

export { text as marketText, int as marketInt, searchTextFor, encryptContent, decryptContent };
