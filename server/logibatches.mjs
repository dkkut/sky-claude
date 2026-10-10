/**
 * Поставки: пакет оплаченных заказов продавца для развоза.
 *
 * Продавец собирает поставку из СВОИХ заказов (готовых к отправке, с
 * адресом покупателя), указывает, откуда курьер их заберёт, и передаёт:
 * конкретному курьеру из тех, кто с ним сотрудничает, или в пул (кто из
 * подходящих курьеров нажмёт «взять» первым, тот везёт всю поставку).
 *
 * Сами заказы по-прежнему передаются курьеру обычными поручениями
 * (logi_courier_assignments), а получение и вручение подтверждаются теми
 * же кодами/QR (courierdelivery.mjs) — поставка только группирует и
 * строит маршрут. Адреса покупателей отдаются курьеру лишь после
 * передачи, и только по заказам его поставки.
 *
 * Маршрут считает Google Directions (maps.mjs::computeRoute): порядок
 * остановок подбирается автоматически, к ним добавляются расстояния и
 * время. Без ключа или с отказом сервиса маршрута нет — и это так и
 * говорится, порядок не выдумывается.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { decryptContent } from './crypto.mjs';
import { marketText as text, ORDER_ID_RE } from './market.mjs';
import { geocode, computeRoute, fetchStaticMap, isRealPoint } from './maps.mjs';
import { assignCourier, postOrderToPool, notifyLogi, logLogi } from './logistics.mjs';

export const BATCH_ID_RE = /^lb-[0-9a-f-]{36}$/;
export const MAX_BATCH_ORDERS = 20;
const ELIGIBLE = `o.market_type = 'standard'
  AND o.status IN ('seller_payment_confirmed','fulfillment')
  AND o.address_enc IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM logi_batch_items bi WHERE bi.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM logi_courier_assignments a WHERE a.order_id = o.id AND a.status <> 'cancelled')`;

const iso = (d) => d?.toISOString?.() ?? null;
const dec = (v) => (v ? (decryptContent(v) ?? '') : '');

const courierOf = async (profileId) => {
  const { rows } = await query('SELECT * FROM logi_couriers WHERE profile_id = $1', [profileId]);
  return rows[0] ?? null;
};

/** Заказы продавца, которые можно положить в поставку. */
export const eligibleOrders = async (sellerId) => {
  const { rows } = await query(
    `SELECT o.id, o.title_snap, o.quantity, o.total_kop, o.status, o.address_enc, o.created_at
       FROM market_orders o WHERE o.seller_id = $1 AND ${ELIGIBLE} ORDER BY o.created_at LIMIT 200`, [sellerId]);
  return rows.map((r) => ({
    id: r.id, title: r.title_snap, quantity: r.quantity, total: Number(r.total_kop) / 100,
    status: r.status, address: dec(r.address_enc), createdAt: iso(r.created_at),
  }));
};

const batchView = (b) => ({
  id: b.id, title: b.title, status: b.status, courierId: b.courier_id ?? null, sellerId: b.seller_id,
  originAddress: b.origin_address, hasOrigin: isRealPoint(b.origin_lat, b.origin_lng),
  price: Number(b.price_kop ?? 0) / 100, cityId: b.city_id, district: b.district,
  handedAt: iso(b.handed_at), createdAt: iso(b.created_at), updatedAt: iso(b.updated_at),
  route: b.route_json ? { ...b.route_json, builtAt: iso(b.route_at) } : null,
});

/** Поставка и права на неё: продавец-владелец или назначенный курьер. */
const load = async (profileId, batchId) => {
  if (!BATCH_ID_RE.test(String(batchId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM logi_batches WHERE id = $1', [batchId]);
  const b = rows[0];
  if (!b) return null;
  if (b.seller_id === profileId) return { b, role: 'seller' };
  if (b.courier_id) {
    const c = await courierOf(profileId);
    if (c && c.id === b.courier_id && ['handed', 'done'].includes(b.status)) return { b, role: 'courier', courier: c };
  }
  return null;
};

export const createBatch = async (sellerId, { title, orderIds, originAddress } = {}) => {
  const ids = Array.from(new Set((Array.isArray(orderIds) ? orderIds : []).map(String)));
  if (ids.length === 0) return { error: 'no_orders' };
  if (ids.length > MAX_BATCH_ORDERS) return { error: 'too_many_orders', max: MAX_BATCH_ORDERS };
  if (!ids.every((id) => ORDER_ID_RE.test(id))) return { error: 'not_found' };
  const origin = text(originAddress, 300);
  if (origin.length < 4) return { error: 'origin_required' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`logibatch:${sellerId}`]);
    // Каждый заказ — свой, готовый и не занятый другой поставкой/курьером: проверка и вставка под одним замком.
    const { rows } = await client.query(
      `SELECT o.id FROM market_orders o WHERE o.seller_id = $1 AND o.id = ANY($2::text[]) AND ${ELIGIBLE}`, [sellerId, ids]);
    if (rows.length !== ids.length) { await client.query('ROLLBACK'); return { error: 'orders_not_ready' }; }
    const point = await geocode(origin);
    const id = `lb-${generateId()}`;
    await client.query(
      `INSERT INTO logi_batches (id, seller_id, title, origin_address, origin_lat, origin_lng) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, sellerId, text(title, 80) || 'Поставка', origin, point?.lat ?? null, point?.lng ?? null]);
    for (let i = 0; i < ids.length; i += 1) {
      await client.query('INSERT INTO logi_batch_items (batch_id, order_id, position) VALUES ($1,$2,$3)', [id, ids[i], i]);
    }
    await client.query('COMMIT');
    await logLogi(sellerId, 'batch_created', id, { orders: ids.length });
    return { id, originResolved: Boolean(point) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === '23505') return { error: 'orders_not_ready' };
    throw e;
  } finally { client.release(); }
};

export const listBatches = async (profileId, { as = 'seller' } = {}) => {
  let rows;
  if (as === 'courier') {
    const c = await courierOf(profileId);
    if (!c) return [];
    ({ rows } = await query(
      `SELECT b.*, (SELECT count(*)::int FROM logi_batch_items i WHERE i.batch_id = b.id) AS n
         FROM logi_batches b WHERE b.courier_id = $1 AND b.status IN ('handed','done') ORDER BY b.handed_at DESC LIMIT 100`, [c.id]));
  } else {
    ({ rows } = await query(
      `SELECT b.*, (SELECT count(*)::int FROM logi_batch_items i WHERE i.batch_id = b.id) AS n
         FROM logi_batches b WHERE b.seller_id = $1 AND b.status <> 'cancelled' ORDER BY b.created_at DESC LIMIT 100`, [profileId]));
  }
  return rows.map((b) => ({ ...batchView(b), orders: b.n }));
};

/** Открытые поставки пула для курьера: его город/район, ещё никем не взятые. */
export const listOpenBatches = async (profileId) => {
  const c = await courierOf(profileId);
  if (!c) return { error: 'not_a_courier' };
  if (c.status !== 'approved') return { error: 'not_approved' };
  const { rows } = await query(
    `SELECT b.*, (SELECT count(*)::int FROM logi_batch_items i WHERE i.batch_id = b.id) AS n
       FROM logi_batches b WHERE b.status = 'open' AND b.city_id = $1 AND ($2 = '' OR b.district = $2)
      ORDER BY b.created_at DESC LIMIT 50`, [c.city_id, c.district]);
  // Адреса покупателей в пуле не показываем — только размер и район.
  return rows.map((b) => ({ ...batchView(b), orders: b.n, originAddress: '', route: null }));
};

export const readBatch = async (profileId, batchId) => {
  const got = await load(profileId, batchId);
  if (!got) return { error: 'not_found' };
  const { b, role } = got;
  const { rows } = await query(
    `SELECT i.order_id, i.position, o.title_snap, o.quantity, o.total_kop, o.address_enc,
            a.id AS assignment_id, a.status AS assignment_status
       FROM logi_batch_items i JOIN market_orders o ON o.id = i.order_id
       LEFT JOIN logi_courier_assignments a ON a.order_id = i.order_id AND a.status <> 'cancelled'
      WHERE i.batch_id = $1 ORDER BY i.position`, [b.id]);
  // Курьер видит адреса только своей поставки после передачи; продавец — всегда свои.
  const items = rows.map((r) => ({
    orderId: r.order_id, position: r.position, title: r.title_snap, quantity: r.quantity,
    total: Number(r.total_kop) / 100, address: dec(r.address_enc),
    assignmentId: r.assignment_id ?? null, assignmentStatus: r.assignment_status ?? null,
  }));
  // Все поручения закрыты — поставка выполнена.
  if (b.status === 'handed' && items.length && items.every((i) => ['delivered', 'cancelled'].includes(i.assignmentStatus ?? ''))) {
    await query(`UPDATE logi_batches SET status = 'done', updated_at = now() WHERE id = $1 AND status = 'handed'`, [b.id]);
    b.status = 'done';
  }
  return { batch: batchView(b), items, role };
};

export const cancelBatch = async (sellerId, batchId) => {
  const got = await load(sellerId, batchId);
  if (!got || got.role !== 'seller') return { error: 'not_found' };
  if (!['draft', 'open'].includes(got.b.status)) return { error: 'wrong_state' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE logi_courier_assignments SET status = 'cancelled', updated_at = now()
        WHERE status = 'open' AND courier_id IS NULL AND order_id IN (SELECT order_id FROM logi_batch_items WHERE batch_id = $1)`, [batchId]);
    await client.query('DELETE FROM logi_batch_items WHERE batch_id = $1', [batchId]);
    await client.query(`UPDATE logi_batches SET status = 'cancelled', updated_at = now() WHERE id = $1`, [batchId]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  await logLogi(sellerId, 'batch_cancelled', batchId);
  return { ok: true };
};

/**
 * Передача поставки. Конкретному курьеру — каждому заказу обычное
 * поручение (нужна принятая заявка о сотрудничестве); в пул — открытые
 * поручения, поставку берёт один курьер целиком. Если хоть один заказ
 * передать нельзя, не передаётся ничего: поставка остаётся черновиком.
 */
export const handoffBatch = async (sellerId, batchId, { courierId, pool: toPool, priceKop, cityId, district } = {}) => {
  const got = await load(sellerId, batchId);
  if (!got || got.role !== 'seller') return { error: 'not_found' };
  const { b } = got;
  if (b.status !== 'draft') return { error: 'wrong_state' };
  const { rows: items } = await query('SELECT order_id FROM logi_batch_items WHERE batch_id = $1 ORDER BY position', [batchId]);
  if (items.length === 0) return { error: 'no_orders' };

  const done = [];
  const rollback = () => query(
    `UPDATE logi_courier_assignments SET status = 'cancelled', updated_at = now()
      WHERE order_id = ANY($1::text[]) AND seller_id = $2 AND status IN ('open','assigned')`, [done, sellerId]);

  if (toPool === true) {
    for (const it of items) {
      const r = await postOrderToPool(sellerId, it.order_id, { priceKop, cityId, district });
      if (r.error) { await rollback(); return { error: r.error, orderId: it.order_id }; }
      done.push(it.order_id);
    }
    await query(
      `UPDATE logi_batches SET status = 'open', price_kop = $2, city_id = $3, district = $4, updated_at = now() WHERE id = $1`,
      [batchId, Math.max(0, Math.round(Number(priceKop) || 0)), text(cityId, 60), text(district, 80)]);
    await logLogi(sellerId, 'batch_posted_to_pool', batchId);
    return { ok: true, status: 'open' };
  }

  for (const it of items) {
    const r = await assignCourier(sellerId, it.order_id, courierId);
    if (r.error) { await rollback(); return { error: r.error, orderId: it.order_id }; }
    done.push(it.order_id);
  }
  await query(`UPDATE logi_batches SET status = 'handed', courier_id = $2, handed_at = now(), updated_at = now() WHERE id = $1`, [batchId, courierId]);
  const { rows: c } = await query('SELECT profile_id FROM logi_couriers WHERE id = $1', [courierId]);
  if (c[0]) await notifyLogi(c[0].profile_id, courierId, null, 'assigned', `Вам передана поставка «${b.title}»: заказов — ${items.length}`);
  await logLogi(sellerId, 'batch_handed', batchId, { courierId, orders: items.length });
  return { ok: true, status: 'handed' };
};

/** Курьер берёт открытую поставку из пула целиком: либо все заказы, либо ни одного. */
export const takeBatch = async (profileId, batchId) => {
  if (!BATCH_ID_RE.test(String(batchId ?? ''))) return { error: 'not_found' };
  const c = await courierOf(profileId);
  if (!c) return { error: 'not_a_courier' };
  if (c.status !== 'approved') return { error: 'not_approved' };
  if (!c.online) return { error: 'not_online' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM logi_batches WHERE id = $1 AND status = 'open' FOR UPDATE`, [batchId]);
    if (!rows[0]) { await client.query('ROLLBACK'); return { error: 'already_taken' }; }
    const { rows: items } = await client.query('SELECT order_id FROM logi_batch_items WHERE batch_id = $1', [batchId]);
    const upd = await client.query(
      `UPDATE logi_courier_assignments SET courier_id = $2, status = 'assigned', updated_at = now()
        WHERE order_id = ANY($1::text[]) AND status = 'open' AND courier_id IS NULL`, [items.map((i) => i.order_id), c.id]);
    if (upd.rowCount !== items.length) { await client.query('ROLLBACK'); return { error: 'already_taken' }; }
    await client.query(`UPDATE logi_batches SET status = 'handed', courier_id = $2, handed_at = now(), updated_at = now() WHERE id = $1`, [batchId, c.id]);
    await client.query('COMMIT');
    await notifyLogi(rows[0].seller_id, c.id, null, 'assigned', `Курьер взял поставку «${rows[0].title}» из пула`);
    await logLogi(profileId, 'batch_taken', batchId);
    return { ok: true };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

/**
 * Построить (или перестроить) маршрут. Курьеру — от его текущей точки,
 * если он на связи, иначе от точки забора; продавцу — от точки забора.
 */
export const buildRoute = async (profileId, batchId) => {
  const got = await load(profileId, batchId);
  if (!got) return { error: 'not_found' };
  const { b, role, courier } = got;
  const { rows } = await query(
    `SELECT i.order_id, o.address_enc FROM logi_batch_items i JOIN market_orders o ON o.id = i.order_id
      WHERE i.batch_id = $1 ORDER BY i.position`, [batchId]);

  let origin = null; let originKind = 'warehouse';
  if (role === 'courier' && courier.online && isRealPoint(courier.lat, courier.lng)) {
    origin = { lat: Number(courier.lat), lng: Number(courier.lng) }; originKind = 'courier';
  } else if (isRealPoint(b.origin_lat, b.origin_lng)) {
    origin = { lat: Number(b.origin_lat), lng: Number(b.origin_lng) };
  } else if (b.origin_address) {
    const p = await geocode(b.origin_address);
    if (p) { origin = { lat: p.lat, lng: p.lng }; await query('UPDATE logi_batches SET origin_lat = $2, origin_lng = $3 WHERE id = $1', [batchId, p.lat, p.lng]); }
  }
  if (!origin) return { error: 'no_origin' };

  const stops = []; const unresolved = [];
  for (const r of rows) {
    const p = await geocode(dec(r.address_enc));
    if (p) stops.push({ id: r.order_id, lat: p.lat, lng: p.lng }); else unresolved.push(r.order_id);
  }
  if (stops.length === 0) return { error: 'no_stops' };

  const route = await computeRoute({ origin, stops, vehicle: courier?.vehicle });
  if (route.error) return { error: route.error };

  const saved = {
    order: route.order, legs: route.legs, distanceM: route.distanceM, durationS: route.durationS,
    polyline: route.polyline, origin: { ...origin, kind: originKind }, unresolved,
  };
  await query('UPDATE logi_batches SET route_json = $2::jsonb, route_at = now(), updated_at = now() WHERE id = $1', [batchId, JSON.stringify(saved)]);
  // Порядок остановок запоминается, чтобы список заказов шёл так, как ехать.
  for (let i = 0; i < route.order.length; i += 1) {
    await query('UPDATE logi_batch_items SET position = $3 WHERE batch_id = $1 AND order_id = $2', [batchId, route.order[i].id, i]);
  }
  return { ok: true };
};

/** Картинка карты маршрута: старт, пронумерованные остановки, линия. */
export const batchMap = async (profileId, batchId, { width, height } = {}) => {
  const got = await load(profileId, batchId);
  if (!got || !got.b.route_json) return null;
  const r = got.b.route_json;
  const points = [{ lat: r.origin.lat, lng: r.origin.lng, kind: r.origin.kind === 'courier' ? 'courier' : 'warehouse' }];
  r.order.forEach((p, i) => points.push({ lat: p.lat, lng: p.lng, kind: 'target', label: i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9) }));
  return fetchStaticMap({ points, pathEnc: r.polyline, width, height });
};
