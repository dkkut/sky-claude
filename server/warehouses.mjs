/**
 * Sky Market / Логистика: склады, поставки и пропуска.
 *
 * Раньше всё это жило в браузере, и слово «доступ» означало, что экран
 * не нарисовал кнопку. Здесь доступ означает, что сервер не отдал
 * данные.
 *
 * Кто что может со складом:
 *
 *   владелец    — всё, включая сотрудников и удаление;
 *   менеджер    — остатки, перемещения, пропуска, журнал;
 *   работник    — остатки и журнал, читает пропуска;
 *   посторонний — ничего, и склад для него неотличим от несуществующего.
 *
 * Пропуск — это ключ от склада. Поэтому в базе лежит его отпечаток, а
 * не он сам: утёкший дамп не должен превращаться в связку ключей.
 * Сканирование ищет по отпечатку и только среди складов, к которым у
 * сканирующего есть доступ, — иначе подбор кода проверялся бы на всех
 * складах разом.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { marketText as text, marketInt as int } from './market.mjs';
import { logLogi } from './logistics.mjs';

export const WAREHOUSE_ID_RE = /^lw-[0-9a-f-]{36}$/;
export const PASS_ID_RE = /^lp-[0-9a-f-]{36}$/;
export const SUPPLY_ID_RE = /^ls-[0-9a-f-]{36}$/;
export const TRANSFER_ID_RE = /^lt-[0-9a-f-]{36}$/;

const MAX_NAME = 120;
const MAX_ADDRESS = 300;
const MAX_PHOTOS = 8;
const MAX_WAREHOUSES = 50;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/* ─── Доступ к складу ──────────────────────────────────────────────── */

/**
 * Что этот человек может на этом складе.
 *
 * Роль берётся из базы: владелец — из строки склада, сотрудник — из
 * таблицы сотрудников. Присланной роли здесь не читается никогда.
 */
export const warehouseAccess = async (warehouseId, actorId) => {
  if (!WAREHOUSE_ID_RE.test(String(warehouseId ?? ''))) return null;
  const { rows } = await query(
    `SELECT w.*, s.role AS staff_role
       FROM logi_warehouses w
       LEFT JOIN logi_warehouse_staff s ON s.warehouse_id = w.id AND s.profile_id = $2
      WHERE w.id = $1`, [warehouseId, actorId ?? '']);
  const row = rows[0];
  if (!row) return null;
  if (row.seller_id === actorId) return { warehouse: row, role: 'owner' };
  if (row.staff_role) return { warehouse: row, role: row.staff_role };
  if (await can(actorId, 'logistics')) return { warehouse: row, role: 'support' };
  await logLogi(actorId, 'warehouse_denied', warehouseId);
  return null;
};

const MAY_WRITE_STOCK = new Set(['owner', 'manager', 'worker', 'support']);
const MAY_MANAGE = new Set(['owner', 'manager', 'support']);
const MAY_OWN = new Set(['owner', 'support']);

/* ─── Склад ────────────────────────────────────────────────────────── */

const toWarehouse = (row, photos = []) => ({
  id: row.id,
  sellerId: row.seller_id,
  name: row.name,
  address: row.address_enc ? (decryptContent(row.address_enc) ?? '') : '',
  cityId: row.city_id,
  /* Пусто — место склада не задано. Ноль-ноль вместо этого означал бы
     точку в Гвинейском заливе, и карта показала бы склад там. */
  location: row.lat == null || row.lng == null
    ? null
    : { lat: Number(row.lat), lng: Number(row.lng) },
  photos,
  schedule: Array.isArray(row.schedule) ? row.schedule : [],
  capacity: Number(row.capacity ?? 0),
  role: row.role,
  /* Открыт ли склад для чужих. Поле читается из той же строки, а не
     спрашивается у модуля общего склада: обратный импорт замкнул бы
     два модуля друг на друга ради одного слова. */
  sharedState: row.shared_state ?? 'off',
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

const cleanSchedule = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d) => d && DAYS.includes(String(d.day)))
    .slice(0, 7)
    .map((d) => ({
      day: String(d.day),
      closed: d.closed === true,
      from: text(d.from, 5) || '09:00',
      to: text(d.to, 5) || '21:00',
    }));
};

const photosOf = async (warehouseId) => {
  const { rows } = await query(
    'SELECT id FROM logi_warehouse_photos WHERE warehouse_id = $1 ORDER BY sort_order, created_at',
    [warehouseId]);
  return rows.map((r) => r.id);
};

/** Свои склады и те, где человек числится сотрудником. */
export const listWarehouses = async (profileId) => {
  const { rows } = await query(
    `SELECT DISTINCT w.*
       FROM logi_warehouses w
       LEFT JOIN logi_warehouse_staff s ON s.warehouse_id = w.id AND s.profile_id = $1
      WHERE w.seller_id = $1 OR s.profile_id = $1
      ORDER BY w.created_at DESC`, [profileId]);
  const out = [];
  for (const row of rows) out.push(toWarehouse(row, await photosOf(row.id)));
  return out;
};

/**
 * Сортировочные центры — для выбора при создании поставки.
 *
 * Видны всем: поставку везут на чужой центр, и знать о нём надо до
 * того, как договорился. Адрес при этом не отдаётся: он нужен тому,
 * кто уже везёт, и приходит вместе с поставкой.
 */
export const listSortingCenters = async () => {
  const { rows } = await query(
    `SELECT id, name, city_id FROM logi_warehouses
      WHERE role = 'sorting_center' ORDER BY name`);
  return rows.map((r) => ({ id: r.id, name: r.name, cityId: r.city_id }));
};

export const createWarehouse = async (sellerId, input = {}) => {
  const name = text(input.name, MAX_NAME);
  if (name.length < 2) return { error: 'bad_name' };

  const { rows: count } = await query(
    'SELECT count(*)::int AS n FROM logi_warehouses WHERE seller_id = $1', [sellerId]);
  if ((count[0]?.n ?? 0) >= MAX_WAREHOUSES) return { error: 'too_many_warehouses' };

  const address = text(input.address, MAX_ADDRESS);
  const lat = Number(input.location?.lat);
  const lng = Number(input.location?.lng);

  const { rows } = await query(
    `INSERT INTO logi_warehouses
       (id, seller_id, name, address_enc, city_id, lat, lng, capacity, role, schedule)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
    [`lw-${generateId()}`, sellerId, name, address ? encryptContent(address) : null,
      text(input.cityId, 60),
      Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null,
      int(input.capacity, 0, 10_000_000) ?? 0,
      input.role === 'sorting_center' ? 'sorting_center' : 'own',
      JSON.stringify(cleanSchedule(input.schedule))]);

  await logWarehouse(rows[0].id, sellerId, 'created', `Склад «${name}» создан`);
  await logLogi(sellerId, 'warehouse_created', rows[0].id);
  return { warehouse: toWarehouse(rows[0], []) };
};

export const updateWarehouse = async (warehouseId, actorId, patch = {}) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };

  const sets = [];
  const args = [warehouseId];
  if (patch.name !== undefined) {
    const name = text(patch.name, MAX_NAME);
    if (name.length < 2) return { error: 'bad_name' };
    args.push(name); sets.push(`name = $${args.length}`);
  }
  if (patch.address !== undefined) {
    const addr = text(patch.address, MAX_ADDRESS);
    args.push(addr ? encryptContent(addr) : null); sets.push(`address_enc = $${args.length}`);
  }
  if (patch.cityId !== undefined) { args.push(text(patch.cityId, 60)); sets.push(`city_id = $${args.length}`); }
  if (patch.capacity !== undefined) {
    args.push(int(patch.capacity, 0, 10_000_000) ?? 0); sets.push(`capacity = $${args.length}`);
  }
  if (patch.schedule !== undefined) {
    args.push(JSON.stringify(cleanSchedule(patch.schedule))); sets.push(`schedule = $${args.length}::jsonb`);
  }
  /* Роль склада меняет только владелец: сортировочный центр виден всем
     при создании поставки, и назначать им чужой склад нельзя. */
  if (patch.role !== undefined && MAY_OWN.has(found.role)) {
    args.push(patch.role === 'sorting_center' ? 'sorting_center' : 'own');
    sets.push(`role = $${args.length}`);
  }
  if (patch.location !== undefined) {
    const lat = Number(patch.location?.lat);
    const lng = Number(patch.location?.lng);
    args.push(Number.isFinite(lat) ? lat : null); sets.push(`lat = COALESCE($${args.length}, lat)`);
    args.push(Number.isFinite(lng) ? lng : null); sets.push(`lng = COALESCE($${args.length}, lng)`);
  }
  if (sets.length === 0) return { warehouse: toWarehouse(found.warehouse, await photosOf(warehouseId)) };

  const { rows } = await query(
    `UPDATE logi_warehouses SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, args);
  await logWarehouse(warehouseId, actorId, 'updated', 'Склад изменён');
  return { warehouse: toWarehouse(rows[0], await photosOf(warehouseId)) };
};

export const deleteWarehouse = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_OWN.has(found.role)) return { error: 'not_allowed' };

  /* Склад с живой арендой не удаляют. Внутри лежит чужой товар, а
     строки аренды ушли бы каскадом вместе со складом — и человек,
     приехавший за своим, не нашёл бы даже записи о том, что он его
     сюда привозил. */
  const { rows: live } = await query(
    `SELECT 1 FROM logi_cell_rentals
      WHERE warehouse_id = $1 AND status IN ('created','payment_declared','active') LIMIT 1`,
    [warehouseId]);
  if (live[0]) return { error: 'warehouse_rented' };

  const photos = await photosOf(warehouseId);
  await query('DELETE FROM logi_warehouses WHERE id = $1', [warehouseId]);
  await logLogi(actorId, 'warehouse_deleted', warehouseId);
  return { ok: true, photos };
};

/* ─── Фотографии склада ────────────────────────────────────────────── */

export const addWarehousePhoto = async (warehouseId, actorId, mime) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };

  const { rows: count } = await query(
    'SELECT count(*)::int AS n FROM logi_warehouse_photos WHERE warehouse_id = $1', [warehouseId]);
  if ((count[0]?.n ?? 0) >= MAX_PHOTOS) return { error: 'too_many_photos' };

  const id = `lwp-${generateId()}`;
  await query(
    `INSERT INTO logi_warehouse_photos (id, warehouse_id, mime, sort_order)
     VALUES ($1,$2,$3,$4)`, [id, warehouseId, String(mime), count[0]?.n ?? 0]);
  return { photoId: id };
};

export const readWarehousePhoto = async (photoId, viewerId) => {
  const { rows } = await query(
    `SELECT p.id, p.mime, p.warehouse_id FROM logi_warehouse_photos p WHERE p.id = $1`,
    [String(photoId ?? '')]);
  if (!rows[0]) return null;
  const found = await warehouseAccess(rows[0].warehouse_id, viewerId);
  if (!found) return null;
  return { mime: rows[0].mime };
};

export const deleteWarehousePhoto = async (photoId, actorId) => {
  const { rows } = await query(
    'SELECT warehouse_id FROM logi_warehouse_photos WHERE id = $1', [String(photoId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const found = await warehouseAccess(rows[0].warehouse_id, actorId);
  if (!found || !MAY_MANAGE.has(found.role)) return { error: 'not_found' };
  await query('DELETE FROM logi_warehouse_photos WHERE id = $1', [photoId]);
  return { ok: true };
};

/* ─── Остатки ──────────────────────────────────────────────────────── */

const toStock = (row) => ({
  id: row.id,
  warehouseId: row.warehouse_id,
  productId: row.product_id,
  productTitle: row.product_title,
  quantity: Number(row.quantity),
});

export const listStock = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return null;
  const { rows } = await query(
    'SELECT * FROM logi_stock WHERE warehouse_id = $1 ORDER BY product_title', [warehouseId]);
  return rows.map(toStock);
};

/** Занято и свободно — считает сервер, а не экран. */
export const warehouseFill = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return null;
  const { rows } = await query(
    'SELECT coalesce(sum(quantity), 0)::int AS n FROM logi_stock WHERE warehouse_id = $1',
    [warehouseId]);
  const occupied = Number(rows[0]?.n ?? 0);
  const capacity = Number(found.warehouse.capacity ?? 0);
  return { occupied, capacity, free: Math.max(0, capacity - occupied) };
};

/**
 * Поставить или изменить остаток.
 *
 * Вместимость проверяется тем же запросом, которым пишется количество:
 * «посчитал, потом записал» двумя запросами — это два человека,
 * положивших на склад последнее свободное место.
 */
export const setStock = async (warehouseId, actorId, productId, productTitle, quantity) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_WRITE_STOCK.has(found.role)) return { error: 'not_allowed' };

  const qty = int(quantity, 0, 10_000_000);
  if (qty === null) return { error: 'bad_quantity' };
  const pid = text(productId, 80);
  if (!pid) return { error: 'bad_product' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Строку склада берём под замок: пока мы считаем занятое место,
       никто другой не должен положить туда же. */
    const { rows: w } = await client.query(
      'SELECT capacity FROM logi_warehouses WHERE id = $1 FOR UPDATE', [warehouseId]);
    const { rows: used } = await client.query(
      `SELECT coalesce(sum(quantity), 0)::int AS n FROM logi_stock
        WHERE warehouse_id = $1 AND product_id <> $2`, [warehouseId, pid]);
    const capacity = Number(w[0]?.capacity ?? 0);
    if (capacity > 0 && Number(used[0].n) + qty > capacity) {
      await client.query('ROLLBACK');
      return { error: 'over_capacity', free: Math.max(0, capacity - Number(used[0].n)) };
    }

    if (qty === 0) {
      await client.query('DELETE FROM logi_stock WHERE warehouse_id = $1 AND product_id = $2',
        [warehouseId, pid]);
      await client.query('COMMIT');
      await logWarehouse(warehouseId, actorId, 'stock_out', `Убрано с остатков: ${text(productTitle, 120)}`);
      return { ok: true, removed: true };
    }

    const { rows } = await client.query(
      `INSERT INTO logi_stock (id, warehouse_id, product_id, product_title, quantity)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (warehouse_id, product_id) DO UPDATE
         SET quantity = EXCLUDED.quantity, product_title = EXCLUDED.product_title,
             updated_at = now()
       RETURNING *`,
      [`lst-${generateId()}`, warehouseId, pid, text(productTitle, 120), qty]);
    await client.query('COMMIT');
    await logWarehouse(warehouseId, actorId, 'stock_in',
      `Остаток «${text(productTitle, 120)}»: ${qty}`);
    return { stock: toStock(rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Перемещения между складами ───────────────────────────────────── */

const toTransfer = (row) => ({
  id: row.id,
  fromWarehouseId: row.from_wh_id,
  toWarehouseId: row.to_wh_id,
  productId: row.product_id,
  productTitle: row.product_title,
  quantity: Number(row.quantity),
  status: row.status,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  completedAt: row.completed_at?.toISOString?.() ?? undefined,
});

export const listTransfers = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return null;
  const { rows } = await query(
    `SELECT * FROM logi_transfers WHERE from_wh_id = $1 OR to_wh_id = $1
      ORDER BY created_at DESC LIMIT 200`, [warehouseId]);
  return rows.map(toTransfer);
};

/**
 * Отправить товар с одного склада на другой.
 *
 * Товар списывается с исходного склада сразу — тем же запросом, которым
 * проверяется наличие. Иначе одну и ту же коробку отправляют дважды.
 */
export const createTransfer = async (actorId, input = {}) => {
  const from = String(input.fromWarehouseId ?? '');
  const to = String(input.toWarehouseId ?? '');
  if (from === to) return { error: 'same_warehouse' };

  const src = await warehouseAccess(from, actorId);
  if (!src || !MAY_MANAGE.has(src.role)) return { error: 'not_found' };
  const dst = await warehouseAccess(to, actorId);
  if (!dst) return { error: 'target_not_found' };

  const qty = int(input.quantity, 1, 10_000_000);
  if (!qty) return { error: 'bad_quantity' };
  const pid = text(input.productId, 80);
  if (!pid) return { error: 'bad_product' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: took } = await client.query(
      `UPDATE logi_stock SET quantity = quantity - $3, updated_at = now()
        WHERE warehouse_id = $1 AND product_id = $2 AND quantity >= $3`,
      [from, pid, qty]);
    if (took === 0) { await client.query('ROLLBACK'); return { error: 'not_enough_stock' }; }

    const { rows } = await client.query(
      `INSERT INTO logi_transfers
         (id, from_wh_id, to_wh_id, product_id, product_title, quantity)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [`lt-${generateId()}`, from, to, pid, text(input.productTitle, 120), qty]);
    await client.query('COMMIT');

    await logWarehouse(from, actorId, 'transfer_out',
      `Отправлено ${qty} × «${text(input.productTitle, 120)}»`);
    return { transfer: toTransfer(rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const TRANSFER_NEXT = { pending: 'in_transit', in_transit: 'done' };

/**
 * Продвинуть перемещение.
 *
 * Из «в пути» в «доставлено» товар появляется на складе назначения —
 * и только тогда. До этого он уже списан с исходного и нигде не лежит:
 * он в дороге, и так оно и есть.
 */
export const advanceTransfer = async (transferId, actorId) => {
  if (!TRANSFER_ID_RE.test(String(transferId ?? ''))) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM logi_transfers WHERE id = $1 FOR UPDATE', [transferId]);
    const row = rows[0];
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const src = await warehouseAccess(row.from_wh_id, actorId);
    const dst = await warehouseAccess(row.to_wh_id, actorId);
    if ((!src || !MAY_MANAGE.has(src.role)) && (!dst || !MAY_MANAGE.has(dst.role))) {
      await client.query('ROLLBACK');
      return { error: 'not_found' };
    }

    const next = TRANSFER_NEXT[row.status];
    if (!next) { await client.query('ROLLBACK'); return { error: 'wrong_state', status: row.status }; }

    const { rows: upd } = await client.query(
      `UPDATE logi_transfers SET status = $2,
              completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END
        WHERE id = $1 RETURNING *`, [transferId, next]);

    if (next === 'done') {
      await client.query(
        `INSERT INTO logi_stock (id, warehouse_id, product_id, product_title, quantity)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (warehouse_id, product_id) DO UPDATE
           SET quantity = logi_stock.quantity + EXCLUDED.quantity, updated_at = now()`,
        [`lst-${generateId()}`, row.to_wh_id, row.product_id, row.product_title, row.quantity]);
    }
    await client.query('COMMIT');

    if (next === 'done') {
      await logWarehouse(row.to_wh_id, actorId, 'transfer_in',
        `Принято ${row.quantity} × «${row.product_title}»`);
    }
    return { transfer: toTransfer(upd[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Отмена возвращает товар туда, откуда он уехал. */
export const cancelTransfer = async (transferId, actorId) => {
  if (!TRANSFER_ID_RE.test(String(transferId ?? ''))) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM logi_transfers WHERE id = $1 FOR UPDATE', [transferId]);
    const row = rows[0];
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const src = await warehouseAccess(row.from_wh_id, actorId);
    if (!src || !MAY_MANAGE.has(src.role)) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (['done', 'cancelled'].includes(row.status)) {
      await client.query('ROLLBACK');
      return { error: 'already_closed' };
    }

    const { rows: upd } = await client.query(
      `UPDATE logi_transfers SET status = 'cancelled', completed_at = now()
        WHERE id = $1 RETURNING *`, [transferId]);
    await client.query(
      `INSERT INTO logi_stock (id, warehouse_id, product_id, product_title, quantity)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (warehouse_id, product_id) DO UPDATE
         SET quantity = logi_stock.quantity + EXCLUDED.quantity, updated_at = now()`,
      [`lst-${generateId()}`, row.from_wh_id, row.product_id, row.product_title, row.quantity]);
    await client.query('COMMIT');
    return { transfer: toTransfer(upd[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Сотрудники ───────────────────────────────────────────────────── */

export const listStaff = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return null;
  const { rows } = await query(
    `SELECT s.id, s.profile_id, s.role, s.assigned_at, p.name, p.username
       FROM logi_warehouse_staff s JOIN profiles p ON p.id = s.profile_id
      WHERE s.warehouse_id = $1 ORDER BY s.assigned_at`, [warehouseId]);
  return rows.map((r) => ({
    id: r.id,
    warehouseId,
    accountId: r.profile_id,
    name: r.name,
    username: r.username,
    role: r.role,
    assignedAt: r.assigned_at?.toISOString?.() ?? undefined,
  }));
};

/** Сотрудников заводит владелец. Менеджер их только видит. */
export const addStaff = async (warehouseId, actorId, username, role) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_OWN.has(found.role)) return { error: 'not_allowed' };

  const nick = text(username, 40).replace(/^@/, '');
  const { rows: p } = await query(
    'SELECT id, name, username FROM profiles WHERE lower(username) = lower($1)', [nick]);
  if (!p[0]) return { error: 'no_such_user' };
  if (p[0].id === found.warehouse.seller_id) return { error: 'owner_already' };

  const { rows } = await query(
    `INSERT INTO logi_warehouse_staff (id, warehouse_id, profile_id, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (warehouse_id, profile_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [`lws-${generateId()}`, warehouseId, p[0].id,
      role === 'manager' ? 'manager' : 'worker']);

  await logWarehouse(warehouseId, actorId, 'staff_added', `Добавлен сотрудник @${p[0].username}`);
  await logLogi(actorId, 'staff_added', warehouseId, { role: rows[0].role });
  return {
    staff: {
      id: rows[0].id, warehouseId, accountId: p[0].id, name: p[0].name,
      username: p[0].username, role: rows[0].role,
      assignedAt: rows[0].assigned_at?.toISOString?.() ?? undefined,
    },
  };
};

export const removeStaff = async (staffId, actorId) => {
  const { rows } = await query(
    'SELECT warehouse_id FROM logi_warehouse_staff WHERE id = $1', [String(staffId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  const found = await warehouseAccess(rows[0].warehouse_id, actorId);
  if (!found || !MAY_OWN.has(found.role)) return { error: 'not_found' };
  await query('DELETE FROM logi_warehouse_staff WHERE id = $1', [staffId]);
  await logWarehouse(rows[0].warehouse_id, actorId, 'staff_removed', 'Сотрудник убран');
  return { ok: true };
};

/* ─── Журнал склада ────────────────────────────────────────────────── */

export const logWarehouse = async (warehouseId, actorId, type, line) => {
  try {
    await query(
      `INSERT INTO logi_warehouse_log (warehouse_id, actor_id, type, text)
       VALUES ($1,$2,$3,$4)`,
      [warehouseId, actorId ?? null, text(type, 40), text(line, 300)]);
  } catch {
    /* Журнал не должен ронять то, что он описывает. */
  }
};

export const listWarehouseLog = async (warehouseId, actorId, { limit } = {}) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return null;
  const lim = int(limit, 1, 200) ?? 100;
  const { rows } = await query(
    `SELECT id, type, text, created_at FROM logi_warehouse_log
      WHERE warehouse_id = $1 ORDER BY created_at DESC LIMIT $2`, [warehouseId, lim]);
  return rows.map((r) => ({
    id: String(r.id),
    warehouseId,
    type: r.type,
    text: r.text,
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};
