/**
 * Sky GO — «Жилье и отдых»: квартиры и дома, туры, отели.
 *
 * Объявления размещают исполнители через кабинет (роли host / tour_operator / hotel: одобренная заявка + действующая подписка).
 * Бронь — заказ вида 'stay': гость отправляет заявку → владелец подтверждает (под замком объявления проверяются даты/места)
 * → открывается прямая оплата владельцу (Sky деньги за жильё не принимает) → гость «оплатил», владелец «получил».
 * Цена всегда считается сервером из объявления; присланная клиентом — игнорируется. Отзывов и оценок нет — выдумывать нечего.
 * Туры и отели доступны только ИП и организациям; сверка с реестрами туроператоров/гостиниц не выполняется.
 */
import { query } from './db.mjs';
import { subscriptionState } from './gosubs.mjs';
import { openPayment, payRow } from './gopay.mjs';
import { executorStatus } from './goreg.mjs';
import { payDetailsRaw } from './goreg.mjs';
import { cityOk, cities, newId, inTx, lockOrder, setStatus, addEvent, notifyGo, goLog, clean } from './gocore.mjs';

export const KIND_ROLE = { home: 'host', tour: 'tour_operator', hotel: 'hotel' };
const BLOCKING = ['awaiting_payment', 'payment_reported', 'paid'];
const HOLD_HOURS = 48;
const MAX_PHOTOS = 8;
const MAX_PHOTO = 4 * 1024 * 1024;
const MAX_LISTINGS = 20;

const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? String(s) : null);
const today = () => new Date().toISOString().slice(0, 10);
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const list = (v, max, len) => (Array.isArray(v) ? v.map((x) => clean(x, len)).filter(Boolean).slice(0, max) : []);
const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v) : d);

const sniffImage = (b) => {
  if (!b || b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
};

/* ─── Проверка и сборка данных объявления ───────────────────────────── */
const buildData = (kind, input, prev) => {
  const d = input?.data ?? {};
  if (kind === 'home') {
    const price = int(input?.priceRub, 100, 1_000_000); if (price == null) return { error: 'bad_price' };
    const maxGuests = int(d.maxGuests, 1, 30); if (maxGuests == null) return { error: 'bad_guests' };
    return { price, data: {
      maxGuests, rooms: int(d.rooms, 0, 20) ?? 1, beds: int(d.beds, 1, 40) ?? 1, areaM2: int(d.areaM2, 0, 2000) ?? 0,
      minNights: int(d.minNights, 1, 30) ?? 1, checkInTime: hhmm(d.checkInTime, '14:00'), checkOutTime: hhmm(d.checkOutTime, '12:00'),
      rules: clean(d.rules, 600), amenities: list(d.amenities, 20, 30), unit: 'ночь' } };
  }
  if (kind === 'hotel') {
    const rooms = [];
    for (const r of Array.isArray(d.rooms) ? d.rooms.slice(0, 30) : []) {
      const name = clean(r?.name, 60); const price = int(r?.priceRub, 100, 1_000_000); const guests = int(r?.guests, 1, 10); const count = int(r?.count, 1, 200);
      if (name.length < 2 || price == null || guests == null || count == null) return { error: 'bad_room' };
      rooms.push({ id: clean(r?.id, 40) || newId('rm'), name, priceRub: price, guests, count });
    }
    return { price: rooms.length ? Math.min(...rooms.map((r) => r.priceRub)) : 0, data: {
      stars: int(d.stars, 0, 5) ?? 0, amenities: list(d.amenities, 20, 30), rooms, checkInTime: hhmm(d.checkInTime, '14:00'), checkOutTime: hhmm(d.checkOutTime, '12:00'),
      rules: clean(d.rules, 600), unit: 'ночь' } };
  }
  const deps = [];
  for (const x of Array.isArray(d.departures) ? d.departures.slice(0, 40) : []) {
    const date = ymd(x?.date); const price = int(x?.priceRub, 100, 1_000_000); const seats = int(x?.seats, 1, 500);
    if (!date || price == null || seats == null) return { error: 'bad_departure' };
    deps.push({ id: clean(x?.id, 40) || newId('dep'), date, priceRub: price, seats });
  }
  const future = deps.filter((x) => x.date >= today());
  return { price: future.length ? Math.min(...future.map((x) => x.priceRub)) : 0, data: {
    durationDays: int(d.durationDays, 1, 60) ?? 1, program: clean(d.program, 3000), includes: clean(d.includes, 600), minAge: int(d.minAge, 0, 18) ?? 0,
    departures: deps, unit: 'человек' } };
};

const ownerReady = async (ownerId, kind) => {
  const role = KIND_ROLE[kind]; if (!role) return { error: 'bad_kind' };
  const ex = await executorStatus(ownerId, role);
  if (!ex) return { error: 'not_registered' };
  if (ex.status !== 'approved') return { error: 'not_approved', status: ex.status };
  return { ok: true, role };
};

const ownRow = async (ownerId, id, client) => (await (client ?? { query }).query('SELECT * FROM go_listings WHERE id = $1 AND owner_id = $2', [String(id ?? ''), ownerId])).rows[0] ?? null;

/** Занятость: брони, которые держат даты/места (подтверждены владельцем — ждут оплаты, оплачены). */
const blockingBookings = async (client, listingId, exceptOrderId) => (await client.query(
  `SELECT id, data FROM go_orders WHERE kind = 'stay' AND data->>'listingId' = $1 AND status = ANY($2::text[])
      AND ($3::text IS NULL OR id <> $3) AND COALESCE(data->>'checkOut', data->>'date') >= $4`,
  [listingId, BLOCKING, exceptOrderId ?? null, today()])).rows;

/** Можно ли разместить бронь. Вызывать под замком объявления. */
const fits = (l, b, others) => {
  const d = l.data ?? {};
  if (l.kind === 'home') return !others.some((o) => b.checkIn < o.data.checkOut && o.data.checkIn < b.checkOut);
  if (l.kind === 'hotel') {
    const room = (d.rooms ?? []).find((r) => r.id === b.roomId);
    return Boolean(room) && others.filter((o) => o.data.roomId === b.roomId && b.checkIn < o.data.checkOut && o.data.checkIn < b.checkOut).length < room.count;
  }
  const dep = (d.departures ?? []).find((x) => x.id === b.departureId);
  return Boolean(dep) && others.filter((o) => o.data.departureId === b.departureId).reduce((s, o) => s + (o.data.people ?? 0), 0) + b.people <= dep.seats;
};

/** Разбор запроса брони: даты, гости, комната/отправление; цена — по объявлению. */
const planBooking = (l, input) => {
  const d = l.data ?? {};
  if (l.kind === 'tour') {
    const dep = (d.departures ?? []).find((x) => x.id === String(input?.departureId ?? ''));
    if (!dep) return { error: 'departure_not_found' };
    if (dep.date < today()) return { error: 'departure_passed' };
    const people = int(input?.people, 1, 20); if (people == null) return { error: 'bad_guests' };
    return { b: { departureId: dep.id, people, date: dep.date, checkIn: dep.date, checkOut: dep.date, nights: 0, guests: people }, total: dep.priceRub * people, label: `Тур, отправление ${dep.date}` };
  }
  const checkIn = ymd(input?.checkIn); const checkOut = ymd(input?.checkOut);
  if (!checkIn || !checkOut) return { error: 'bad_dates' };
  if (checkIn < today()) return { error: 'date_in_past' };
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1 || nights > 60) return { error: 'bad_dates' };
  const guests = int(input?.guests, 1, 30); if (guests == null) return { error: 'bad_guests' };
  if (l.kind === 'home') {
    if (guests > d.maxGuests) return { error: 'too_many_guests', max: d.maxGuests };
    if (nights < (d.minNights ?? 1)) return { error: 'min_nights', min: d.minNights };
    return { b: { checkIn, checkOut, nights, guests }, total: l.price_rub * nights, label: `${nights} н.` };
  }
  const room = (d.rooms ?? []).find((r) => r.id === String(input?.roomId ?? ''));
  if (!room) return { error: 'room_not_found' };
  if (guests > room.guests) return { error: 'too_many_guests', max: room.guests };
  return { b: { checkIn, checkOut, nights, guests, roomId: room.id, roomName: room.name }, total: room.priceRub * nights, label: `${room.name}, ${nights} н.` };
};

/* ─── Кабинет владельца ─────────────────────────────────────────────── */
const photoIds = async (id) => (await query('SELECT id FROM go_listing_photos WHERE listing_id = $1 ORDER BY sort, created_at', [id])).rows.map((r) => r.id);
const mineView = async (r) => ({ id: r.id, kind: r.kind, title: r.title, descr: r.descr, city: r.city, address: r.address, priceRub: r.price_rub, status: r.status,
  modNote: r.mod_note || undefined, data: r.data, photos: await photoIds(r.id), updatedAt: r.updated_at.toISOString() });

export const myListings = async (ownerId) => {
  const { rows } = await query('SELECT * FROM go_listings WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId]);
  return { listings: await Promise.all(rows.map(mineView)) };
};

export const saveListing = async (ownerId, input) => {
  const kind = String(input?.kind ?? '');
  const ok = await ownerReady(ownerId, kind); if (ok.error) return ok;
  const title = clean(input?.title, 120); if (title.length < 3) return { error: 'title_required' };
  const city = clean(input?.city, 60); if (!(await cityOk(city))) return { error: 'bad_city' };
  const address = clean(input?.address, 200); if (address.length < 3) return { error: 'address_required' };
  const built = buildData(kind, input); if (built.error) return built;
  const descr = clean(input?.descr, 2000);
  return inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:listing:${ownerId}`]);
    if (input?.id) {
      const cur = (await c.query('SELECT * FROM go_listings WHERE id = $1 AND owner_id = $2 FOR UPDATE', [String(input.id), ownerId])).rows[0];
      if (!cur) return { error: 'not_found' };
      if (cur.kind !== kind) return { error: 'bad_kind' };
      // Номера и отправления, по которым есть живые брони, убирать нельзя.
      const keys = kind === 'hotel' ? (built.data.rooms ?? []).map((r) => r.id) : kind === 'tour' ? (built.data.departures ?? []).map((x) => x.id) : null;
      if (keys) {
        const field = kind === 'hotel' ? 'roomId' : 'departureId';
        const used = (await c.query(
          `SELECT DISTINCT data->>'${field}' AS k FROM go_orders WHERE kind = 'stay' AND data->>'listingId' = $1 AND status IN ('requested','awaiting_payment','payment_reported','paid')
              AND COALESCE(data->>'checkOut', data->>'date') >= $2`, [cur.id, today()])).rows.map((r) => r.k);
        if (used.some((k) => k && !keys.includes(k))) return { error: 'has_bookings' };
      }
      await c.query('UPDATE go_listings SET title=$2, descr=$3, city=$4, address=$5, price_rub=$6, data=$7::jsonb, updated_at=now() WHERE id=$1',
        [cur.id, title, descr, city, address, built.price, JSON.stringify(built.data)]);
      return { ok: true, id: cur.id };
    }
    const { rows: n } = await c.query('SELECT count(*)::int AS n FROM go_listings WHERE owner_id = $1', [ownerId]);
    if (n[0].n >= MAX_LISTINGS) return { error: 'too_many_listings' };
    const id = newId('gls');
    await c.query('INSERT INTO go_listings (id, owner_id, kind, title, descr, city, address, price_rub, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
      [id, ownerId, kind, title, descr, city, address, built.price, JSON.stringify(built.data)]);
    return { ok: true, id };
  });
};

export const removeListing = async (ownerId, id) => inTx(async (c) => {
  const l = await ownRow(ownerId, id, c); if (!l) return { error: 'not_found' };
  const { rows } = await c.query(`SELECT 1 FROM go_orders WHERE kind = 'stay' AND data->>'listingId' = $1 AND status IN ('requested','awaiting_payment','payment_reported') LIMIT 1`, [l.id]);
  if (rows[0]) return { error: 'has_bookings' };
  await c.query('DELETE FROM go_listings WHERE id = $1', [l.id]);
  return { ok: true };
});

export const setPublished = async (ownerId, id, on) => {
  const l = await ownRow(ownerId, id); if (!l) return { error: 'not_found' };
  const ok = await ownerReady(ownerId, l.kind); if (ok.error) return ok;
  if (on) {
    if (l.status === 'hidden') return { error: 'hidden_by_admin', note: l.mod_note };
    const sub = await subscriptionState(ownerId, ok.role);
    if (!sub.active) return { error: 'subscription_required' };
    if (l.price_rub <= 0) return { error: l.kind === 'tour' ? 'no_departures' : l.kind === 'hotel' ? 'no_rooms' : 'bad_price' };
    if ((await photoIds(l.id)).length < 1) return { error: 'photo_required' };
    await query(`UPDATE go_listings SET status = 'published', updated_at = now() WHERE id = $1`, [l.id]);
    return { ok: true, status: 'published' };
  }
  if (l.status === 'published') await query(`UPDATE go_listings SET status = 'draft', updated_at = now() WHERE id = $1`, [l.id]);
  return { ok: true, status: l.status === 'hidden' ? 'hidden' : 'draft' };
};

export const addPhoto = async (ownerId, id, bytes) => {
  const l = await ownRow(ownerId, id); if (!l) return { error: 'not_found' };
  if (!bytes || bytes.length > MAX_PHOTO) return { error: 'file_too_large' };
  const mime = sniffImage(bytes); if (!mime) return { error: 'unsupported_type' };
  const { rows } = await query('SELECT count(*)::int AS n FROM go_listing_photos WHERE listing_id = $1', [l.id]);
  if (rows[0].n >= MAX_PHOTOS) return { error: 'too_many_photos' };
  const pid = newId('gph');
  await query('INSERT INTO go_listing_photos (id, listing_id, sort, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6)', [pid, l.id, rows[0].n, mime, bytes.length, bytes]);
  return { ok: true, id: pid };
};

export const removePhoto = async (ownerId, id, photoId) => {
  const l = await ownRow(ownerId, id); if (!l) return { error: 'not_found' };
  const { rowCount } = await query('DELETE FROM go_listing_photos WHERE id = $1 AND listing_id = $2', [String(photoId ?? ''), l.id]);
  if (!rowCount) return { error: 'not_found' };
  // Без фото объявление не остаётся опубликованным.
  if ((await photoIds(l.id)).length < 1 && l.status === 'published') await query(`UPDATE go_listings SET status = 'draft' WHERE id = $1`, [l.id]);
  return { ok: true };
};

/** Фото: опубликованного объявления — любому вошедшему; черновика — владельцу и сотруднику (staff). */
export const getPhoto = async (viewerId, photoId, staff) => {
  const { rows } = await query(
    `SELECT p.mime, p.data, l.owner_id, l.status FROM go_listing_photos p JOIN go_listings l ON l.id = p.listing_id WHERE p.id = $1`, [String(photoId ?? '')]);
  const r = rows[0]; if (!r) return { error: 'not_found' };
  if (r.status !== 'published' && r.owner_id !== viewerId && !staff) return { error: 'not_found' };
  return { ok: true, mime: r.mime, data: r.data };
};

/* ─── Каталог ───────────────────────────────────────────────────────── */
const visibleSql = `l.status = 'published'
  AND EXISTS (SELECT 1 FROM go_executors e WHERE e.profile_id = l.owner_id AND e.status = 'approved'
              AND e.role = CASE l.kind WHEN 'home' THEN 'host' WHEN 'tour' THEN 'tour_operator' ELSE 'hotel' END)
  AND EXISTS (SELECT 1 FROM go_subscriptions s WHERE s.profile_id = l.owner_id AND s.expires_at > now()
              AND s.role = CASE l.kind WHEN 'home' THEN 'host' WHEN 'tour' THEN 'tour_operator' ELSE 'hotel' END)`;

const card = async (r) => {
  const photos = await photoIds(r.id);
  return { id: r.id, kind: r.kind, title: r.title, city: r.city, priceRub: r.price_rub, unit: r.data?.unit ?? '', photo: photos[0] ?? null,
    maxGuests: r.data?.maxGuests, stars: r.data?.stars, durationDays: r.data?.durationDays,
    nextDeparture: r.kind === 'tour' ? (r.data?.departures ?? []).filter((x) => x.date >= today()).map((x) => x.date).sort()[0] ?? null : undefined };
};

export const catalog = async ({ kind, city, q, guests, checkIn, checkOut, sort } = {}) => {
  if (!KIND_ROLE[kind]) return { error: 'bad_kind' };
  const args = [kind]; const where = [visibleSql, 'l.kind = $1'];
  if (city) { args.push(clean(city, 60)); where.push(`l.city = $${args.length}`); }
  if (q) { args.push(`%${clean(q, 60).toLowerCase().replace(/([\\%_])/g, '\\$1')}%`); where.push(`(lower(l.title) LIKE $${args.length} ESCAPE '\\' OR lower(l.descr) LIKE $${args.length} ESCAPE '\\')`); }
  const { rows } = await query(`SELECT l.* FROM go_listings l WHERE ${where.join(' AND ')} ORDER BY ${sort === 'price_desc' ? 'l.price_rub DESC' : 'l.price_rub ASC'}, l.created_at DESC LIMIT 100`, args);
  const ci = ymd(checkIn); const co = ymd(checkOut); const g = int(guests, 1, 30);
  const out = [];
  for (const r of rows) {
    if (g && r.kind === 'home' && r.data.maxGuests < g) continue;
    if (g && r.kind === 'hotel' && !(r.data.rooms ?? []).some((x) => x.guests >= g)) continue;
    if (ci && co && r.kind !== 'tour' && co > ci) {
      const others = await blockingBookings({ query }, r.id, null);
      const rooms = r.kind === 'hotel' ? (r.data.rooms ?? []).filter((x) => x.guests >= (g ?? 1)) : [null];
      const free = rooms.some((room) => fits(r, { checkIn: ci, checkOut: co, roomId: room?.id, people: 0 }, others));
      if (!free) continue;
    }
    out.push(await card(r));
  }
  return { listings: out };
};

export const getListing = async (id) => {
  const { rows } = await query(`SELECT l.* FROM go_listings l WHERE l.id = $1 AND ${visibleSql}`, [String(id ?? '')]);
  const l = rows[0]; if (!l) return { error: 'not_found' };
  const base = await card(l);
  const data = { ...l.data };
  if (l.kind === 'tour') {
    const others = await blockingBookings({ query }, l.id, null);
    data.departures = (data.departures ?? []).filter((x) => x.date >= today()).sort((a, b) => a.date.localeCompare(b.date))
      .map((x) => ({ ...x, seatsLeft: Math.max(0, x.seats - others.filter((o) => o.data.departureId === x.id).reduce((s, o) => s + (o.data.people ?? 0), 0)) }));
  }
  const org = (await query(`SELECT p.username, p.name FROM profiles p WHERE p.id = $1`, [l.owner_id])).rows[0];
  return { listing: { ...base, descr: l.descr, city: l.city, data, photos: await photoIds(l.id), owner: { username: org?.username, name: org?.name } } };
};

export const quote = async (input) => {
  const { rows } = await query(`SELECT l.* FROM go_listings l WHERE l.id = $1 AND ${visibleSql}`, [String(input?.listingId ?? '')]);
  const l = rows[0]; if (!l) return { error: 'not_found' };
  const plan = planBooking(l, input); if (plan.error) return plan;
  const available = fits(l, plan.b, await blockingBookings({ query }, l.id, null));
  return { ok: true, totalRub: plan.total, nights: plan.b.nights, available, label: plan.label };
};

/* ─── Бронь ─────────────────────────────────────────────────────────── */
export const book = async (guestId, input) => {
  const name = clean(input?.contact?.name, 80);
  const phone = String(input?.contact?.phone ?? '').replace(/[^\d+]/g, '').slice(0, 16);
  if (name.length < 2) return { error: 'recipient_name_required' };
  if (!/^\+?\d{10,15}$/.test(phone)) return { error: 'recipient_phone_invalid' };
  const idem = clean(input?.idemKey, 64) || null;
  const created = await inTx(async (c) => {
    const l = (await c.query(`SELECT l.* FROM go_listings l WHERE l.id = $1 AND ${visibleSql} FOR UPDATE OF l`, [String(input?.listingId ?? '')])).rows[0];
    if (!l) return { error: 'not_found' };
    if (l.owner_id === guestId) return { error: 'own_listing' };
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:cust:${guestId}`]);
    if (idem) {
      const dup = (await c.query('SELECT id FROM go_orders WHERE customer_id = $1 AND idem_key = $2', [guestId, idem])).rows[0];
      if (dup) return { ok: true, orderId: dup.id, duplicate: true };
    }
    const act = (await c.query(`SELECT count(*)::int AS n FROM go_orders WHERE customer_id = $1 AND kind = 'stay' AND status IN ('requested','awaiting_payment','payment_reported')`, [guestId])).rows[0].n;
    if (act >= 10) return { error: 'too_many_active' };
    const plan = planBooking(l, input); if (plan.error) return plan;
    if (!fits(l, plan.b, await blockingBookings(c, l.id, null))) return { error: 'dates_taken' };
    const id = newId('go');
    const data = { listingId: l.id, listingKind: l.kind, title: l.title, city: l.city, address: l.address, ...plan.b, label: plan.label, totalRub: plan.total,
      contact: { name, phone }, comment: clean(input?.comment, 300) };
    await c.query(`INSERT INTO go_orders (id, kind, customer_id, executor_id, status, price_rub, city, data, idem_key) VALUES ($1,'stay',$2,$3,'requested',$4,$5,$6::jsonb,$7)`,
      [id, guestId, l.owner_id, plan.total, l.city, JSON.stringify(data), idem]);
    await addEvent(c, id, guestId, null, 'requested', 'Заявка на бронирование отправлена');
    return { ok: true, orderId: id, totalRub: plan.total, ownerId: l.owner_id };
  });
  if (created.ok && !created.duplicate) await notifyGo(created.ownerId, 'stay', 'Новая заявка на бронь', 'Подтвердите или отклоните заявку в кабинете.', created.orderId);
  return created;
};

/** Решение владельца по заявке. */
export const hostAct = async (ownerId, orderId, action, reason) => {
  const res = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o || o.kind !== 'stay' || o.executor_id !== ownerId) return { error: 'not_found' };
    if (o.status !== 'requested') return { error: 'bad_state', status: o.status };
    if (action === 'decline') {
      const why = clean(reason, 200); if (why.length < 3) return { error: 'reason_required' };
      await setStatus(c, o, 'cancelled', ownerId, `Владелец отклонил: ${why}`, { cancelled_by: ownerId, cancel_reason: why });
      return { ok: true, guestId: o.customer_id, text: ['Заявка отклонена', why] };
    }
    if (action !== 'confirm') return { error: 'bad_action' };
    const l = (await c.query('SELECT * FROM go_listings WHERE id = $1 FOR UPDATE', [o.data.listingId])).rows[0];
    if (!l) return { error: 'not_found' };
    const role = KIND_ROLE[l.kind];
    if (!(await subscriptionState(ownerId, role)).active) return { error: 'subscription_required' };
    if (!(await payDetailsRaw(ownerId))) return { error: 'pay_details_required' };
    const b = { checkIn: o.data.checkIn, checkOut: o.data.checkOut, roomId: o.data.roomId, departureId: o.data.departureId, people: o.data.people ?? 0 };
    if (!fits(l, b, await blockingBookings(c, l.id, o.id))) return { error: 'dates_taken' };
    const holdUntil = new Date(Date.now() + HOLD_HOURS * 3_600_000).toISOString();
    await setStatus(c, o, 'awaiting_payment', ownerId, 'Бронь подтверждена владельцем — ожидается оплата', { data: JSON.stringify({ ...o.data, holdUntil }) });
    const opened = await openPayment(c, o, o.customer_id, ownerId, o.price_rub);
    if (opened.error) return opened;
    return { ok: true, guestId: o.customer_id, text: ['Бронь подтверждена', `Оплатите владельцу напрямую в течение ${HOLD_HOURS} ч — иначе даты освободятся.`] };
  });
  if (res.ok) await notifyGo(res.guestId, 'stay', res.text[0], res.text[1], orderId);
  return res;
};

export const guestCancel = async (guestId, orderId, reason) => {
  const res = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o || o.kind !== 'stay' || o.customer_id !== guestId) return { error: 'not_found' };
    if (!['requested', 'awaiting_payment'].includes(o.status)) return { error: 'bad_state', status: o.status };
    if (o.status === 'awaiting_payment' && (await payRow(c, o.id))?.state !== 'awaiting') return { error: 'bad_state', status: 'payment_reported' };
    const why = clean(reason, 200) || 'Отменено гостем';
    await setStatus(c, o, 'cancelled', guestId, why, { cancelled_by: guestId, cancel_reason: why });
    return { ok: true, ownerId: o.executor_id };
  });
  if (res.ok) await notifyGo(res.ownerId, 'stay', 'Бронь отменена', 'Гость отменил бронь.', orderId);
  return res;
};

/** Не оплачено в срок — даты освобождаются. */
export const sweepStay = async () => {
  const { rows } = await query(`SELECT id FROM go_orders WHERE kind = 'stay' AND status = 'awaiting_payment' AND (data->>'holdUntil')::timestamptz < now() LIMIT 100`);
  for (const r of rows) {
    const res = await inTx(async (c) => {
      const o = await lockOrder(c, r.id);
      if (!o || o.status !== 'awaiting_payment' || (await payRow(c, o.id))?.state !== 'awaiting') return null;
      await setStatus(c, o, 'cancelled', null, 'Не оплачено в срок', { cancel_reason: 'Не оплачено в срок' });
      return { guest: o.customer_id, owner: o.executor_id };
    }).catch(() => null);
    if (res) { await notifyGo(res.guest, 'stay', 'Бронь отменена', 'Оплата не поступила в срок.', r.id); await notifyGo(res.owner, 'stay', 'Бронь отменена', 'Гость не оплатил в срок.', r.id); }
  }
};

/* ─── Администрация ─────────────────────────────────────────────────── */
export const adminListings = async ({ status, kind, q } = {}) => {
  const args = []; const where = [];
  if (['draft', 'published', 'hidden'].includes(status)) { args.push(status); where.push(`l.status = $${args.length}`); }
  if (KIND_ROLE[kind]) { args.push(kind); where.push(`l.kind = $${args.length}`); }
  if (q) { args.push(`%${clean(q, 40).toLowerCase()}%`); where.push(`(lower(l.title) LIKE $${args.length} OR lower(p.username) LIKE $${args.length})`); }
  const { rows } = await query(
    `SELECT l.*, p.username FROM go_listings l JOIN profiles p ON p.id = l.owner_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.updated_at DESC LIMIT 200`, args);
  return { items: await Promise.all(rows.map(async (r) => ({ id: r.id, kind: r.kind, title: r.title, city: r.city, status: r.status, priceRub: r.price_rub,
    owner: r.username, modNote: r.mod_note || undefined, photos: await photoIds(r.id), descr: r.descr, address: r.address }))) };
};

export const adminModerate = async (adminId, id, action, note) => {
  const why = clean(note, 300);
  if (action === 'hide' && why.length < 3) return { error: 'note_required' };
  const { rows } = await query('SELECT id, owner_id, status, title FROM go_listings WHERE id = $1', [String(id ?? '')]);
  const l = rows[0]; if (!l) return { error: 'not_found' };
  if (action === 'hide') await query(`UPDATE go_listings SET status = 'hidden', mod_note = $2, updated_at = now() WHERE id = $1`, [l.id, why]);
  else if (action === 'restore') { if (l.status !== 'hidden') return { error: 'bad_state' }; await query(`UPDATE go_listings SET status = 'draft', mod_note = '', updated_at = now() WHERE id = $1`, [l.id]); }
  else return { error: 'bad_action' };
  await goLog(adminId, `listing_${action}`, l.id, { note: why });
  await notifyGo(l.owner_id, 'stay', action === 'hide' ? 'Объявление снято администрацией' : 'Объявление возвращено', action === 'hide' ? `«${l.title}»: ${why}` : `«${l.title}» снова можно опубликовать.`, l.id);
  return { ok: true };
};
