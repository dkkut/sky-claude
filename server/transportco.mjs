/**
 * Sky Market / Логистика: транспортные компании.
 *
 * Компания, её парк, её команда, её заказы и биржа доставок. Раньше всё
 * это жило в памяти вкладки: «биржа» показывала выдуманные заказы, а
 * чужую машину можно было отправить в рейс, просто нарисовав кнопку.
 *
 * Что решается здесь и только здесь:
 *
 *   · компания одна на человека, и владелец у неё один;
 *   · машину, водителя и тариф правит только владелец своей компании —
 *     принадлежность проверяется по базе, а не по присланному id;
 *   · заказ на доставку создаёт продавец, берёт компания, а цену
 *     утверждает снова продавец: деньги за доставку идут мимо Sky, и
 *     согласие должно быть обеим сторонам;
 *   · на бирже адреса показаны сокращённо. Полный адрес появляется у
 *     той компании, которая заказ взяла: биржа, раздающая адреса всем
 *     подряд, — это выгрузка адресов покупателей.
 *
 * Денег Sky не держит и здесь: «финансы» компании — это журнал
 * выполненных доставок, а не касса. Ни баланса, ни вывода.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { isAdmin } from './admin.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { marketText as text, marketInt as int } from './market.mjs';
import { logLogi } from './logistics.mjs';
import { pushMarket } from './signal.mjs';

export const TC_ID_RE = /^ltc-[0-9a-f-]{36}$/;
export const VEHICLE_ID_RE = /^ltv-[0-9a-f-]{36}$/;
export const MEMBER_ID_RE = /^ltm-[0-9a-f-]{36}$/;
export const TC_ORDER_ID_RE = /^lto-[0-9a-f-]{36}$/;
export const TARIFF_ID_RE = /^ltt-[0-9a-f-]{36}$/;

const KINDS = ['courier', 'car', 'truck', 'van', 'special', 'moto'];
const VEHICLE_STATUS = ['available', 'busy', 'maintenance', 'disabled'];
const TEAM_ROLES = ['driver', 'courier', 'dispatcher'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const MAX_NAME = 120;
const MAX_TEXT = 2000;
const MAX_ADDRESS = 300;

const rub = (kop) => Number(kop ?? 0) / 100;
const kop = (rubles) => {
  const n = Number(rubles);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};
const grams = (kg) => {
  const n = Number(kg);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : 0;
};

const list = (raw, allowed, cap = 20) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw.slice(0, cap)) {
    const s = text(v, 60);
    if (!s) continue;
    if (allowed && !allowed.includes(s)) continue;
    out.push(s);
  }
  return out;
};

/* ─── Компания ─────────────────────────────────────────────────────── */

const toCompany = (row, { own = false } = {}) => ({
  id: row.id,
  ownerId: row.owner_id,
  name: row.name,
  logoHue: Number(row.logo_hue ?? 210),
  description: row.description,
  city: row.city,
  regions: Array.isArray(row.regions) ? row.regions : [],
  /* Контакты компании — публичные: по ним с ней и связываются. Но
     хранятся зашифрованными, как любые персональные данные. */
  contactPhone: row.contact_phone_enc ? (decryptContent(row.contact_phone_enc) ?? '') : '',
  contactEmail: row.contact_email_enc ? (decryptContent(row.contact_email_enc) ?? '') : '',
  workDays: Array.isArray(row.work_days) ? row.work_days : [],
  workFrom: row.work_from,
  workTo: row.work_to,
  weekendDelivery: Boolean(row.weekend_delivery),
  transportKinds: Array.isArray(row.transport_kinds) ? row.transport_kinds : [],
  zones: Array.isArray(row.zones) ? row.zones : [],
  minPrice: rub(row.min_price_kop),
  pricePerKm: rub(row.price_per_km_kop),
  maxWeightKg: Number(row.max_weight_g ?? 0) / 1000,
  maxVolumeM3: Number(row.max_volume_ml ?? 0) / 1_000_000,
  deliveryTimeHours: Number(row.delivery_hours ?? 24),
  verified: Boolean(row.verified),
  rating: row.rating == null ? 0 : Math.round(Number(row.rating) * 10) / 10,
  completedDeliveries: Number(row.completed ?? 0),
  successRatePct: Number(row.success_pct ?? 100),
  own,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

export const myCompany = async (ownerId) => {
  const { rows } = await query('SELECT * FROM logi_tc WHERE owner_id = $1', [ownerId]);
  return rows[0] ? toCompany(rows[0], { own: true }) : null;
};

/** Строка компании, если она принадлежит этому человеку. */
const ownCompanyRow = async (companyId, ownerId) => {
  if (!TC_ID_RE.test(String(companyId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM logi_tc WHERE id = $1', [companyId]);
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id !== ownerId) {
    await logLogi(ownerId, 'tc_denied', companyId);
    return null;
  }
  return row;
};

const companyFields = (p = {}) => ({
  name: text(p.name, MAX_NAME),
  logo_hue: int(p.logoHue, 0, 360) ?? 210,
  description: text(p.description, MAX_TEXT),
  city: text(p.city, 80),
  regions: JSON.stringify(list(p.regions, null, 30)),
  phone: text(p.contactPhone, 40),
  email: text(p.contactEmail, 120),
  work_days: JSON.stringify(list(p.workDays, DAYS, 7)),
  work_from: text(p.workFrom, 5) || '09:00',
  work_to: text(p.workTo, 5) || '18:00',
  weekend: p.weekendDelivery === true,
  kinds: JSON.stringify(list(p.transportKinds, KINDS, 6)),
  zones: JSON.stringify(list(p.zones, null, 30)),
  min_price_kop: kop(p.minPrice),
  price_per_km_kop: kop(p.pricePerKm),
  max_weight_g: grams(p.maxWeightKg),
  max_volume_ml: Math.max(0, Math.round(Number(p.maxVolumeM3 ?? 0) * 1_000_000) || 0),
  delivery_hours: int(p.deliveryTimeHours, 1, 24 * 90) ?? 24,
});

export const createCompany = async (ownerId, input = {}) => {
  const f = companyFields(input);
  if (f.name.length < 2) return { error: 'bad_name' };

  const { rows } = await query(
    `INSERT INTO logi_tc
       (id, owner_id, name, logo_hue, description, city, regions,
        contact_phone_enc, contact_email_enc, work_days, work_from, work_to,
        weekend_delivery, transport_kinds, zones, min_price_kop, price_per_km_kop,
        max_weight_g, max_volume_ml, delivery_hours)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15::jsonb,
             $16,$17,$18,$19,$20)
     ON CONFLICT (owner_id) DO NOTHING
     RETURNING *`,
    [`ltc-${generateId()}`, ownerId, f.name, f.logo_hue, f.description, f.city, f.regions,
      f.phone ? encryptContent(f.phone) : null, f.email ? encryptContent(f.email) : null,
      f.work_days, f.work_from, f.work_to, f.weekend, f.kinds, f.zones,
      f.min_price_kop, f.price_per_km_kop, f.max_weight_g, f.max_volume_ml, f.delivery_hours]);
  if (!rows[0]) return { error: 'already_have_company' };

  await logLogi(ownerId, 'tc_created', rows[0].id);
  return { company: toCompany(rows[0], { own: true }) };
};

export const updateCompany = async (companyId, ownerId, patch = {}) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return { error: 'not_found' };

  const f = companyFields({ ...toCompany(row, { own: true }), ...patch });
  if (f.name.length < 2) return { error: 'bad_name' };

  const { rows } = await query(
    `UPDATE logi_tc SET name = $2, logo_hue = $3, description = $4, city = $5,
            regions = $6::jsonb, contact_phone_enc = $7, contact_email_enc = $8,
            work_days = $9::jsonb, work_from = $10, work_to = $11, weekend_delivery = $12,
            transport_kinds = $13::jsonb, zones = $14::jsonb, min_price_kop = $15,
            price_per_km_kop = $16, max_weight_g = $17, max_volume_ml = $18,
            delivery_hours = $19, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [companyId, f.name, f.logo_hue, f.description, f.city, f.regions,
      f.phone ? encryptContent(f.phone) : null, f.email ? encryptContent(f.email) : null,
      f.work_days, f.work_from, f.work_to, f.weekend, f.kinds, f.zones,
      f.min_price_kop, f.price_per_km_kop, f.max_weight_g, f.max_volume_ml, f.delivery_hours]);
  return { company: toCompany(rows[0], { own: true }) };
};

/** Каталог компаний — для продавца, который выбирает, кому отдать. */
export const listCompanies = async (viewerId, { city, limit } = {}) => {
  const lim = int(limit, 1, 200) ?? 100;
  /* Кто спрашивает, в запрос не уходит: он нужен только чтобы отметить
     свою компанию в ответе. Лишний неиспользованный параметр Postgres
     не проглотит — он не сможет вывести его тип. */
  const args = [];
  let where = '';
  if (city) { args.push(text(city, 80)); where = `WHERE city = $${args.length}`; }
  args.push(lim);
  const { rows } = await query(
    `SELECT * FROM logi_tc ${where}
      ORDER BY verified DESC, rating DESC NULLS LAST, created_at DESC
      LIMIT $${args.length}`, args);
  return rows.map((r) => toCompany(r, { own: r.owner_id === viewerId }));
};

/** Отметку «проверена» ставит администрация, а не сама компания. */
export const setCompanyVerified = async (actorId, companyId, verified) => {
  if (!(await isAdmin(actorId))) {
    await logLogi(actorId, 'tc_verify_denied', companyId);
    return { error: 'not_allowed' };
  }
  const { rows } = await query(
    'UPDATE logi_tc SET verified = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [String(companyId ?? ''), verified === true]);
  if (!rows[0]) return { error: 'not_found' };
  await logLogi(actorId, 'tc_verified', companyId, { verified: verified === true });
  return { company: toCompany(rows[0]) };
};

/* ─── Парк ─────────────────────────────────────────────────────────── */

const toVehicle = (row) => ({
  id: row.id,
  companyId: row.company_id,
  photoHue: Number(row.photo_hue ?? 210),
  brand: row.brand,
  model: row.model,
  plateNumber: row.plate_number,
  kind: row.kind,
  capacityKg: Number(row.capacity_g ?? 0) / 1000,
  volumeM3: Number(row.volume_ml ?? 0) / 1_000_000,
  status: row.status,
  driverId: row.driver_id ?? null,
  currentLoadKg: Number(row.load_g ?? 0) / 1000,
});

export const listVehicles = async (companyId, ownerId) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return null;
  const { rows } = await query(
    'SELECT * FROM logi_tc_vehicles WHERE company_id = $1 ORDER BY created_at', [companyId]);
  return rows.map(toVehicle);
};

export const addVehicle = async (companyId, ownerId, input = {}) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return { error: 'not_found' };

  const { rows } = await query(
    `INSERT INTO logi_tc_vehicles
       (id, company_id, photo_hue, brand, model, plate_number, kind, capacity_g, volume_ml)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [`ltv-${generateId()}`, companyId, int(input.photoHue, 0, 360) ?? 210,
      text(input.brand, 60), text(input.model, 60), text(input.plateNumber, 20),
      KINDS.includes(String(input.kind)) ? String(input.kind) : 'car',
      grams(input.capacityKg),
      Math.max(0, Math.round(Number(input.volumeM3 ?? 0) * 1_000_000) || 0)]);
  await logLogi(ownerId, 'tc_vehicle_added', rows[0].id);
  return { vehicle: toVehicle(rows[0]) };
};

/** Машина правится только внутри своей компании — проверка идёт JOIN'ом. */
const ownVehicleRow = async (vehicleId, ownerId) => {
  if (!VEHICLE_ID_RE.test(String(vehicleId ?? ''))) return null;
  const { rows } = await query(
    `SELECT v.* FROM logi_tc_vehicles v JOIN logi_tc c ON c.id = v.company_id
      WHERE v.id = $1 AND c.owner_id = $2`, [vehicleId, ownerId]);
  if (!rows[0]) await logLogi(ownerId, 'tc_vehicle_denied', vehicleId);
  return rows[0] ?? null;
};

export const setVehicleStatus = async (vehicleId, ownerId, status) => {
  if (!VEHICLE_STATUS.includes(String(status))) return { error: 'bad_status' };
  const row = await ownVehicleRow(vehicleId, ownerId);
  if (!row) return { error: 'not_found' };
  const { rows } = await query(
    'UPDATE logi_tc_vehicles SET status = $2 WHERE id = $1 RETURNING *', [vehicleId, String(status)]);
  return { vehicle: toVehicle(rows[0]) };
};

export const assignDriver = async (vehicleId, ownerId, driverId) => {
  const row = await ownVehicleRow(vehicleId, ownerId);
  if (!row) return { error: 'not_found' };

  /* Водитель — из команды той же компании. Чужого в свою машину не
     посадишь, даже прислав его идентификатор. */
  let driver = null;
  if (driverId) {
    const { rows: d } = await query(
      'SELECT id FROM logi_tc_team WHERE id = $1 AND company_id = $2',
      [String(driverId), row.company_id]);
    driver = d[0] ?? null;
    if (!driver) return { error: 'no_such_driver' };
  }

  const { rows } = await query(
    'UPDATE logi_tc_vehicles SET driver_id = $2 WHERE id = $1 RETURNING *',
    [vehicleId, driver?.id ?? null]);
  await query('UPDATE logi_tc_team SET vehicle_id = NULL WHERE vehicle_id = $1 AND id <> COALESCE($2, \'\')',
    [vehicleId, driver?.id ?? null]);
  if (driver) {
    await query('UPDATE logi_tc_team SET vehicle_id = $2 WHERE id = $1', [driver.id, vehicleId]);
  }
  return { vehicle: toVehicle(rows[0]) };
};

export const removeVehicle = async (vehicleId, ownerId) => {
  const row = await ownVehicleRow(vehicleId, ownerId);
  if (!row) return { error: 'not_found' };
  await query('DELETE FROM logi_tc_vehicles WHERE id = $1', [vehicleId]);
  return { ok: true };
};

/* ─── Команда ──────────────────────────────────────────────────────── */

const toMember = (row) => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  phone: row.phone_enc ? (decryptContent(row.phone_enc) ?? '') : '',
  role: row.role,
  vehicleId: row.vehicle_id ?? null,
  rating: row.rating == null ? 0 : Math.round(Number(row.rating) * 10) / 10,
  completedDeliveries: Number(row.completed ?? 0),
  active: Boolean(row.active),
  joinedAt: row.joined_at?.toISOString?.() ?? undefined,
});

export const listTeam = async (companyId, ownerId) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return null;
  const { rows } = await query(
    'SELECT * FROM logi_tc_team WHERE company_id = $1 ORDER BY joined_at', [companyId]);
  return rows.map(toMember);
};

export const addMember = async (companyId, ownerId, input = {}) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return { error: 'not_found' };
  const name = text(input.name, MAX_NAME);
  if (name.length < 2) return { error: 'bad_name' };

  const phone = text(input.phone, 40);
  const { rows } = await query(
    `INSERT INTO logi_tc_team (id, company_id, name, phone_enc, role)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [`ltm-${generateId()}`, companyId, name, phone ? encryptContent(phone) : null,
      TEAM_ROLES.includes(String(input.role)) ? String(input.role) : 'driver']);
  return { member: toMember(rows[0]) };
};

const ownMemberRow = async (memberId, ownerId) => {
  if (!MEMBER_ID_RE.test(String(memberId ?? ''))) return null;
  const { rows } = await query(
    `SELECT m.* FROM logi_tc_team m JOIN logi_tc c ON c.id = m.company_id
      WHERE m.id = $1 AND c.owner_id = $2`, [memberId, ownerId]);
  if (!rows[0]) await logLogi(ownerId, 'tc_member_denied', memberId);
  return rows[0] ?? null;
};

export const toggleMember = async (memberId, ownerId) => {
  const row = await ownMemberRow(memberId, ownerId);
  if (!row) return { error: 'not_found' };
  const { rows } = await query(
    'UPDATE logi_tc_team SET active = NOT active WHERE id = $1 RETURNING *', [memberId]);
  return { member: toMember(rows[0]) };
};

export const removeMember = async (memberId, ownerId) => {
  const row = await ownMemberRow(memberId, ownerId);
  if (!row) return { error: 'not_found' };
  await query('DELETE FROM logi_tc_team WHERE id = $1', [memberId]);
  return { ok: true };
};

/* ─── Заказы на доставку ───────────────────────────────────────────── */

/**
 * Заказ глазами того, кто смотрит.
 *
 * На бирже адреса показаны сокращённо — до первой запятой, то есть
 * город. Полный адрес видит продавец (это его заказ) и компания,
 * которая заказ взяла. Биржа, раздающая точные адреса всем подряд, —
 * это выгрузка адресов покупателей, а не биржа.
 */
const shortAddr = (full) => {
  const s = String(full ?? '');
  const cut = s.indexOf(',');
  return cut > 0 ? `${s.slice(0, cut)}, …` : (s ? '…' : '');
};

const toTcOrder = (row, { full = false } = {}) => {
  const from = row.from_addr_enc ? (decryptContent(row.from_addr_enc) ?? '') : '';
  const to = row.to_addr_enc ? (decryptContent(row.to_addr_enc) ?? '') : '';
  return {
    id: row.id,
    companyId: row.company_id ?? null,
    sellerId: row.seller_id,
    sellerName: row.seller_name ?? '',
    productName: row.product_name,
    qty: Number(row.qty),
    weightKg: Number(row.weight_g ?? 0) / 1000,
    fromAddress: full ? from : shortAddr(from),
    toAddress: full ? to : shortAddr(to),
    distanceKm: Number(row.distance_m ?? 0) / 1000,
    price: rub(row.price_kop),
    driverId: row.driver_id ?? null,
    vehicleId: row.vehicle_id ?? null,
    status: row.status,
    isExchange: Boolean(row.is_exchange),
    proposedPrice: row.offer_price_kop == null ? undefined : rub(row.offer_price_kop),
    offerCompanyId: row.offer_company_id ?? null,
    offerCompanyName: row.offer_company_name ?? undefined,
    etaHours: Number(row.eta_hours ?? 24),
    createdAt: row.created_at?.toISOString?.() ?? undefined,
  };
};

const SELECT_TC_ORDER = `
  SELECT o.*, p.name AS seller_name, oc.name AS offer_company_name
    FROM logi_tc_orders o
    JOIN profiles p ON p.id = o.seller_id
    LEFT JOIN logi_tc oc ON oc.id = o.offer_company_id
`;

/** Заказ создаёт продавец: адрес и цена — его, а не компании. */
export const createTcOrder = async (sellerId, input = {}) => {
  const productName = text(input.productName, MAX_NAME);
  if (!productName) return { error: 'bad_product' };

  /* Компанию можно указать сразу, но только существующую. Без неё
     заказ уходит на биржу. */
  let companyId = null;
  if (input.companyId) {
    const { rows: c } = await query('SELECT id FROM logi_tc WHERE id = $1', [String(input.companyId)]);
    if (!c[0]) return { error: 'no_such_company' };
    companyId = c[0].id;
  }

  const from = text(input.fromAddress, MAX_ADDRESS);
  const to = text(input.toAddress, MAX_ADDRESS);

  const { rows } = await query(
    `INSERT INTO logi_tc_orders
       (id, company_id, seller_id, product_name, qty, weight_g, from_addr_enc, to_addr_enc,
        distance_m, price_kop, eta_hours, is_exchange)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [`lto-${generateId()}`, companyId, sellerId, productName,
      int(input.qty, 1, 100_000) ?? 1, grams(input.weightKg),
      from ? encryptContent(from) : null, to ? encryptContent(to) : null,
      Math.max(0, Math.round(Number(input.distanceKm ?? 0) * 1000) || 0),
      kop(input.price), int(input.etaHours, 1, 24 * 90) ?? 24,
      companyId === null]);

  await logLogi(sellerId, 'tc_order_created', rows[0].id, { onExchange: companyId === null });
  return { order: toTcOrder({ ...rows[0], seller_name: '' }, { full: true }) };
};

/** Заказы компании. Полные адреса: заказ уже её. */
export const listCompanyOrders = async (companyId, ownerId) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return null;
  const { rows } = await query(
    `${SELECT_TC_ORDER} WHERE o.company_id = $1 ORDER BY o.created_at DESC LIMIT 200`, [companyId]);
  return rows.map((r) => toTcOrder(r, { full: true }));
};

/** Свои заказы глазами продавца. */
export const listSellerTcOrders = async (sellerId) => {
  const { rows } = await query(
    `${SELECT_TC_ORDER} WHERE o.seller_id = $1 ORDER BY o.created_at DESC LIMIT 200`, [sellerId]);
  return rows.map((r) => toTcOrder(r, { full: true }));
};

/**
 * Биржа: заказы, которые ещё никто не взял.
 *
 * Видна только владельцам компаний — иначе это открытый список чужих
 * отправлений. Адреса сокращены.
 */
export const listExchange = async (ownerId) => {
  const { rows: c } = await query('SELECT id FROM logi_tc WHERE owner_id = $1', [ownerId]);
  if (!c[0]) return null;
  const { rows } = await query(
    `${SELECT_TC_ORDER}
      WHERE o.company_id IS NULL AND o.is_exchange AND o.status = 'new'
      ORDER BY o.created_at DESC LIMIT 100`);
  return rows.map((r) => toTcOrder(r, { full: false }));
};

/** Взять заказ с биржи. Берёт компания — первая, кто успел. */
export const acceptExchangeOrder = async (orderId, ownerId) => {
  if (!TC_ORDER_ID_RE.test(String(orderId ?? ''))) return { error: 'not_found' };
  const { rows: c } = await query('SELECT id FROM logi_tc WHERE owner_id = $1', [ownerId]);
  if (!c[0]) return { error: 'no_company' };

  /* Захват одним запросом: «проверил, потом взял» двумя — это два
     перевозчика, поехавших за одной посылкой. */
  const { rows } = await query(
    `UPDATE logi_tc_orders
        SET company_id = $2, is_exchange = FALSE, status = 'assigned', updated_at = now()
      WHERE id = $1 AND company_id IS NULL AND is_exchange AND status = 'new'
      RETURNING *`, [orderId, c[0].id]);
  if (!rows[0]) return { error: 'already_taken' };

  await notifySeller(rows[0].seller_id, 'Заказ на доставку принят перевозчиком');
  await logLogi(ownerId, 'tc_order_taken', orderId);
  return { order: toTcOrder(rows[0], { full: true }) };
};

/**
 * Встречная цена.
 *
 * Компания предлагает свою цену, решает продавец. Ни одна из сторон не
 * меняет цену в одиночку: за доставку платят напрямую, и согласие
 * нужно обоим.
 */
export const proposePrice = async (orderId, ownerId, price) => {
  if (!TC_ORDER_ID_RE.test(String(orderId ?? ''))) return { error: 'not_found' };
  const { rows: c } = await query('SELECT id, name FROM logi_tc WHERE owner_id = $1', [ownerId]);
  if (!c[0]) return { error: 'no_company' };

  const { rows } = await query(
    `UPDATE logi_tc_orders
        SET offer_company_id = $2, offer_price_kop = $3, updated_at = now()
      WHERE id = $1 AND status = 'new'
      RETURNING *`, [orderId, c[0].id, kop(price)]);
  if (!rows[0]) return { error: 'wrong_state' };

  await notifySeller(rows[0].seller_id, `Перевозчик предложил свою цену: ${rub(kop(price))} ₽`);
  return { order: toTcOrder(rows[0], { full: false }) };
};

/** Решение по встречной цене принимает продавец — владелец заказа. */
export const answerOffer = async (orderId, sellerId, approve) => {
  if (!TC_ORDER_ID_RE.test(String(orderId ?? ''))) return { error: 'not_found' };
  const { rows: o } = await query(
    'SELECT * FROM logi_tc_orders WHERE id = $1 AND seller_id = $2', [orderId, sellerId]);
  if (!o[0]) { await logLogi(sellerId, 'tc_offer_denied', orderId); return { error: 'not_found' }; }
  if (!o[0].offer_company_id) return { error: 'no_offer' };

  const { rows } = approve
    ? await query(
      `UPDATE logi_tc_orders
          SET price_kop = offer_price_kop, company_id = offer_company_id,
              is_exchange = FALSE, status = 'assigned',
              offer_company_id = NULL, offer_price_kop = NULL, updated_at = now()
        WHERE id = $1 RETURNING *`, [orderId])
    : await query(
      `UPDATE logi_tc_orders
          SET offer_company_id = NULL, offer_price_kop = NULL, updated_at = now()
        WHERE id = $1 RETURNING *`, [orderId]);

  await logLogi(sellerId, approve ? 'tc_offer_approved' : 'tc_offer_rejected', orderId);
  return { order: toTcOrder(rows[0], { full: true }) };
};

/** Заказ компании — только своей. */
const ownTcOrderRow = async (orderId, ownerId) => {
  if (!TC_ORDER_ID_RE.test(String(orderId ?? ''))) return null;
  const { rows } = await query(
    `SELECT o.* FROM logi_tc_orders o JOIN logi_tc c ON c.id = o.company_id
      WHERE o.id = $1 AND c.owner_id = $2`, [orderId, ownerId]);
  if (!rows[0]) await logLogi(ownerId, 'tc_order_denied', orderId);
  return rows[0] ?? null;
};

/**
 * Назначить машину и водителя.
 *
 * И машина, и водитель проверяются на принадлежность той же компании:
 * присланный идентификатор чужой машины не должен отправлять её в рейс.
 * Грузоподъёмность тоже проверяется здесь — на экране она подсказка.
 */
export const assignTcOrder = async (orderId, ownerId, vehicleId, driverId) => {
  const order = await ownTcOrderRow(orderId, ownerId);
  if (!order) return { error: 'not_found' };
  if (['completed', 'cancelled'].includes(order.status)) return { error: 'already_closed' };

  const { rows: v } = await query(
    'SELECT * FROM logi_tc_vehicles WHERE id = $1 AND company_id = $2',
    [String(vehicleId ?? ''), order.company_id]);
  if (!v[0]) return { error: 'no_such_vehicle' };
  if (v[0].status === 'disabled' || v[0].status === 'maintenance') return { error: 'vehicle_unavailable' };
  if (Number(v[0].capacity_g) > 0 && Number(order.weight_g) > Number(v[0].capacity_g)) {
    return { error: 'too_heavy' };
  }

  let driver = null;
  if (driverId) {
    const { rows: d } = await query(
      'SELECT * FROM logi_tc_team WHERE id = $1 AND company_id = $2 AND active',
      [String(driverId), order.company_id]);
    driver = d[0] ?? null;
    if (!driver) return { error: 'no_such_driver' };
  }

  const { rows } = await query(
    `UPDATE logi_tc_orders SET vehicle_id = $2, driver_id = $3, status = 'assigned', updated_at = now()
      WHERE id = $1 RETURNING *`, [orderId, v[0].id, driver?.id ?? null]);
  await query('UPDATE logi_tc_vehicles SET status = $2 WHERE id = $1', [v[0].id, 'busy']);
  return { order: toTcOrder(rows[0], { full: true }) };
};

const ORDER_NEXT = { new: 'assigned', assigned: 'in_progress', in_progress: 'completed' };

/**
 * Продвинуть заказ.
 *
 * Завершение записывает строку в журнал выполненного и освобождает
 * машину. Журнал — не касса: деньги за доставку идут мимо Sky.
 */
export const advanceTcOrder = async (orderId, ownerId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: check } = await client.query(
      `SELECT o.* FROM logi_tc_orders o JOIN logi_tc c ON c.id = o.company_id
        WHERE o.id = $1 AND c.owner_id = $2 FOR UPDATE OF o`,
      [String(orderId ?? ''), ownerId]);
    const order = check[0];
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const next = ORDER_NEXT[order.status];
    if (!next) { await client.query('ROLLBACK'); return { error: 'wrong_state', status: order.status }; }

    const { rows } = await client.query(
      'UPDATE logi_tc_orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [orderId, next]);

    if (next === 'completed') {
      await client.query(
        `INSERT INTO logi_tc_finance (id, company_id, order_id, amount_kop)
         VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`,
        [`ltf-${generateId()}`, order.company_id, orderId, order.price_kop]);
      await client.query(
        'UPDATE logi_tc SET completed = completed + 1, updated_at = now() WHERE id = $1',
        [order.company_id]);
      if (order.vehicle_id) {
        await client.query(`UPDATE logi_tc_vehicles SET status = 'available' WHERE id = $1`,
          [order.vehicle_id]);
      }
      if (order.driver_id) {
        await client.query('UPDATE logi_tc_team SET completed = completed + 1 WHERE id = $1',
          [order.driver_id]);
      }
    }
    await client.query('COMMIT');

    if (next === 'completed') await notifySeller(order.seller_id, 'Доставка выполнена');
    return { order: toTcOrder(rows[0], { full: true }) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Отменить может и компания, и продавец — это их общий заказ. */
export const cancelTcOrder = async (orderId, actorId) => {
  if (!TC_ORDER_ID_RE.test(String(orderId ?? ''))) return { error: 'not_found' };
  const { rows: o } = await query(
    `SELECT o.*, c.owner_id FROM logi_tc_orders o
       LEFT JOIN logi_tc c ON c.id = o.company_id WHERE o.id = $1`, [orderId]);
  const row = o[0];
  if (!row) return { error: 'not_found' };
  if (row.seller_id !== actorId && row.owner_id !== actorId) {
    await logLogi(actorId, 'tc_cancel_denied', orderId);
    return { error: 'not_found' };
  }
  if (['completed', 'cancelled'].includes(row.status)) return { error: 'already_closed' };

  const { rows } = await query(
    `UPDATE logi_tc_orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
    [orderId]);
  if (row.vehicle_id) {
    await query(`UPDATE logi_tc_vehicles SET status = 'available' WHERE id = $1`, [row.vehicle_id]);
  }
  return { order: toTcOrder(rows[0], { full: true }) };
};

/* ─── Тарифы, журнал выполненного, склады компании ─────────────────── */

export const listTariffs = async (companyId, ownerId) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return null;
  const { rows } = await query(
    'SELECT * FROM logi_tc_tariffs WHERE company_id = $1 ORDER BY base_kop', [companyId]);
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    maxWeightKg: Number(r.max_weight_g ?? 0) / 1000,
    basePrice: rub(r.base_kop),
    description: r.description,
    express: Boolean(r.express),
  }));
};

export const addTariff = async (companyId, ownerId, input = {}) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return { error: 'not_found' };
  const name = text(input.name, MAX_NAME);
  if (!name) return { error: 'bad_name' };
  const { rows } = await query(
    `INSERT INTO logi_tc_tariffs (id, company_id, name, max_weight_g, base_kop, description, express)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [`ltt-${generateId()}`, companyId, name, grams(input.maxWeightKg), kop(input.basePrice),
      text(input.description, MAX_TEXT), input.express === true]);
  return { id: rows[0].id };
};

export const removeTariff = async (tariffId, ownerId) => {
  if (!TARIFF_ID_RE.test(String(tariffId ?? ''))) return { error: 'not_found' };
  const { rowCount } = await query(
    `DELETE FROM logi_tc_tariffs t USING logi_tc c
      WHERE t.id = $1 AND c.id = t.company_id AND c.owner_id = $2`, [tariffId, ownerId]);
  if (rowCount === 0) { await logLogi(ownerId, 'tc_tariff_denied', tariffId); return { error: 'not_found' }; }
  return { ok: true };
};

/**
 * Журнал выполненного.
 *
 * Это записи о завершённых доставках и суммах, о которых договорились
 * стороны. Ни баланса, ни вывода: денег компании Sky не держит.
 */
export const listFinance = async (companyId, ownerId) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return null;
  const { rows } = await query(
    'SELECT id, order_id, amount_kop, at FROM logi_tc_finance WHERE company_id = $1 ORDER BY at DESC LIMIT 200',
    [companyId]);
  return rows.map((r) => ({
    id: r.id,
    companyId,
    orderId: r.order_id,
    amount: rub(r.amount_kop),
    at: r.at?.toISOString?.() ?? undefined,
  }));
};

export const listCompanyWarehouses = async (companyId, ownerId) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return null;
  const { rows } = await query(
    'SELECT * FROM logi_tc_warehouses WHERE company_id = $1 ORDER BY created_at', [companyId]);
  return rows.map((r) => ({
    id: r.id,
    companyId,
    warehouseName: r.name,
    address: r.address_enc ? (decryptContent(r.address_enc) ?? '') : '',
    own: Boolean(r.own),
  }));
};

export const linkCompanyWarehouse = async (companyId, ownerId, input = {}) => {
  const row = await ownCompanyRow(companyId, ownerId);
  if (!row) return { error: 'not_found' };
  const name = text(input.warehouseName, MAX_NAME);
  if (!name) return { error: 'bad_name' };
  const addr = text(input.address, MAX_ADDRESS);
  const { rows } = await query(
    `INSERT INTO logi_tc_warehouses (id, company_id, name, address_enc, own)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [`ltw-${generateId()}`, companyId, name, addr ? encryptContent(addr) : null,
      input.own !== false]);
  return { id: rows[0].id };
};

export const unlinkCompanyWarehouse = async (linkId, ownerId) => {
  const { rowCount } = await query(
    `DELETE FROM logi_tc_warehouses w USING logi_tc c
      WHERE w.id = $1 AND c.id = w.company_id AND c.owner_id = $2`, [String(linkId ?? ''), ownerId]);
  if (rowCount === 0) return { error: 'not_found' };
  return { ok: true };
};

/* ─── Уведомления ──────────────────────────────────────────────────── */

const notifySeller = async (sellerId, line) => {
  pushMarket([sellerId], { type: 'logi-notification', payload: { kind: 'transport', text: line } });
};
