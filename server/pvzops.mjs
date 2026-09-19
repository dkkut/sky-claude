/**
 * Sky ПВЗ: сотрудники, ячейки, ключи, безопасная выдача заказа, журнал.
 *
 * Дополняет, а не заменяет, существующую машину заказов
 * (marketorders.mjs) и доставку (marketdelivery.mjs). Покупатель по-
 * прежнему может сам подтвердить получение кнопкой — этот путь не
 * тронут. Здесь — параллельный, для точек, которые ведёт сотрудник:
 * заказ кладут в конкретную ячейку, а забрать его может только тот, кто
 * назвал код, который сервер сам выдал покупателю и сам же проверяет.
 *
 * Обо всех правах.
 *
 * Сотрудник точки — не администратор Sky. Он получает только то, что
 * ему выдали для ЭТОЙ точки (`market_pvz_staff.permissions`), и это
 * никак не пересекается с ролями admin.mjs. Первого сотрудника точки
 * может завести только Sky-администрация (permission 'market') —
 * дальше уже сотрудник с правом 'admin' может звать и убирать других
 * для той же точки и только для неё.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { generateNumericCode, hashCode, codesEqual } from './crypto.mjs';
import { marketText as text, marketInt as int, ORDER_ID_RE, logMarket } from './market.mjs';
import { applyTransition, toOrder } from './marketorders.mjs';
import { pushMarket } from './signal.mjs';

export const PVZ_ID_RE = /^mpp-[0-9a-f-]{36}$/;
export const CELL_ID_RE = /^pzc-[0-9a-f-]{36}$/;
export const KEY_ID_RE = /^pzk-[0-9a-f-]{36}$/;
export const STAFF_ID_RE = /^pzs-[0-9a-f-]{36}$/;

/** Закрытый список прав сотрудника точки. Ничего сверх этого списка не проверяется и не хранится. */
export const PERMISSIONS = ['view', 'receive', 'place', 'issue', 'cells', 'keys', 'returns', 'admin'];

const CELL_STATES = ['FREE', 'RESERVED', 'OCCUPIED', 'BLOCKED', 'MAINTENANCE'];
const KEY_STATES = ['AVAILABLE', 'ISSUED', 'LOST', 'BLOCKED'];

/* ─── Журнал (только запись) ─────────────────────────────────────────── */

export const logPvz = async (client, pvzId, actorId, action, target = {}, detail = {}, suspicious = false) => {
  const runner = client ?? { query };
  try {
    await runner.query(
      `INSERT INTO market_pvz_audit (pvz_id, actor_id, action, target_type, target_id, detail, suspicious)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [pvzId, actorId ?? null, text(action, 64), text(target.type, 32) || '',
        text(target.id, 80) || '', JSON.stringify(detail ?? {}), Boolean(suspicious)]);
  } catch {
    /* Журнал не должен ронять операцию, которую он описывает. */
  }
};

export const auditFor = async (pvzId, actorId, { limit } = {}) => {
  if (!(await hasPermission(pvzId, actorId, 'admin')) && !(await can(actorId, 'market'))) return null;
  const lim = int(limit, 1, 500) ?? 200;
  const { rows } = await query(
    `SELECT id, actor_id, action, target_type, target_id, detail, suspicious, created_at
       FROM market_pvz_audit WHERE pvz_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [pvzId, lim]);
  return rows.map((r) => ({
    id: String(r.id), actorId: r.actor_id, action: r.action,
    targetType: r.target_type, targetId: r.target_id, detail: r.detail,
    suspicious: r.suspicious, createdAt: r.created_at.toISOString(),
  }));
};

/* ─── Сотрудники / права ─────────────────────────────────────────────── */

/** Чем этот человек может распоряжаться на этой точке. Пусто, если ничем. */
export const permissionsOf = async (pvzId, profileId) => {
  if (!PVZ_ID_RE.test(String(pvzId ?? '')) || !profileId) return [];
  const { rows } = await query(
    `SELECT permissions FROM market_pvz_staff
      WHERE pvz_id = $1 AND profile_id = $2 AND status = 'active'`,
    [pvzId, profileId]);
  return rows[0]?.permissions ?? [];
};

export const hasPermission = async (pvzId, profileId, perm) => {
  const list = await permissionsOf(pvzId, profileId);
  return list.includes(perm) || list.includes('admin');
};

/**
 * Может ли распоряжаться точкой вообще (для видеообзора и общих
 * действий администрирования): либо сотрудник с правом 'admin' на
 * этой самой точке, либо Sky-администрация.
 */
export const mayManagePvz = async (pvzId, actorId) =>
  (await hasPermission(pvzId, actorId, 'admin')) || (await can(actorId, 'market'));

/** Любой активный сотрудник этой точки — для видеообзора и справок, доступных «по месту работы». */
export const isStaffOf = async (pvzId, actorId) => (await permissionsOf(pvzId, actorId)).length > 0;

const pvzExists = async (pvzId) => {
  const { rows } = await query('SELECT id FROM market_pickup_points WHERE id = $1', [String(pvzId ?? '')]);
  return Boolean(rows[0]);
};

export const listStaff = async (pvzId, actorId) => {
  if (!(await isStaffOf(pvzId, actorId)) && !(await can(actorId, 'market'))) return null;
  const { rows } = await query(
    `SELECT s.id, s.profile_id, s.permissions, s.status, s.created_at, s.revoked_at,
            p.name, p.username
       FROM market_pvz_staff s JOIN profiles p ON p.id = s.profile_id
      WHERE s.pvz_id = $1 ORDER BY s.status, s.created_at`, [pvzId]);
  return rows.map((r) => ({
    id: r.id, profileId: r.profile_id, name: r.name, username: r.username,
    permissions: r.permissions, status: r.status,
    createdAt: r.created_at.toISOString(), revokedAt: r.revoked_at?.toISOString() ?? null,
  }));
};

export const addStaff = async (pvzId, actorId, targetProfileId, permissions) => {
  if (!(await pvzExists(pvzId))) return { error: 'not_found' };
  if (!(await mayManagePvz(pvzId, actorId))) return { error: 'not_allowed' };
  const target = text(targetProfileId, 80);
  if (!target) return { error: 'bad_profile' };
  const perms = Array.isArray(permissions)
    ? [...new Set(permissions.map((p) => String(p)).filter((p) => PERMISSIONS.includes(p)))]
    : [];
  if (perms.length === 0) return { error: 'bad_permissions' };

  const { rows: p } = await query('SELECT id FROM profiles WHERE id = $1', [target]);
  if (!p[0]) return { error: 'bad_profile' };

  const id = `pzs-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO market_pvz_staff (id, pvz_id, profile_id, permissions, added_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (pvz_id, profile_id) DO UPDATE SET
       permissions = EXCLUDED.permissions, status = 'active', revoked_at = NULL, revoked_by = NULL
     RETURNING id`,
    [id, pvzId, target, perms, actorId]);
  await logPvz(null, pvzId, actorId, 'staff_added', { type: 'staff', id: rows[0].id }, { profileId: target, permissions: perms });
  return { id: rows[0].id };
};

export const revokeStaff = async (pvzId, actorId, staffId) => {
  if (!(await mayManagePvz(pvzId, actorId))) return { error: 'not_allowed' };
  if (!STAFF_ID_RE.test(String(staffId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    `UPDATE market_pvz_staff SET status = 'revoked', revoked_at = now(), revoked_by = $3
      WHERE id = $1 AND pvz_id = $2 AND status = 'active' RETURNING profile_id`,
    [staffId, pvzId, actorId]);
  if (!rows[0]) return { error: 'not_found' };
  /* Себя разжаловать можно, соседа по другой точке — нет: WHERE pvz_id
     выше уже это отсекает. Права Sky-панели это в любом случае не
     трогает — их тут никогда и не было. */
  await logPvz(null, pvzId, actorId, 'staff_revoked', { type: 'staff', id: staffId }, { profileId: rows[0].profile_id });
  return { ok: true };
};

/** Точки, где человек работает — чтобы кабинет знал, куда его пускать. */
export const myPvzMemberships = async (profileId) => {
  const { rows } = await query(
    `SELECT s.pvz_id, s.permissions, p.title, p.city, p.address, p.staff_closed
       FROM market_pvz_staff s JOIN market_pickup_points p ON p.id = s.pvz_id
      WHERE s.profile_id = $1 AND s.status = 'active' ORDER BY p.title`, [profileId]);
  return rows.map((r) => ({
    pvzId: r.pvz_id, permissions: r.permissions, title: r.title, city: r.city,
    address: r.address, staffClosed: r.staff_closed,
  }));
};

/* ─── Временное закрытие точки ───────────────────────────────────────── */

export const setStaffClosed = async (pvzId, actorId, closed, reason = '') => {
  if (!(await hasPermission(pvzId, actorId, 'admin')) && !(await can(actorId, 'market'))) {
    return { error: 'not_allowed' };
  }
  await query(
    `UPDATE market_pickup_points SET staff_closed = $2, staff_closed_reason = $3 WHERE id = $1`,
    [pvzId, Boolean(closed), closed ? text(reason, 200) : '']);
  await logPvz(null, pvzId, actorId, closed ? 'pvz_closed' : 'pvz_reopened', { type: 'pvz', id: pvzId }, { reason }, closed);
  return { ok: true };
};

/* ─── Ячейки ──────────────────────────────────────────────────────────── */

const toCell = (r) => ({
  id: r.id, pvzId: r.pvz_id, number: r.number, size: r.size, status: r.status,
  hasKey: r.has_key, currentOrderId: r.current_order_id, blockReason: r.block_reason,
  updatedAt: r.updated_at.toISOString(),
});

export const listCells = async (pvzId, actorId) => {
  if (!(await hasPermission(pvzId, actorId, 'view')) && !(await can(actorId, 'market'))) return null;
  const { rows } = await query(
    `SELECT * FROM market_pvz_cells WHERE pvz_id = $1 ORDER BY number`, [pvzId]);
  return rows.map(toCell);
};

export const upsertCell = async (pvzId, actorId, { number, size, hasKey }) => {
  if (!(await hasPermission(pvzId, actorId, 'cells'))) return { error: 'not_allowed' };
  const num = text(number, 20);
  if (!num) return { error: 'bad_cell' };
  const sz = ['S', 'M', 'L', 'XL'].includes(String(size)) ? String(size) : 'M';
  const id = `pzc-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO market_pvz_cells (id, pvz_id, number, size, has_key)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (pvz_id, number) DO UPDATE SET size = EXCLUDED.size, has_key = EXCLUDED.has_key,
       updated_at = now()
     RETURNING id`,
    [id, pvzId, num, sz, Boolean(hasKey)]);
  await logPvz(null, pvzId, actorId, 'cell_upserted', { type: 'cell', id: rows[0].id }, { number: num, size: sz });
  return { id: rows[0].id };
};

/**
 * Аварийный перевод ячейки: BLOCKED/MAINTENANCE вручную, или снятие
 * блокировки обратно во FREE. OCCUPIED/RESERVED руками не ставится —
 * это только следствие place()/reserve(), иначе ячейку можно было бы
 * подменить заказом, которого там нет.
 */
export const setCellStatus = async (pvzId, actorId, cellId, status, reason = '') => {
  if (!(await hasPermission(pvzId, actorId, 'cells'))) return { error: 'not_allowed' };
  if (!CELL_ID_RE.test(String(cellId ?? ''))) return { error: 'not_found' };
  if (!['FREE', 'BLOCKED', 'MAINTENANCE'].includes(String(status))) return { error: 'bad_status' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM market_pvz_cells WHERE id = $1 AND pvz_id = $2 FOR UPDATE`, [cellId, pvzId]);
    const cell = rows[0];
    if (!cell) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (status === 'FREE' && cell.current_order_id) {
      await client.query('ROLLBACK');
      return { error: 'cell_occupied' };
    }
    await client.query(
      `UPDATE market_pvz_cells SET status = $2, block_reason = $3, updated_at = now() WHERE id = $1`,
      [cellId, status, status === 'FREE' ? '' : text(reason, 200)]);
    await client.query('COMMIT');
    await logPvz(null, pvzId, actorId, 'cell_status', { type: 'cell', id: cellId }, { status, reason },
      status !== 'FREE');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Приём и размещение заказа ──────────────────────────────────────── */

/** Заказ этой точки — не любой: pickup_point_id должен совпасть. */
const orderOfPvz = async (client, pvzId, orderId) => {
  const { rows } = await client.query(
    `SELECT * FROM market_orders WHERE id = $1 AND pickup_point_id = $2 FOR UPDATE`,
    [orderId, pvzId]);
  return rows[0] ?? null;
};

export const receiveOrder = async (pvzId, actorId, orderId) => {
  if (!(await hasPermission(pvzId, actorId, 'receive'))) return { error: 'not_allowed' };
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  const { rows } = await query(
    `SELECT id, status FROM market_orders WHERE id = $1 AND pickup_point_id = $2`, [id, pvzId]);
  if (!rows[0]) return { error: 'not_found' };
  await logPvz(null, pvzId, actorId, 'order_received', { type: 'order', id }, { status: rows[0].status });
  return { ok: true };
};

/**
 * Положить заказ в ячейку. Один заказ — одна ячейка (market_pvz_cells_order_idx
 * страхует то же самое на уровне базы: два одновременных «положить»
 * упрутся в один и тот же уникальный индекс, и второй получит отказ, а
 * не тихую перезапись первого).
 */
export const placeInCell = async (pvzId, actorId, orderId, cellId) => {
  if (!(await hasPermission(pvzId, actorId, 'place'))) return { error: 'not_allowed' };
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  if (!CELL_ID_RE.test(String(cellId ?? ''))) return { error: 'bad_cell' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await orderOfPvz(client, pvzId, id);
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    const { rows: cellRows } = await client.query(
      `SELECT * FROM market_pvz_cells WHERE id = $1 AND pvz_id = $2 FOR UPDATE`, [cellId, pvzId]);
    const cell = cellRows[0];
    if (!cell) { await client.query('ROLLBACK'); return { error: 'bad_cell' }; }
    if (!['FREE', 'RESERVED'].includes(cell.status)) { await client.query('ROLLBACK'); return { error: 'cell_not_free' }; }
    if (cell.status === 'RESERVED' && cell.current_order_id && cell.current_order_id !== id) {
      await client.query('ROLLBACK');
      return { error: 'cell_reserved_for_other' };
    }

    const { rows: already } = await client.query(
      `SELECT id FROM market_pvz_cells WHERE current_order_id = $1 AND id <> $2`, [id, cellId]);
    if (already[0]) { await client.query('ROLLBACK'); return { error: 'order_already_placed' }; }

    try {
      await client.query(
        `UPDATE market_pvz_cells SET status = 'OCCUPIED', current_order_id = $2, updated_at = now() WHERE id = $1`,
        [cellId, id]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (String(err.code) === '23505') return { error: 'order_already_placed' };
      throw err;
    }
    await client.query('COMMIT');
    await logPvz(null, pvzId, actorId, 'order_placed', { type: 'order', id }, { cellId, cellNumber: cell.number });
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export const reserveCell = async (pvzId, actorId, orderId, cellId) => {
  if (!(await hasPermission(pvzId, actorId, 'place'))) return { error: 'not_allowed' };
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  if (!CELL_ID_RE.test(String(cellId ?? ''))) return { error: 'bad_cell' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await orderOfPvz(client, pvzId, id);
    if (!order) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    const { rows: cellRows } = await client.query(
      `SELECT * FROM market_pvz_cells WHERE id = $1 AND pvz_id = $2 AND status = 'FREE' FOR UPDATE`,
      [cellId, pvzId]);
    if (!cellRows[0]) { await client.query('ROLLBACK'); return { error: 'cell_not_free' }; }
    try {
      await client.query(
        `UPDATE market_pvz_cells SET status = 'RESERVED', current_order_id = $2, updated_at = now() WHERE id = $1`,
        [cellId, id]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (String(err.code) === '23505') return { error: 'order_already_placed' };
      throw err;
    }
    await client.query('COMMIT');
    await logPvz(null, pvzId, actorId, 'cell_reserved', { type: 'order', id }, { cellId });
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Ключи ───────────────────────────────────────────────────────────── */

const toKey = (r) => ({
  id: r.id, pvzId: r.pvz_id, cellId: r.cell_id, status: r.status,
  currentHolderId: r.current_holder_id, issuedAt: r.issued_at?.toISOString?.() ?? null,
  returnedAt: r.returned_at?.toISOString?.() ?? null,
  returnedConfirmedBy: r.returned_confirmed_by ?? null,
  createdAt: r.created_at.toISOString(),
});

export const listKeys = async (pvzId, actorId) => {
  if (!(await hasPermission(pvzId, actorId, 'keys')) && !(await hasPermission(pvzId, actorId, 'view'))) return null;
  const { rows } = await query(
    `SELECT k.* FROM market_pvz_keys k WHERE k.pvz_id = $1 ORDER BY k.created_at DESC LIMIT 500`, [pvzId]);
  return rows.map(toKey);
};

/** Новый ключ под ячейку (первичная выдача или перекодировка после утери). */
export const createKey = async (pvzId, actorId, cellId) => {
  if (!(await hasPermission(pvzId, actorId, 'keys'))) return { error: 'not_allowed' };
  if (!CELL_ID_RE.test(String(cellId ?? ''))) return { error: 'bad_cell' };
  const { rows: cellRows } = await query(
    `SELECT id, has_key FROM market_pvz_cells WHERE id = $1 AND pvz_id = $2`, [cellId, pvzId]);
  if (!cellRows[0]) return { error: 'bad_cell' };
  if (!cellRows[0].has_key) return { error: 'cell_has_no_key' };

  const { rows: live } = await query(
    `SELECT id FROM market_pvz_keys WHERE cell_id = $1 AND status IN ('AVAILABLE','ISSUED')`, [cellId]);
  if (live[0]) return { error: 'key_already_exists' };

  const id = `pzk-${generateId()}`;
  await query(`INSERT INTO market_pvz_keys (id, pvz_id, cell_id) VALUES ($1,$2,$3)`, [id, pvzId, cellId]);
  await logPvz(null, pvzId, actorId, 'key_created', { type: 'key', id }, { cellId });
  return { id };
};

export const issueKeyToStaff = async (pvzId, actorId, keyId, toProfileId) => {
  if (!(await hasPermission(pvzId, actorId, 'keys'))) return { error: 'not_allowed' };
  if (!KEY_ID_RE.test(String(keyId ?? ''))) return { error: 'not_found' };
  const holder = text(toProfileId, 80);
  if (!holder || !(await isStaffOf(pvzId, holder))) return { error: 'bad_holder' };

  const { rows } = await query(
    `UPDATE market_pvz_keys SET status = 'ISSUED', current_holder_id = $3, issued_at = now(),
        returned_at = NULL, returned_confirmed_by = NULL
      WHERE id = $1 AND pvz_id = $2 AND status = 'AVAILABLE' RETURNING cell_id`,
    [keyId, pvzId, holder]);
  if (!rows[0]) return { error: 'key_not_available' };
  await logPvz(null, pvzId, actorId, 'key_issued', { type: 'key', id: keyId }, { toProfileId: holder, cellId: rows[0].cell_id });
  return { ok: true };
};

export const returnKeyFromStaff = async (pvzId, actorId, keyId) => {
  if (!(await hasPermission(pvzId, actorId, 'keys'))) return { error: 'not_allowed' };
  if (!KEY_ID_RE.test(String(keyId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    `UPDATE market_pvz_keys SET status = 'AVAILABLE', current_holder_id = NULL,
        returned_at = now(), returned_confirmed_by = $3
      WHERE id = $1 AND pvz_id = $2 AND status = 'ISSUED' RETURNING cell_id, current_holder_id`,
    [keyId, pvzId, actorId]);
  if (!rows[0]) return { error: 'key_not_issued' };
  await logPvz(null, pvzId, actorId, 'key_returned', { type: 'key', id: keyId },
    { cellId: rows[0].cell_id, wasHeldBy: rows[0].current_holder_id });
  return { ok: true };
};

export const reportKeyLost = async (pvzId, actorId, keyId) => {
  if (!(await hasPermission(pvzId, actorId, 'keys'))) return { error: 'not_allowed' };
  if (!KEY_ID_RE.test(String(keyId ?? ''))) return { error: 'not_found' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE market_pvz_keys SET status = 'LOST'
        WHERE id = $1 AND pvz_id = $2 AND status IN ('AVAILABLE','ISSUED') RETURNING cell_id`,
      [keyId, pvzId]);
    if (!rows[0]) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    /* Ячейку блокируем сразу: без ключа выдавать из неё нечего, пока
       не перекодировали замок и не завели новый ключ. */
    await client.query(
      `UPDATE market_pvz_cells SET status = 'BLOCKED', block_reason = 'Утерян ключ', updated_at = now()
        WHERE id = $1 AND status NOT IN ('BLOCKED')`, [rows[0].cell_id]);
    await client.query('COMMIT');
    await logPvz(null, pvzId, actorId, 'key_lost', { type: 'key', id: keyId }, { cellId: rows[0].cell_id }, true);
    return { ok: true, cellId: rows[0].cell_id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Код получения ───────────────────────────────────────────────────── */

/**
 * Завести код получения для заказа, готового к выдаче из пункта
 * выдачи. Вызывается доставкой (marketdelivery.mjs) в момент
 * ready_for_pickup, не клиентом. Возвращает код открытым текстом ровно
 * один раз — дальше он хранится только зашифрованным.
 */
export const issuePickupCode = async (client, orderId) => {
  const code = generateNumericCode(6);
  await client.query(
    `UPDATE market_orders SET pickup_code_enc = $2 WHERE id = $1`,
    [orderId, encryptContent(code)]);
  return code;
};

export const pickupCodeFor = (order) => {
  if (!order.pickup_code_enc) return null;
  return decryptContent(order.pickup_code_enc) || null;
};

/**
 * Выдать заказ покупателю, проверив код на сервере.
 *
 * Сервер сам устанавливает всю цепочку покупатель ↔ заказ ↔ пункт ↔
 * ячейка по своим собственным записям: из запроса читаются только
 * orderId и code, ничего похожего на buyerId здесь не принимается.
 */
export const verifyPickup = async (pvzId, actorId, orderId, code) => {
  if (!(await hasPermission(pvzId, actorId, 'issue'))) return { error: 'not_allowed' };
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  const given = text(code, 20).replace(/\D/g, '');
  if (!given) return { error: 'bad_code' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await orderOfPvz(client, pvzId, id);
    if (!order) {
      await client.query('ROLLBACK');
      await logPvz(null, pvzId, actorId, 'issue_denied', { type: 'order', id }, { reason: 'not_found' }, true);
      return { error: 'not_found' };
    }
    if (order.status !== 'ready_for_pickup') {
      await client.query('ROLLBACK');
      return { error: 'wrong_state', status: order.status };
    }
    const real = pickupCodeFor(order);
    if (!real || !codesEqual(hashCode(given, id), hashCode(real, id))) {
      await client.query('ROLLBACK');
      await logPvz(null, pvzId, actorId, 'issue_denied', { type: 'order', id }, { reason: 'bad_code' }, true);
      return { error: 'bad_code' };
    }

    const { row, notes } = await applyTransition(client, order, {
      to: 'buyer_received', actorId, actorRole: 'pvz_staff', detail: { pvzId },
    });
    /* Та же дозакрывающая ступень, что actOnOrder делает для
       самостоятельного подтверждения покупателем: сделка не должна
       остаться висеть на buyer_received только потому, что подтвердил
       её не сам покупатель, а сотрудник точки. */
    const done = await applyTransition(client, row, {
      to: 'completed', actorId: null, actorRole: 'system', detail: { auto: true, byStaff: actorId },
    });
    await client.query(
      `UPDATE market_products SET sold = sold + $2, updated_at = now() WHERE id = $1`,
      [order.product_id, order.quantity]);
    await client.query(
      `UPDATE market_sellers SET orders_done = orders_done + 1, updated_at = now() WHERE profile_id = $1`,
      [order.seller_id]);

    await client.query(
      `UPDATE market_pvz_cells SET status = 'FREE', current_order_id = NULL, updated_at = now()
        WHERE current_order_id = $1`, [id]);

    await client.query('COMMIT');
    for (const n of [...notes, ...done.notes]) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
    await logPvz(null, pvzId, actorId, 'order_issued', { type: 'order', id }, {});
    await logMarket(actorId, 'pvz_order_issued', id, { pvzId });
    return { order: toOrder(done.row, 'support') };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Обзор точки для кабинета сотрудника ───────────────────────────── */

export const pvzOverview = async (pvzId, actorId) => {
  if (!(await isStaffOf(pvzId, actorId)) && !(await can(actorId, 'market'))) return null;
  const { rows } = await query(
    `SELECT id, title, city, address, phone, work_from, work_to, hold_days,
            active, staff_closed, staff_closed_reason
       FROM market_pickup_points WHERE id = $1`, [pvzId]);
  const p = rows[0];
  if (!p) return null;
  const { rows: waiting } = await query(
    `SELECT id, title_snap, pickup_until FROM market_orders
      WHERE pickup_point_id = $1 AND status = 'ready_for_pickup' ORDER BY pickup_until`, [pvzId]);
  return {
    id: p.id, title: p.title, city: p.city, address: p.address, phone: p.phone,
    workFrom: p.work_from, workTo: p.work_to, holdDays: p.hold_days,
    active: p.active, staffClosed: p.staff_closed, staffClosedReason: p.staff_closed_reason,
    waitingOrders: waiting.map((o) => ({
      id: o.id, title: o.title_snap, pickupUntil: o.pickup_until?.toISOString?.() ?? null,
    })),
  };
};

export { CELL_STATES, KEY_STATES };
