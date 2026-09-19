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
import { can } from './admin.mjs';
import { profileAge, myVerification as myPassportVerification, MIN_COURIER_AGE } from './courierverify.mjs';

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
  // Статус допуска решает администратор (courier_verifications +
  // decideCourierApplication) — не сам курьер и не клиент.
  status: row.status,
  statusReason: row.status_reason ?? undefined,
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
 *
 * Выйти на связь (online=true) можно только когда все условия допуска
 * выполнены прямо сейчас — не были выполнены когда-то при подаче
 * заявки, а именно сейчас: статус approved, паспорт verified, возраст
 * ≥16. Проверяется заново при каждом включении, а не один раз и
 * навсегда, — потому что дата рождения или проверка паспорта могли
 * измениться (см. courierverify.mjs::setDateOfBirth).
 */
export const setCourierPresence = async (profileId, { online, lat, lng } = {}) => {
  const row = await courierRowByProfile(profileId);
  if (!row) return { error: 'not_a_courier' };

  const nextOnline = online === undefined ? row.online : online === true;
  if (nextOnline && !row.online) {
    if (row.status === 'suspended') return { error: 'suspended' };
    if (row.status !== 'approved') return { error: 'not_approved' };
    const age = await profileAge(profileId);
    if (age === null || age < MIN_COURIER_AGE) return { error: 'underage' };
    const verification = await myPassportVerification(profileId);
    if (verification?.status !== 'verified') return { error: 'passport_unverified' };
  }
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

/* ─── Допуск курьера: решает администратор ───────────────────────────── */

/**
 * Одобрить/отклонить заявку курьера.
 *
 * Право 'logistics', простой can() — как и решение по проверке
 * паспорта (courierverify.mjs::decideVerification) и по любой другой
 * модерации в проекте: это не выдача денег и не админских прав.
 *
 * Одобрить можно, только если паспорт уже verified и возраст ≥16 —
 * тем же способом пересчитанный заново, а не унаследованный из заявки.
 */
export const decideCourierApplication = async (adminId, courierId, approve, reason = '') => {
  if (!(await can(adminId, 'logistics'))) return { error: 'not_allowed' };
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return { error: 'not_found' };

  const { rows: cur } = await query(
    `SELECT * FROM logi_couriers WHERE id = $1 AND status = 'pending'`, [courierId]);
  const row = cur[0];
  if (!row) return { error: 'not_found' };

  if (approve) {
    const age = await profileAge(row.profile_id);
    if (age === null || age < MIN_COURIER_AGE) return { error: 'underage' };
    const verification = await myPassportVerification(row.profile_id);
    if (verification?.status !== 'verified') return { error: 'passport_unverified' };
  }
  const status = approve ? 'approved' : 'rejected';
  const statusReason = approve ? null : (text(reason, 300) || 'Отклонено');

  const { rows: upd } = await query(
    `UPDATE logi_couriers SET status = $2, status_reason = $3, status_by = $4, status_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [courierId, status, statusReason, adminId]);
  if (!upd[0]) return { error: 'not_found' };

  await notifyLogi(row.profile_id, courierId, null, status,
    approve ? 'Заявка курьера одобрена — можно выходить на связь' : `Заявка курьера отклонена: ${statusReason}`);
  await logLogi(adminId, approve ? 'courier_approved' : 'courier_rejected', courierId, { reason: statusReason });
  return { courier: toCourier(upd[0], { withPhone: true }) };
};

/**
 * Приостановить/восстановить уже одобренного курьера.
 *
 * Приостановленный курьер не может выйти на связь (setCourierPresence
 * проверяет status) и не получает новых заказов из пула, но уже
 * взятые поручения решаются по обычным правилам — блокировка не
 * отменяет то, что уже делается.
 */
export const setCourierAdminStatus = async (adminId, courierId, status, reason = '') => {
  if (!(await can(adminId, 'logistics'))) return { error: 'not_allowed' };
  if (!COURIER_ID_RE.test(String(courierId ?? ''))) return { error: 'not_found' };
  if (!['suspended', 'approved'].includes(String(status))) return { error: 'bad_status' };

  const fromStatus = status === 'suspended' ? 'approved' : 'suspended';
  const { rows } = await query(
    `UPDATE logi_couriers SET status = $2, status_reason = $3, status_by = $4, status_at = now(),
            online = CASE WHEN $2 = 'suspended' THEN FALSE ELSE online END, updated_at = now()
      WHERE id = $1 AND status = $5 RETURNING *`,
    [courierId, status, text(reason, 300) || null, adminId, fromStatus]);
  if (!rows[0]) return { error: 'wrong_state' };

  await notifyLogi(rows[0].profile_id, courierId, null, status,
    status === 'suspended' ? `Работа приостановлена: ${text(reason, 300) || 'без причины'}` : 'Работа возобновлена');
  await logLogi(adminId, status === 'suspended' ? 'courier_suspended' : 'courier_restored', courierId, { reason });
  return { courier: toCourier(rows[0], { withPhone: true }) };
};

/** Очередь заявок курьеров для админ-панели. */
export const adminListCouriers = async (adminId, { status, q, limit } = {}) => {
  if (!(await can(adminId, 'logistics'))) return null;
  const lim = int(limit, 1, 200) ?? 100;
  const args = [];
  const where = [];
  if (status) { args.push(text(status, 20)); where.push(`c.status = $${args.length}`); }
  const needle = text(q, 80).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`lower(c.name) LIKE $${args.length} ESCAPE '\\'`);
  }
  args.push(lim);
  const { rows } = await query(
    `SELECT c.*, p.date_of_birth
       FROM logi_couriers c JOIN profiles p ON p.id = c.profile_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (c.status = 'pending') DESC, c.created_at DESC
      LIMIT $${args.length}`, args);
  return rows.map((r) => ({
    ...toCourier(r, { withPhone: true }),
    age: r.date_of_birth ? Math.floor((Date.now() - new Date(r.date_of_birth).getTime()) / 31557600000) : null,
  }));
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
  courierId: row.courier_id ?? null,
  sellerId: row.seller_id,
  status: row.status,
  cityId: row.city_id ?? '',
  district: row.district ?? '',
  price: Number(row.price_kop ?? 0) / 100,
  problemReason: row.problem_reason ?? undefined,
  ticketId: row.ticket_id ?? undefined,
  assignedAt: row.assigned_at?.toISOString?.() ?? undefined,
  pickedUpAt: row.picked_up_at?.toISOString?.() ?? undefined,
  deliveredAt: row.delivered_at?.toISOString?.() ?? undefined,
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

  const { rows: c } = await query(
    'SELECT profile_id, price_kop, city_id, district, status FROM logi_couriers WHERE id = $1', [courierId]);
  if (!c[0]) return { error: 'not_found' };
  if (c[0].status !== 'approved') return { error: 'courier_not_approved' };

  const { rows } = await query(
    `INSERT INTO logi_courier_assignments (id, order_id, courier_id, seller_id, city_id, district, price_kop)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (order_id) DO UPDATE
       SET courier_id = EXCLUDED.courier_id, status = 'assigned', updated_at = now()
     WHERE logi_courier_assignments.status IN ('open', 'assigned', 'cancelled')
     RETURNING *`,
    [`lca-${generateId()}`, orderId, courierId, sellerId, c[0].city_id, c[0].district, c[0].price_kop]);
  if (!rows[0]) return { error: 'already_in_progress' };

  await notifyLogi(c[0].profile_id, courierId, orderId, 'assigned', 'Вам поручена доставка');
  await logLogi(sellerId, 'courier_assigned', orderId, { courierId });
  return { assignment: toAssignment(rows[0]) };
};

/**
 * Отменить поручение. Курьер или продавец — это их сделка.
 *
 * «Забрал» и «доставил» здесь больше не решаются: это подтверждает не
 * кнопка, а код/QR у второй стороны (courierdelivery.mjs::
 * confirmPickup/confirmDelivery) — иначе курьер сам себе засчитывал бы
 * доставку без единого подтверждения со стороны продавца или
 * покупателя, а именно так раньше и было.
 */
export const setAssignmentStatus = async (actorId, assignmentId, status) => {
  if (status !== 'cancelled') return { error: 'bad_status' };

  const { rows } = await query(
    `SELECT a.*, c.profile_id AS courier_profile
       FROM logi_courier_assignments a LEFT JOIN logi_couriers c ON c.id = a.courier_id
      WHERE a.id = $1`, [String(assignmentId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };

  const byCourier = row.courier_profile === actorId;
  const bySeller = row.seller_id === actorId;
  if (!byCourier && !bySeller) {
    await logLogi(actorId, 'assignment_denied', assignmentId);
    return { error: 'not_found' };
  }
  if (['delivered', 'cancelled'].includes(row.status)) return { error: 'already_closed' };

  const { rows: upd } = await query(
    `UPDATE logi_courier_assignments SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
    [assignmentId]);

  const target = byCourier ? row.seller_id : row.courier_profile;
  if (target) await notifyLogi(target, row.courier_id, row.order_id, 'cancelled', 'Доставка отменена');
  await logLogi(actorId, 'assignment_cancelled', assignmentId);
  return { assignment: toAssignment(upd[0]) };
};

/**
 * Курьер сообщает о проблеме с доставкой — не отменяет заказ сам по
 * себе, а переводит поручение в 'problem' и заводит обращение в
 * существующую поддержку (server/support.mjs): дальше решает
 * администратор, а не курьер и не клиент.
 */
export const reportAssignmentProblem = async (actorId, assignmentId, reason) => {
  const { createTicket } = await import('./support.mjs');
  const REASONS = {
    no_answer: 'Получатель не отвечает', not_home: 'Получателя нет на месте',
    bad_address: 'Неверный адрес', cannot_handoff: 'Невозможно передать заказ',
    damaged: 'Повреждение отправления', other: 'Другая причина',
  };
  const label = REASONS[String(reason)] ?? REASONS.other;

  const { rows } = await query(
    `SELECT a.*, c.profile_id AS courier_profile
       FROM logi_courier_assignments a JOIN logi_couriers c ON c.id = a.courier_id
      WHERE a.id = $1`, [String(assignmentId ?? '')]);
  const row = rows[0];
  if (!row || row.courier_profile !== actorId) return { error: 'not_found' };
  if (['delivered', 'cancelled'].includes(row.status)) return { error: 'already_closed' };

  const { ticket } = await createTicket(actorId, {
    subject: `Проблема с доставкой заказа ${row.order_id}`,
    body: `Курьер сообщил о проблеме с заказом ${row.order_id}: ${label}`,
    kind: 'report',
  });

  const { rows: upd } = await query(
    `UPDATE logi_courier_assignments SET status = 'problem', problem_reason = $2, ticket_id = $3, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [assignmentId, label, ticket?.id ?? null]);

  await notifyLogi(row.seller_id, row.courier_id, row.order_id, 'problem', `Проблема с доставкой: ${label}`);
  await logLogi(actorId, 'assignment_problem', assignmentId, { reason: label });
  return { assignment: toAssignment(upd[0]), ticketId: ticket?.id };
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

/* ─── Пул заказов: продавец выставляет, курьер берёт сам ─────────────── */

/**
 * Выставить заказ в пул — вместо того, чтобы звать конкретного
 * курьера. Любой одобренный курьер в этом городе/районе сможет взять
 * его сам (takeOrder). Цену за доставку называет продавец здесь же —
 * так же, как в logi_couriers.price_kop называет её курьер в своём
 * профиле, только на этот один заказ.
 */
export const postOrderToPool = async (sellerId, orderId, { priceKop, cityId, district } = {}) => {
  if (!ORDER_ID_RE.test(String(orderId ?? ''))) return { error: 'not_found' };
  const { rows: o } = await query('SELECT id, seller_id, status FROM market_orders WHERE id = $1', [orderId]);
  if (!o[0] || o[0].seller_id !== sellerId) return { error: 'not_found' };
  if (['completed', 'cancelled'].includes(o[0].status)) return { error: 'order_closed' };

  const price = int(priceKop, 0, 10_000_00) ?? 0;
  const { rows } = await query(
    `INSERT INTO logi_courier_assignments (id, order_id, courier_id, seller_id, status, city_id, district, price_kop)
     VALUES ($1,$2,NULL,$3,'open',$4,$5,$6)
     ON CONFLICT (order_id) DO UPDATE
       SET courier_id = NULL, status = 'open', city_id = EXCLUDED.city_id,
           district = EXCLUDED.district, price_kop = EXCLUDED.price_kop, updated_at = now()
     WHERE logi_courier_assignments.status IN ('cancelled')
     RETURNING *`,
    [`lca-${generateId()}`, orderId, sellerId, text(cityId, 60), text(district, 80), price]);
  if (!rows[0]) return { error: 'already_in_progress' };

  await logLogi(sellerId, 'order_posted_to_pool', orderId);
  return { assignment: toAssignment(rows[0]) };
};

export const cancelPoolPosting = async (sellerId, orderId) => {
  const { rows } = await query(
    `UPDATE logi_courier_assignments SET status = 'cancelled', updated_at = now()
      WHERE order_id = $1 AND seller_id = $2 AND status = 'open' RETURNING *`,
    [String(orderId ?? ''), sellerId]);
  if (!rows[0]) return { error: 'not_found' };
  await logLogi(sellerId, 'pool_posting_cancelled', orderId);
  return { assignment: toAssignment(rows[0]) };
};

/**
 * Заказы, доступные курьеру: открытые, в его городе/районе, ещё не
 * взятые. Фильтрация — здесь, на сервере: курьер не видит пул целиком,
 * только то, что подходит ему.
 */
export const listOpenOrders = async (profileId, { limit } = {}) => {
  const row = await courierRowByProfile(profileId);
  if (!row) return { error: 'not_a_courier' };
  if (row.status !== 'approved') return { error: 'not_approved' };

  const lim = int(limit, 1, 100) ?? 50;
  const { rows } = await query(
    `SELECT a.*, mo.title_snap, mo.total_kop
       FROM logi_courier_assignments a JOIN market_orders mo ON mo.id = a.order_id
      WHERE a.status = 'open' AND a.city_id = $1
        AND ($2 = '' OR a.district = $2)
      ORDER BY a.assigned_at DESC LIMIT $3`,
    [row.city_id, row.district, lim]);
  return rows.map((r) => ({ ...toAssignment(r), orderTitle: r.title_snap, orderTotal: Number(r.total_kop) / 100 }));
};

/**
 * Взять заказ из пула самому.
 *
 * Гонку двух одновременных «взять» решает условное обновление
 * (WHERE status='open' AND courier_id IS NULL) — тот же приём, что и
 * во всём остальном проекте с гонками за одну строку: выиграет ровно
 * один UPDATE, второй получит already_taken.
 */
export const takeOrder = async (profileId, orderId) => {
  if (!ORDER_ID_RE.test(String(orderId ?? ''))) return { error: 'not_found' };
  const row = await courierRowByProfile(profileId);
  if (!row) return { error: 'not_a_courier' };
  if (row.status !== 'approved') return { error: 'not_approved' };
  if (!row.online) return { error: 'not_online' };

  const { rows } = await query(
    `UPDATE logi_courier_assignments SET courier_id = $2, status = 'assigned', updated_at = now()
      WHERE order_id = $1 AND status = 'open' AND courier_id IS NULL
      RETURNING *`,
    [orderId, row.id]);
  if (!rows[0]) return { error: 'already_taken' };

  await notifyLogi(rows[0].seller_id, row.id, orderId, 'assigned', 'Курьер взял заказ из пула');
  await logLogi(profileId, 'order_taken', orderId);
  return { assignment: toAssignment(rows[0]) };
};

/* ─── Статистика и заработок курьера ─────────────────────────────────── */

export const courierStats = async (profileId) => {
  const row = await courierRowByProfile(profileId);
  if (!row) return null;
  const { rows: agg } = await query(
    `SELECT
        count(*) FILTER (WHERE a.status = 'delivered')::int AS delivered,
        count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE a.status IN ('assigned','picked_up','in_transit'))::int AS active
       FROM logi_courier_assignments a WHERE a.courier_id = $1`, [row.id]);
  const { rows: earn } = await query(
    `SELECT coalesce(sum(amount_kop), 0)::bigint AS total FROM courier_earnings WHERE courier_id = $1`,
    [row.id]);
  return {
    deliveredCount: agg[0]?.delivered ?? 0,
    cancelledCount: agg[0]?.cancelled ?? 0,
    activeCount: agg[0]?.active ?? 0,
    totalEarned: Number(earn[0]?.total ?? 0) / 100,
    rating: row.rating == null ? 0 : Math.round(Number(row.rating) * 10) / 10,
  };
};

export const courierEarningsHistory = async (profileId, { limit } = {}) => {
  const row = await courierRowByProfile(profileId);
  if (!row) return [];
  const lim = int(limit, 1, 200) ?? 100;
  const { rows } = await query(
    `SELECT e.*, mo.title_snap FROM courier_earnings e
       JOIN market_orders mo ON mo.id = e.order_id
      WHERE e.courier_id = $1 ORDER BY e.created_at DESC LIMIT $2`, [row.id, lim]);
  return rows.map((r) => ({
    id: r.id, orderId: r.order_id, orderTitle: r.title_snap,
    amount: Number(r.amount_kop) / 100, createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
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
