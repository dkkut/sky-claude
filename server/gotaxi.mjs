/**
 * Sky Такси. Цена считается на сервере по тарифам из настроек и по маршруту (или честной оценке); клиент цену не присылает.
 * Водитель принимает заказ атомарно (UPDATE … WHERE status='searching'), только с активным кабинетом и реквизитами для оплаты.
 * Оплата — напрямую водителю по его реквизитам: пассажир сообщает, водитель подтверждает; за пассажира водитель подтвердить не может.
 */
import { query } from './db.mjs';
import { canAccept } from './gosubs.mjs';
import { openPayment, orderView } from './gopay.mjs';
import { executorStatus } from './goreg.mjs';
import { tariffVersion, fingerprint, taxiBreakdown, issueQuote, redeemQuote, markQuoteUsed, snapshot } from './gopricing.mjs';
import { driverClass, classMode, classCheck } from './goclass.mjs';
import { offerNext, claimOffer, openOffersFor, cancelOffers } from './godispatch.mjs';
import { openJson, getSetting, cityOk, newId, inTx, lockOrder, setStatus, addEvent, resolvePoint, routeBetween, notifyGo, clean, haversineKm, goLog } from './gocore.mjs';

export const SCHEDULE_DEFAULTS = { minMin: 30, maxDays: 7, leadMin: 20, maxOrders: 5 };
export const scheduleSettings = async () => ({ ...SCHEDULE_DEFAULTS, ...(((await getSetting('schedule', null)) ?? {})) });

const ACTIVE = ['searching', 'assigned', 'en_route', 'arrived', 'in_ride', 'awaiting_payment', 'payment_reported'];

export const taxiTariffs = async () => (await getSetting('taxi_tariffs', {})) ?? {};

export const priceOf = (t, km, min) => Math.max(Number(t.min) || 0, Math.round((Number(t.base) || 0) + km * (Number(t.perKm) || 0) + min * (Number(t.perMin) || 0)));

/** Расчёт без записи: условия, маршрут, цены и их состав по каждому тарифу. */
const calc = async (input) => {
  const city = clean(input?.city, 60);
  if (!(await cityOk(city))) return { error: 'bad_city' };
  const a = await resolvePoint(input?.from); if (a.error) return { error: `from_${a.error}` };
  const b = await resolvePoint(input?.to); if (b.error) return { error: `to_${b.error}` };
  const r = await routeBetween(a.point, b.point);
  if (r.km > 200) return { error: 'too_far' };
  if (r.km < 0.1) return { error: 'same_point' };
  const tariffs = await taxiTariffs();
  const offers = Object.entries(tariffs).map(([code, t]) => ({ code, title: t.title, priceRub: priceOf(t, r.km, r.min), breakdown: taxiBreakdown(t, r.km, r.min) }));
  return { ok: true, city, from: a.point, to: b.point, km: Math.round(r.km * 10) / 10, minutes: r.min, estimated: r.estimated, offers,
    version: tariffVersion(tariffs), fp: fingerprint('taxi', city, a.point, b.point) };
};

/**
 * Предварительный расчёт. С profileId — ещё и котировка (quoteId, срок): цена, которую человек увидел, фиксируется,
 * и заказ по ней не может стоить иначе без повторного согласия. estimated=true — маршрут посчитан по прямой, а не картой.
 */
export const quote = async (input, profileId = null) => {
  const q = await calc(input);
  if (q.error) return q;
  const out = { ok: true, from: q.from, to: q.to, km: q.km, minutes: q.minutes, estimated: q.estimated,
    offers: q.offers.map((o) => ({ code: o.code, title: o.title, priceRub: o.priceRub, breakdown: o.breakdown })), tariffVersion: q.version, currency: 'RUB' };
  if (profileId) Object.assign(out, await issueQuote(profileId, 'taxi', q.fp, q.version, Object.fromEntries(q.offers.map((o) => [o.code, { priceRub: o.priceRub, breakdown: o.breakdown }])), { km: q.km, minutes: q.minutes, estimated: q.estimated }));
  return out;
};

export const create = async (customerId, input) => {
  const q = await calc(input);
  if (q.error) return q;
  const tariff = String(input?.tariff ?? '');
  const offer = q.offers.find((o) => o.code === tariff);
  if (!offer) return { error: 'bad_tariff' };
  const idem = clean(input?.idemKey, 64) || null;
  const comment = clean(input?.comment, 200);
  const quoteId = input?.quoteId ? String(input.quoteId) : null;
  // «На потом»: время проверяет сервер (не раньше чем через minMin минут, не дальше maxDays суток); заказ ждёт и сам начинает поиск за leadMin минут.
  let scheduledAt = null;
  if (input?.scheduledAt) {
    const sc = await scheduleSettings();
    const when = new Date(String(input.scheduledAt));
    if (Number.isNaN(when.getTime())) return { error: 'bad_schedule' };
    const ahead = (when.getTime() - Date.now()) / 60000;
    if (ahead < sc.minMin) return { error: 'schedule_too_soon', minMin: sc.minMin };
    if (ahead > sc.maxDays * 1440) return { error: 'schedule_too_far', maxDays: sc.maxDays };
    scheduledAt = when;
  }
  const out = await inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:cust:${customerId}`]);
    if (idem) {
      const { rows } = await c.query('SELECT * FROM go_orders WHERE customer_id = $1 AND idem_key = $2', [customerId, idem]);
      if (rows[0]) return { ok: true, orderId: rows[0].id, duplicate: true };
    }
    if (scheduledAt) {
      const sc = await scheduleSettings();
      const { rows: mine } = await c.query(`SELECT scheduled_at FROM go_orders WHERE customer_id = $1 AND kind = 'taxi' AND status = 'scheduled'`, [customerId]);
      if (mine.length >= sc.maxOrders) return { error: 'too_many_scheduled', max: sc.maxOrders };
      if (mine.some((m) => Math.abs(m.scheduled_at.getTime() - scheduledAt.getTime()) < 30 * 60000)) return { error: 'schedule_conflict' };
    } else {
      const { rows: act } = await c.query(`SELECT 1 FROM go_orders WHERE customer_id = $1 AND kind = 'taxi' AND status = ANY($2::text[]) LIMIT 1`, [customerId, ACTIVE]);
      if (act[0]) return { error: 'active_order_exists' };
    }
    let snap = snapshot({ version: q.version, breakdown: offer.breakdown, priceRub: offer.priceRub, estimated: q.estimated });
    if (quoteId) {
      const red = await redeemQuote(c, customerId, quoteId, 'taxi', q.fp, q.version, tariff, offer.priceRub);
      if (red.error) return red;
      snap = snapshot({ version: red.tariffVersion, breakdown: red.breakdown, priceRub: red.priceRub, quoteId, quotedAt: red.quotedAt, expiresAt: red.expiresAt, estimated: q.estimated });
    }
    const id = newId('go');
    const data = { from: q.from, to: q.to, tariff, tariffTitle: offer.title, km: q.km, minutes: q.minutes, estimated: q.estimated, comment };
    await c.query(
      `INSERT INTO go_orders (id, kind, customer_id, status, price_rub, city, data, idem_key, pricing, scheduled_at) VALUES ($1,'taxi',$2,$7,$3,$4,$5::jsonb,$6,$8::jsonb,$9)`,
      [id, customerId, snap.priceRub, q.city, JSON.stringify(data), idem, scheduledAt ? 'scheduled' : 'searching', JSON.stringify(snap), scheduledAt]);
    if (quoteId) await markQuoteUsed(c, quoteId, id);
    await addEvent(c, id, customerId, null, scheduledAt ? 'scheduled' : 'searching', scheduledAt ? `Заказ создан на ${scheduledAt.toISOString()}` : 'Заказ создан');
    return { ok: true, orderId: id, priceRub: snap.priceRub, fresh: !scheduledAt, scheduledAt: scheduledAt?.toISOString() ?? null };
  });
  if (out.error === 'price_changed' || out.error === 'quote_expired') return { ...out, quote: await quote(input, customerId) };   // свежая котировка — человек подтверждает заново
  if (out.fresh) { delete out.fresh; await offerNext(out.orderId).catch((e) => console.error('[go] распределение', e.message)); }
  return out;
};

/** Заказы для водителя: только в его городе, без персональных данных заказчика. */
export const availableFor = async (driverId) => {
  const ok = await canAccept(driverId, 'taxi_driver');
  if (ok.error) return ok;
  const ex = await executorStatus(driverId, 'taxi_driver');
  const { rows: pres } = await query(`SELECT online, lat, lng FROM go_presence WHERE profile_id = $1 AND role = 'taxi_driver'`, [driverId]);
  if (!pres[0]?.online) return { error: 'offline' };
  const { rows } = await query(
    `SELECT * FROM go_orders o WHERE kind = 'taxi' AND status = 'searching' AND executor_id IS NULL AND city = $1
        AND (dispatch_state <> 'offering' OR EXISTS (SELECT 1 FROM go_order_offers f WHERE f.order_id = o.id AND f.driver_id = $2 AND f.status = 'offered' AND f.expires_at > now()))
      ORDER BY created_at LIMIT 40`, [ex.city, driverId]);
  const offers = await openOffersFor(driverId);
  const here = pres[0].lat != null ? { lat: pres[0].lat, lng: pres[0].lng } : null;
  const orders = rows.map((r) => ({
    id: r.id, priceRub: r.price_rub, createdAt: r.created_at.toISOString(),
    from: { address: r.data.from.address }, to: { address: r.data.to.address }, km: r.data.km, minutes: r.data.minutes, tariff: r.data.tariffTitle,
    distanceToPickupKm: here ? Math.round(haversineKm(here, r.data.from) * 10) / 10 : null,
    offer: offers.get(r.id) ?? null,
  })).sort((a, b) => (a.offer ? 0 : 1) - (b.offer ? 0 : 1) || (a.distanceToPickupKm ?? 1e9) - (b.distanceToPickupKm ?? 1e9));
  return { orders };
};

export const accept = async (driverId, orderId) => {
  const ok = await canAccept(driverId, 'taxi_driver');
  if (ok.error) return ok;
  return inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:exec:${driverId}`]);
    const { rows: pres } = await c.query(`SELECT online FROM go_presence WHERE profile_id = $1 AND role = 'taxi_driver'`, [driverId]);
    if (!pres[0]?.online) return { error: 'offline' };
    const { rows: busy } = await c.query(`SELECT 1 FROM go_orders WHERE kind = 'taxi' AND executor_id = $1 AND status = ANY($2::text[]) LIMIT 1`, [driverId, ['assigned', 'en_route', 'arrived', 'in_ride']]);
    if (busy[0]) return { error: 'driver_busy' };
    const ex = await executorStatus(driverId, 'taxi_driver');
    if (!classCheck(driverClass(ex), (await c.query('SELECT data->>\'tariff\' AS t FROM go_orders WHERE id = $1', [orderId])).rows[0]?.t, await classMode()).ok) return { error: 'class_mismatch' };
    // Заказ предложен конкретному водителю — принять его может только он и только пока предложение действует.
    const { rows: cur } = await c.query(`SELECT dispatch_state FROM go_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    let claimed = false;
    if (cur[0]?.dispatch_state === 'offering') { const cl = await claimOffer(c, orderId, driverId); if (cl.error) return cl; claimed = true; }
    const { rows } = await c.query(
      `UPDATE go_orders SET status = 'assigned', executor_id = $2, updated_at = now()
        WHERE id = $1 AND kind = 'taxi' AND status = 'searching' AND executor_id IS NULL AND city = $3 RETURNING *`, [orderId, driverId, ex.city]);
    if (!rows[0]) { if (claimed) throw Object.assign(new Error('already_taken'), { goError: 'already_taken' }); return { error: 'already_taken' }; }   // откат: предложение не должно считаться принятым
    await addEvent(c, orderId, driverId, 'searching', 'assigned', 'Водитель назначен');
    await cancelOffers(c, orderId);
    return { ok: true, customerId: rows[0].customer_id };
  }).catch((e) => (e.goError ? { error: e.goError } : Promise.reject(e))).then(async (r) => {
    if (r.ok) await notifyGo(r.customerId, 'taxi', 'Водитель назначен', 'Водитель принял ваш заказ.', orderId);
    return r;
  });
};

const DRIVER_STEPS = {
  en_route: { from: 'assigned', to: 'en_route', note: 'Водитель едет к пассажиру', msg: 'Водитель выехал к вам.' },
  arrived: { from: 'en_route', to: 'arrived', note: 'Водитель прибыл', msg: 'Водитель на месте.' },
  start: { from: 'arrived', to: 'in_ride', note: 'Поездка началась', msg: 'Поездка началась.' },
};

/** Шаги водителя. Завершение поездки открывает оплату: цена зафиксирована при заказе и меняться не может. */
export const driverAct = async (driverId, orderId, action) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'taxi' || o.executor_id !== driverId) return { error: 'not_found' };
  if (action === 'complete') {
    if (o.status !== 'in_ride') return { error: 'bad_state', status: o.status };
    const opened = await openPayment(c, o, o.customer_id, driverId, o.price_rub);
    if (opened.error) return opened;
    await addEvent(c, o.id, driverId, 'in_ride', 'in_ride', 'Поездка завершена');
    await setStatus(c, { ...o }, 'awaiting_payment', driverId, 'Ожидается оплата', { completed_at: new Date() });
    return { ok: true, notify: [o.customer_id, 'Поездка завершена', `К оплате ${o.price_rub} ₽ — реквизиты водителя в заказе.`] };
  }
  if (action === 'release') {   // водитель отказался до начала поездки — заказ снова ищет водителя
    if (!['assigned', 'en_route', 'arrived'].includes(o.status)) return { error: 'bad_state', status: o.status };
    await c.query(`UPDATE go_orders SET status = 'searching', executor_id = NULL, dispatch_state = 'none', updated_at = now() WHERE id = $1`, [o.id]);
    await addEvent(c, o.id, driverId, o.status, 'searching', 'Водитель отказался — поиск продолжается');
    return { ok: true, redispatch: true, notify: [o.customer_id, 'Водитель отказался', 'Ищем другого водителя.'] };
  }
  const step = DRIVER_STEPS[action];
  if (!step) return { error: 'bad_action' };
  if (o.status !== step.from) return { error: 'bad_state', status: o.status };
  await setStatus(c, o, step.to, driverId, step.note);
  return { ok: true, notify: [o.customer_id, 'Такси', step.msg] };
}).then(async (r) => {
  if (r.ok && r.notify) await notifyGo(r.notify[0], 'taxi', r.notify[1], r.notify[2], orderId);
  if (r.ok && r.redispatch) await offerNext(orderId).catch(() => {});
  return r;
});

export const customerCancel = async (customerId, orderId, reason) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'taxi' || o.customer_id !== customerId) return { error: 'not_found' };
  if (!['scheduled', 'searching', 'assigned', 'en_route', 'arrived'].includes(o.status)) return { error: 'bad_state', status: o.status };
  await cancelOffers(c, o.id);
  await setStatus(c, o, 'cancelled', customerId, clean(reason, 200) || 'Отменён заказчиком', { cancelled_by: customerId, cancel_reason: clean(reason, 200) });
  return { ok: true, driverId: o.executor_id };
}).then(async (r) => {
  if (r.ok && r.driverId) await notifyGo(r.driverId, 'taxi', 'Заказ отменён', 'Пассажир отменил заказ.', orderId);
  return r;
});
