/**
 * Sky GO → «Организации» → «Для транспорта». НАДСТРОЙКА над организациями (gop_*, kb_*), а не отдельный сервис:
 *   • категории группы `transport` (АЗС, мойки, автосервисы, детейлинг, запчасти, стоянки, парковки, эвакуаторы, автосалоны, прокат);
 *   • топливо: цены вносит САМА организация, Sky цен не знает; у каждой цены видна дата обновления (старше 7 дней — «устарела»);
 *   • удобства (закрытый список) и акции с датами;
 *   • заказ-наряд — ход работ по автомобилю клиента (принят → диагностика → согласование → в работе → готов → выдан);
 *   • оплата — страница оплаты SkyKassa Business (`kb_qr`): предоплата или полная оплата; «на месте» — без страницы. Деньги Sky не принимает,
 *     подтверждает организация или платёжный партнёр; возврат — её действие в SkyKassa Business (статус `refunded` приходит сюда через paymentChanged).
 * Филиалы — отдельные организации одного владельца (до 5, переключатель в «Sky для бизнеса»): общего баланса и общей карточки нет.
 */
import { query } from './db.mjs';
import { notifyGift } from './giftnotify.mjs';
import { newId, inTx, clean, sealJson, openJson } from './gocore.mjs';
import { payUrl, publicId } from './kbiz.mjs';

const err = (error, extra = {}) => ({ error, ...extra });
const note = (to, title, body, ref) => notifyGift(to, 'go_transport', title, body, ref).catch(() => {});

export const FUELS = { ai92: 'АИ-92', ai95: 'АИ-95', ai98: 'АИ-98', ai100: 'АИ-100', dt: 'Дизель', dt_win: 'Дизель зимний', gas_propane: 'Газ (пропан)', gas_methane: 'Газ (метан)', ev: 'Электрозарядка (кВт·ч)' };
export const FEATURES = { shop: 'Магазин', cafe: 'Кафе', coffee: 'Кофе', toilet: 'Туалет', air: 'Подкачка шин', vacuum: 'Пылесос', carwash: 'Мойка', ev: 'Зарядка электромобилей', card: 'Оплата картой',
  wifi: 'Wi-Fi', night: 'Круглосуточно', waiting: 'Зона ожидания', tire: 'Шиномонтаж', diag: 'Диагностика', covered: 'Крытая', guarded: 'Охраняемая', visit: 'Выезд к клиенту', warranty: 'Гарантия на работы', parts: 'Запчасти в наличии' };
export const WORK_LABEL = { accepted: 'Принят', diagnostics: 'Диагностика', awaiting_approval: 'Ждёт вашего согласования', in_work: 'В работе', ready: 'Готов к выдаче', issued: 'Выдан', cancelled: 'Отменён' };
const PAY_LABEL = { none: 'Оплата на месте', requested: 'Ждёт оплаты', prepaid: 'Предоплата получена', paid: 'Оплачен', refunded: 'Оплата возвращена' };
/** Таблица переходов: кто может (owner — организация, buyer — клиент). Недопустимый переход отклоняется. */
const NEXT = {
  accepted: { diagnostics: 'owner', in_work: 'owner', cancelled: 'both' },
  diagnostics: { awaiting_approval: 'owner', in_work: 'owner', cancelled: 'both' },
  awaiting_approval: { in_work: 'buyer', cancelled: 'both' },
  in_work: { ready: 'owner', awaiting_approval: 'owner', cancelled: 'owner' },
  ready: { issued: 'owner', in_work: 'owner' },
  issued: {}, cancelled: {},
};
const TERMINAL = ['issued', 'cancelled'];

const ownBiz = async (key) => (await query('SELECT b.id, b.name, b.owner_id, p.category_id, c.group_id FROM kb_businesses b LEFT JOIN gop_places p ON p.business_id = b.id LEFT JOIN gop_categories c ON c.id = p.category_id WHERE b.id = kb_cur_biz($1)', [key])).rows[0] ?? null;
const needTransport = (b) => (!b ? err('no_business') : b.group_id !== 'transport' ? err('not_transport') : null);
const stale = (d) => Date.now() - new Date(d).getTime() > 7 * 86400_000;

/* ─── Удобства ─── */
export const ownerFeaturesSave = async (key, list) => {
  const b = await ownBiz(key); const bad = needTransport(b); if (bad) return bad;
  const clean_ = [...new Set((Array.isArray(list) ? list : []).map(String).filter((x) => x in FEATURES))];
  await query('UPDATE gop_places SET features = $2::jsonb, updated_at = now() WHERE business_id = $1', [b.id, JSON.stringify(clean_)]);
  return { ok: true, features: clean_ };
};

/* ─── Топливо ─── */
export const ownerFuelGet = async (key) => {
  const b = await ownBiz(key); const bad = needTransport(b); if (bad) return bad;
  const { rows } = await query('SELECT fuel, price_kop, available, updated_at FROM gop_fuel_prices WHERE business_id = $1', [b.id]);
  return { ok: true, fuels: FUELS, prices: rows.map((r) => ({ fuel: r.fuel, priceRub: r.price_kop / 100, available: r.available, updatedAt: r.updated_at.toISOString() })) };
};
export const ownerFuelSet = async (key, actor, list) => {
  const b = await ownBiz(key); const bad = needTransport(b); if (bad) return bad;
  if (b.category_id !== 'fuel') return err('not_fuel');
  if (!Array.isArray(list)) return err('bad_field', { field: 'prices' });
  const rows = [];
  for (const x of list.slice(0, 20)) {
    const fuel = String(x?.fuel ?? ''); if (!(fuel in FUELS)) return err('bad_field', { field: 'fuel' });
    const n = Number(x?.priceRub); if (!Number.isFinite(n) || n <= 0 || n > 1000) return err('bad_field', { field: 'priceRub' });
    rows.push({ fuel, kop: Math.round(n * 100), available: x?.available !== false });
  }
  await inTx(async (c) => {
    const keep = rows.map((r) => r.fuel);
    await c.query('DELETE FROM gop_fuel_prices WHERE business_id = $1 AND NOT (fuel = ANY($2))', [b.id, keep]);
    for (const r of rows) {   // дата обновления меняется только если изменилась цена или наличие
      await c.query(`INSERT INTO gop_fuel_prices (business_id, fuel, price_kop, available, updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (business_id, fuel) DO UPDATE SET price_kop = EXCLUDED.price_kop, available = EXCLUDED.available, updated_by = EXCLUDED.updated_by,
          updated_at = CASE WHEN gop_fuel_prices.price_kop <> EXCLUDED.price_kop OR gop_fuel_prices.available <> EXCLUDED.available THEN now() ELSE gop_fuel_prices.updated_at END`,
        [b.id, r.fuel, r.kop, r.available, actor]);
    }
  });
  return ownerFuelGet(key);
};

/* ─── Акции ─── */
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
export const ownerPromos = async (key) => {
  const b = await ownBiz(key); const bad = needTransport(b); if (bad) return bad;
  const { rows } = await query('SELECT * FROM gop_promos WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50', [b.id]);
  return { ok: true, promos: rows.map(promoShape) };
};
const promoShape = (r) => ({ id: r.id, title: r.title, body: r.body, startsOn: r.starts_on ? String(r.starts_on).slice(0, 10) : null, endsOn: r.ends_on ? String(r.ends_on).slice(0, 10) : null, active: r.active });
export const ownerPromoSave = async (key, id, body) => {
  const b = await ownBiz(key); const bad = needTransport(b); if (bad) return bad;
  const title = clean(body?.title, 80); if (title.length < 3) return err('bad_field', { field: 'title' });
  const text = clean(body?.body, 400); const s = dateOrNull(body?.startsOn); const e = dateOrNull(body?.endsOn);
  if (s && e && e < s) return err('bad_field', { field: 'endsOn' });
  const active = body?.active !== false;
  if (id) {
    const r = await query('UPDATE gop_promos SET title=$3, body=$4, starts_on=$5, ends_on=$6, active=$7 WHERE id=$1 AND business_id=$2', [id, b.id, title, text, s, e, active]);
    return r.rowCount ? { ok: true, id } : err('not_found');
  }
  const n = (await query('SELECT count(*)::int AS n FROM gop_promos WHERE business_id = $1 AND active', [b.id])).rows[0].n;
  if (active && n >= 10) return err('too_many_promos');
  const nid = newId('gpp');
  await query('INSERT INTO gop_promos (id, business_id, title, body, starts_on, ends_on, active) VALUES ($1,$2,$3,$4,$5,$6,$7)', [nid, b.id, title, text, s, e, active]);
  return { ok: true, id: nid };
};
export const ownerPromoDelete = async (key, id) => {
  const b = await ownBiz(key); if (!b) return err('no_business');
  const r = await query('DELETE FROM gop_promos WHERE id = $1 AND business_id = $2', [String(id ?? ''), b.id]);
  return r.rowCount ? { ok: true } : err('not_found');
};

/* ─── Публичная часть карточки ─── */
export const publicInfo = async (id) => {
  const p = (await query(`SELECT p.features, p.category_id, c.group_id, c.name AS category_name FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id LEFT JOIN gop_categories c ON c.id = p.category_id
    WHERE p.business_id = $1 AND p.connected AND p.status = 'published' AND b.status = 'active'`, [String(id ?? '')])).rows[0];
  if (!p) return err('not_found');
  const fuel = (await query('SELECT fuel, price_kop, available, updated_at FROM gop_fuel_prices WHERE business_id = $1 ORDER BY fuel', [id])).rows;
  const promos = (await query(`SELECT * FROM gop_promos WHERE business_id = $1 AND active AND (starts_on IS NULL OR starts_on <= CURRENT_DATE) AND (ends_on IS NULL OR ends_on >= CURRENT_DATE) ORDER BY created_at DESC LIMIT 10`, [id])).rows;
  const apps = [];
  if (p.category_id === 'fuel') apps.push({ key: 'fuel', title: 'Заправки и «Моё авто»' });
  if (['parkings', 'carparks'].includes(p.category_id)) apps.push({ key: 'parking', title: 'Sky Parking' });
  return { ok: true, transport: p.group_id === 'transport', categoryId: p.category_id, features: (p.features ?? []).filter((f) => f in FEATURES).map((f) => ({ id: f, name: FEATURES[f] })),
    fuel: fuel.map((r) => ({ fuel: r.fuel, name: FUELS[r.fuel] ?? r.fuel, priceRub: r.price_kop / 100, available: r.available, updatedAt: r.updated_at.toISOString(), stale: stale(r.updated_at) })),
    promos: promos.map(promoShape), apps };
};

/* ─── Заказ-наряд ─── */
const vehicleOf = (v) => { const o = openJson(v); return { plate: o.plate ?? '', model: o.model ?? '' }; };
const shape = async (r, forOwner) => {
  const ev = (await query('SELECT status, comment, at FROM gop_work_events WHERE order_id = $1 ORDER BY id', [r.id])).rows;
  let payUrl_ = null;
  if (r.pay_status === 'requested' && r.qr_id) {
    const q = (await query(`SELECT public_id, expires_at FROM kb_qr WHERE id = $1 AND status = 'active'`, [r.qr_id])).rows[0];
    if (q && (!q.expires_at || q.expires_at > new Date())) payUrl_ = payUrl(q.public_id);
  }
  const base = { id: r.id, placeId: r.business_id, placeName: r.name, title: r.title, vehicle: vehicleOf(r.vehicle_enc), status: r.status, statusLabel: WORK_LABEL[r.status], priceRub: r.price_rub, paidRub: r.paid_rub,
    payStatus: r.pay_status, payLabel: PAY_LABEL[r.pay_status], payUrl: payUrl_, note: r.note, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    events: ev.map((e) => ({ status: e.status, label: WORK_LABEL[e.status], comment: e.comment, at: e.at.toISOString() })),
    actions: Object.entries(NEXT[r.status] ?? {}).filter(([, who]) => who === 'both' || who === (forOwner ? 'owner' : 'buyer')).map(([to]) => to) };
  if (forOwner) base.buyer = { id: r.buyer_id, name: r.buyer_name, username: r.buyer_username };
  return base;
};
const SELECT = `SELECT w.*, b.name, pr.name AS buyer_name, pr.username AS buyer_username FROM gop_work_orders w JOIN kb_businesses b ON b.id = w.business_id JOIN profiles pr ON pr.id = w.buyer_id`;

export const ownerCreateWork = async (key, actor, body) => {
  const b = await ownBiz(key); const bad = needTransport(b); if (bad) return bad;
  const title = clean(body?.title, 120); if (title.length < 3) return err('bad_field', { field: 'title' });
  let buyer = null;
  if (body?.bookingId) buyer = (await query('SELECT buyer_id FROM gop_bookings WHERE id = $1 AND business_id = $2', [String(body.bookingId), b.id])).rows[0]?.buyer_id;
  else if (body?.username) buyer = (await query('SELECT id FROM profiles WHERE lower(username) = lower($1)', [String(body.username).replace(/^@/, '').trim()])).rows[0]?.id;
  if (!buyer) return err('buyer_not_found');
  if (buyer === b.owner_id) return err('own_place');
  const plate = clean(body?.plate, 20); const model = clean(body?.model, 60);
  const price = body?.priceRub == null || body.priceRub === '' ? null : Number(body.priceRub);
  if (price != null && (!Number.isInteger(price) || price < 0 || price > 10_000_000)) return err('bad_field', { field: 'priceRub' });
  const open = (await query(`SELECT count(*)::int AS n FROM gop_work_orders WHERE business_id = $1 AND buyer_id = $2 AND status NOT IN ('issued','cancelled')`, [b.id, buyer])).rows[0].n;
  if (open >= 5) return err('too_many_open');
  const id = newId('gpw');
  await inTx(async (c) => {
    await c.query('INSERT INTO gop_work_orders (id, business_id, buyer_id, booking_id, title, vehicle_enc, price_rub, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, b.id, buyer, body?.bookingId ? String(body.bookingId) : null, title, sealJson({ plate, model }), price, clean(body?.note, 400), actor]);
    await c.query(`INSERT INTO gop_work_events (order_id, status, comment, actor) VALUES ($1,'accepted',$2,$3)`, [id, clean(body?.comment, 300), actor]);
  });
  void note(buyer, `${b.name}: автомобиль принят`, `${title}. Ход работ виден в Sky GO → Организации → «Мои работы».`, `gopw:${id}:accepted:0`);
  return { ok: true, id };
};

export const ownerWork = async (key, q = {}) => {
  const b = await ownBiz(key); if (!b) return err('no_business');
  const vals = [b.id]; let w = 'w.business_id = $1';
  if (q.status === 'open') w += ` AND w.status NOT IN ('issued','cancelled')`; else if (q.status && q.status in WORK_LABEL) { vals.push(q.status); w += ` AND w.status = $${vals.length}`; }
  const { rows } = await query(`${SELECT} WHERE ${w} ORDER BY w.updated_at DESC LIMIT 100`, vals);
  return { ok: true, orders: await Promise.all(rows.map((r) => shape(r, true))) };
};
export const myWork = async (me) => {
  const { rows } = await query(`${SELECT} WHERE w.buyer_id = $1 ORDER BY w.updated_at DESC LIMIT 100`, [me]);
  return { ok: true, orders: await Promise.all(rows.map((r) => shape(r, false))) };
};

/** Смена статуса организацией (`as: owner`, key — ключ организации) или клиентом (`as: buyer`, key — профиль). Повтор того же статуса — duplicate. */
export const setWorkStatus = async (as, key, actor, id, to, body = {}) => {
  const comment = clean(body?.comment, 300);
  const res = await inTx(async (c) => {
    const { rows } = await c.query(`SELECT w.*, b.owner_id, b.name FROM gop_work_orders w JOIN kb_businesses b ON b.id = w.business_id WHERE w.id = $1 FOR UPDATE OF w`, [String(id ?? '')]);
    const r = rows[0]; if (!r) return err('not_found');
    if (as === 'owner') { const own = await c.query('SELECT 1 FROM kb_businesses WHERE id = $1 AND id = kb_cur_biz($2)', [r.business_id, key]); if (!own.rows[0]) return err('not_found'); }
    else if (r.buyer_id !== key) return err('not_found');
    if (r.status === to) return { ok: true, duplicate: true };
    const who = NEXT[r.status]?.[to];
    if (!who || (who !== 'both' && who !== as)) return err('bad_transition', { from: r.status, to });
    if (to === 'cancelled' && as === 'owner' && !comment) return err('reason_required');
    let price = r.price_rub;
    if (body?.priceRub != null && as === 'owner') { const n = Number(body.priceRub); if (!Number.isInteger(n) || n < 0 || n > 10_000_000) return err('bad_field', { field: 'priceRub' }); price = n; }
    await c.query('UPDATE gop_work_orders SET status = $2, price_rub = $3, updated_at = now() WHERE id = $1', [r.id, to, price]);
    if (to === 'cancelled' && r.qr_id) await c.query(`UPDATE kb_qr SET status = 'disabled', updated_at = now() WHERE id = $1 AND status = 'active'`, [r.qr_id]);
    const ev = await c.query('INSERT INTO gop_work_events (order_id, status, comment, actor) VALUES ($1,$2,$3,$4) RETURNING id', [r.id, to, comment, actor]);
    return { ok: true, status: to, owner: r.owner_id, buyer: r.buyer_id, name: r.name, title: r.title, evId: ev.rows[0].id };
  });
  if (res.ok && !res.duplicate) {
    const t = `${res.name}: ${WORK_LABEL[res.status].toLowerCase()}`;
    if (as === 'owner') void note(res.buyer, t, `${res.title}${comment ? `. ${comment}` : ''}`, `gopw:${id}:${res.status}:${res.evId}`);
    else void note(res.owner, `Клиент: ${WORK_LABEL[res.status].toLowerCase()}`, res.title, `gopw:${id}:${res.status}:${res.evId}`);
  }
  return res;
};

/** Запрос оплаты: страница SkyKassa Business на сумму (предоплата или полная). До одной активной страницы на заказ-наряд. */
export const ownerRequestPay = async (key, actor, id, body) => {
  const kind = body?.kind === 'prepay' ? 'prepay' : 'full';
  const res = await inTx(async (c) => {
    const { rows } = await c.query(`SELECT w.*, b.name, b.id AS bid FROM gop_work_orders w JOIN kb_businesses b ON b.id = w.business_id WHERE w.id = $1 AND b.id = kb_cur_biz($2) FOR UPDATE OF w`, [String(id ?? ''), key]);
    const r = rows[0]; if (!r) return err('not_found');
    if (['cancelled'].includes(r.status)) return err('bad_state');
    if (!r.price_rub) return err('price_required');
    const left = r.price_rub - r.paid_rub; if (left <= 0) return err('already_paid');
    const amount = kind === 'full' ? left : Math.round(Number(body?.amountRub));
    if (!Number.isInteger(amount) || amount < 1 || amount > left) return err('bad_field', { field: 'amountRub' });
    const rq = await c.query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [r.bid]); if (!rq.rows[0]) return err('no_requisites');
    if (r.qr_id) await c.query(`UPDATE kb_qr SET status = 'disabled', updated_at = now() WHERE id = $1 AND status = 'active'`, [r.qr_id]);
    const qid = newId('kbq'); const pid = publicId();
    await c.query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, expires_at, config) VALUES ($1,$2,$3,'order',$4,'',$5,'',now() + interval '7 days',$6::jsonb)`,
      [qid, pid, r.bid, `${kind === 'prepay' ? 'Предоплата' : 'Оплата'}: ${r.title}`, amount, JSON.stringify({ workId: r.id, kind })]);
    await c.query(`UPDATE gop_work_orders SET qr_id = $2, pay_status = 'requested', updated_at = now() WHERE id = $1`, [r.id, qid]);
    await c.query(`INSERT INTO gop_work_events (order_id, status, comment, actor) VALUES ($1,$2,$3,$4)`, [r.id, r.status, `Запрошена ${kind === 'prepay' ? 'предоплата' : 'оплата'}: ${amount} ₽`, actor]);
    return { ok: true, payUrl: payUrl(pid), amountRub: amount, buyer: r.buyer_id, name: r.name, title: r.title };
  });
  if (res.ok) void note(res.buyer, `${res.name}: ждёт оплаты`, `${res.title} — ${res.amountRub} ₽. Оплатить можно переводом организации по ссылке в «Моих работах».`, `gopw:${id}:pay:${res.amountRub}:${Date.now() >> 12}`);
  return res;
};

/** Платёж по заказ-наряду изменил статус (из goplaces.paymentChanged). true — это был наш платёж. */
export const workPaymentChanged = async (paymentId, to) => {
  const { rows } = await query(`SELECT p.status AS pay, p.amount_rub, w.id, w.paid_rub, w.price_rub, w.buyer_id, w.title, b.owner_id, b.name
      FROM kb_payments p JOIN gop_work_orders w ON w.qr_id = p.qr_id JOIN kb_businesses b ON b.id = w.business_id WHERE p.id = $1`, [paymentId]);
  const r = rows[0]; if (!r) return false;
  if (r.pay !== to) return true;
  if (to === 'confirmed') {
    const paid = r.paid_rub + (Number(r.amount_rub) || 0); const st = r.price_rub && paid >= r.price_rub ? 'paid' : 'prepaid';
    const u = await query(`UPDATE gop_work_orders SET paid_rub = $2, pay_status = $3, updated_at = now() WHERE id = $1 AND pay_status = 'requested'`, [r.id, paid, st]);
    if (u.rowCount) {
      await query(`INSERT INTO gop_work_events (order_id, status, comment, actor) SELECT id, status, $2, 'system' FROM gop_work_orders WHERE id = $1`, [r.id, st === 'paid' ? 'Оплата подтверждена' : 'Предоплата подтверждена']);
      void note(r.buyer_id, 'Оплата подтверждена', `${r.name}: ${r.title}`, `gopw:${r.id}:paid:${paid}`);
    }
  } else if (to === 'refunded') {
    const u = await query(`UPDATE gop_work_orders SET paid_rub = 0, pay_status = 'refunded', updated_at = now() WHERE id = $1 AND pay_status <> 'refunded'`, [r.id]);
    if (u.rowCount) void note(r.buyer_id, 'Оплата возвращена', `${r.name}: ${r.title}`, `gopw:${r.id}:refund`);
  } else if (['cancelled', 'not_found', 'expired'].includes(to)) {
    await query(`UPDATE gop_work_orders SET pay_status = CASE WHEN paid_rub > 0 THEN 'prepaid' ELSE 'none' END, updated_at = now() WHERE id = $1 AND pay_status = 'requested'`, [r.id]);
  }
  return true;
};

/** Статистика организации по транспортным заказам (только настоящие данные). */
export const ownerTransportStats = async (key) => {
  const b = await ownBiz(key); const bad = needTransport(b); if (bad) return bad;
  const st = (await query(`SELECT status, count(*)::int AS n FROM gop_work_orders WHERE business_id = $1 GROUP BY status`, [b.id])).rows;
  const sum = (await query(`SELECT COALESCE(sum(paid_rub),0)::int AS paid, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS month FROM gop_work_orders WHERE business_id = $1`, [b.id])).rows[0];
  const fuel = (await query('SELECT max(updated_at) AS at FROM gop_fuel_prices WHERE business_id = $1', [b.id])).rows[0];
  const promos = (await query('SELECT count(*)::int AS n FROM gop_promos WHERE business_id = $1 AND active', [b.id])).rows[0].n;
  return { ok: true, byStatus: Object.fromEntries(st.map((x) => [x.status, x.n])), paidRub: sum.paid, ordersMonth: sum.month, fuelUpdatedAt: fuel.at?.toISOString() ?? null, activePromos: promos };
};
export const isTerminalWork = (s) => TERMINAL.includes(s);
