/**
 * Sky Еда: заведения, меню, заказы. Заведение публикует одобренный продавец с активным кабинетом; цена заказа считается
 * сервером по актуальному меню (снимок позиций уходит в заказ). Доставку делает единая система курьеров (godelivery.mjs):
 * когда заведение отмечает «готово», создаётся заказ доставки. Оплата еды — напрямую продавцу.
 */
import { query } from './db.mjs';
import { canAccept, subscriptionState } from './gosubs.mjs';
import { openPayment } from './gopay.mjs';
import { executorStatus } from './goreg.mjs';
import { createFoodDelivery, payTerm } from './godelivery.mjs';
import { cityOk, newId, inTx, lockOrder, setStatus, addEvent, resolvePoint, notifyGo, clean, cleanPoint, pointOk } from './gocore.mjs';

const MAX_ITEMS = 30;
const ACTIVE_FOOD = ['pending', 'accepted', 'cooking', 'ready', 'handed_to_courier', 'delivering', 'awaiting_payment', 'payment_reported'];

/* ─── Заведение продавца ───────────────────────────────────────────── */
const placeRow = async (ownerId) => (await query('SELECT * FROM go_places WHERE owner_id = $1', [ownerId])).rows[0] ?? null;
const placeView = (r, extra = {}) => ({ id: r.id, name: r.name, descr: r.descr, city: r.city, address: r.address, lat: r.lat, lng: r.lng,
  category: r.category, hours: r.hours, published: r.published, accepting: r.accepting, ...extra });

const sellerReady = async (ownerId) => {
  const ex = await executorStatus(ownerId, 'food_seller');
  if (!ex || ex.status !== 'approved') return { error: 'not_approved' };
  return { ok: true, city: ex.city };
};

export const myPlace = async (ownerId) => {
  const r = await placeRow(ownerId);
  if (!r) return { place: null };
  const { rows: items } = await query('SELECT * FROM go_menu_items WHERE place_id = $1 ORDER BY sort, created_at', [r.id]);
  const sub = await subscriptionState(ownerId, 'food_seller');
  return { place: placeView(r, { subscriptionActive: sub.active }), items: items.map(itemView) };
};

const itemView = (i) => ({ id: i.id, category: i.category, name: i.name, descr: i.descr, priceRub: i.price_rub, available: i.available, sort: i.sort });

export const savePlace = async (ownerId, input) => {
  const ok = await sellerReady(ownerId); if (ok.error) return ok;
  const name = clean(input?.name, 120);
  if (name.length < 2) return { error: 'name_required' };
  const address = clean(input?.address, 240);
  if (address.length < 4) return { error: 'address_required' };
  const city = clean(input?.city, 60) || ok.city;
  if (!(await cityOk(city))) return { error: 'bad_city' };
  let lat = null; let lng = null;
  const rp = await resolvePoint({ address: `${city}, ${address}`, lat: input?.lat, lng: input?.lng });
  if (rp.ok) { lat = rp.point.lat; lng = rp.point.lng; } else if (!pointOk(cleanPoint(input))) { /* без координат — публикация закрыта */ }
  const cur = await placeRow(ownerId);
  const vals = [name, clean(input?.descr, 500), city, address, lat, lng, clean(input?.category, 60), clean(input?.hours, 80)];
  if (cur) {
    await query(`UPDATE go_places SET name=$2, descr=$3, city=$4, address=$5, lat=$6, lng=$7, category=$8, hours=$9, updated_at = now() WHERE id = $1`, [cur.id, ...vals]);
    return { ok: true, id: cur.id, located: lat != null };
  }
  const id = newId('gpl');
  await query(`INSERT INTO go_places (id, owner_id, name, descr, city, address, lat, lng, category, hours) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, ownerId, ...vals]);
  return { ok: true, id, located: lat != null };
};

export const setPublished = async (ownerId, on) => {
  const ok = await sellerReady(ownerId); if (ok.error) return ok;
  const p = await placeRow(ownerId);
  if (!p) return { error: 'no_place' };
  if (on) {
    const sub = await subscriptionState(ownerId, 'food_seller');
    if (!sub.active) return { error: 'subscription_required' };
    if (p.lat == null) return { error: 'place_not_located' };
    const { rows } = await query('SELECT count(*)::int AS n FROM go_menu_items WHERE place_id = $1 AND available', [p.id]);
    if (rows[0].n < 1) return { error: 'menu_empty' };
  }
  await query('UPDATE go_places SET published = $2, updated_at = now() WHERE id = $1', [p.id, Boolean(on)]);
  return { ok: true, published: Boolean(on) };
};

export const setAccepting = async (ownerId, on) => {
  const p = await placeRow(ownerId);
  if (!p) return { error: 'no_place' };
  await query('UPDATE go_places SET accepting = $2, updated_at = now() WHERE id = $1', [p.id, Boolean(on)]);
  return { ok: true, accepting: Boolean(on) };
};

export const saveItem = async (ownerId, input) => {
  const ok = await sellerReady(ownerId); if (ok.error) return ok;
  const p = await placeRow(ownerId);
  if (!p) return { error: 'no_place' };
  const name = clean(input?.name, 120);
  const price = Number(input?.priceRub);
  if (name.length < 2) return { error: 'name_required' };
  if (!Number.isInteger(price) || price < 0 || price > 100000) return { error: 'bad_price' };
  const vals = [clean(input?.category, 60), name, clean(input?.descr, 400), price, input?.available !== false, Math.max(0, Math.min(9999, Number(input?.sort) || 0))];
  if (input?.id) {
    const { rowCount } = await query(
      `UPDATE go_menu_items SET category=$3, name=$4, descr=$5, price_rub=$6, available=$7, sort=$8 WHERE id = $1 AND place_id = $2`, [String(input.id), p.id, ...vals]);
    return rowCount ? { ok: true, id: input.id } : { error: 'not_found' };
  }
  const { rows: n } = await query('SELECT count(*)::int AS n FROM go_menu_items WHERE place_id = $1', [p.id]);
  if (n[0].n >= 300) return { error: 'too_many_items' };
  const id = newId('gmi');
  await query(`INSERT INTO go_menu_items (id, place_id, category, name, descr, price_rub, available, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, p.id, ...vals]);
  return { ok: true, id };
};

export const removeItem = async (ownerId, id) => {
  const p = await placeRow(ownerId);
  if (!p) return { error: 'no_place' };
  const { rowCount } = await query('DELETE FROM go_menu_items WHERE id = $1 AND place_id = $2', [String(id ?? ''), p.id]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

/* ─── Каталог ──────────────────────────────────────────────────────── */
/** Видны только заведения с действующим кабинетом: без подписки продавец новых заказов не принимает, и показывать его незачем. */
export const catalog = async ({ city, q, category } = {}) => {
  const args = [];
  const where = ['p.published', 'p.accepting'];
  if (city) { args.push(clean(city, 60)); where.push(`p.city = $${args.length}`); }
  if (category) { args.push(clean(category, 60)); where.push(`p.category = $${args.length}`); }
  if (q) { args.push(`%${clean(q, 60).toLowerCase().replace(/([\\%_])/g, '\\$1')}%`); where.push(`(lower(p.name) LIKE $${args.length} ESCAPE '\\' OR lower(p.category) LIKE $${args.length} ESCAPE '\\')`); }
  const { rows } = await query(
    `SELECT p.* FROM go_places p
      WHERE ${where.join(' AND ')}
        AND EXISTS (SELECT 1 FROM go_executors e WHERE e.profile_id = p.owner_id AND e.role = 'food_seller' AND e.status = 'approved')
        AND EXISTS (SELECT 1 FROM go_subscriptions s WHERE s.profile_id = p.owner_id AND s.role = 'food_seller' AND s.expires_at > now())
      ORDER BY p.name LIMIT 100`, args);
  return { places: rows.map((r) => placeView(r)) };
};

export const getPlace = async (id) => {
  const { rows } = await query(
    `SELECT p.* FROM go_places p WHERE p.id = $1 AND p.published
        AND EXISTS (SELECT 1 FROM go_executors e WHERE e.profile_id = p.owner_id AND e.role = 'food_seller' AND e.status = 'approved')
        AND EXISTS (SELECT 1 FROM go_subscriptions s WHERE s.profile_id = p.owner_id AND s.role = 'food_seller' AND s.expires_at > now())`, [String(id ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const { rows: items } = await query('SELECT * FROM go_menu_items WHERE place_id = $1 ORDER BY sort, created_at', [rows[0].id]);
  return { place: placeView(rows[0]), items: items.map(itemView) };
};

/* ─── Заказы ───────────────────────────────────────────────────────── */
export const create = async (customerId, input) => {
  const placeId = String(input?.placeId ?? '');
  const lines = Array.isArray(input?.items) ? input.items : [];
  if (!lines.length) return { error: 'cart_empty' };
  const want = new Map();
  for (const l of lines) {
    const q = Math.floor(Number(l?.qty));
    if (!l?.id || !Number.isFinite(q) || q < 1 || q > 20) return { error: 'bad_qty' };
    want.set(String(l.id), (want.get(String(l.id)) ?? 0) + q);
  }
  if ([...want.values()].reduce((a, b) => a + b, 0) > MAX_ITEMS) return { error: 'too_many_items' };

  const g = await getPlace(placeId);
  if (g.error) return { error: 'place_unavailable' };
  const placeRowFull = (await query('SELECT * FROM go_places WHERE id = $1', [placeId])).rows[0];
  if (!placeRowFull.accepting) return { error: 'place_closed' };
  if (placeRowFull.owner_id === customerId) return { error: 'own_place' };
  const byId = new Map(g.items.map((i) => [i.id, i]));
  const snapshot = [];
  let sum = 0;
  for (const [id, qty] of want) {
    const it = byId.get(id);
    if (!it || !it.available) return { error: 'item_unavailable', itemId: id };
    snapshot.push({ id, name: it.name, priceRub: it.priceRub, qty });
    sum += it.priceRub * qty;
  }
  const rp = await resolvePoint(input?.address);
  if (rp.error) return { error: `address_${rp.error}` };
  const name = clean(input?.recipient?.name, 80); const phone = String(input?.recipient?.phone ?? '').replace(/[^\d+]/g, '').slice(0, 16);
  if (name.length < 2) return { error: 'recipient_name_required' };
  if (!/^\+?\d{10,15}$/.test(phone)) return { error: 'recipient_phone_invalid' };
  const idem = clean(input?.idemKey, 64) || null;
  const term = await payTerm('food');

  return inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:cust:${customerId}`]);
    if (idem) {
      const { rows } = await c.query('SELECT id FROM go_orders WHERE customer_id = $1 AND idem_key = $2', [customerId, idem]);
      if (rows[0]) return { ok: true, orderId: rows[0].id, duplicate: true };
    }
    const { rows: act } = await c.query(`SELECT count(*)::int AS n FROM go_orders WHERE customer_id = $1 AND kind = 'food' AND status = ANY($2::text[])`, [customerId, ACTIVE_FOOD]);
    if (act[0].n >= 5) return { error: 'too_many_active' };
    const id = newId('go');
    const data = { placeId, placeName: g.place.name, placeAddress: g.place.address, items: snapshot, sumRub: sum, address: rp.point, recipient: { name, phone },
      comment: clean(input?.comment, 300), payTerm: term };
    await c.query(`INSERT INTO go_orders (id, kind, customer_id, executor_id, status, price_rub, city, data, idem_key) VALUES ($1,'food',$2,$3,'pending',$4,$5,$6::jsonb,$7)`,
      [id, customerId, placeRowFull.owner_id, sum, g.place.city, JSON.stringify(data), idem]);
    await addEvent(c, id, customerId, null, 'pending', 'Заказ оформлен');
    return { ok: true, orderId: id, sumRub: sum, sellerId: placeRowFull.owner_id };
  }).then(async (r) => {
    if (r.ok && !r.duplicate) await notifyGo(r.sellerId, 'food', 'Новый заказ', 'Поступил заказ — примите его.', r.orderId);
    return r;
  });
};

export const sellerOrders = async (sellerId) => {
  const { rows } = await query(`SELECT * FROM go_orders WHERE kind = 'food' AND executor_id = $1 ORDER BY created_at DESC LIMIT 100`, [sellerId]);
  return rows;
};

const SELLER_STEPS = {
  accept: { from: 'pending', to: 'accepted', note: 'Принят продавцом', msg: 'Заведение приняло заказ.' },
  cook: { from: 'accepted', to: 'cooking', note: 'Готовится', msg: 'Ваш заказ готовится.' },
};

export const sellerAct = async (sellerId, orderId, action, reason) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'food' || o.executor_id !== sellerId) return { error: 'not_found' };
  if (action === 'accept') {
    const ok = await canAccept(sellerId, 'food_seller').then((r) => (r.error === 'pay_details_required' ? r : r));
    if (ok.error) return ok;
  }
  if (action === 'reject') {
    if (!['pending', 'accepted', 'cooking'].includes(o.status)) return { error: 'bad_state', status: o.status };
    const why = clean(reason, 200);
    if (why.length < 3) return { error: 'reason_required' };
    await setStatus(c, o, 'cancelled', sellerId, `Отказ заведения: ${why}`, { cancelled_by: sellerId, cancel_reason: why });
    return { ok: true, notify: [o.customer_id, 'Заказ отменён', `Заведение отказалось: ${why}`] };
  }
  if (action === 'ready') {
    if (o.status !== 'cooking') return { error: 'bad_state', status: o.status };
    if (o.data.payTerm === 'before') {
      const { rows: p } = await c.query('SELECT state FROM go_order_pay WHERE order_id = $1', [o.id]);
      if (p[0]?.state !== 'confirmed') return { error: 'payment_required' };
    }
    const place = (await c.query('SELECT * FROM go_places WHERE id = $1', [o.data.placeId])).rows[0];
    if (!place || place.lat == null) return { error: 'place_not_located' };
    await setStatus(c, o, 'ready', sellerId, 'Готов к выдаче');
    const d = await createFoodDelivery(c, o, place);
    return { ok: true, deliveryId: d.id, notify: [o.customer_id, 'Заказ готов', 'Ищем курьера для доставки.'] };
  }
  const step = SELLER_STEPS[action];
  if (!step) return { error: 'bad_action' };
  if (o.status !== step.from) return { error: 'bad_state', status: o.status };
  if (action === 'cook' && o.data.payTerm === 'before') {
    const { rows: p } = await c.query('SELECT state FROM go_order_pay WHERE order_id = $1', [o.id]);
    if (p[0]?.state !== 'confirmed') return { error: 'payment_required' };
  }
  await setStatus(c, o, step.to, sellerId, step.note);
  if (action === 'accept' && o.data.payTerm === 'before') {
    const opened = await openPayment(c, o, o.customer_id, sellerId, o.price_rub);
    if (opened.error) return opened;
  }
  return { ok: true, notify: [o.customer_id, 'Sky Еда', step.msg] };
}).then(async (r) => {
  if (r.ok && r.notify) await notifyGo(r.notify[0], 'food', r.notify[1], r.notify[2], orderId);
  return r;
});

export const customerCancel = async (customerId, orderId, reason) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'food' || o.customer_id !== customerId) return { error: 'not_found' };
  if (!['pending', 'accepted'].includes(o.status)) return { error: 'bad_state', status: o.status };
  await setStatus(c, o, 'cancelled', customerId, clean(reason, 200) || 'Отменён заказчиком', { cancelled_by: customerId, cancel_reason: clean(reason, 200) });
  return { ok: true, sellerId: o.executor_id };
}).then(async (r) => {
  if (r.ok) await notifyGo(r.sellerId, 'food', 'Заказ отменён', 'Покупатель отменил заказ.', orderId);
  return r;
});

/** Курьерский заказ двинулся — еда следует за ним. Вызывается маршрутами после шага курьера. */
export const syncFromDelivery = async (foodOrderId, to, actorId) => inTx(async (c) => {
  const o = await lockOrder(c, foodOrderId);
  if (!o || o.kind !== 'food') return { ok: true };
  const order = { handed_to_courier: ['ready'], delivering: ['handed_to_courier', 'ready'], delivered: ['delivering', 'handed_to_courier', 'ready'] };
  if (!order[to]?.includes(o.status)) return { ok: true };
  if (to === 'delivered') {
    if (o.data.payTerm === 'before') {
      const { rows: p } = await c.query('SELECT state FROM go_order_pay WHERE order_id = $1', [o.id]);
      if (p[0]?.state === 'confirmed') { await setStatus(c, o, 'paid', actorId, 'Доставлено', { completed_at: new Date() }); return { ok: true }; }
    }
    const opened = await openPayment(c, o, o.customer_id, o.executor_id, o.price_rub);
    if (opened.error) return { ok: true, warn: opened.error };
    await setStatus(c, o, 'awaiting_payment', actorId, 'Доставлено — ожидается оплата заведению', { completed_at: new Date() });
    return { ok: true, customerId: o.customer_id };
  }
  await setStatus(c, o, to, actorId, to === 'delivering' ? 'Курьер везёт заказ' : 'Передан курьеру');
  return { ok: true };
});
