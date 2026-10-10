/**
 * Отслеживание посылки заказа Sky Market.
 *
 * Продавец указывает настоящий трек-номер, который получил у службы
 * (СДЭК, Почта России, DHL, UPS …), а стороны сделки видят состояние
 * посылки у самой службы. Источники и разбор — server/trackingproviders.mjs.
 *
 * Правила:
 *   · номер ставит и снимает только продавец этого заказа, и только
 *     пока заказ в работе (оплачен и ещё не закрыт);
 *   · читают номер и состояние покупатель, продавец и поддержка Market;
 *   · состояние у службы заказ НЕ двигает — оно только показывается;
 *   · ответ службы кэшируется: служба с лимитами, а экран заказа
 *     открывают много раз.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logMarket, ORDER_ID_RE } from './market.mjs';
import { systemMessage } from './marketchat.mjs';
import {
  PROVIDERS, NUMBER_RE, trackingUrl, sourcesConfigured, fetchTracking, providerList,
} from './trackingproviders.mjs';

/** Пока заказ в этих состояниях, продавец ещё может указать/сменить трек. */
const TRACKABLE = new Set([
  'seller_payment_confirmed', 'fulfillment', 'seller_shipped', 'in_transit', 'ready_for_pickup',
]);

const TTL_MS = {
  delivered: 6 * 3600_000, returned: 6 * 3600_000, exception: 30 * 60_000,
};
const DEFAULT_TTL_MS = 15 * 60_000;
const NEGATIVE_TTL_MS = 60_000;

/** Недавние сбои службы — чтобы не долбить её, пока она лежит. */
const failures = new Map();

export { providerList };

const cached = async (provider, number) => {
  const { rows } = await query(
    'SELECT payload, fetched_at FROM parcel_tracking_cache WHERE provider = $1 AND number = $2',
    [provider, number]);
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - new Date(row.fetched_at).getTime();
  const ttl = TTL_MS[row.payload?.status] ?? DEFAULT_TTL_MS;
  return { payload: row.payload, fresh: age < ttl };
};

/**
 * Состояние посылки: из кэша, иначе у службы.
 * Возвращает { ok, data? , error? , url, live }.
 */
export const lookupParcel = async (provider, number) => {
  const prov = String(provider ?? '');
  const num = String(number ?? '').trim();
  if (!PROVIDERS[prov] || !NUMBER_RE.test(num)) return { ok: false, error: 'bad_input' };
  const url = trackingUrl(prov, num);
  const live = sourcesConfigured()[PROVIDERS[prov].source] === true;
  if (!live) return { ok: false, error: 'not_configured', url, live };

  const hit = await cached(prov, num);
  if (hit?.fresh) return { ok: true, data: hit.payload, url, live, cached: true };

  const key = `${prov}:${num}`;
  const failedAt = failures.get(key);
  if (failedAt && Date.now() - failedAt < NEGATIVE_TTL_MS) {
    // свежего ответа нет, а служба только что не ответила: отдаём то, что есть
    return hit
      ? { ok: true, data: hit.payload, url, live, cached: true, stale: true }
      : { ok: false, error: 'upstream_unavailable', url, live };
  }

  try {
    const data = await fetchTracking(prov, num);
    failures.delete(key);
    await query(
      `INSERT INTO parcel_tracking_cache (provider, number, payload, fetched_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (provider, number) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`,
      [prov, num, JSON.stringify(data)]);
    return { ok: true, data, url, live };
  } catch (err) {
    failures.set(key, Date.now());
    if (failures.size > 5000) failures.clear();
    return hit
      ? { ok: true, data: hit.payload, url, live, cached: true, stale: true }
      : { ok: false, error: err.message === 'not_configured' ? 'not_configured' : 'upstream_unavailable', url, live };
  }
};

const orderOf = async (orderId) => {
  if (!ORDER_ID_RE.test(String(orderId ?? ''))) return null;
  const { rows } = await query('SELECT id, buyer_id, seller_id, status FROM market_orders WHERE id = $1', [orderId]);
  return rows[0] ?? null;
};

/** Трек заказа и состояние посылки. null — заказа нет или он не ваш. */
export const getOrderTracking = async (orderId, viewerId) => {
  const order = await orderOf(orderId);
  if (!order) return null;
  const mine = order.buyer_id === viewerId || order.seller_id === viewerId;
  if (!mine && !(await can(viewerId, 'market'))) return null;

  const { rows } = await query('SELECT provider, number, updated_at FROM parcel_tracking WHERE order_id = $1', [order.id]);
  const t = rows[0];
  const canEdit = order.seller_id === viewerId && TRACKABLE.has(order.status);
  if (!t) return { tracking: null, canEdit };
  const result = await lookupParcel(t.provider, t.number);
  return {
    tracking: {
      provider: t.provider,
      providerTitle: PROVIDERS[t.provider]?.title ?? t.provider,
      number: t.number,
      url: trackingUrl(t.provider, t.number),
      updatedAt: t.updated_at,
    },
    parcel: result.ok ? result.data : null,
    parcelError: result.ok ? null : result.error,
    stale: result.stale === true,
    live: result.live === true,
    canEdit,
  };
};

export const setOrderTracking = async (orderId, sellerId, { provider, number } = {}) => {
  const order = await orderOf(orderId);
  if (!order || order.seller_id !== sellerId) return { error: 'not_found' };
  if (!TRACKABLE.has(order.status)) return { error: 'bad_status' };
  const prov = String(provider ?? '');
  const num = String(number ?? '').trim().toUpperCase();
  if (!PROVIDERS[prov]) return { error: 'bad_provider' };
  if (!NUMBER_RE.test(num)) return { error: 'bad_number' };

  await query(
    `INSERT INTO parcel_tracking (order_id, provider, number, set_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (order_id) DO UPDATE SET provider = EXCLUDED.provider, number = EXCLUDED.number,
       set_by = EXCLUDED.set_by, updated_at = now()`,
    [order.id, prov, num, sellerId]);
  await logMarket(sellerId, 'tracking_set', order.id, { provider: prov });
  await systemMessage(order.id, `Продавец указал трек-номер: ${PROVIDERS[prov].title} ${num}.`).catch(() => {});
  return { ok: true };
};

export const clearOrderTracking = async (orderId, sellerId) => {
  const order = await orderOf(orderId);
  if (!order || order.seller_id !== sellerId) return { error: 'not_found' };
  if (!TRACKABLE.has(order.status)) return { error: 'bad_status' };
  await query('DELETE FROM parcel_tracking WHERE order_id = $1', [order.id]);
  await logMarket(sellerId, 'tracking_cleared', order.id);
  return { ok: true };
};
