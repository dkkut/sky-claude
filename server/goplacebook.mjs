/**
 * Sky GO «Организации», этап 2: бронирование по расписанию, отзывы, жалобы, статистика владельца.
 * Слоты считает ТОЛЬКО сервер: часы работы места (gop_places.hours, пояс tz) − выходные дни, шаг `book_step_min`, длительность услуги.
 * Защита от двойной записи: проверка и вставка в одной транзакции под advisory-замком услуги, занято = пересечения со статусами
 * requested|confirmed не меньше `capacity`. Время клиента принимается только если совпадает с рассчитанным слотом.
 * Оплаты у брони нет: расчёт на месте (как заказ — прямым переводом организации); Sky деньги не принимает.
 */
import { query } from './db.mjs';
import { notifyGift } from './giftnotify.mjs';
import { newId, inTx, clean, sealJson, openJson } from './gocore.mjs';
import { payUrl, publicId } from './kbiz.mjs';
import { can } from './admin.mjs';
import { logAdmin as adminLog } from './adminsec.mjs';

const err = (error, extra = {}) => ({ error, ...extra });
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];   // getUTCDay()
const MIN = 60000;
const ACTIVE = ['awaiting_payment', 'requested', 'confirmed'];
const PAY_WINDOW_MIN = 30;
export const BOOK_LABEL = { awaiting_payment: 'Ждёт задатка', requested: 'Ждёт подтверждения', confirmed: 'Подтверждена', rejected: 'Отклонена', cancelled: 'Отменена', done: 'Состоялась', no_show: 'Клиент не пришёл' };
const visible = `p.connected AND p.status = 'published' AND b.status = 'active'`;
const ownBiz = async (profileId) => (await query('SELECT id, name, status, owner_id FROM kb_businesses WHERE id = kb_cur_biz($1)', [profileId])).rows[0] ?? null;
const logAdmin = (me, action, detail) => adminLog({ actorId: me, targetType: 'go_place', type: `go_places_${action}`, detail: String(detail ?? '') }).catch(() => {});
const notify = (to, title, body, ref) => notifyGift(to, 'kassa_biz', title, body, ref).catch(() => {});

/* ─── Время в поясе места ─── */
const tzOffsetMs = (ts, tz) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
};
/** «2026-11-03» + «09:30» в поясе tz → UTC-миллисекунды. */
export const localToUtc = (day, hm, tz) => {
  const [y, m, d] = day.split('-').map(Number); const [h, mi] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const weekdayOf = (day) => { const [y, m, d] = day.split('-').map(Number); return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const todayIn = (tz, now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const hmMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

/** Слоты услуги на день (до проверки занятости): [{ start, end }] в мс UTC. */
export const daySlots = (hours, tz, day, durationMin, stepMin) => {
  const wd = weekdayOf(day); const out = [];
  const intervals = hours?.[wd] ?? [];
  for (const [a, b] of intervals) {
    const s = hmMin(a); let e = hmMin(b); if (e <= s) e += 1440;     // через полночь
    for (let t = s; t + durationMin <= e; t += stepMin) {
      const dayShift = Math.floor(t / 1440); const hh = String(Math.floor((t % 1440) / 60)).padStart(2, '0'); const mm = String(t % 60).padStart(2, '0');
      const startMs = localToUtc(addDays(day, dayShift), `${hh}:${mm}`, tz);
      out.push({ start: startMs, end: startMs + durationMin * MIN });
    }
  }
  return out;
};

const placeFor = async (id) => (await query(`SELECT p.*, b.name, b.owner_id FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE p.business_id = $1 AND ${visible}`, [String(id ?? '')])).rows[0] ?? null;
const serviceOf = async (businessId, itemId) => (await query(`SELECT * FROM kb_items WHERE id = $1 AND business_id = $2 AND status = 'active' AND available AND kind = 'service'`, [String(itemId ?? ''), businessId])).rows[0] ?? null;

/* ─── Для людей: настройки, слоты, бронь ─── */
export const bookInfo = async (id) => {
  const p = await placeFor(id); if (!p) return err('not_found');
  if (!p.book_enabled) return { ok: true, enabled: false, services: [] };
  const items = (await query(`SELECT id, title, description, price_rub, duration_min, capacity, deposit_rub FROM kb_items WHERE business_id = $1 AND status = 'active' AND available AND kind = 'service' AND duration_min IS NOT NULL ORDER BY sort, created_at LIMIT 100`, [p.business_id])).rows;
  return { ok: true, enabled: true, horizonDays: p.book_horizon_days, autoConfirm: p.book_auto_confirm, tz: p.tz, today: todayIn(p.tz),
    services: items.map((i) => ({ id: i.id, title: i.title, description: i.description, priceRub: i.price_rub, durationMin: i.duration_min, depositRub: i.deposit_rub })) };
};

export const slots = async (id, itemId, day) => {
  await expireUnpaid().catch(() => {});
  const p = await placeFor(id); if (!p) return err('not_found');
  if (!p.book_enabled) return err('booking_disabled');
  if (!DAY_RE.test(String(day ?? ''))) return err('bad_field', { field: 'date' });
  const it = await serviceOf(p.business_id, itemId); if (!it || !it.duration_min) return err('item_unavailable');
  const today = todayIn(p.tz);
  if (day < today || day > addDays(today, p.book_horizon_days)) return { ok: true, slots: [] };
  const off = await query('SELECT 1 FROM gop_days_off WHERE business_id = $1 AND day = $2', [p.business_id, day]);
  if (off.rows[0]) return { ok: true, slots: [], dayOff: true };
  const base = daySlots(p.hours, p.tz, day, it.duration_min, p.book_step_min);
  const minStart = Date.now() + p.book_lead_min * MIN;
  const cand = base.filter((s) => s.start >= minStart);
  if (!cand.length) return { ok: true, slots: [] };
  const busy = (await query(`SELECT starts_at, ends_at FROM gop_bookings WHERE item_id = $1 AND status = ANY($2) AND starts_at < $3 AND ends_at > $4`,
    [it.id, ACTIVE, new Date(cand[cand.length - 1].end), new Date(cand[0].start)])).rows.map((r) => [r.starts_at.getTime(), r.ends_at.getTime()]);
  const out = cand.map((s) => { const used = busy.filter(([a, b]) => a < s.end && b > s.start).length; return { start: new Date(s.start).toISOString(), free: Math.max(0, it.capacity - used) }; }).filter((s) => s.free > 0);
  return { ok: true, slots: out, durationMin: it.duration_min };
};

export const book = async (me, id, body) => {
  await expireUnpaid().catch(() => {});
  const p = await placeFor(id); if (!p) return err('not_found');
  if (p.owner_id === me) return err('own_place');
  if (!p.book_enabled) return err('booking_disabled');
  const it = await serviceOf(p.business_id, body?.itemId); if (!it || !it.duration_min) return err('item_unavailable');
  const startMs = Date.parse(String(body?.start ?? '')); if (!Number.isFinite(startMs)) return err('bad_field', { field: 'start' });
  const name = clean(body?.contact?.name, 80); const phone = clean(body?.contact?.phone, 30);
  if (name.length < 2) return err('bad_field', { field: 'name' });
  if (!/^[0-9+() -]{5,30}$/.test(phone)) return err('bad_field', { field: 'phone' });
  const idem = clean(body?.idemKey, 60) || null;
  // время должно совпадать с рассчитанным слотом (день — по поясу места)
  const day = todayIn(p.tz, startMs);
  const today = todayIn(p.tz);
  if (day < today || day > addDays(today, p.book_horizon_days)) return err('slot_unavailable');
  const off = await query('SELECT 1 FROM gop_days_off WHERE business_id = $1 AND day = $2', [p.business_id, day]);
  if (off.rows[0]) return err('slot_unavailable');
  const allow = [...daySlots(p.hours, p.tz, day, it.duration_min, p.book_step_min), ...daySlots(p.hours, p.tz, addDays(day, -1), it.duration_min, p.book_step_min)];
  const slot = allow.find((s) => s.start === startMs);
  if (!slot || slot.start < Date.now() + p.book_lead_min * MIN) return err('slot_unavailable');
  const deposit = Math.min(it.deposit_rub ?? 0, it.price_rub);
  const status = deposit > 0 ? 'awaiting_payment' : p.book_auto_confirm ? 'confirmed' : 'requested';
  const res = await inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gopb:${it.id}`]);
    if (idem) { const d = await c.query('SELECT id, status FROM gop_bookings WHERE buyer_id = $1 AND idem_key = $2', [me, idem]); if (d.rows[0]) return { ok: true, duplicate: true, id: d.rows[0].id, status: d.rows[0].status }; }
    const mine = await c.query(`SELECT count(*)::int AS n FROM gop_bookings WHERE buyer_id = $1 AND business_id = $2 AND status = ANY($3) AND ends_at > now()`, [me, p.business_id, ACTIVE]);
    if (mine.rows[0].n >= 5) return err('too_many_bookings');
    const same = await c.query(`SELECT 1 FROM gop_bookings WHERE buyer_id = $1 AND item_id = $2 AND status = ANY($3) AND starts_at < $4 AND ends_at > $5`, [me, it.id, ACTIVE, new Date(slot.end), new Date(slot.start)]);
    if (same.rows[0]) return err('already_booked');
    const used = await c.query(`SELECT count(*)::int AS n FROM gop_bookings WHERE item_id = $1 AND status = ANY($2) AND starts_at < $3 AND ends_at > $4`, [it.id, ACTIVE, new Date(slot.end), new Date(slot.start)]);
    if (used.rows[0].n >= it.capacity) return err('slot_taken');
    const bid = newId('gpb'); let qid = null; let pid = null;
    if (deposit > 0) {   // задаток — страница оплаты SkyKassa Business (прямой перевод организации); слот держится PAY_WINDOW_MIN минут
      qid = newId('kbq'); pid = publicId();
      await c.query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, expires_at, config) VALUES ($1,$2,$3,'order',$4,'',$5,'',now() + ($6 || ' minutes')::interval,$7::jsonb)`,
        [qid, pid, p.business_id, `Задаток за запись: ${it.title}`, deposit, String(PAY_WINDOW_MIN), JSON.stringify({ bookingId: bid, deposit: true })]);
    }
    await c.query(`INSERT INTO gop_bookings (id, business_id, item_id, item_title, price_rub, buyer_id, starts_at, ends_at, status, contact_enc, note, idem_key, deposit_rub, qr_id, pay_deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [bid, p.business_id, it.id, it.title, it.price_rub, me, new Date(slot.start), new Date(slot.end), status, sealJson({ name, phone }), clean(body?.note, 300), idem, deposit, qid, deposit > 0 ? new Date(Date.now() + PAY_WINDOW_MIN * MIN) : null]);
    return { ok: true, id: bid, status, depositRub: deposit, payUrl: pid ? payUrl(pid) : null };
  });
  if (res.ok && !res.duplicate && res.status !== 'awaiting_payment') {
    void notify(p.owner_id, 'Новая запись в Sky GO', `${it.title}, ${new Date(slot.start).toLocaleString('ru-RU', { timeZone: p.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`, `gopb:${res.id}:new`);
  }
  return res.ok ? { ...res, statusLabel: BOOK_LABEL[res.status], startsAt: new Date(slot.start).toISOString() } : res;
};

const shapeMine = (r) => ({ id: r.id, placeId: r.business_id, placeName: r.name, item: r.item_title, priceRub: r.price_rub, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(), tz: r.tz,
  status: r.status, statusLabel: BOOK_LABEL[r.status], comment: r.owner_comment, canCancel: ACTIVE.includes(r.status) && r.starts_at.getTime() > Date.now(), address: r.address, depositRub: r.deposit_rub,
  payUrl: r.status === 'awaiting_payment' && r.public_id ? payUrl(r.public_id) : null, payBy: r.status === 'awaiting_payment' && r.pay_deadline ? r.pay_deadline.toISOString() : null });
export const myBookings = async (me) => {
  const { rows } = await query(`SELECT bk.*, b.name, p.tz, p.address, q.public_id FROM gop_bookings bk JOIN kb_businesses b ON b.id = bk.business_id LEFT JOIN gop_places p ON p.business_id = bk.business_id LEFT JOIN kb_qr q ON q.id = bk.qr_id WHERE bk.buyer_id = $1 ORDER BY bk.starts_at DESC LIMIT 100`, [me]);
  return { bookings: rows.map(shapeMine) };
};

/** Единый переход статуса брони под замком строки. actor: 'buyer' | 'owner'. */
const TRANS = {
  cancel_buyer: { who: 'buyer', from: ['awaiting_payment', 'requested', 'confirmed'], to: 'cancelled', future: true },
  confirm:      { who: 'owner', from: ['requested'], to: 'confirmed' },
  reject:       { who: 'owner', from: ['requested'], to: 'rejected', reason: true },
  cancel:       { who: 'owner', from: ['awaiting_payment', 'requested', 'confirmed'], to: 'cancelled', reason: true },
  done:         { who: 'owner', from: ['confirmed'], to: 'done', past: true },
  'no-show':    { who: 'owner', from: ['confirmed'], to: 'no_show', past: true },
};
const transit = async (actorId, bookingId, action, reason) => {
  const t = TRANS[action]; if (!t) return err('bad_action');
  const why = clean(reason, 300);
  if (t.reason && why.length < 3) return err('reason_required');
  const res = await inTx(async (c) => {
    const { rows } = await c.query(`SELECT bk.*, b.owner_id, b.name FROM gop_bookings bk JOIN kb_businesses b ON b.id = bk.business_id WHERE bk.id = $1 FOR UPDATE OF bk`, [String(bookingId ?? '')]);
    const r = rows[0]; if (!r) return err('not_found');
    if (t.who === 'buyer' ? r.buyer_id !== actorId : r.owner_id !== actorId) return err('not_found');
    if (r.status === t.to) return { ok: true, duplicate: true, status: r.status };
    if (!t.from.includes(r.status)) return err('bad_state', { status: r.status });
    if (t.future && r.starts_at.getTime() <= Date.now()) return err('bad_state', { status: r.status });
    if (t.past && r.starts_at.getTime() > Date.now()) return err('too_early');
    if (['cancelled', 'rejected'].includes(t.to) && r.qr_id) await c.query(`UPDATE kb_qr SET status = 'disabled', updated_at = now() WHERE id = $1 AND status = 'active'`, [r.qr_id]);
    await c.query(`UPDATE gop_bookings SET status = $2, owner_comment = CASE WHEN $3 <> '' THEN $3 ELSE owner_comment END, updated_at = now() WHERE id = $1`, [r.id, t.to, why]);
    return { ok: true, status: t.to, row: r };
  });
  if (res.ok && !res.duplicate) {
    const r = res.row; const when = r.starts_at.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (t.who === 'owner') void notify(r.buyer_id, `Запись: ${BOOK_LABEL[t.to].toLowerCase()}`, `${r.name}, ${r.item_title}, ${when}${why ? `. ${why}` : ''}`, `gopb:${r.id}:${t.to}`);
    else void notify(r.owner_id, 'Клиент отменил запись', `${r.item_title}, ${when}`, `gopb:${r.id}:${t.to}`);
    return { ok: true, status: t.to, statusLabel: BOOK_LABEL[t.to] };
  }
  return res.ok ? res : res;
};
export const cancelMine = (me, id) => transit(me, id, 'cancel_buyer', '');
export const ownerAct = (me, id, action, reason) => (action === 'cancel_buyer' ? err('bad_action') : transit(me, id, action, reason));

/* ─── Владелец: настройки, выходные, список броней ─── */
export const ownerBookGet = async (me) => {
  const b = await ownBiz(me); if (!b) return err('no_business');
  await query('INSERT INTO gop_places (business_id) VALUES ($1) ON CONFLICT DO NOTHING', [b.id]);
  const p = (await query('SELECT * FROM gop_places WHERE business_id = $1', [b.id])).rows[0];
  const off = (await query(`SELECT day::text AS day, reason FROM gop_days_off WHERE business_id = $1 AND day >= current_date - 1 ORDER BY day LIMIT 200`, [b.id])).rows;
  return { ok: true, settings: { enabled: p.book_enabled, stepMin: p.book_step_min, horizonDays: p.book_horizon_days, leadMin: p.book_lead_min, autoConfirm: p.book_auto_confirm }, daysOff: off,
    hoursSet: Object.keys(p.hours ?? {}).length > 0 };
};
export const ownerBookSave = async (me, body) => {
  const b = await ownBiz(me); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const num = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  const cur = await ownerBookGet(me); const s = cur.settings;
  const next = { enabled: body?.enabled == null ? s.enabled : Boolean(body.enabled), stepMin: body?.stepMin == null ? s.stepMin : num(body.stepMin, 5, 240), horizonDays: body?.horizonDays == null ? s.horizonDays : num(body.horizonDays, 1, 180),
    leadMin: body?.leadMin == null ? s.leadMin : num(body.leadMin, 0, 10080), autoConfirm: body?.autoConfirm == null ? s.autoConfirm : Boolean(body.autoConfirm) };
  for (const k of ['stepMin', 'horizonDays', 'leadMin']) if (next[k] == null) return err('bad_field', { field: k });
  if (next.enabled && !cur.hoursSet) return err('hours_required');
  await query(`UPDATE gop_places SET book_enabled=$2, book_step_min=$3, book_horizon_days=$4, book_lead_min=$5, book_auto_confirm=$6, updated_at=now() WHERE business_id=$1`,
    [b.id, next.enabled, next.stepMin, next.horizonDays, next.leadMin, next.autoConfirm]);
  return ownerBookGet(me);
};
export const ownerDayOff = async (me, day, reason, on) => {
  const b = await ownBiz(me); if (!b) return err('no_business');
  if (!DAY_RE.test(String(day ?? ''))) return err('bad_field', { field: 'day' });
  if (on) {
    const n = await query('SELECT count(*)::int AS n FROM gop_days_off WHERE business_id = $1 AND day >= current_date', [b.id]); if (n.rows[0].n >= 200) return err('too_many');
    await query('INSERT INTO gop_days_off (business_id, day, reason) VALUES ($1,$2,$3) ON CONFLICT (business_id, day) DO UPDATE SET reason = EXCLUDED.reason', [b.id, day, clean(reason, 80)]);
  } else await query('DELETE FROM gop_days_off WHERE business_id = $1 AND day = $2', [b.id, day]);
  return ownerBookGet(me);
};
export const ownerBookings = async (me, q = {}) => {
  const b = await ownBiz(me); if (!b) return err('no_business');
  const vals = [b.id]; let w = 'bk.business_id = $1';
  if (q.status && BOOK_LABEL[q.status]) { vals.push(q.status); w += ` AND bk.status = $${vals.length}`; }
  if (q.from && DAY_RE.test(q.from)) { vals.push(q.from); w += ` AND bk.starts_at >= $${vals.length}::date`; }
  const { rows } = await query(`SELECT bk.*, p.tz FROM gop_bookings bk LEFT JOIN gop_places p ON p.business_id = bk.business_id WHERE ${w} ORDER BY bk.starts_at DESC LIMIT 200`, vals);
  return { bookings: rows.map((r) => { let c = {}; try { c = openJson(r.contact_enc) ?? {}; } catch { /* нечитаемо */ } return { id: r.id, item: r.item_title, priceRub: r.price_rub, depositRub: r.deposit_rub, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(), tz: r.tz, status: r.status, statusLabel: BOOK_LABEL[r.status],
    name: c.name ?? '', phone: c.phone ?? '', note: r.note, comment: r.owner_comment }; }) };
};

/* ─── Отзывы ─── */
const eligible = async (me, businessId) => {
  const a = await query(`SELECT 1 FROM kb_orders WHERE buyer_profile_id = $1 AND business_id = $2 AND status = 'done' LIMIT 1`, [me, businessId]);
  if (a.rows[0]) return true;
  return Boolean((await query(`SELECT 1 FROM gop_bookings WHERE buyer_id = $1 AND business_id = $2 AND status = 'done' LIMIT 1`, [me, businessId])).rows[0]);
};
export const reviewsOf = async (me, id) => {
  const p = await placeFor(id); if (!p) return err('not_found');
  const sum = (await query(`SELECT count(*)::int AS n, round(avg(rating)::numeric, 1)::float AS avg FROM gop_reviews WHERE business_id = $1 AND NOT hidden`, [p.business_id])).rows[0];
  const rows = (await query(`SELECT r.*, pr.name FROM gop_reviews r LEFT JOIN profiles pr ON pr.id = r.profile_id WHERE r.business_id = $1 AND NOT r.hidden ORDER BY r.created_at DESC LIMIT 30`, [p.business_id])).rows;
  return { ok: true, count: sum.n, avg: sum.n ? sum.avg : null, canReview: p.owner_id !== me && await eligible(me, p.business_id) && !rows.some((x) => x.profile_id === me) && !(await query('SELECT 1 FROM gop_reviews WHERE business_id=$1 AND profile_id=$2', [p.business_id, me])).rows[0],
    reviews: rows.map((r) => ({ id: r.id, name: String(r.name ?? 'Клиент').split(' ')[0], rating: r.rating, text: r.body, reply: r.reply, at: r.created_at.toISOString(), mine: r.profile_id === me })) };
};
export const addReview = async (me, id, body) => {
  const p = await placeFor(id); if (!p) return err('not_found');
  if (p.owner_id === me) return err('own_place');
  const rating = Number(body?.rating); if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err('bad_field', { field: 'rating' });
  if (!(await eligible(me, p.business_id))) return err('review_not_allowed');   // только после выполненного заказа или состоявшейся записи
  const r = await query(`INSERT INTO gop_reviews (id, business_id, profile_id, rating, body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (business_id, profile_id) DO NOTHING`, [newId('gpr'), p.business_id, me, rating, clean(body?.text, 1000)]);
  if (!r.rowCount) return err('already_reviewed');
  void notify(p.owner_id, 'Новый отзыв в Sky GO', `${rating} из 5`, `gopr:${p.business_id}:${me}`);
  return reviewsOf(me, id);
};
export const ownerReviews = async (me) => {
  const b = await ownBiz(me); if (!b) return err('no_business');
  const rows = (await query(`SELECT r.*, pr.name FROM gop_reviews r LEFT JOIN profiles pr ON pr.id = r.profile_id WHERE r.business_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [b.id])).rows;
  return { reviews: rows.map((r) => ({ id: r.id, name: String(r.name ?? 'Клиент').split(' ')[0], rating: r.rating, text: r.body, reply: r.reply, hidden: r.hidden, hiddenReason: r.hidden_reason, at: r.created_at.toISOString() })) };
};
export const ownerReply = async (me, reviewId, text) => {
  const b = await ownBiz(me); if (!b) return err('no_business');
  const t = clean(text, 500); if (t.length < 2) return err('bad_field', { field: 'text' });
  const r = await query('UPDATE gop_reviews SET reply = $3 WHERE id = $1 AND business_id = $2', [String(reviewId ?? ''), b.id, t]);
  return r.rowCount ? { ok: true } : err('not_found');
};

/* ─── Жалобы ─── */
export const REPORT_REASONS = { wrong_info: 'Неверные данные', fraud: 'Мошенничество', closed: 'Организация не работает', inappropriate: 'Недопустимое содержимое', other: 'Другое' };
export const report = async (me, id, body) => {
  const p = await placeFor(id); if (!p) return err('not_found');
  if (p.owner_id === me) return err('own_place');
  const reason = String(body?.reason ?? ''); if (!REPORT_REASONS[reason]) return err('bad_field', { field: 'reason' });
  const text = clean(body?.text, 500); if (reason === 'other' && text.length < 5) return err('text_required');
  const day = await query(`SELECT count(*)::int AS n FROM gop_reports WHERE profile_id = $1 AND created_at > now() - interval '1 day'`, [me]); if (day.rows[0].n >= 5) return err('too_many');
  const r = await query(`INSERT INTO gop_reports (id, business_id, profile_id, reason, body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [newId('gpx'), p.business_id, me, reason, text]);
  if (!r.rowCount) return { ok: true, duplicate: true };
  void import('./staffnotify.mjs').then((m) => m.notifyStaff('go_place', { title: 'Жалоба на организацию Sky GO', body: p.name, dedupe: `rep:${p.business_id}:${Date.now() >> 16}`, except: me })).catch(() => {});
  return { ok: true };
};
export const adminReports = async (me, q = {}) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const st = ['open', 'resolved', 'dismissed'].includes(q.status) ? q.status : 'open';
  const rows = (await query(`SELECT x.*, b.name FROM gop_reports x JOIN kb_businesses b ON b.id = x.business_id WHERE x.status = $1 ORDER BY x.created_at DESC LIMIT 200`, [st])).rows;
  return { reports: rows.map((r) => ({ id: r.id, placeId: r.business_id, placeName: r.name, reason: r.reason, reasonLabel: REPORT_REASONS[r.reason] ?? r.reason, text: r.body, status: r.status, resolution: r.resolution, at: r.created_at.toISOString() })) };
};
export const adminResolveReport = async (me, id, action, note) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const n = clean(note, 300); if (n.length < 3) return err('reason_required');
  const to = action === 'dismiss' ? 'dismissed' : action === 'resolve' ? 'resolved' : null; if (!to) return err('bad_action');
  const r = await query(`UPDATE gop_reports SET status = $2, resolved_by = $3, resolution = $4, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING business_id`, [String(id ?? ''), to, me, n]);
  if (!r.rowCount) return err('bad_state');
  await logAdmin(me, `report_${to}`, `${r.rows[0].business_id}: ${n}`);
  return { ok: true, status: to };
};
export const adminHideReview = async (me, reviewId, hide, reason) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const n = clean(reason, 300); if (hide && n.length < 5) return err('reason_required');
  const r = await query(`UPDATE gop_reviews SET hidden = $2, hidden_by = $3, hidden_reason = $4 WHERE id = $1 RETURNING business_id`, [String(reviewId ?? ''), Boolean(hide), me, hide ? n : '']);
  if (!r.rowCount) return err('not_found');
  await logAdmin(me, hide ? 'review_hide' : 'review_show', `${r.rows[0].business_id}: ${n}`);
  return { ok: true };
};
export const adminReviews = async (me, placeId) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const rows = (await query(`SELECT r.* FROM gop_reviews r WHERE r.business_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [String(placeId ?? '')])).rows;
  return { reviews: rows.map((r) => ({ id: r.id, rating: r.rating, text: r.body, reply: r.reply, hidden: r.hidden, hiddenReason: r.hidden_reason, at: r.created_at.toISOString() })) };
};

/* ─── Статистика владельца (только настоящие данные) ─── */
export const ownerStats = async (me, days) => {
  const b = await ownBiz(me); if (!b) return err('no_business');
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  const orders = (await query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE o.source = 'gonet')::int AS from_places, count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status IN ('rejected','cancelled'))::int AS lost,
      coalesce(sum(total_rub) FILTER (WHERE status = 'done'), 0)::int AS done_rub
      FROM kb_orders o WHERE business_id = $1 AND created_at > now() - ($2 || ' days')::interval`, [b.id, String(d)])).rows[0];
  const bk = (await query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status = 'no_show')::int AS no_show, count(*) FILTER (WHERE status IN ('rejected','cancelled'))::int AS lost
      FROM gop_bookings WHERE business_id = $1 AND created_at > now() - ($2 || ' days')::interval`, [b.id, String(d)])).rows[0];
  const rv = (await query(`SELECT count(*)::int AS n, round(avg(rating)::numeric, 1)::float AS avg FROM gop_reviews WHERE business_id = $1 AND NOT hidden`, [b.id])).rows[0];
  const fav = (await query('SELECT count(*)::int AS n FROM gop_favs WHERE business_id = $1', [b.id])).rows[0].n;
  const top = (await query(`SELECT l->>'title' AS title, sum((l->>'qty')::int)::int AS qty FROM kb_orders o, jsonb_array_elements(o.lines) l WHERE o.business_id = $1 AND o.status = 'done' AND o.created_at > now() - ($2 || ' days')::interval GROUP BY 1 ORDER BY qty DESC LIMIT 5`, [b.id, String(d)])).rows;
  return { ok: true, days: d, orders: { total: orders.n, fromCatalog: orders.from_places, done: orders.done, lost: orders.lost, doneRub: orders.done_rub }, bookings: { total: bk.n, done: bk.done, noShow: bk.no_show, lost: bk.lost },
    reviews: { count: rv.n, avg: rv.n ? rv.avg : null }, favorites: fav, top, note: 'Просмотры карточек и переходы к маршруту не считаются: Sky их не записывает.' };
};

/** Уборка: давно прошедшие неподтверждённые заявки закрываются (слот освобождается). Вызывается из почасовой уборки. */
/** Платёж по задатку изменил статус (из kbiz.actOnPayment / kbprovider через goplaces.paymentChanged). true — это был платёж за запись. */
export const depositPaymentChanged = async (paymentId, to) => {
  const { rows } = await query(`SELECT p.status AS pay, bk.id, bk.status, bk.buyer_id, bk.item_title, bk.starts_at, b.owner_id, pl.book_auto_confirm AS auto
      FROM kb_payments p JOIN gop_bookings bk ON bk.qr_id = p.qr_id JOIN kb_businesses b ON b.id = bk.business_id LEFT JOIN gop_places pl ON pl.business_id = bk.business_id WHERE p.id = $1`, [paymentId]);
  const r = rows[0]; if (!r) return false;
  if (r.pay !== to) return true;
  if (to === 'confirmed' && r.status === 'awaiting_payment') {
    const next = r.auto ? 'confirmed' : 'requested';
    const u = await query(`UPDATE gop_bookings SET status = $2, updated_at = now() WHERE id = $1 AND status = 'awaiting_payment'`, [r.id, next]);
    if (u.rowCount) {
      void notify(r.buyer_id, 'Задаток получен', `${r.item_title}. ${next === 'confirmed' ? 'Запись подтверждена.' : 'Ждём подтверждения организации.'}`, `gopb:${r.id}:paid`);
      void notify(r.owner_id, 'Новая запись в Sky GO', `${r.item_title} (задаток оплачен)`, `gopb:${r.id}:new`);
    }
  } else if (['cancelled', 'not_found', 'refunded'].includes(to) && r.status === 'awaiting_payment') {
    const u = await query(`UPDATE gop_bookings SET status = 'cancelled', owner_comment = 'Задаток не получен', updated_at = now() WHERE id = $1 AND status = 'awaiting_payment'`, [r.id]);
    if (u.rowCount) void notify(r.buyer_id, 'Запись отменена', 'Задаток не получен — время снова свободно.', `gopb:${r.id}:unpaid`);
  }
  return true;
};

/** Не оплатившие задаток вовремя теряют слот; вызывается лениво при выдаче слотов и записи, и уборкой. */
export const expireUnpaid = async () => {
  // не оплатившие задаток вовремя (и не заявившие о переводе) теряют слот
  const e = await query(`UPDATE gop_bookings bk SET status = 'cancelled', owner_comment = 'Задаток не оплачен вовремя', updated_at = now()
      WHERE status = 'awaiting_payment' AND pay_deadline < now() AND NOT EXISTS (SELECT 1 FROM kb_payments p WHERE p.qr_id = bk.qr_id AND p.status IN ('reported','confirmed')) RETURNING id, buyer_id, qr_id`);
  for (const x of e.rows) { void notify(x.buyer_id, 'Запись отменена', 'Задаток не оплачен вовремя — время снова свободно.', `gopb:${x.id}:unpaid`); if (x.qr_id) await query(`UPDATE kb_qr SET status = 'disabled', updated_at = now() WHERE id = $1 AND status = 'active'`, [x.qr_id]).catch(() => {}); }
  return e.rowCount;
};

export const sweepBookings = async () => {
  await expireUnpaid();
  const r = await query(`UPDATE gop_bookings SET status = 'cancelled', owner_comment = 'Организация не ответила вовремя', updated_at = now() WHERE status = 'requested' AND starts_at < now() RETURNING id, buyer_id`);
  for (const x of r.rows) void notify(x.buyer_id, 'Запись отменена', 'Организация не подтвердила запись до её начала.', `gopb:${x.id}:expired`);
  return r.rowCount;
};
