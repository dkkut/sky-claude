/**
 * Sky Доставка: три сценария (ПВЗ → получатель, получатель → получатель, компания → получатель) и доставка еды для Sky Еды.
 * Все они идут через одну систему курьеров: один кабинет, одна подписка. Переходы проверяет сервер; передачу курьеру и вручение
 * подтверждают одноразовые коды (хеш, срок, 5 попыток). Оплата — напрямую курьеру (до или после — настройка payment_terms.delivery).
 */
import { query } from './db.mjs';
import { canAccept } from './gosubs.mjs';
import { openPayment } from './gopay.mjs';
import { zoneEffect } from './gozones.mjs';
import { parseSchedule, checkScheduleSlot } from './goschedule.mjs';
import { offerNext, claimOffer, openOffersFor, cancelOffers } from './godispatch.mjs';
import { tariffVersion, fingerprint, issueQuote, redeemQuote, markQuoteUsed, snapshot } from './gopricing.mjs';
import { executorStatus } from './goreg.mjs';
import { openJson, getSetting, cityOk, newId, inTx, lockOrder, setStatus, addEvent, resolvePoint, routeBetween, issueCode, checkCode, notifyGo, clean, haversineKm, cleanPoint, pushOrderChanged } from './gocore.mjs';

const SCENARIOS = ['pvz', 'p2p', 'company', 'errand', 'cargo', 'food'];
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

/** Грузовой тариф: правит администрация (go_finance). Значения по умолчанию — заготовка, цены владелец задаёт сам. */
export const CARGO_DEFAULT = {
  base: 800, perKm: 40, minRub: 1200, loaderRub: 700,
  bodies: { s: { maxKg: 300, dims: '170×100×90', surcharge: 0 }, m: { maxKg: 700, dims: '250×150×150', surcharge: 500 }, l: { maxKg: 1500, dims: '400×200×200', surcharge: 1300 } },
};
export const cargoTariff = async () => ({ ...CARGO_DEFAULT, ...((await getSetting('cargo_tariff', null)) ?? {}) });
export const cargoPrice = (t, km, body, loaders) =>
  Math.max(Number(t.minRub) || 0, Math.round((Number(t.base) || 0) + km * (Number(t.perKm) || 0) + (Number(t.bodies?.[body]?.surcharge) || 0) + loaders * (Number(t.loaderRub) || 0)));

export const payTerm = async (kind) => {
  const t = (await getSetting('payment_terms', {})) ?? {};
  const v = t[kind];
  return v === 'before' || v === 'on_accept' ? 'before' : 'after';
};

const calcQuote = async (input) => {
  const city = clean(input?.city, 60);
  if (!(await cityOk(city))) return { error: 'bad_city' };
  const a = await resolvePoint(input?.from); if (a.error) return { error: `from_${a.error}` };
  const b = await resolvePoint(input?.to); if (b.error) return { error: `to_${b.error}` };
  const rawSize = input?.size ?? input?.parcel?.size;
  const size = SIZES.includes(rawSize) ? rawSize : 's';
  const r = await routeBetween(a.point, b.point);
  if (r.km > 300) return { error: 'too_far' };
  const zones = await zoneEffect(clean(input?.city, 60), 'delivery', a.point, b.point);
  if (zones.closed) return { error: 'zone_closed', zone: zones.closed.name };
  const zs = zones.totalRub;
  const base = { ok: true, from: a.point, to: b.point, km: Math.round(r.km * 10) / 10, minutes: r.min, estimated: r.estimated, size, zoneRub: zs, zones: zones.surcharges.map((z) => ({ name: z.name, rub: z.rub, where: z.where })), zoneSig: zones.hit };
  if (input?.scenario === 'cargo') {
    const t = await cargoTariff();
    const body = SIZES.includes(input?.body) ? input.body : 's';
    const loaders = Math.min(2, Math.max(0, Math.floor(Number(input?.loaders) || 0)));
    return { ...base, body, loaders, priceRub: cargoPrice(t, r.km, body, loaders) + zs,
      prices: Object.fromEntries(SIZES.map((k) => [k, cargoPrice(t, r.km, k, loaders) + zs])), loaderRub: t.loaderRub, bodies: t.bodies };
  }
  // Цена каждого размера — чтобы человек видел её на карточках, а выбор не менял сумму неожиданно.
  const prices = Object.fromEntries(await Promise.all(SIZES.map(async (k) => [k, (await deliveryPrice(r.km, k, false)) + zs])));
  return { ...base, priceRub: prices[size], prices };
};

/**
 * Предварительный расчёт доставки. С profileId — ещё и котировка (quoteId, срок, версия тарифа): цена, которую человек увидел,
 * фиксируется; заказ по ней при смене тарифа/условий не создаётся без повторного согласия (см. gopricing.mjs).
 */
export const quote = async (input, profileId = null) => {
  const q = await calcQuote(input);
  if (q.error || !profileId) return q;
  const cargo = input?.scenario === 'cargo';
  const tariffs = cargo ? await cargoTariff() : ((await getSetting('delivery_tariff', {})) ?? {});
  const version = tariffVersion(q.zoneSig?.length ? { t: tariffs, z: q.zoneSig } : tariffs);
  const fp = fingerprint('delivery', clean(input?.city, 60), q.from, q.to, { scenario: String(input?.scenario ?? ''), loaders: q.loaders ?? 0 });
  const offers = Object.fromEntries(Object.entries(q.prices).map(([k, v]) => [k, { priceRub: v }]));
  return { ...q, ...(await issueQuote(profileId, 'delivery', fp, version, offers, { km: q.km, minutes: q.minutes })), tariffVersion: version, currency: 'RUB' };
};

/** Заказ доставки. company — только для одобренной компании. food создаётся Sky Едой (createFoodDelivery), а не человеком. */
export const create = async (customerId, input, ctx = {}) => {
  const scenario = String(input?.scenario ?? '');
  if (!SCENARIOS.includes(scenario) || scenario === 'food') return { error: 'bad_scenario' };
  if (scenario === 'company') {
    const ex = await executorStatus(customerId, 'company');
    if (!ex || ex.status !== 'approved') return { error: 'company_not_approved' };
    const ok = await canAccept(customerId, 'company').then((r) => (r.error === 'pay_details_required' ? { ok: true } : r));   // компании реквизиты для приёма денег не нужны
    if (ok.error) return ok;
  }
  const q = await calcQuote(input);
  if (q.error) return q;
  const quoteId = input?.quoteId && !ctx.orgId ? String(input.quoteId) : null;
  const rec = contact(input?.recipient, 'recipient'); if (rec.error) return rec;
  let sender = null;
  // Поручение («забрать заказ или что-то купить»): отправитель — место/магазин, его контакт необязателен.
  if (scenario === 'errand') { const s = contact(input?.sender, 'sender'); sender = s.ok ? s.value : null; }
  else if (scenario !== 'pvz') { const s = contact(input?.sender, 'sender'); if (s.error) return s; sender = s.value; }

  const parcel = { description: clean(input?.parcel?.description, 200), weightKg: Math.min(100, Math.max(0, Number(input?.parcel?.weightKg) || 0)), size: q.size };
  if (parcel.description.length < 2) return { error: 'parcel_required' };
  const pvzInfo = scenario === 'pvz' ? clean(input?.pvzInfo, 200) : '';
  if (scenario === 'pvz' && pvzInfo.length < 2) return { error: 'pvz_info_required' };
  const idem = clean(input?.idemKey, 64) || null;
  const term = await payTerm('delivery');
  // «На потом» — только личные заказы; организации распределяют заказы сами.
  if (input?.scheduledAt && ctx.orgId) return { error: 'schedule_not_for_org' };
  const sch = await parseSchedule(input?.scheduledAt); if (sch.error) return sch;
  const scheduledAt = sch.at;

  const cargoMode = scenario === 'cargo';
  const out = await inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:cust:${customerId}`]);
    if (idem) {
      const { rows } = await c.query('SELECT id FROM go_orders WHERE customer_id = $1 AND idem_key = $2', [customerId, idem]);
      if (rows[0]) return { ok: true, orderId: rows[0].id, duplicate: true };
    }
    if (scheduledAt) { const bad = await checkScheduleSlot(c, customerId, 'delivery', scheduledAt); if (bad) return bad; }
    const { rows: act } = await c.query(`SELECT count(*)::int AS n FROM go_orders WHERE customer_id = $1 AND kind = 'delivery' AND status = ANY($2::text[])`, [customerId, ACTIVE]);
    if (act[0].n >= (ctx.orgId ? 200 : 10)) return { error: 'too_many_active' };
    const baseTariffs = cargoMode ? await cargoTariff() : ((await getSetting('delivery_tariff', {})) ?? {});
    const version = tariffVersion(q.zoneSig?.length ? { t: baseTariffs, z: q.zoneSig } : baseTariffs);
    let snap = snapshot({ version, breakdown: null, priceRub: q.priceRub, estimated: q.estimated });
    if (quoteId) {
      const fp = fingerprint('delivery', clean(input.city, 60), q.from, q.to, { scenario, loaders: q.loaders ?? 0 });
      const red = await redeemQuote(c, customerId, quoteId, 'delivery', fp, version, cargoMode ? q.body : q.size, q.priceRub);
      if (red.error) return red;
      snap = snapshot({ version: red.tariffVersion, breakdown: null, priceRub: red.priceRub, quoteId, quotedAt: red.quotedAt, expiresAt: red.expiresAt, estimated: q.estimated });
    }
    const id = newId('go');
    const data = { scenario, from: q.from, to: q.to, km: q.km, minutes: q.minutes, estimated: q.estimated, parcel, pvzInfo, sender, recipient: rec.value,
      cargo: scenario === 'cargo' ? { body: q.body, loaders: q.loaders } : undefined,
      comment: clean(input?.comment, 200), desiredTime: clean(input?.desiredTime, 60), payTerm: term,
      company: scenario === 'company' ? clean(input?.company, 120) : undefined,
      // Заказ организации: в общий поток курьеров попадает, только если организация так решила (poolOpen).
      ...(ctx.orgId ? { org: { id: ctx.orgId, name: ctx.orgName }, poolOpen: Boolean(ctx.poolOpen) } : {}) };
    await c.query(`INSERT INTO go_orders (id, kind, customer_id, status, price_rub, city, data, idem_key, org_id, created_by, pricing, scheduled_at) VALUES ($1,'delivery',$2,$10,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$11)`,
      [id, customerId, snap.priceRub, clean(input.city, 60), JSON.stringify(data), idem, ctx.orgId ?? null, ctx.createdBy ?? null, JSON.stringify(snap), scheduledAt ? 'scheduled' : 'searching', scheduledAt]);
    if (quoteId) await markQuoteUsed(c, quoteId, id);
    await addEvent(c, id, ctx.createdBy ?? customerId, null, scheduledAt ? 'scheduled' : 'searching', ctx.orgId ? 'Заказ создан в кабинете организации' : scheduledAt ? `Заказ создан на ${scheduledAt.toISOString()}` : 'Заказ создан');
    await issueCode(c, id, 'pickup'); await issueCode(c, id, 'handover');
    return { ok: true, orderId: id, priceRub: snap.priceRub, scheduledAt: scheduledAt?.toISOString() ?? null };
  });
  if (out.error === 'price_changed' || out.error === 'quote_expired') return { ...out, quote: await quote(input, customerId) };
  if (out.ok && !out.duplicate && !ctx.orgId && !scheduledAt) await offerNext(out.orderId).catch((e) => console.error('[go] распределение', e.message));
  return out;
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

/** Грузовые заказы видят и принимают только курьеры с транспортом «грузовой» (anketa → extra.transport). */
const canCargo = (ex) => openJson(ex?.data_enc).extra?.transport === 'truck';

export const availableFor = async (courierId) => {
  const ok = await canAccept(courierId, 'courier');
  if (ok.error) return ok;
  const ex = await executorStatus(courierId, 'courier');
  const { rows: pres } = await query(`SELECT online, lat, lng FROM go_presence WHERE profile_id = $1 AND role = 'courier'`, [courierId]);
  if (!pres[0]?.online) return { error: 'offline' };
  const cargoOk = canCargo(ex);
  const { rows: all } = await query(`SELECT * FROM go_orders WHERE kind = 'delivery' AND status = 'searching' AND executor_id IS NULL AND city = $1 AND (org_id IS NULL OR data->>'poolOpen' = 'true')
        AND (dispatch_state <> 'offering' OR EXISTS (SELECT 1 FROM go_order_offers f WHERE f.order_id = go_orders.id AND f.driver_id = $2 AND f.status = 'offered' AND f.expires_at > now())) ORDER BY created_at LIMIT 60`, [ex.city, courierId]);
  const offers = await openOffersFor(courierId);
  const rows = all.filter((r) => r.data.scenario !== 'cargo' || cargoOk).slice(0, 40);
  const here = pres[0].lat != null ? { lat: pres[0].lat, lng: pres[0].lng } : null;
  return { orders: rows.map((r) => ({
    id: r.id, scenario: r.data.scenario, cargo: r.data.cargo, priceRub: r.price_rub, createdAt: r.created_at.toISOString(),
    from: { address: r.data.from?.address ?? '' }, to: { address: r.data.to?.address ?? '' }, km: r.data.km, minutes: r.data.minutes,
    parcel: { description: r.data.parcel?.description, size: r.data.parcel?.size, weightKg: r.data.parcel?.weightKg }, comment: r.data.comment || undefined,
    distanceToPickupKm: here && r.data.from ? Math.round(haversineKm(here, r.data.from) * 10) / 10 : null, offer: offers.get(r.id) ?? null }))
    .sort((a, b) => (a.offer ? 0 : 1) - (b.offer ? 0 : 1)) };
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
    const { rows: cand } = await c.query(`SELECT data->>'scenario' AS sc FROM go_orders WHERE id = $1`, [orderId]);
    const { rows: mine } = await c.query(`SELECT data->>'scenario' AS sc FROM go_orders WHERE kind = 'delivery' AND executor_id = $1 AND status IN ('assigned','heading_pickup','at_pickup','picked_up','delivering','at_recipient')`, [courierId]);
    // Грузовой заказ едет отдельным рейсом: совмещать его с другими нельзя ни в ту, ни в другую сторону.
    if ((cand[0]?.sc === 'cargo' && mine.length > 0) || mine.some((m) => m.sc === 'cargo')) return { error: 'incompatible_order' };
    // Заказ предложен конкретному курьеру — принять его может только он и только пока предложение действует.
    const { rows: cur } = await c.query(`SELECT dispatch_state FROM go_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    let claimed = false;
    if (cur[0]?.dispatch_state === 'offering') { const cl = await claimOffer(c, orderId, courierId); if (cl.error) return cl; claimed = true; }
    const { rows } = await c.query(
      `UPDATE go_orders SET status = 'assigned', executor_id = $2, updated_at = now()
        WHERE id = $1 AND kind = 'delivery' AND status = 'searching' AND executor_id IS NULL AND city = $3
          AND (org_id IS NULL OR data->>'poolOpen' = 'true')
          AND (data->>'scenario' <> 'cargo' OR $4::boolean) RETURNING *`, [orderId, courierId, ex.city, canCargo(ex)]);
    if (!rows[0]) { if (claimed) throw Object.assign(new Error('already_taken'), { goError: 'already_taken' }); return { error: 'already_taken' }; }
    await cancelOffers(c, orderId);
    await addEvent(c, orderId, courierId, 'searching', 'assigned', 'Курьер назначен');
    if (rows[0].data.payTerm === 'before' && rows[0].data.scenario !== 'food') {
      const opened = await openPayment(c, rows[0], rows[0].customer_id, courierId, rows[0].price_rub);
      if (opened.error) throw Object.assign(new Error(opened.error), { goError: opened.error });
    }
    return { ok: true, customerId: rows[0].customer_id, parentId: rows[0].parent_id, orgId: rows[0].org_id };
  }).catch((e) => (e.goError ? { error: e.goError } : Promise.reject(e))).then(async (r) => {
    if (r.ok) {
      await notifyGo(r.customerId, 'delivery', 'Курьер назначен', 'Курьер принял ваш заказ.', orderId, `${orderId}:assigned:${courierId}`);
      if (r.orgId) await (await import('./goorg.mjs')).notifyStaff(r.orgId, 'Курьер принял заказ', 'Заказ из общего потока взял внешний курьер.', orderId, `${orderId}:pool-accepted:${courierId}`);
      await pushOrderChanged(orderId);
    }
    return r;
  });
};

const STEPS = {
  heading: { from: 'assigned', to: 'heading_pickup', note: 'Курьер направляется к месту получения', msg: 'Курьер едет за отправлением.', org: 'Исполнитель выехал за отправлением' },
  arrived_pickup: { from: 'heading_pickup', to: 'at_pickup', note: 'Курьер прибыл к месту получения', msg: 'Курьер на месте получения.', org: 'Исполнитель на месте получения' },
  start_delivery: { from: 'picked_up', to: 'delivering', note: 'Доставка началась', msg: 'Доставка началась.', org: 'Доставка началась' },
  arrived_recipient: { from: 'delivering', to: 'at_recipient', note: 'Курьер прибыл к получателю', msg: 'Курьер прибыл к получателю — назовите ему код вручения.', org: 'Исполнитель прибыл к получателю' },
};
const AFTER_PICKUP = ['picked_up', 'delivering', 'at_recipient', 'awaiting_payment', 'payment_reported', 'paid'];
const FINISHED = ['awaiting_payment', 'payment_reported', 'paid'];

/**
 * Шаги курьера. pickup: код передачи (кроме еды), deliver: код вручения.
 * Повтор того же действия (двойной тап, повтор после обрыва связи) не ошибка: заказ уже там, куда его вело действие, — отвечаем ok без побочных эффектов.
 * Заказ, назначенный диспетчером организации, сначала нужно принять (accept_assignment); отказаться от него — только с причиной.
 */
export const courierAct = async (courierId, orderId, action, code, reason) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'delivery' || o.executor_id !== courierId) return { error: 'not_found' };
  const food = o.data.scenario === 'food';
  const dispatch = o.data.dispatch;
  const internal = Boolean(o.data.internal);
  const out = (extra = {}) => ({ ok: true, orgId: o.org_id, ...extra });

  if (action === 'accept_assignment') {
    if (!dispatch) return { error: 'bad_action' };
    if (dispatch.accepted) return out({ duplicate: true });
    if (o.status !== 'assigned') return { error: 'bad_state', status: o.status };
    await c.query(`UPDATE go_orders SET data = jsonb_set(data, '{dispatch,accepted}', 'true'::jsonb), updated_at = now() WHERE id = $1`, [o.id]);
    await addEvent(c, o.id, courierId, 'assigned', 'assigned', 'Исполнитель принял назначение');
    return out({ orgNotify: ['Исполнитель принял заказ', 'Назначение принято, исполнитель приступает.'] });
  }
  if (action === 'release') {
    if (!['assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
    const why = clean(reason, 200);
    if (o.org_id && why.length < 3) return { error: 'reason_required' };
    if (o.org_id && !o.data.poolOpen) {
      // Заказ организации: возвращается диспетчеру, а не в общий поток курьеров.
      await c.query(`UPDATE go_orders SET status = 'searching', executor_id = NULL, updated_at = now(),
        data = (data - 'dispatch') || jsonb_build_object('internal', false, 'declinedBy', coalesce(data->'declinedBy', '[]'::jsonb) || to_jsonb($2::text)) WHERE id = $1`, [o.id, courierId]);
    } else {
      await c.query(`UPDATE go_orders SET status = 'searching', executor_id = NULL, dispatch_state = 'none', data = data - 'dispatch', updated_at = now() WHERE id = $1`, [o.id]);
    }
    await c.query(`DELETE FROM go_order_pay WHERE order_id = $1 AND state = 'awaiting'`, [o.id]);
    await addEvent(c, o.id, courierId, o.status, 'searching', why ? `Исполнитель отказался: ${why}` : 'Курьер отказался — поиск продолжается');
    return out({ released: true, notify: o.org_id ? null : [o.customer_id, 'Курьер отказался', 'Ищем другого курьера.'],
      orgNotify: ['Исполнитель отказался от заказа', `Причина: ${why || 'не указана'}. Назначьте другого исполнителя.`] });
  }
  if (action === 'pickup') {
    if (AFTER_PICKUP.includes(o.status)) return out({ duplicate: true });
    if (o.status !== 'at_pickup') return { error: 'bad_state', status: o.status };
    if (o.data.payTerm === 'before' && !food && !internal) {
      const { rows: p } = await c.query(`SELECT state FROM go_order_pay WHERE order_id = $1`, [o.id]);
      if (p[0]?.state !== 'confirmed') return { error: 'payment_required' };
    }
    if (!food) { const ck = await checkCode(c, o.id, 'pickup', code); if (ck.error) return ck; }
    await setStatus(c, o, 'picked_up', courierId, 'Отправление принято');
    return out({ notify: [o.customer_id, 'Отправление принято', 'Курьер забрал отправление.'], orgNotify: ['Отправление получено', 'Исполнитель забрал отправление.'],
      foodSync: o.parent_id ? { parent: o.parent_id, to: 'handed_to_courier' } : null });
  }
  if (action === 'deliver') {
    if (FINISHED.includes(o.status)) return out({ duplicate: true });
    if (o.status !== 'at_recipient') return { error: 'bad_state', status: o.status };
    const ck = await checkCode(c, o.id, 'handover', code); if (ck.error) return ck;
    if (internal) {
      // Свой сотрудник организации: денег между организацией и исполнителем через Sky нет, платить некому — доставка закрывается вручением.
      await setStatus(c, o, 'paid', courierId, 'Отправление вручено (оплата не требуется: исполнитель — сотрудник организации)', { completed_at: new Date() });
    } else if (o.data.payTerm === 'before') {
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
    await c.query(`UPDATE go_orders SET data = data - 'problemOpen' WHERE id = $1`, [o.id]);
    return out({ notify: [o.customer_id, 'Отправление вручено', internal ? 'Отправление вручено получателю.' : `К оплате курьеру ${o.price_rub} ₽ — реквизиты в заказе.`],
      orgNotify: ['Доставка завершена', 'Отправление вручено получателю.'], foodSync: o.parent_id ? { parent: o.parent_id, to: 'delivered' } : null });
  }
  const step = STEPS[action];
  if (!step) return { error: 'bad_action' };
  if (o.status === step.to) return out({ duplicate: true });
  if (o.status !== step.from) return { error: 'bad_state', status: o.status };
  if (action === 'heading' && dispatch && !dispatch.accepted) return { error: 'assignment_not_accepted' };
  await setStatus(c, o, step.to, courierId, step.note);
  return out({ notify: [o.customer_id, 'Доставка', step.msg], orgNotify: [step.org, step.note],
    foodSync: action === 'start_delivery' && o.parent_id ? { parent: o.parent_id, to: 'delivering' } : null });
}).then(async (r) => {
  if (!r.ok || r.duplicate) return r;
  const org = await import('./goorg.mjs');
  // Заказ организации уведомляет её сотрудников; личного заказчика (он же владелец) вторым письмом не дублируем.
  if (r.orgId && r.orgNotify) await org.notifyStaff(r.orgId, r.orgNotify[0], r.orgNotify[1], orderId, `${orderId}:${action}`);
  else if (r.notify) await notifyGo(r.notify[0], 'delivery', r.notify[1], r.notify[2], orderId, `${orderId}:${action}`);
  if (r.released && r.orgId) await org.afterRelease(orderId).catch(() => {});
  if (r.released && !r.orgId) await offerNext(orderId).catch(() => {});
  await pushOrderChanged(orderId);
  return r;
});

export const customerCancel = async (customerId, orderId, reason) => inTx(async (c) => {
  const o = await lockOrder(c, orderId);
  if (!o || o.kind !== 'delivery' || o.customer_id !== customerId) return { error: 'not_found' };
  if (o.parent_id) return { error: 'cancel_via_food_order' };
  if (!['scheduled', 'searching', 'assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
  await cancelOffers(c, o.id);
  await setStatus(c, o, 'cancelled', customerId, clean(reason, 200) || 'Отменён заказчиком', { cancelled_by: customerId, cancel_reason: clean(reason, 200) });
  return { ok: true, courierId: o.executor_id, orgId: o.org_id };
}).then(async (r) => {
  if (r.ok && r.courierId) await notifyGo(r.courierId, 'delivery', 'Заказ отменён', 'Заказчик отменил доставку.', orderId, `${orderId}:cancelled`);
  if (r.ok) await pushOrderChanged(orderId);
  return r;
});
