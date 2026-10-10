/**
 * Курьер и заказ: настоящее подтверждение получения от продавца и
 * доставки покупателю — кодом/QR, а не одной кнопкой.
 *
 * Раньше courier_assignments двигался сам по себе (logistics.mjs::
 * setAssignmentStatus), а состояние самого заказа (market_orders,
 * market_shipments) — само по себе: курьер мог отметить у себя
 * «доставил», и это НИКАК не завершало сделку — покупателю всё равно
 * приходилось самому нажимать «Получил». Тут они соединяются:
 * подтверждение курьера — это и есть шаг основной машины состояний
 * заказа (marketorders.mjs), с сервера, а не с двух несвязанных кнопок.
 *
 * Приём получения от продавца устроен так же, как приёмка на Sky ПВЗ
 * (pvzops.mjs::verifyPickup) — сверяется тот же QR-токен, который
 * продавец уже печатает на коробку (sellerOrderQr). Приём получения
 * покупателем устроен так же, как выдача на ПВЗ — тот же шестизначный
 * код/QR (issuePickupCode/issuePickupQr), которые раньше заводились
 * только для доставки в пункт выдачи, — здесь заводятся и для доставки
 * курьером на адрес.
 */
import { pool } from './db.mjs';
import { marketText as text, ORDER_ID_RE, logMarket } from './market.mjs';
import { generateId } from './security.mjs';
import { hashCode, codesEqual } from './crypto.mjs';
import { applyTransition } from './marketorders.mjs';
import { moveShipment } from './marketdelivery.mjs';
import {
  parseOrderQrPayload, orderShipTokenValid, issuePickupCode, issuePickupQr,
  pickupCodeFor, pickupQrTokenFor, pickupQrPayload, accrueCommissionIfNeeded,
} from './pvzops.mjs';
import { wallet } from './wallet.mjs';
import { pushMarket } from './signal.mjs';

/**
 * Поручение и заказ разом, под блокировкой строки заказа — тем же
 * приёмом, что и moveShipmentByHand/verifyPickup: одна транзакция
 * держит и проверку, и переход, так что два одновременных сканирования
 * не могут оба выиграть.
 */
const lockedAssignment = async (client, orderId, courierProfileId) => {
  const { rows } = await client.query(
    `SELECT o.*, s.method, s.destination, s.status AS shipment_status,
            a.id AS assignment_id, a.status AS assignment_status, a.courier_id AS assign_courier_id,
            a.price_kop AS courier_price_kop, c.profile_id AS courier_profile
       FROM market_orders o
       JOIN market_shipments s ON s.order_id = o.id
       JOIN logi_courier_assignments a ON a.order_id = o.id
       JOIN logi_couriers c ON c.id = a.courier_id
      WHERE o.id = $1 FOR UPDATE OF o`, [orderId]);
  const row = rows[0];
  if (!row || row.courier_profile !== courierProfileId) return null;
  return row;
};

/**
 * Курьер получил отправление от продавца.
 *
 * Принимает тот же QR, что продавец печатает на коробку
 * (sellerOrderQr/pvzops.mjs) — курьеру ничего отдельного заводить не
 * пришлось. Работает только для отправлений, которые везёт сам
 * продавец (method='seller_self'): поручение курьеру — это и есть
 * способ, которым продавец «возит сам», просто руками курьера.
 */
export const confirmPickup = async (courierProfileId, orderId, proof) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await lockedAssignment(client, id, courierProfileId);
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (row.assignment_status !== 'assigned') { await client.query('ROLLBACK'); return { error: 'wrong_state', status: row.assignment_status }; }
    if (row.method !== 'seller_self') { await client.query('ROLLBACK'); return { error: 'not_courier_shipment' }; }

    const qr = parseOrderQrPayload(proof);
    if (!qr || qr.orderId !== id || !orderShipTokenValid(row, qr.token)) {
      await client.query('ROLLBACK');
      await logMarket(courierProfileId, 'courier_pickup_denied', id);
      return { error: 'bad_code' };
    }

    const moved = await moveShipment(client,
      row, { status: row.shipment_status, destination: row.destination }, 'in_transit',
      { actorId: courierProfileId, actorRole: 'courier', detail: { assignmentId: row.assignment_id } });
    if (moved.error) { await client.query('ROLLBACK'); return moved; }

    /* Доставка на адрес курьером — как и доставка в пункт выдачи,
       получатель должен суметь подтвердить получение кодом, а не
       просто словом «да, получил». Заводим код здесь же, один раз. */
    if (row.destination === 'buyer_address' && !row.pickup_code_enc) {
      await issuePickupCode(client, id);
      await issuePickupQr(client, id);
    }

    await client.query(
      `UPDATE logi_courier_assignments SET status = 'picked_up', picked_up_at = now(), updated_at = now() WHERE id = $1`,
      [row.assignment_id]);

    await client.query('COMMIT');
    for (const n of moved.notes ?? []) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
    pushMarket([row.seller_id], { type: 'logi-notification', payload: { kind: 'picked_up', text: 'Курьер забрал отправление', orderId: id } });
    await logMarket(courierProfileId, 'courier_pickup_confirmed', id);
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Курьер передал отправление покупателю.
 *
 * Покупатель предъявляет код или QR — тот же, что при выдаче на ПВЗ,
 * сверяется так же (hashCode+codesEqual, постоянное время сравнения).
 * Успешная проверка сразу переводит заказ до конца (buyer_received →
 * completed) — тем же двойным переходом, что и verifyPickup: сделка не
 * должна повиснуть на промежуточном шаге только потому, что закрыл её
 * не сам покупатель нажатием кнопки, а курьер по коду.
 *
 * Заработок начисляется здесь же, один раз: UNIQUE(order_id) в
 * courier_earnings не даст сделать это дважды, даже если подтверждение
 * почему-то дойдёт до сервера повторно.
 */
export const confirmDelivery = async (courierProfileId, orderId, proof) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await lockedAssignment(client, id, courierProfileId);
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (row.assignment_status !== 'picked_up') { await client.query('ROLLBACK'); return { error: 'wrong_state', status: row.assignment_status }; }

    const qr = parseOrderQrPayload(proof) ?? (() => {
      const m = /^skypvz:pickup:(mo-[0-9a-f-]{36}):([\w-]{20,64})$/.exec(String(proof ?? '').trim());
      return m ? { orderId: m[1], token: m[2], isPickupQr: true } : null;
    })();
    const code = qr ? '' : text(proof, 20).replace(/\D/g, '');
    if (!qr && !code) { await client.query('ROLLBACK'); return { error: 'bad_code' }; }

    const ok = qr
      ? (qr.orderId === id && Boolean(pickupQrTokenFor(row)) && codesEqual(hashCode(qr.token, id), hashCode(pickupQrTokenFor(row), id)))
      : (Boolean(pickupCodeFor(row)) && codesEqual(hashCode(code, id), hashCode(pickupCodeFor(row), id)));
    if (!ok) {
      await client.query('ROLLBACK');
      await logMarket(courierProfileId, 'courier_delivery_denied', id);
      return { error: 'bad_code' };
    }

    const { row: received, notes } = await applyTransition(client, row, {
      to: 'buyer_received', actorId: courierProfileId, actorRole: 'courier',
      detail: { assignmentId: row.assignment_id },
    });
    const done = await applyTransition(client, received, {
      to: 'completed', actorId: null, actorRole: 'system', detail: { auto: true, byCourier: courierProfileId },
    });
    await client.query(
      `UPDATE market_products SET sold = sold + $2, updated_at = now() WHERE id = $1`,
      [row.product_id, row.quantity]);
    await client.query(
      `UPDATE market_sellers SET orders_done = orders_done + 1, updated_at = now() WHERE profile_id = $1`,
      [row.seller_id]);
    await accrueCommissionIfNeeded(client, done.row);

    await client.query(
      `UPDATE logi_courier_assignments SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = $1`,
      [row.assignment_id]);
    await client.query('UPDATE logi_couriers SET deliveries = deliveries + 1 WHERE id = $1', [row.assign_courier_id]);

    let earned = 0;
    const { rows: ins } = await client.query(
      `INSERT INTO courier_earnings (id, courier_id, profile_id, assignment_id, order_id, amount_kop)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (order_id) DO NOTHING RETURNING amount_kop`,
      [`ce-${generateId()}`, row.assign_courier_id, courierProfileId, row.assignment_id, id, row.courier_price_kop || 0]);
    if (ins[0] && Number(ins[0].amount_kop) > 0) earned = Number(ins[0].amount_kop);

    // Заработок курьера зачисляется той же транзакцией, что и запись о нём:
    // раньше COMMIT шёл раньше, сбой кошелька оставлял строку courier_earnings
    // (повторно её уже не создать — ON CONFLICT) без денег на балансе.
    if (earned > 0 && Math.round(earned / 100) > 0) {
      const credited = await wallet.creditIn(
        client, courierProfileId, Math.round(earned / 100), 'courier_earning', `Доставка заказа ${id}`, id);
      if (credited.error) throw new Error(`courier_credit_${credited.error}`);
    }
    await client.query('COMMIT');

    for (const n of [...notes, ...done.notes]) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
    pushMarket([row.seller_id], { type: 'logi-notification', payload: { kind: 'delivered', text: 'Курьер доставил заказ', orderId: id } });
    await logMarket(courierProfileId, 'courier_delivery_confirmed', id, { earnedKop: earned });
    return { ok: true, earned: earned / 100 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export { pickupQrPayload };
