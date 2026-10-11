/**
 * Sky Доставка: три сценария (ПВЗ → получатель, получатель → получатель, компания → получатель) и доставка еды для Sky Еды.
 * Все они идут через одну систему курьеров: один кабинет, одна подписка. Переходы проверяет сервер; передачу курьеру и вручение
 * подтверждают одноразовые коды (хеш, срок, 5 попыток). Оплата — напрямую курьеру (до или после — настройка payment_terms.delivery).
 */
import { query } from './db.mjs';
import { canAccept } from './gosubs.mjs';
import { openPayment } from './gopay.mjs';
import { executorStatus } from './goreg.mjs';
import { getSetting, cityOk, newId, inTx, lockOrder, setStatus, addEvent, resolvePoint, routeBetween, issueCode, checkCode, notifyGo, clean, haversineKm, cleanPoint } from './gocore.mjs';

const SCENARIOS = ['pvz', 'p2p', 'company', 'food'];
const ACTIVE = ['searching', 'assigned', 'heading_pickup', 'at_pickup', 'picked_up', 'delivering', 'at_recipient', 'awaiting_payment', 'payment_reported'];
const SIZES = ['s', 'm', 'l'];

const contact = (c, label) => {
  const name = clean(c?.name, 80);
  const phone = String(c?.phone ?? '').replace(/[^\d+]/g, '').slice(0, 16);
  if (name.length < 2) return { error: `${label}_name_required` };
  if (!/^\+?\d{10,15}$/.test(phone)) return { error: `${label}_phone_invalid` };
  return { ok: true, value: { name, phone } };
};

export const deliveryPrice = async (km, size, food) => {
  const t = (await getSetting('delivery_tariff', {})) ?? {};
  if (food) return Math.max(Number(t.foodMin) || 0, Math.round((Number(t.foodBase) || 0) + km * (Number(t.foodPerKm) || 0)));
  const sur = Number(t.sizeSurcharge?.[size]) || 0;
  return Math.max(Number(t.minRub) || 0, Math.round((Number(t.base) || 0) + km * (Number(t.perKm) || 0) + sur));
};

export const payTerm = async (kind) => {
  const t = (await getSetting('payment_terms', {})) ?? {};
  const v = t[kind];
  return v === 'before' || v === 'on_accept' ? 'before' : 'after';
};

export const quote = async (input) => {
  const city = clean(input?.city, 60);
  if (!(await cityOk(city))) return { error: 'bad_city' };
  const a = await resolvePoint(input?.from); if (a.error) return { error: `from_${a.error}` };
  const b = await resolvePoint(input?.to); if (b.error) return { error: `to_${b.error}` };
  const rawSize = input?.size ?? input?.parcel?.size;
  const size = SIZES.includes(rawSize) ? rawSize : 's';
  const r = await routeBetween(a.point, b.point);
  if (r.km > 300) return { error: 'too_far' };
  return { ok: true, from: a.point, to: b.point, km: Math.round(r.km * 10) / 10, minutes: r.min, estimated: r.estimated, size, priceRub: await deliveryPrice(r.km, size, false) };
};

/** Заказ доставки. company — только для одобренной компании. food создаётся Sky Едой (createFoodDelivery), а не человеком. */
export const create = async (customerId, input) => {
  const scenario = String(input?.scenario ?? '');
  if (!SCENARIOS.includes(scenario) || scenario === 'food') return { error: 'bad_scenario' };
  if (scenario === 'company') {
    const ex = await executorStatus(customerId, 'company');
    if (!ex || ex.status !== 'approved') return { error: 'company_not_approved' };
    const ok = await canAccept(customerId, 'company').then((r) => (r.error === 'pay_details_required' ? { ok: true } : r));   // компании реквизиты для приёма денег не нужны
    if (ok.error) return ok;
  }
  const q = await quote(input);
  if (q.error) return q;
  const rec = contact(input?.recipient, 'recipient'); if (rec.error) return rec;
  let sender = null;
  if (scenario !== 'pvz') { const s = contact(input?.sender, 'sender'); if (s.error) return s; sender = s.value; }
  const parcel = { description: clean(input?.parcel?.description, 200), weightKg: Math.min(100, Math.max(0, Number(input?.parcel?.weightKg) || 0)), size: q.size };
  if (parcel.description.length < 2) return { error: 'parcel_required' };
  const pvzInfo = scenario === 'pvz' ? clean(input?.pvzInfo, 200) : '';
  if (scenario === 'pvz' && pvzInfo.length < 2) return { error: 'pvz_info_required' };
  const idem = clean(input?.idemKey, 64) || null;
  const term = await payTerm('delivery');

  return inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:cust:${customerId}`]);
    if (idem) {
      const { rows } = await c.query('SELECT id FROM go_orders WHERE customer_id = $1 AND idem_key = $2', [customerId, idem]);
      if (rows[0]) return { ok: true, orderId: rows[0].id, duplicate: true };
    }
    const { rows: act } = await c.query(`SELECT count(*)::int AS n FROM go_orders WHERE customer_id = $1 AND kind = 'delivery' AND status = ANY($2::text[])`, [customerId, ACTIVE]);
    if (act[0].n >= 10) return { error: 'too_many_active' };
    const id = newId('go');
    const data = { scenario, from: q.from, to: q.to, km: q.km, minutes: q.minutes, estimated: q.estimated, parcel, pvzInfo, sender, recipient: rec.value,
      comment: clean(input?.comment, 200), desiredTime: clean(input?.desiredTime, 60), payTerm: term,
      company: scenario === 'company' ? clean(input?.company, 120) : undefined };
    await c.query(`INSERT INTO go_orders (id, kind, customer_id, status, price_rub, city, data, idem_key) VALUES ($1,'delivery',$2,'searching',$3,$4,$5::jsonb,$6)`,
      [id, customerId, q.priceRub, clean(input.city, 60), JSON.stringify(data), idem]);
    await addEvent(c, id, customerId, null, 'searching', 'Заказ создан');
    await issueCode(c, id, 'pickup'); await issueCode(c, id, 'handover');
    return { ok: true, orderId: id, priceRub: q.priceRub };
  });
};

/** Доставка еды: создаёт Sky Еда, когда заведение отметило «готово». Платит заказчик курьеру напрямую. */
export const createFoodDelivery = async (client, foodOrder, place) => {
  const to = foodOrder.data.address;
  const from = { address: place.address, lat: place.lat, lng: place.lng };
  const r = await routeBetween(from, to);
  const price = await deliveryPrice(r.km, 's', true);
  const id = newId('go');
  const term = await payTerm('delivery');
  const data = { scenario: 'food', from, to, km: Math.round(r.km * 10) / 10, minutes: r.min, estimated: r.estimated,
    parcel: { description: `Заказ из «${place.name}»`, weightKg: 0, size: 's' }, recipient: foodOrder.data.recipient ?? null,
    comment: foodOrder.data.comment ?? '', payTerm: term, foodOrderId: foodOrder.id };
  await client.query(`INSERT INTO go_orders (id, kind, parent_id, customer_id, status, price_rub, city, data) VALUES ($1,'delivery',$2,$3,'searching',$4,$5,$6::jsonb)`,
    [id, foodOrder.id, foodOrder.customer_id, price, foodOrder.city, JSON.stringify(data)]);
  await addEvent(client, id, null, null, 'searching', 'Доставка еды создана');
  await issueCode(client, id, 'handover');
  return { id, price };
};

export const availableFor = async (courierId) => {
  const ok = await canAccept(courierId, 'courier');
  if (ok.error) return ok;
  const ex = await executorStatus(courierId, 'courier');
  const { rows: pres } = await query(`SELECT online, lat, lng FROM go_presence WHERE profile_id = $1 AND role = 'courier'`, [courierId]);
  if (!pres[0]?.online) return { error: 'offline' };
  const { rows } = await query(`SELECT * FROM go_orders WHERE kind = 'delivery' AND status = 'searching' AND executor_id IS NULL AND city = $1 ORDER BY created_at LIMIT 40`, [ex.city]);
  const here = pres[0].lat != null ? { lat: pres[0].lat, lng: pres[0].lng } : null;
  return { orders: rows.map((r) => ({
    id: r.id, scenario: r.data.scenario, priceRub: r.price_rub, createdAt: r.created_at.toISOString(),
    from: { address: r.data.from.address }, to: { address: r.data.to.address }, km: r.data.km, minutes: r.data.minutes,
    parcel: { description: r.data.parcel?.description, size: r.data.parcel?.size, weightKg: r.data.parcel?.weightKg }, comment: r.data.comment || undefined,
    distanceToPickupKm: here ? Math.round(haversineKm(here, r.data.from) * 10) / 10 : null })) };
};

export const accept = async (courierId, orderId) => {
  const ok = await canAccept(courierId, 'courier');
  if (ok.error) return ok;
  return inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:exec:${courierId}`]);
    const { rows: pres } = await c.query(`SELECT online FROM go_presence WHERE profile_id = $1 AND role = 'courier'`, [courierId]);
    if (!pres[0]?.online) return { error: 'offline' };
    const { rows: busy } = await c.query(`SELECT count(*)::int AS n FROM go_orders WHERE kind = 'delivery' AND executor_id = $1 AND status IN ('assigned','heading_pickup','at_pickup','picked_up','delivering','at_recipient')`, [courierId]);
    if (busy[0].n >= 3) return { error: 'courier_busy' };
    const ex = await executorStatus(courierId, 'courier');
    const { rows } = await c.query(
      `UPDATE go_orders SET status = 'assigned', executor_id = $2, updated_at = now()
        WHERE id = $1 AND kind = 'delivery' AND status = 'searching' AND executor_id IS NULL AND city = $3 RETURNING *`, [orderId, courierId, ex.city]);
    if (!rows[0]) return { error: 'already_taken' };
    await addEvent(c, orderId, courierId, 'searching', 'assigned', 'Курьер назначен');
    if (rows[0].data.payTerm === 'before' && rows[0].data.scenario !== 'food') {
      const opened = await openPayment(c, rows[0], rows[0].customer_id, courierId, rows[0].price_rub);
      if (opened.error) throw Object.assign(new Error(opened.error), { goError: opened.error });
    }
    return { ok: true, customerId: rows[0].customer_id, parentId: rows[0].parent_id };
  }).catch((e) => (e.goError ? { error: e.goError } : Promise.reject(e))).then(async (r) => {
    if (r.ok) await notifyGo(r.customerId, 'delivery', 'Курьер назначен', 'Курьер принял ваш заказ.', orderId);
    return r;
  });
};

const STEPS = {
  heading: { from: 'assigned', to: 'heading_pickup', note: 'Курьер направляется к месту получения', msg: 'Курьер едет за отправлением.' },
  arrived_pickup: { from: 'heading_pickup', to: 'at_pickup', note: 'Курьер прибыл к месту получения', msg: 'Курьер на месте получения.' },
  start_delivery: { from: 'picked_up', to: 'delivering', note: 'Доставка началась', msg: 'Доставка началась.' },
  arrived_recipient: { from: 'delivering', to: 'at_recipient', note: 'Курьер прибыл к получателю', msg: 'Курьер прибыл к получателю — назовите ему код вручения.' },
};

/** Шаги курьера. pickup: код передачи (кроме еды), deliver: код вручения. */
export const courierAct = async (courierId, orderId, action, code) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'delivery' || o.executor_id !== courierId) return { error: 'not_found' };
  const food = o.data.scenario === 'food';
  if (action === 'release') {
    if (!['assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
    await c.query(`UPDATE go_orders SET status = 'searching', executor_id = NULL, updated_at = now() WHERE id = $1`, [o.id]);
    await c.query(`DELETE FROM go_order_pay WHERE order_id = $1 AND state = 'awaiting'`, [o.id]);
    await addEvent(c, o.id, courierId, o.status, 'searching', 'Курьер отказался — поиск продолжается');
    return { ok: true, notify: [o.customer_id, 'Курьер отказался', 'Ищем другого курьера.'] };
  }
  if (action === 'pickup') {
    if (o.status !== 'at_pickup') return { error: 'bad_state', status: o.status };
    if (o.data.payTerm === 'before' && !food) {
      const { rows: p } = await c.query(`SELECT state FROM go_order_pay WHERE order_id = $1`, [o.id]);
      if (p[0]?.state !== 'confirmed') return { error: 'payment_required' };
    }
    if (!food) { const ck = await checkCode(c, o.id, 'pickup', code); if (ck.error) return ck; }
    await setStatus(c, o, 'picked_up', courierId, 'Отправление принято');
    return { ok: true, notify: [o.customer_id, 'Отправление принято', 'Курьер забрал отправление.'], foodSync: o.parent_id ? { parent: o.parent_id, to: 'handed_to_courier' } : null };
  }
  if (action === 'deliver') {
    if (o.status !== 'at_recipient') return { error: 'bad_state', status: o.status };
    const ck = await checkCode(c, o.id, 'handover', code); if (ck.error) return ck;
    if (o.data.payTerm === 'before') {
      const { rows: p } = await c.query(`SELECT state FROM go_order_pay WHERE order_id = $1`, [o.id]);
      const confirmed = food ? false : p[0]?.state === 'confirmed';
      if (confirmed) { await setStatus(c, o, 'paid', courierId, 'Отправление вручено', { completed_at: new Date() }); }
      else {
        const opened = await openPayment(c, o, o.customer_id, courierId, o.price_rub);
        if (opened.error) return opened;
        await setStatus(c, o, 'awaiting_payment', courierId, 'Отправление вручено — ожидается оплата', { completed_at: new Date() });
      }
    } else {
      const opened = await openPayment(c, o, o.customer_id, courierId, o.price_rub);
      if (opened.error) return opened;
      await setStatus(c, o, 'awaiting_payment', courierId, 'Отправление вручено — ожидается оплата', { completed_at: new Date() });
    }
    return { ok: true, notify: [o.customer_id, 'Отправление вручено', `К оплате курьеру ${o.price_rub} ₽ — реквизиты в заказе.`], foodSync: o.parent_id ? { parent: o.parent_id, to: 'delivered' } : null };
  }
  const step = STEPS[action];
  if (!step) return { error: 'bad_action' };
  if (o.status !== step.from) return { error: 'bad_state', status: o.status };
  await setStatus(c, o, step.to, courierId, step.note);
  return { ok: true, notify: [o.customer_id, 'Доставка', step.msg], foodSync: action === 'start_delivery' && o.parent_id ? { parent: o.parent_id, to: 'delivering' } : null };
}).then(async (r) => {
  if (r.ok && r.notify) await notifyGo(r.notify[0], 'delivery', r.notify[1], r.notify[2], orderId);
  return r;
});

export const customerCancel = async (customerId, orderId, reason) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'delivery' || o.customer_id !== customerId) return { error: 'not_found' };
  if (o.parent_id) return { error: 'cancel_via_food_order' };
  if (!['searching', 'assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
  await setStatus(c, o, 'cancelled', customerId, clean(reason, 200) || 'Отменён заказчиком', { cancelled_by: customerId, cancel_reason: clean(reason, 200) });
  return { ok: true, courierId: o.executor_id };
}).then(async (r) => {
  if (r.ok && r.courierId) await notifyGo(r.courierId, 'delivery', 'Заказ отменён', 'Заказчик отменил доставку.', orderId);
  return r;
});
