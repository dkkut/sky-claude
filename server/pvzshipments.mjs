/**
 * Поставка: несколько заказов, которые продавец завозит в пункт
 * выдачи одним разом, с приёмкой по QR.
 *
 * Не путать с market_shipments (marketdelivery.mjs) — там путь ОДНОГО
 * заказа, отдельно на каждый. Поставка — это партия НЕСКОЛЬКИХ таких
 * заказов, и у неё свой QR, своя приёмка и свой путь. Когда продавец
 * подтверждает отправку поставки, каждый заказ внутри неё заодно
 * получает свою обычную запись в market_shipments — существующий
 * экран покупателя (OrderScreens.tsx, readShipment) продолжает
 * работать как раньше, не зная, что заказ приехал партией.
 *
 * Три уровня доказательства, и каждый проверяется отдельно:
 *   QR поставки  — какую поставку открыли (pvzshipments.mjs, здесь);
 *   QR заказа    — какая именно коробка (pvzops.mjs, sellerOrderQr);
 *   QR получения — кто именно её забирает (pvzops.mjs, verifyPickup).
 * Подмена одного не подменяет остальные: сервер проверяет всю цепочку
 * заново на каждом шаге, а не верит тому, что клиент уже «показал QR».
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { hashCode, codesEqual } from './crypto.mjs';
import { marketText as text, marketInt as int, ORDER_ID_RE, logMarket } from './market.mjs';
import { applyTransition } from './marketorders.mjs';
import { pushMarket } from './signal.mjs';
import {
  PVZ_ID_RE, hasPermission, hasRole, isStaffOf, logPvz,
  orderShipTokenValid, parseOrderQrPayload,
} from './pvzops.mjs';

export const SHIPMENT_ID_RE = /^mps-[0-9a-f-]{36}$/;
const MAX_TRACKING = 120;

/* ─── Владение и доступ ───────────────────────────────────────────────── */

const shipmentRow = async (client, shipmentId) => {
  const { rows } = await client.query(
    'SELECT * FROM market_pvz_shipments WHERE id = $1 FOR UPDATE', [shipmentId]);
  return rows[0] ?? null;
};

const maySeeShipment = async (shipment, actorId) =>
  shipment.seller_id === actorId || (await isStaffOf(shipment.pvz_id, actorId));

const toShipment = (r) => ({
  id: r.id, pvzId: r.pvz_id, sellerId: r.seller_id, method: r.method,
  carrierTitle: r.carrier_title, tracking: r.tracking, status: r.status,
  expectedCount: r.expected_count, receivedCount: r.received_count,
  shippedAt: r.shipped_at?.toISOString?.() ?? null, receivedAt: r.received_at?.toISOString?.() ?? null,
  createdAt: r.created_at.toISOString(),
});

const toItem = (r) => ({
  id: r.id, shipmentId: r.shipment_id, orderId: r.order_id, status: r.status,
  scannedAt: r.scanned_at?.toISOString?.() ?? null, title: r.title_snap ?? undefined,
});

/* ─── Создание и сбор поставки ───────────────────────────────────────── */

export const createShipment = async (sellerId, { pvzId, method, carrierTitle, tracking } = {}) => {
  if (!PVZ_ID_RE.test(String(pvzId ?? ''))) return { error: 'bad_pvz' };
  const m = ['seller_self', 'carrier', 'other'].includes(String(method)) ? String(method) : 'seller_self';
  const { rows: pvzRows } = await query(
    `SELECT id FROM market_pickup_points WHERE id = $1 AND active AND NOT staff_closed`, [pvzId]);
  if (!pvzRows[0]) return { error: 'bad_pvz' };

  const id = `mps-${generateId()}`;
  const token = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO market_pvz_shipments (id, pvz_id, seller_id, method, carrier_title, tracking, qr_token_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, pvzId, sellerId, m, text(carrierTitle, 120), text(tracking, MAX_TRACKING), encryptContent(token)]);
  await logMarket(sellerId, 'pvz_shipment_created', id, { pvzId });
  return { id };
};

export const shipmentQr = async (shipmentId, sellerId, { regenerate = false } = {}) => {
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT id, seller_id, qr_token_enc, status FROM market_pvz_shipments WHERE id = $1', [shipmentId]);
  const s = rows[0];
  if (!s || s.seller_id !== sellerId) return { error: 'not_found' };
  if (s.status !== 'created') return { error: 'wrong_state' };

  let tokenEnc = s.qr_token_enc;
  if (regenerate) {
    const token = crypto.randomBytes(24).toString('base64url');
    tokenEnc = encryptContent(token);
    await query('UPDATE market_pvz_shipments SET qr_token_enc = $2 WHERE id = $1', [shipmentId, tokenEnc]);
  }
  const token = decryptContent(tokenEnc);
  return { shipmentId, token, payload: `skypvz:shipment:${shipmentId}:${token}` };
};

const parseShipmentQrPayload = (raw) => {
  const m = /^skypvz:shipment:(mps-[0-9a-f-]{36}):([\w-]{20,64})$/.exec(String(raw ?? '').trim());
  return m ? { shipmentId: m[1], token: m[2] } : null;
};

export const addOrderToShipment = async (sellerId, shipmentId, orderId) => {
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return { error: 'not_found' };
  const oid = String(orderId ?? '');
  if (!ORDER_ID_RE.test(oid)) return { error: 'bad_order' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipment = await shipmentRow(client, shipmentId);
    if (!shipment || shipment.seller_id !== sellerId) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (shipment.status !== 'created') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }

    const { rows: orderRows } = await client.query(
      `SELECT id, seller_id, pickup_point_id, status FROM market_orders WHERE id = $1 FOR UPDATE`, [oid]);
    const order = orderRows[0];
    if (!order || order.seller_id !== sellerId) { await client.query('ROLLBACK'); return { error: 'bad_order' }; }
    if (order.pickup_point_id !== shipment.pvz_id) { await client.query('ROLLBACK'); return { error: 'wrong_pvz' }; }
    if (order.status !== 'fulfillment') { await client.query('ROLLBACK'); return { error: 'wrong_order_state', status: order.status }; }

    try {
      await client.query(
        `INSERT INTO market_pvz_shipment_items (id, shipment_id, order_id) VALUES ($1,$2,$3)`,
        [`mpi-${generateId()}`, shipmentId, oid]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (String(err.code) === '23505') return { error: 'already_in_shipment' };
      throw err;
    }
    await client.query(
      `UPDATE market_pvz_shipments SET expected_count = expected_count + 1, updated_at = now() WHERE id = $1`,
      [shipmentId]);
    await client.query('COMMIT');
    await logPvz(null, shipment.pvz_id, sellerId, 'shipment_item_added', { type: 'shipment', id: shipmentId }, { orderId: oid });
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export const removeOrderFromShipment = async (sellerId, shipmentId, orderId) => {
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return { error: 'not_found' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipment = await shipmentRow(client, shipmentId);
    if (!shipment || shipment.seller_id !== sellerId) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (shipment.status !== 'created') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
    const { rowCount } = await client.query(
      `DELETE FROM market_pvz_shipment_items WHERE shipment_id = $1 AND order_id = $2`, [shipmentId, orderId]);
    if (rowCount === 0) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    await client.query(
      `UPDATE market_pvz_shipments SET expected_count = GREATEST(0, expected_count - 1), updated_at = now() WHERE id = $1`,
      [shipmentId]);
    await client.query('COMMIT');
    await logPvz(null, shipment.pvz_id, sellerId, 'shipment_item_removed', { type: 'shipment', id: shipmentId }, { orderId });
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export const myShipments = async (sellerId, { status } = {}) => {
  const args = [sellerId];
  let where = 'seller_id = $1';
  if (status) { args.push(String(status)); where += ` AND status = $${args.length}`; }
  const { rows } = await query(
    `SELECT s.*, p.title AS pvz_title FROM market_pvz_shipments s
       JOIN market_pickup_points p ON p.id = s.pvz_id
      WHERE ${where} ORDER BY s.created_at DESC LIMIT 200`, args);
  return rows.map((r) => ({ ...toShipment(r), pvzTitle: r.pvz_title }));
};

/** Поставки, ожидающие приёмки в этой точке — для вкладки «Приёмка». */
export const pendingShipmentsForPvz = async (pvzId, actorId) => {
  if (!(await hasPermission(pvzId, actorId, 'receive'))) return null;
  const { rows } = await query(
    `SELECT * FROM market_pvz_shipments
      WHERE pvz_id = $1 AND status IN ('created','shipped') ORDER BY created_at`, [pvzId]);
  return rows.map(toShipment);
};

export const shipmentDetail = async (shipmentId, actorId) => {
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM market_pvz_shipments WHERE id = $1', [shipmentId]);
  const s = rows[0];
  if (!s) return null;
  if (!(await maySeeShipment(s, actorId))) return null;
  const { rows: items } = await query(
    `SELECT i.*, o.title_snap FROM market_pvz_shipment_items i
       JOIN market_orders o ON o.id = i.order_id
      WHERE i.shipment_id = $1 ORDER BY o.title_snap`, [shipmentId]);
  return { ...toShipment(s), items: items.map(toItem) };
};

/* ─── Подтверждение отправки продавцом ───────────────────────────────── */

/**
 * Продавец подтверждает, что реально вывез/сдал поставку. Только
 * этим нажатием, и только своей поставки — руками поставить статус
 * произвольным запросом нельзя, потому что shipmentRow сверяет
 * seller_id, а не верит присланному id.
 */
export const confirmDispatch = async (sellerId, shipmentId) => {
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return { error: 'not_found' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipment = await shipmentRow(client, shipmentId);
    if (!shipment || shipment.seller_id !== sellerId) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (shipment.status !== 'created') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
    if (shipment.expected_count === 0) { await client.query('ROLLBACK'); return { error: 'empty_shipment' }; }

    await client.query(
      `UPDATE market_pvz_shipments SET status = 'shipped', shipped_at = now(), shipped_by = $2, updated_at = now()
        WHERE id = $1`, [shipmentId, sellerId]);

    const { rows: items } = await client.query(
      `SELECT order_id FROM market_pvz_shipment_items WHERE shipment_id = $1`, [shipmentId]);
    const allNotes = [];
    for (const it of items) {
      const { rows: orderRows } = await client.query(
        'SELECT * FROM market_orders WHERE id = $1 AND status = $2 FOR UPDATE', [it.order_id, 'fulfillment']);
      const order = orderRows[0];
      if (!order) continue; // изменилось между сбором и отправкой — оставляем как есть, не рвём поставку
      const { notes } = await applyTransition(client, order, {
        to: 'seller_shipped', actorId: sellerId, actorRole: 'seller',
        detail: { method: shipment.method, shipmentId },
      });
      allNotes.push(...notes);
      /* Тот же экран покупателя, что и у обычного отправления
         (OrderScreens.tsx) — заказ, приехавший партией, выглядит для
         покупателя не хуже отправленного поодиночке. */
      await client.query(
        `INSERT INTO market_shipments (order_id, method, destination, pickup_point_id, status, status_text)
         VALUES ($1,$2,'pickup_point',$3,'accepted','Продавец передал в пункт выдачи')
         ON CONFLICT (order_id) DO NOTHING`,
        [it.order_id, shipment.method === 'carrier' ? 'carrier' : 'seller_self', shipment.pvz_id]);
    }
    await client.query('COMMIT');
    for (const n of allNotes) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
    await logPvz(null, shipment.pvz_id, sellerId, 'shipment_dispatched', { type: 'shipment', id: shipmentId }, { count: items.length });
    await logMarket(sellerId, 'pvz_shipment_dispatched', shipmentId, { pvzId: shipment.pvz_id });
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Приёмка в ПВЗ ───────────────────────────────────────────────────── */

/** Открыть поставку по QR поставки — первый шаг приёмки. */
export const openShipmentByQr = async (pvzId, actorId, qrPayload) => {
  if (!(await hasPermission(pvzId, actorId, 'receive'))) return { error: 'not_allowed' };
  const parsed = parseShipmentQrPayload(qrPayload);
  if (!parsed) return { error: 'bad_qr' };
  const { rows } = await query('SELECT * FROM market_pvz_shipments WHERE id = $1', [parsed.shipmentId]);
  const s = rows[0];
  if (!s || s.pvz_id !== pvzId) return { error: 'not_found' };
  const real = decryptContent(s.qr_token_enc ?? '');
  if (!real || !codesEqual(hashCode(parsed.token, s.id), hashCode(real, s.id))) return { error: 'bad_qr' };
  if (!['shipped', 'created'].includes(s.status)) return { error: 'wrong_state', status: s.status };
  return shipmentDetail(s.id, actorId);
};

/**
 * Сканировать QR одного заказа при приёмке поставки.
 *
 * Вся цепочка проверок раздела 12 — здесь, и в этом порядке: заказ и
 * поставка существуют → заказ действительно числится в ЭТОЙ поставке
 * → поставка действительно этой точки → заказ не принят и не выдан
 * раньше. Несовпадение на любом шаге — не «принять и разобраться
 * потом», а отказ с записью в unmatched_scans (разделы 13, 17).
 */
export const scanShipmentOrder = async (pvzId, actorId, shipmentId, qrPayload) => {
  if (!(await hasPermission(pvzId, actorId, 'receive'))) return { error: 'not_allowed' };
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return { error: 'not_found' };
  const parsed = parseOrderQrPayload(qrPayload);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipment = await shipmentRow(client, shipmentId);
    if (!shipment || shipment.pvz_id !== pvzId) {
      await client.query('ROLLBACK');
      return { error: 'not_found' };
    }
    if (!['shipped', 'created'].includes(shipment.status)) {
      await client.query('ROLLBACK');
      return { error: 'wrong_state', status: shipment.status };
    }

    const recordUnmatched = async (orderId, reason) => {
      await client.query(
        `INSERT INTO market_pvz_unmatched_scans (pvz_id, shipment_id, order_id, raw_token, reason, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [pvzId, shipmentId, orderId ?? null, text(qrPayload, 200), reason, actorId]);
      await logPvz(null, pvzId, actorId, 'unmatched_scan', { type: 'shipment', id: shipmentId }, { reason, orderId }, true);
    };

    if (!parsed) {
      await client.query('ROLLBACK');
      await recordUnmatched(null, 'unreadable');
      return { error: 'bad_qr' };
    }

    const { rows: orderRows } = await client.query(
      'SELECT * FROM market_orders WHERE id = $1 FOR UPDATE', [parsed.orderId]);
    const order = orderRows[0];
    if (!order || order.seller_id !== shipment.seller_id || !orderShipTokenValid(order, parsed.token)) {
      await client.query('ROLLBACK');
      await recordUnmatched(order?.id ?? null, 'not_this_seller_or_bad_token');
      return { error: 'not_found' };
    }
    if (['completed', 'cancelled', 'buyer_received'].includes(order.status)) {
      await client.query('ROLLBACK');
      await recordUnmatched(order.id, 'order_closed');
      return { error: 'order_closed' };
    }

    const { rows: itemRows } = await client.query(
      `SELECT * FROM market_pvz_shipment_items WHERE shipment_id = $1 AND order_id = $2 FOR UPDATE`,
      [shipmentId, order.id]);
    const item = itemRows[0];
    if (!item) {
      await client.query('ROLLBACK');
      await recordUnmatched(order.id, 'not_in_this_shipment');
      return { error: 'not_in_shipment' };
    }
    if (item.status === 'received') {
      await client.query('ROLLBACK');
      return { error: 'already_received' };
    }

    await client.query(
      `UPDATE market_pvz_shipment_items SET status = 'received', scanned_at = now(), scanned_by = $2 WHERE id = $1`,
      [item.id, actorId]);
    await client.query(
      `UPDATE market_pvz_shipments SET status = 'shipped', received_count = received_count + 1, updated_at = now()
        WHERE id = $1`, [shipmentId]);
    await client.query('COMMIT');
    await logPvz(null, pvzId, actorId, 'shipment_item_scanned', { type: 'order', id: order.id }, { shipmentId });
    return { ok: true, orderId: order.id, title: order.title_snap };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Коробка без читаемого QR (раздел 18). Только manager+: обходить
 * сканер — более чувствительное действие, чем обычный приём. Ищет
 * заказ по его собственному id (его сотрудник спрашивает у продавца
 * или смотрит в списке ожидаемых), проверяет ту же цепочку, что и
 * сканирование, и по завершении можно выпустить новый QR заказа
 * взамен повреждённого — старый этим уже инвалидирован.
 */
export const manualReceiveOrder = async (pvzId, actorId, shipmentId, orderId) => {
  if (!(await hasRole(pvzId, actorId, 'manager'))) return { error: 'not_allowed' };
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return { error: 'not_found' };
  const oid = String(orderId ?? '');
  if (!ORDER_ID_RE.test(oid)) return { error: 'bad_order' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipment = await shipmentRow(client, shipmentId);
    if (!shipment || shipment.pvz_id !== pvzId) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const { rows: itemRows } = await client.query(
      `SELECT * FROM market_pvz_shipment_items WHERE shipment_id = $1 AND order_id = $2 FOR UPDATE`,
      [shipmentId, oid]);
    const item = itemRows[0];
    if (!item) { await client.query('ROLLBACK'); return { error: 'not_in_shipment' }; }
    if (item.status === 'received') { await client.query('ROLLBACK'); return { error: 'already_received' }; }

    const { rows: orderRows } = await client.query(
      `SELECT status FROM market_orders WHERE id = $1 FOR UPDATE`, [oid]);
    if (['completed', 'cancelled', 'buyer_received'].includes(orderRows[0]?.status)) {
      await client.query('ROLLBACK');
      return { error: 'order_closed' };
    }

    await client.query(
      `UPDATE market_pvz_shipment_items SET status = 'received', scanned_at = now(), scanned_by = $2 WHERE id = $1`,
      [item.id, actorId]);
    await client.query(
      `UPDATE market_pvz_shipments SET status = 'shipped', received_count = received_count + 1, updated_at = now()
        WHERE id = $1`, [shipmentId]);
    await client.query('COMMIT');
    await logPvz(null, pvzId, actorId, 'shipment_item_manual_receive', { type: 'order', id: oid }, { shipmentId }, true);
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Закрыть приёмку: полностью, если отсканировано всё ожидаемое, или
 * частично — явной второй кнопкой, а не тем же вызовом (раздел 15).
 * Недостающие заказы не считаются потерянными и не трогаются — они
 * просто остаются в статусе expected, и продавец видит их в поставке.
 */
export const confirmReceipt = async (pvzId, actorId, shipmentId, { partial = false } = {}) => {
  if (!(await hasPermission(pvzId, actorId, 'receive'))) return { error: 'not_allowed' };
  if (!SHIPMENT_ID_RE.test(String(shipmentId ?? ''))) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shipment = await shipmentRow(client, shipmentId);
    if (!shipment || shipment.pvz_id !== pvzId) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (!['shipped'].includes(shipment.status)) { await client.query('ROLLBACK'); return { error: 'wrong_state', status: shipment.status }; }

    const { rows: items } = await client.query(
      `SELECT i.*, o.title_snap FROM market_pvz_shipment_items i
         JOIN market_orders o ON o.id = i.order_id
        WHERE i.shipment_id = $1 FOR UPDATE OF i`, [shipmentId]);
    const received = items.filter((i) => i.status === 'received');
    const stillExpected = items.filter((i) => i.status === 'expected');

    if (stillExpected.length > 0 && !partial) {
      await client.query('ROLLBACK');
      return { error: 'incomplete', expected: items.length, received: received.length };
    }

    if (stillExpected.length > 0) {
      await client.query(
        `UPDATE market_pvz_shipment_items SET status = 'missing' WHERE shipment_id = $1 AND status = 'expected'`,
        [shipmentId]);
    }
    const finalStatus = stillExpected.length > 0 ? 'received_partial' : 'received';
    await client.query(
      `UPDATE market_pvz_shipments SET status = $2, received_at = now(), received_by = $3, updated_at = now()
        WHERE id = $1`, [shipmentId, finalStatus, actorId]);
    await client.query('COMMIT');

    await logPvz(null, pvzId, actorId,
      finalStatus === 'received' ? 'shipment_received' : 'shipment_received_partial',
      { type: 'shipment', id: shipmentId },
      { received: received.length, missing: stillExpected.length },
      finalStatus === 'received_partial');

    if (stillExpected.length > 0) {
      const missingTitles = stillExpected.map((i) => i.title_snap).join(', ');
      const note = {
        id: `mn-${generateId()}`, kind: 'pvz_shipment_partial', orderId: null,
        title: 'Поставка получена частично',
        body: `ПВЗ получил ${received.length} из ${items.length} заказов. Не получены: ${missingTitles}.`,
      };
      await query(
        `INSERT INTO market_notifications (id, user_id, order_id, kind, title, body)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [note.id, shipment.seller_id, note.orderId, note.kind, note.title, note.body]).catch(() => {});
      pushMarket([shipment.seller_id], { type: 'market-notification', payload: note });
    }
    return { ok: true, status: finalStatus, received: received.length, missing: stillExpected.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export const unmatchedScans = async (pvzId, actorId) => {
  if (!(await hasRole(pvzId, actorId, 'manager'))) return null;
  const { rows } = await query(
    `SELECT * FROM market_pvz_unmatched_scans WHERE pvz_id = $1 ORDER BY created_at DESC LIMIT 200`, [pvzId]);
  return rows.map((r) => ({
    id: String(r.id), shipmentId: r.shipment_id, orderId: r.order_id, reason: r.reason,
    resolved: r.resolved, actorId: r.actor_id, createdAt: r.created_at.toISOString(),
  }));
};

export const resolveUnmatchedScan = async (pvzId, actorId, id) => {
  if (!(await hasRole(pvzId, actorId, 'manager'))) return { error: 'not_allowed' };
  const { rowCount } = await query(
    `UPDATE market_pvz_unmatched_scans SET resolved = TRUE WHERE id = $1 AND pvz_id = $2`,
    [int(id, 1, Number.MAX_SAFE_INTEGER), pvzId]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};
