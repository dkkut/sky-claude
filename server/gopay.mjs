/**
 * Sky GO — прямая оплата и представление заказа.
 *
 * Sky не принимает деньги клиентов за такси, еду и доставку. Заказчик переводит деньги исполнителю по его реквизитам
 * и нажимает «Я оплатил»; получение денег подтверждает только получатель. Каждый шаг проверяет участника и допустимое состояние.
 * Реквизиты видит только плательщик по своему заказу, пока оплата не закрыта.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { payDetailsRaw } from './goreg.mjs';
import { profileCards, openJson, sealJson, addEvent, lockOrder, setStatus, notifyGo, goLog, inTx, showCode } from './gocore.mjs';

/** Открыть оплату по заказу (идемпотентно): снимок реквизитов получателя на сейчас. */
export const openPayment = async (client, order, payerId, payeeId, amount) => {
  const { rows } = await client.query('SELECT 1 FROM go_order_pay WHERE order_id = $1', [order.id]);
  if (rows[0]) return { ok: true, existed: true };
  const details = await payDetailsRaw(payeeId);
  if (!details) return { error: 'payee_details_missing' };
  await client.query(
    `INSERT INTO go_order_pay (order_id, payer_id, payee_id, amount_rub, details_enc) VALUES ($1,$2,$3,$4,$5)`,
    [order.id, payerId, payeeId, amount, sealJson(details)]);
  return { ok: true };
};

export const payRow = async (client, orderId) => {
  const { rows } = await (client ?? { query }).query('SELECT * FROM go_order_pay WHERE order_id = $1', [orderId]);
  return rows[0] ?? null;
};

/** Заказчик сообщает, что перевёл деньги. Только плательщик, только пока оплата ждёт. */
export const reportPaid = async (customerId, orderId) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o) return { error: 'not_found' };
  const pay = await payRow(c, orderId);
  if (!pay || pay.payer_id !== customerId) return { error: 'not_allowed' };
  if (pay.state !== 'awaiting') return { error: 'bad_state', state: pay.state };
  await c.query(`UPDATE go_order_pay SET state = 'reported', reported_at = now() WHERE order_id = $1`, [orderId]);
  // Для оплаты «после» статус заказа движется вместе с оплатой; для оплаты «до» статус заказа не меняется.
  if (o.status === 'awaiting_payment') await setStatus(c, o, 'payment_reported', customerId, 'Заказчик сообщил об оплате');
  else await addEvent(c, orderId, customerId, o.status, o.status, 'Заказчик сообщил об оплате');
  return { ok: true, payeeId: pay.payee_id, kind: o.kind };
}).then(async (r) => {
  if (r.ok) await notifyGo(r.payeeId, 'payment', 'Заказчик сообщил об оплате', 'Проверьте поступление денег и подтвердите получение.', orderId);
  return r;
});

/** Получатель подтверждает, что деньги пришли. Только получатель, только после сообщения заказчика. */
export const confirmPaid = async (payeeId, orderId) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o) return { error: 'not_found' };
  const pay = await payRow(c, orderId);
  if (!pay || pay.payee_id !== payeeId) return { error: 'not_allowed' };
  if (pay.state !== 'reported') return { error: 'not_reported', state: pay.state };
  await c.query(`UPDATE go_order_pay SET state = 'confirmed', confirmed_at = now() WHERE order_id = $1`, [orderId]);
  if (o.status === 'payment_reported') {
    await setStatus(c, o, 'paid', payeeId, 'Получение оплаты подтверждено', { completed_at: new Date() });
  } else {
    await addEvent(c, orderId, payeeId, o.status, o.status, 'Получение оплаты подтверждено');
  }
  return { ok: true, customerId: pay.payer_id, status: o.status === 'payment_reported' ? 'paid' : o.status };
}).then(async (r) => {
  if (r.ok) await notifyGo(r.customerId, 'payment', 'Оплата подтверждена', 'Исполнитель подтвердил получение денег.', orderId);
  return r;
});

/* ─── Представление заказа ─────────────────────────────────────────── */

const strip = (obj, keys) => { const o = { ...obj }; for (const k of keys) delete o[k]; return o; };

/**
 * Что показать конкретному человеку. Посторонним — ничего (проверка до вызова).
 * Контакты получателя/отправителя — только назначенному исполнителю и заказчику; адреса видны до принятия (иначе не выбрать заказ).
 */
export const orderView = async (row, viewerId, { events = false, staff = false } = {}) => {
  const isCustomer = row.customer_id === viewerId;
  const isExecutor = row.executor_id === viewerId;
  const data = row.data ?? {};
  let safe = data;
  if (!isCustomer && !isExecutor && !staff) safe = strip(data, ['sender', 'recipient', 'contact']);
  // Точный адрес жилья гость получает только после подтверждения брони владельцем.
  if (row.kind === 'stay' && isCustomer && !isExecutor && !['awaiting_payment', 'payment_reported', 'paid'].includes(row.status)) safe = strip(safe, ['address']);
  const cards = await profileCards([row.customer_id, row.executor_id]);
  const out = {
    id: row.id, kind: row.kind, parentId: row.parent_id ?? null, status: row.status, priceRub: row.price_rub, city: row.city,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), completedAt: row.completed_at?.toISOString?.() ?? null,
    cancelReason: row.cancel_reason || undefined,
    role: isCustomer ? 'customer' : isExecutor ? 'executor' : staff ? 'staff' : 'viewer',
    data: safe,
    customer: isExecutor || staff ? cards.get(row.customer_id) : undefined,
    executor: row.executor_id ? cards.get(row.executor_id) : null,
  };
  if (isExecutor || isCustomer || staff) {
    const pay = await payRow(null, row.id);
    if (pay) {
      out.pay = { state: pay.state, amountRub: pay.amount_rub, payeeId: pay.payee_id, payerId: pay.payer_id, reportedAt: pay.reported_at?.toISOString?.() ?? null, confirmedAt: pay.confirmed_at?.toISOString?.() ?? null };
      // Реквизиты — только плательщику и только пока деньги не подтверждены.
      if (isCustomer && pay.state !== 'confirmed') out.pay.details = openJson(pay.details_enc);
    }
    if (isCustomer) {
      const pc = await showCode(row.id, 'pickup'); const hc = await showCode(row.id, 'handover');
      if (pc || hc) out.codes = { pickup: pc ?? undefined, handover: hc ?? undefined };
    }
  }
  if (events && (isCustomer || isExecutor || staff)) {
    const { rows } = await query('SELECT from_status, to_status, note, at, actor_id FROM go_order_events WHERE order_id = $1 ORDER BY id', [row.id]);
    out.events = rows.map((e) => ({ from: e.from_status, to: e.to_status, note: e.note, at: e.at.toISOString(), byYou: e.actor_id === viewerId }));
  }
  return out;
};

export const getOrder = async (viewerId, id) => {
  const { rows } = await query('SELECT * FROM go_orders WHERE id = $1', [String(id ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  const staff = await can(viewerId, 'go');
  const part = row.customer_id === viewerId || row.executor_id === viewerId;
  // Продавец видит доставку своей еды (чтобы знать, кто приедет).
  let related = false;
  if (!part && row.kind === 'delivery' && row.parent_id) {
    const { rows: p } = await query('SELECT executor_id FROM go_orders WHERE id = $1', [row.parent_id]);
    related = p[0]?.executor_id === viewerId;
  }
  if (!part && !staff && !related) return { error: 'not_found' };   // чужой заказ неотличим от несуществующего
  return { order: await orderView(row, viewerId, { events: true, staff: staff && !part }) };
};

export const listMine = async (profileId, { side, status, limit, offset } = {}) => {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  const col = side === 'executor' ? 'executor_id' : 'customer_id';
  const active = status === 'active';
  const done = status === 'history';
  const terminal = `('paid','cancelled')`;
  const { rows } = await query(
    `SELECT * FROM go_orders WHERE ${col} = $1 ${active ? `AND status NOT IN ${terminal}` : done ? `AND status IN ${terminal}` : ''}
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [profileId, lim, off]);
  return { orders: await Promise.all(rows.map((r) => orderView(r, profileId))) };
};

/** Спор: любая сторона, пока заказ не закрыт. Дальше решает администрация (право go). */
export const openDispute = async (actorId, orderId, reason) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || (o.customer_id !== actorId && o.executor_id !== actorId)) return { error: 'not_found' };
  if (['paid', 'cancelled', 'dispute'].includes(o.status)) return { error: 'bad_state', status: o.status };
  const why = String(reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  if (why.length < 5) return { error: 'reason_required' };
  await setStatus(c, o, 'dispute', actorId, why, { data: { ...(o.data ?? {}), disputeFrom: o.status, disputeBy: actorId } });
  await goLog(actorId, 'dispute_open', o.id, { reason: why });
  return { ok: true, other: o.customer_id === actorId ? o.executor_id : o.customer_id, kind: o.kind };
}).then(async (r) => {
  if (r.ok && r.other) await notifyGo(r.other, 'dispute', 'Открыт спор по заказу', 'Администрация Sky рассмотрит обращение.', orderId);
  return r;
});

/** Решение по спору администрацией. */
export const resolveDispute = async (adminId, orderId, outcome, note) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  if (!['paid', 'cancelled'].includes(outcome)) return { error: 'bad_outcome' };
  const text = String(note ?? '').trim().slice(0, 300);
  if (text.length < 3) return { error: 'note_required' };
  return inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o) return { error: 'not_found' };
    if (o.status !== 'dispute') return { error: 'bad_state', status: o.status };
    await setStatus(c, o, outcome, adminId, `Решение администрации: ${text}`, { completed_at: new Date(), cancel_reason: outcome === 'cancelled' ? text : '' });
    await goLog(adminId, 'dispute_resolve', o.id, { outcome, note: text });
    return { ok: true, parties: [o.customer_id, o.executor_id].filter(Boolean) };
  }).then(async (r) => {
    if (r.ok) for (const p of r.parties) await notifyGo(p, 'dispute', 'Спор рассмотрен', `Решение: ${outcome === 'paid' ? 'заказ закрыт' : 'заказ отменён'}. ${text}`, orderId);
    return r;
  });
};
