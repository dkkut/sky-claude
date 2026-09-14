/**
 * Sky Market / Логистика: курьеры.
 *
 * Раньше курьеры жили в памяти вкладки: список был выдуманный, «заявка
 * на сотрудничество» никуда не уходила, а переписка с курьером
 * существовала только у того, кто её открыл. Теперь всё это на
 * сервере, и правила — тоже здесь.
 *
 * Что решается в этом файле и нигде больше:
 *
 *   · курьерский профиль один на человека, и правит его только он сам;
 *   · геопозицию и признак «на связи» ставит только сам курьер и только
 *     про себя — чужую точку на карте не двигает никто;
 *   · телефон курьера виден продавцу только после принятой заявки:
 *     открытый справочник телефонов — это не каталог курьеров;
 *   · переписка и заявки видны только двум сторонам;
 *   · поручение по заказу выдаёт продавец этого заказа, а не любой
 *     желающий.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { marketText as text, marketInt as int, ORDER_ID_RE } from './market.mjs';
import { pushMarket } from './signal.mjs';

export const COURIER_ID_RE = /^lc-[0-9a-f-]{36}$/;
export const COLLAB_ID_RE = /^lcb-[0-9a-f-]{36}$/;

const VEHICLES = ['foot', 'bike', 'scooter', 'car', 'van'];
const MAX_NAME = 80;
const MAX_BIO = 1000;
const MAX_PHONE = 40;
const MAX_MESSAGE = 2000;
const MAX_PRICE_KOP = 10_000_00;

/** Журнал логистики. Ни телефонов, ни адресов, ни переписки. */
export const logLogi = async (actorId, action, subject, detail = {}) => {
  try {
    await query(
      `INSERT INTO logi_log (actor_id, action, subject, detail)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [actorId ?? null, text(action, 64), subject ? text(subject, 128) : null,
        JSON.stringify(detail ?? {})]);
  } catch {
    /* Журнал не должен ронять то, что он описывает. */
  }
};

/* ─── Выдача наружу ────────────────────────────────────────────────── */

/**
 * Курьер глазами продавца.
 *
 * Телефон отдаётся только тому, с кем курьер согласился работать.
 * Каталог курьеров не должен быть способом собрать телефоны: номер
 * нужен, чтобы позвонить по делу, а дело начинается с принятой заявки.
 */
const toCourier = (row, { withPhone = false } = {}) => ({
  id: row.id,
  profileId: row.profile_id,
  name: row.name,
  phone: withPhone && row.phone_enc ? (decryptContent(row.phone_enc) ?? '') : '',
  cityId: row.city_id,
  district: row.district,
  vehicle: row.vehicle,
  rating: row.rating == null ? 0 : Math.round(Number(row.rating) * 10) / 10,
  reviewCount: Number(row.review_count ?? 0),
  deliveriesCount: Number(row.deliveries ?? 0),
  pricePerDelivery: Number(row.price_kop ?? 0) / 100,
  workFrom: row.work_from,
  workTo: row.work_to,
  online: Boolean(row.online),
  bio: row.bio,
  /*
   * Точка на карте — живое местоположение человека. Показывается,
   * только пока он сам объявил себя на связи: уйдя со связи, курьер
   * перестаёт быть точкой на чужой карте, а не остаётся там, где его
   * застали.
   */
  location: row.online
    ? { lat: Number(row.lat ?? 0), lng: Number(row.lng ?? 0) }
    : { lat: 0, lng: 0 },
  updatedAt: row.updated_at?.toISOString?.() ?? undefined,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

/* ─── Свой курьерский профиль ──────────────────────────────────────── */

const courierRowByProfile = async (profileId) => {
  const { rows } = await query('SELECT * FROM logi_couriers WHERE profile_id = $1', [profileId]);
  return rows[0] ?? null;
};

export const myCourier = async (profileId) => {
  const row = await courierRowByProfile(profileId);
  return row ? toCourier(row, { withPhone: true }) : null;
};

const validCourier = (p = {}) => {
  const name = text(p.name, MAX_NAME);
  if (name.length < 2) return { error: 'bad_name' };
  const price = int(p.pricePerDelivery === undefined ? undefined : Math.round(Number(p.pricePerDelivery) * 100),
    0, MAX_PRICE_KOP);
  return {
    fields: {
      name,
      phone: text(p.phone, MAX_PHONE),
      city_id: text(p.cityId, 60),
      district: text(p.district, 80),
      vehicle: VEHICLES.includes(String(p.vehicle)) ? String(p.vehicle) : 'foot',
      price_kop: price ?? 0,
      work_from: text(p.workFrom, 5) || '09:00',
      work_to: text(p.workTo, 5) || '21:00',
      bio: text(p.bio, MAX_BIO),
    },
  };
};

/**
 * Стать курьером.
 *
 * Профиль один на человека — это ключ в базе, а не проверка в коде:
 * проверка в коде — гонка между двумя нажатиями, а ключ — правило.
 */
export const registerCourier = async (profileId, input = {}) => {
  const checked = validCourier(input);
  if (checked.error) return checked;
  const f = checked.fields;

  const { rows } = await query(
    `INSERT INTO logi_couriers
       (id, profile_id, name, phone_enc, city_id, district, vehicle,
        price_kop, work_from, work_to, bio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (profile_id) DO NOTHING
     RETURNING *`,
    [`lc-${generateId()}`, profileId, f.name, f.phone ? encryptContent(f.phone) : null,
      f.city_id, f.district, f.vehicle, f.price_kop, f.work_from, f.work_to, f.bio]);
  if (!rows[0]) return { error: 'already_courier' };

  await logLogi(profileId, 'courier_registered', rows[0].id);
  return { courier: toCourier(rows[0], { withPhone: true }) };
};

export const updateCourier = async (profileId, patch = {}) => {
  const row = await courierRowByProfile(profileId);
  if (!row) return { error: 'not_a_courier' };

  const checked = validCourier({ ...toCourier(row, { withPhone: true }), ...patch });
  if (checked.error) return checked;
  const f = checked.fields;

  const { rows } = await query(
    `UPDATE logi_couriers
        SET name = $2, phone_enc = $3, city_id = $4, district = $5, vehicle = $6,
            price_kop = $7, work_from = $8, work_to = $9, bio = $10, updated_at = now()
      WHERE profile_id = $1 RETURNING *`,
    [profileId, f.name, f.phone ? encryptContent(f.phone) : null, f.city_id, f.district,
      f.vehicle, f.price_kop, f.work_from, f.work_to, f.bio]);
  await logLogi(profileId, 'courier_updated', rows[0].id);
  return { courier: toCourier(rows[0], { withPhone: true }) };
};

/**
 * «На связи» и точка на карте.
 *
 * Ставит только сам курьер и только про себя. Присланного courierId
 * здесь не читается: он берётся из профиля того, кто спрашивает, —
 * иначе любой желающий двигал бы чужую метку по карте.
 */
export const setCourierPresence = async (profileId, { online, lat, lng } = {}) => {
  const row = await courierRowByProfile(profileId);
  if (!row) return { error: 'not_a_courier' };

  const nextOnline = online === undefined ? row.online : online === true;
  const okLat = Number.isFinite(Number(lat)) && Math.abs(Number(lat)) <= 90;
  const okLng = Number.isFinite(Number(lng)) && Math.abs(Number(lng)) <= 180;

  const { rows } = await query(
    `UPDATE logi_couriers
        SET online = $2,
            lat = COALESCE($3, lat),
            lng = COALESCE($4, lng),
            updated_at = now()
      WHERE profile_id = $1 RETURNING *`,
    [profileId, nextOnline, okLat ? Number(lat) : null, okLng ? Number(lng) : null]);
  return { courier: toCourier(rows[0], { withPhone: true }) };
};

/* ─── Каталог курьеров ─────────────────────────────────────────────── */

/**
 * Список курьеров.
 *
 * Телефоны здесь не отдаются никому: их видно только в карточке того
 * курьера, с которым есть принятая заявка.
 */
export const listCouriers = async (viewerId, { cityId, district, vehicle, online, q, limit } = {}) => {
  const lim = int(limit, 1, 200) ?? 100;
  const args = [viewerId ?? ''];
  const where = [];

  if (cityId) { args.push(text(cityId, 60)); where.push(`c.city_id = $${args.length}`); }
  if (district) { args.push(text(district, 80)); where.push(`c.district = $${args.length}`); }
  if (vehicle && VEHICLES.includes(String(vehicle))) {
    args.push(String(vehicle)); where.push(`c.vehicle = $${args.length}`);
  }
  if (online === true) where.push('c.online');

  const needle = text(q, 80).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`lower(c.name) LIKE $${args.length} ESCAPE '\\'`);
  }

  args.push(lim);
  const { rows } = await query(
    `SELECT c.*,
            EXISTS (SELECT 1 FROM logi_courier_favorites f
                     WHERE f.courier_id = c.id AND f.seller_id = $1) AS favorite
       FROM logi_couriers c
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.online DESC, c.rating DESC NULLS LAST, c.created_at DESC
      LIMIT $${args.length}`,
    args);
  return rows.map((r) => ({ ...toCourier(r), favorite: r.favorite === true }));
};

/**
 * Карточка курьера.
 *
 * Телефон появляется, только если у спрашивающего есть принятая заявка
 * на сотрудничество с этим курьером, — или если спрашивает сам курьер.
 */
export const readCourier = async (courierId, viewerId) => {
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return null;
  const { rows } = await query(
    `SELECT c.*,
            EXISTS (SELECT 1 FROM logi_collabs cb
                     WHERE cb.courier_id = c.id AND cb.seller_id = $2
                       AND cb.status = 'accepted') AS working,
            EXISTS (SELECT 1 FROM logi_courier_favorites f
                     WHERE f.courier_id = c.id AND f.seller_id = $2) AS favorite
       FROM logi_couriers c WHERE c.id = $1`,
    [courierId, viewerId ?? '']);
  const row = rows[0];
  if (!row) return null;
  const mine = row.profile_id === viewerId;
  return {
    ...toCourier(row, { withPhone: mine || row.working === true }),
    favorite: row.favorite === true,
    working: row.working === true,
  };
};

export const setCourierFavorite = async (sellerId, courierId, on) => {
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return { error: 'not_found' };
  if (on) {
    await query(
      'INSERT INTO logi_courier_favorites (seller_id, courier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [sellerId, courierId]);
  } else {
    await query('DELETE FROM logi_courier_favorites WHERE seller_id = $1 AND courier_id = $2',
      [sellerId, courierId]);
  }
  return { ok: true };
};

/* ─── Сотрудничество ───────────────────────────────────────────────── */

const toCollab = (row) => ({
  id: row.id,
  courierId: row.courier_id,
  sellerId: row.seller_id,
  message: row.message_enc ? (decryptContent(row.message_enc) ?? '') : '',
  status: row.status,
  courierName: row.courier_name ?? undefined,
  sellerName: row.seller_name ?? undefined,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  respondedAt: row.responded_at?.toISOString?.() ?? undefined,
});

/** Заявку шлёт продавец. Курьер сам себе её не отправляет. */
export const sendCollab = async (sellerId, courierId, message = '') => {
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return { error: 'not_found' };
  const { rows: c } = await query('SELECT profile_id FROM logi_couriers WHERE id = $1', [courierId]);
  if (!c[0]) return { error: 'not_found' };
  if (c[0].profile_id === sellerId) return { error: 'self_collab' };

  const { rows } = await query(
    `INSERT INTO logi_collabs (id, courier_id, seller_id, message_enc)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [`lcb-${generateId()}`, courierId, sellerId,
      text(message, MAX_MESSAGE) ? encryptContent(text(message, MAX_MESSAGE)) : null]);
  if (!rows[0]) return { error: 'already_asked' };

  pushMarket([c[0].profile_id], {
    type: 'logi-collab',
    payload: { collabId: rows[0].id, status: 'pending' },
  });
  await logLogi(sellerId, 'collab_sent', rows[0].id);
  return { collab: toCollab(rows[0]) };
};

/**
 * Ответ на заявку.
 *
 * Принимает и отклоняет только курьер — это его согласие работать.
 * Завершить сотрудничество может любая из двух сторон: держать человека
 * в чужом списке против воли нельзя.
 */
export const respondCollab = async (actorId, collabId, status) => {
  if (!COLLAB_ID_RE.test(String(collabId ?? ''))) return { error: 'not_found' };
  if (!['accepted', 'declined', 'ended'].includes(String(status))) return { error: 'bad_status' };

  const { rows } = await query(
    `SELECT cb.*, c.profile_id AS courier_profile
       FROM logi_collabs cb JOIN logi_couriers c ON c.id = cb.courier_id
      WHERE cb.id = $1`, [collabId]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };

  const isCourier = row.courier_profile === actorId;
  const isSeller = row.seller_id === actorId;
  if (!isCourier && !isSeller) {
    await logLogi(actorId, 'collab_denied', collabId);
    return { error: 'not_found' };
  }
  /* Согласие на работу даёт только курьер. */
  if (status !== 'ended' && !isCourier) return { error: 'not_allowed' };
  if (status === 'ended' && row.status !== 'accepted') return { error: 'wrong_state' };
  if (status !== 'ended' && row.status !== 'pending') return { error: 'wrong_state' };

  const { rows: upd } = await query(
    `UPDATE logi_collabs SET status = $2, responded_at = now() WHERE id = $1 RETURNING *`,
    [collabId, status]);

  pushMarket([row.seller_id, row.courier_profile].filter((u) => u !== actorId), {
    type: 'logi-collab', payload: { collabId, status },
  });
  await logLogi(actorId, 'collab_answered', collabId, { status });
  return { collab: toCollab(upd[0]) };
};

/** Мои заявки: и как продавца, и как курьера. */
export const listCollabs = async (profileId) => {
  const { rows } = await query(
    `SELECT cb.*, c.name AS courier_name, p.name AS seller_name
       FROM logi_collabs cb
       JOIN logi_couriers c ON c.id = cb.courier_id
       JOIN profiles p ON p.id = cb.seller_id
      WHERE cb.seller_id = $1 OR c.profile_id = $1
      ORDER BY cb.created_at DESC LIMIT 200`, [profileId]);
  return rows.map(toCollab);
};

/** Есть ли живое сотрудничество — этим правом открывается переписка. */
const collabBetween = async (courierId, sellerId) => {
  const { rows } = await query(
    `SELECT status FROM logi_collabs
      WHERE courier_id = $1 AND seller_id = $2 AND status IN ('pending','accepted')`,
    [courierId, sellerId]);
  return rows[0]?.status ?? null;
};

/* ─── Переписка с курьером ─────────────────────────────────────────── */

const toCourierMessage = (row) => ({
  id: row.id,
  courierId: row.courier_id,
  sellerId: row.seller_id,
  from: row.author_role,
  text: decryptContent(row.body_enc) ?? '',
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

/**
 * Кто с кем разговаривает.
 *
 * Стороны выводятся из базы: либо спрашивающий — этот курьер, либо он
 * продавец, который к этому курьеру обращался. Присланных ролей здесь
 * не читается.
 */
const chatSides = async (courierId, actorId) => {
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return null;
  const { rows } = await query('SELECT profile_id FROM logi_couriers WHERE id = $1', [courierId]);
  if (!rows[0]) return null;
  if (rows[0].profile_id === actorId) return { role: 'courier', courierProfile: actorId };
  const live = await collabBetween(courierId, actorId);
  if (!live) return null;
  return { role: 'seller', courierProfile: rows[0].profile_id };
};

export const courierChat = async (courierId, actorId, sellerId) => {
  const sides = await chatSides(courierId, actorId);
  if (!sides) return null;
  /* Курьер разговаривает с конкретным продавцом, продавец — сам с
     собой в роли продавца. */
  const seller = sides.role === 'courier' ? String(sellerId ?? '') : actorId;
  if (!seller) return [];
  if (sides.role === 'courier' && !(await collabBetween(courierId, seller))) return null;

  const { rows } = await query(
    `SELECT * FROM logi_courier_messages
      WHERE courier_id = $1 AND seller_id = $2
      ORDER BY created_at LIMIT 300`, [courierId, seller]);
  await query(
    `UPDATE logi_courier_messages SET read_at = now()
      WHERE courier_id = $1 AND seller_id = $2 AND author_role <> $3 AND read_at IS NULL`,
    [courierId, seller, sides.role]);
  return rows.map(toCourierMessage);
};

export const sendCourierMessage = async (courierId, actorId, body, sellerId) => {
  const sides = await chatSides(courierId, actorId);
  if (!sides) return { error: 'not_found' };
  const seller = sides.role === 'courier' ? String(sellerId ?? '') : actorId;
  if (!seller) return { error: 'not_found' };
  if (sides.role === 'courier' && !(await collabBetween(courierId, seller))) return { error: 'not_found' };

  const message = text(body, MAX_MESSAGE);
  if (!message) return { error: 'empty_message' };

  const { rows } = await query(
    `INSERT INTO logi_courier_messages (id, courier_id, seller_id, author_role, body_enc)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [`lcm-${generateId()}`, courierId, seller, sides.role, encryptContent(message)]);

  const other = sides.role === 'courier' ? seller : sides.courierProfile;
  pushMarket([other], {
    type: 'logi-courier-message',
    payload: { courierId, sellerId: seller, message: toCourierMessage(rows[0]) },
  });
  return { message: toCourierMessage(rows[0]) };
};

/* ─── Поручения курьеру ────────────────────────────────────────────── */

const toAssignment = (row) => ({
  id: row.id,
  orderId: row.order_id,
  courierId: row.courier_id,
  sellerId: row.seller_id,
  status: row.status,
  assignedAt: row.assigned_at?.toISOString?.() ?? undefined,
  updatedAt: row.updated_at?.toISOString?.() ?? undefined,
});

/**
 * Отдать заказ курьеру.
 *
 * Отдаёт продавец этого заказа — проверяется по строке заказа, а не по
 * присланному sellerId. Курьер должен быть тем, с кем есть принятая
 * заявка: раздавать чужие заказы незнакомым людям нельзя.
 */
export const assignCourier = async (sellerId, orderId, courierId) => {
  if (!ORDER_ID_RE.test(String(orderId ?? ''))) return { error: 'not_found' };
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return { error: 'not_found' };

  const { rows: o } = await query(
    'SELECT id, seller_id, status FROM market_orders WHERE id = $1', [orderId]);
  if (!o[0] || o[0].seller_id !== sellerId) {
    await logLogi(sellerId, 'assign_denied', orderId);
    return { error: 'not_found' };
  }
  if (['completed', 'cancelled'].includes(o[0].status)) return { error: 'order_closed' };

  const live = await collabBetween(courierId, sellerId);
  if (live !== 'accepted') return { error: 'no_collab' };

  const { rows: c } = await query('SELECT profile_id FROM logi_couriers WHERE id = $1', [courierId]);
  const { rows } = await query(
    `INSERT INTO logi_courier_assignments (id, order_id, courier_id, seller_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (order_id) DO UPDATE
       SET courier_id = EXCLUDED.courier_id, status = 'assigned', updated_at = now()
     WHERE logi_courier_assignments.status IN ('assigned', 'cancelled')
     RETURNING *`,
    [`lca-${generateId()}`, orderId, courierId, sellerId]);
  if (!rows[0]) return { error: 'already_in_progress' };

  await notifyLogi(c[0].profile_id, courierId, orderId, 'assigned', 'Вам поручена доставка');
  await logLogi(sellerId, 'courier_assigned', orderId, { courierId });
  return { assignment: toAssignment(rows[0]) };
};

/**
 * Курьер двигает своё поручение.
 *
 * Только тот курьер, которому поручили. Отменить может и продавец —
 * это его заказ.
 */
export const setAssignmentStatus = async (actorId, assignmentId, status) => {
  if (!['picked_up', 'delivered', 'cancelled'].includes(String(status))) return { error: 'bad_status' };

  const { rows } = await query(
    `SELECT a.*, c.profile_id AS courier_profile
       FROM logi_courier_assignments a JOIN logi_couriers c ON c.id = a.courier_id
      WHERE a.id = $1`, [String(assignmentId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };

  const byCourier = row.courier_profile === actorId;
  const bySeller = row.seller_id === actorId;
  if (!byCourier && !bySeller) {
    await logLogi(actorId, 'assignment_denied', assignmentId);
    return { error: 'not_found' };
  }
  if (status !== 'cancelled' && !byCourier) return { error: 'not_allowed' };
  if (['delivered', 'cancelled'].includes(row.status)) return { error: 'already_closed' };

  const { rows: upd } = await query(
    'UPDATE logi_courier_assignments SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [assignmentId, status]);

  if (status === 'delivered') {
    await query('UPDATE logi_couriers SET deliveries = deliveries + 1 WHERE id = $1', [row.courier_id]);
  }
  const target = byCourier ? row.seller_id : row.courier_profile;
  await notifyLogi(target, row.courier_id, row.order_id, status,
    { picked_up: 'Курьер забрал заказ', delivered: 'Курьер доставил заказ',
      cancelled: 'Доставка отменена' }[status]);
  await logLogi(actorId, 'assignment_moved', assignmentId, { status });
  return { assignment: toAssignment(upd[0]) };
};

export const listAssignments = async (profileId, { as = 'seller' } = {}) => {
  const { rows } = await query(
    as === 'courier'
      ? `SELECT a.* FROM logi_courier_assignments a
           JOIN logi_couriers c ON c.id = a.courier_id
          WHERE c.profile_id = $1 ORDER BY a.assigned_at DESC LIMIT 200`
      : `SELECT a.* FROM logi_courier_assignments a
          WHERE a.seller_id = $1 ORDER BY a.assigned_at DESC LIMIT 200`,
    [profileId]);
  return rows.map(toAssignment);
};

/* ─── Уведомления логистики ────────────────────────────────────────── */

export const notifyLogi = async (userId, courierId, orderId, kind, textLine) => {
  if (!userId) return;
  const id = `lcn-${generateId()}`;
  await query(
    `INSERT INTO logi_courier_notifications (id, user_id, courier_id, order_id, kind, text)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, userId, courierId ?? null, orderId ?? null, text(kind, 40), text(textLine, 200)]);
  pushMarket([userId], {
    type: 'logi-notification',
    payload: { id, kind, text: text(textLine, 200), orderId: orderId ?? null },
  });
};

export const listLogiNotifications = async (userId, { limit } = {}) => {
  const lim = int(limit, 1, 100) ?? 50;
  const { rows } = await query(
    `SELECT id, courier_id, order_id, kind, text, read_at, created_at
       FROM logi_courier_notifications WHERE user_id = $1
      ORDER BY created_at DESC LIMIT $2`, [userId, lim]);
  return rows.map((r) => ({
    id: r.id,
    courierId: r.courier_id,
    orderId: r.order_id,
    type: r.kind,
    text: r.text,
    read: Boolean(r.read_at),
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};

export const readLogiNotification = async (userId, id) => {
  const { rowCount } = await query(
    'UPDATE logi_courier_notifications SET read_at = now() WHERE id = $1 AND user_id = $2',
    [String(id ?? ''), userId]);
  return rowCount > 0;
};

/* ─── Отзывы о курьере ─────────────────────────────────────────────── */

/**
 * Отзыв пишет продавец, который с этим курьером работал.
 *
 * Один отзыв от продавца на курьера — ключ в базе. Без принятой заявки
 * отзыв не пишется: иначе рейтинг курьера правит любой прохожий.
 */
export const addCourierReview = async (sellerId, courierId, rating, body = '') => {
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return { error: 'not_found' };
  const stars = int(rating, 1, 5);
  if (!stars) return { error: 'bad_rating' };

  const { rows: worked } = await query(
    `SELECT 1 FROM logi_collabs
      WHERE courier_id = $1 AND seller_id = $2 AND status IN ('accepted', 'ended')`,
    [courierId, sellerId]);
  if (!worked[0]) return { error: 'no_collab' };

  const { rows } = await query(
    `INSERT INTO logi_courier_reviews (id, courier_id, seller_id, rating, body_enc)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (courier_id, seller_id) DO UPDATE
       SET rating = EXCLUDED.rating, body_enc = EXCLUDED.body_enc, created_at = now()
     RETURNING id`,
    [`lcr-${generateId()}`, courierId, sellerId, stars,
      text(body, MAX_MESSAGE) ? encryptContent(text(body, MAX_MESSAGE)) : null]);

  await query(
    `UPDATE logi_couriers c
        SET rating = r.avg, review_count = r.n, updated_at = now()
       FROM (SELECT avg(rating)::numeric(3,2) AS avg, count(*)::int AS n
               FROM logi_courier_reviews WHERE courier_id = $1) r
      WHERE c.id = $1`, [courierId]);
  await logLogi(sellerId, 'courier_review', courierId, { rating: stars });
  return { ok: true, reviewId: rows[0].id };
};

export const listCourierReviews = async (courierId, { limit } = {}) => {
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return [];
  const lim = int(limit, 1, 100) ?? 50;
  const { rows } = await query(
    `SELECT r.id, r.rating, r.body_enc, r.created_at, r.seller_id, p.name AS seller_name
       FROM logi_courier_reviews r JOIN profiles p ON p.id = r.seller_id
      WHERE r.courier_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
    [courierId, lim]);
  return rows.map((r) => ({
    id: r.id,
    courierId,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    rating: Number(r.rating),
    text: r.body_enc ? (decryptContent(r.body_enc) ?? '') : '',
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};

export { pool };
