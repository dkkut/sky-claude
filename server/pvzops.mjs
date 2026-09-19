/**
 * Sky ПВЗ: владение точкой, сотрудники, ячейки, ключи, безопасная
 * выдача заказа, журнал.
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
 * Сотрудник точки — не администратор Sky. Он получает роль ровно для
 * ЭТОЙ точки (`market_pvz_staff.role`), и это никак не пересекается с
 * ролями admin.mjs. Ролей четыре, по возрастанию:
 *
 *   read_only  — только смотреть;
 *   employee   — приёмка, размещение, выдача, возвраты;
 *   manager    — операционное управление: ячейки, ключи, видео,
 *                временное закрытие, наём employee/read_only;
 *   owner      — полный контроль точки: подписка, начисления,
 *                наём manager, снятие с точки.
 *
 * Первого владельца точка получает при создании (createPvz) — это тот,
 * кто её завёл. Sky-администрация (permission 'market') может править
 * любую точку поверх этого — как администрация уже правит каталог
 * (upsertPickupPoint) — но роль в самой панели Sky ей это не даёт и не
 * может дать: pvzops.mjs прав admin.mjs не читает и не выдаёт.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { wallet } from './wallet.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { generateNumericCode, hashCode, codesEqual } from './crypto.mjs';
import { marketText as text, marketInt as int, ORDER_ID_RE, logMarket } from './market.mjs';
import { applyTransition, toOrder } from './marketorders.mjs';
import { pushMarket } from './signal.mjs';

export const PVZ_ID_RE = /^mpp-[0-9a-f-]{36}$/;
export const CELL_ID_RE = /^pzc-[0-9a-f-]{36}$/;
export const KEY_ID_RE = /^pzk-[0-9a-f-]{36}$/;
export const STAFF_ID_RE = /^pzs-[0-9a-f-]{36}$/;

/** Закрытый список прав — оставлен для 059: старые проверки (setCellStatus и т.п.) спрашивают их по имени, а не по рангу роли напрямую. */
export const PERMISSIONS = ['view', 'receive', 'place', 'issue', 'cells', 'keys', 'returns', 'admin'];
export const ROLES = ['read_only', 'employee', 'manager', 'owner'];
const ROLE_RANK = { read_only: 0, employee: 1, manager: 2, owner: 3 };
/** С какого ранга роли доступно каждое право из PERMISSIONS. */
const PERM_MIN_RANK = {
  view: 0, receive: 1, place: 1, issue: 1, returns: 1,
  cells: 2, keys: 2, admin: 2,
};

const CELL_STATES = ['FREE', 'RESERVED', 'OCCUPIED', 'BLOCKED', 'MAINTENANCE'];
const KEY_STATES = ['AVAILABLE', 'ISSUED', 'LOST', 'BLOCKED'];

/** Сколько стоит держать точку активной. Системный параметр, не настройка владельца. */
export const PVZ_SUBSCRIPTION_PRICE = 359;
export const PVZ_SUBSCRIPTION_DAYS = 30;
/** Комиссия владельцу точки с закрытого заказа. Применённый процент сохраняется в строке начисления — смена этой константы не пересчитывает прошлое. */
export const PVZ_OWNER_COMMISSION_PERCENT = 10;

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

/** Роль этого человека на этой точке — или null, если он там не работает. */
export const roleOf = async (pvzId, profileId) => {
  if (!PVZ_ID_RE.test(String(pvzId ?? '')) || !profileId) return null;
  const { rows } = await query(
    `SELECT role FROM market_pvz_staff
      WHERE pvz_id = $1 AND profile_id = $2 AND status = 'active'`,
    [pvzId, profileId]);
  return rows[0]?.role ?? null;
};

const rankOf = async (pvzId, profileId) => {
  const role = await roleOf(pvzId, profileId);
  return role ? ROLE_RANK[role] : -1;
};

export const hasPermission = async (pvzId, profileId, perm) => {
  const rank = await rankOf(pvzId, profileId);
  return rank >= (PERM_MIN_RANK[perm] ?? 4);
};

export const hasRole = async (pvzId, profileId, minRole) =>
  (await rankOf(pvzId, profileId)) >= ROLE_RANK[minRole];

/**
 * Может ли распоряжаться точкой вообще (для видеообзора и общих
 * действий администрирования): либо manager/owner на этой самой
 * точке, либо Sky-администрация.
 */
export const mayManagePvz = async (pvzId, actorId) =>
  (await hasRole(pvzId, actorId, 'manager')) || (await can(actorId, 'market'));

/** Владелец точки — для подписки, начислений, распоряжения точкой целиком. */
export const isOwnerOf = async (pvzId, actorId) =>
  (await hasRole(pvzId, actorId, 'owner')) || (await can(actorId, 'market'));

/** Любой активный сотрудник этой точки — для видеообзора и справок, доступных «по месту работы». */
export const isStaffOf = async (pvzId, actorId) => (await roleOf(pvzId, actorId)) !== null;

const pvzExists = async (pvzId) => {
  const { rows } = await query('SELECT id FROM market_pickup_points WHERE id = $1', [String(pvzId ?? '')]);
  return Boolean(rows[0]);
};

export const listStaff = async (pvzId, actorId) => {
  if (!(await isStaffOf(pvzId, actorId)) && !(await can(actorId, 'market'))) return null;
  const { rows } = await query(
    `SELECT s.id, s.profile_id, s.role, s.status, s.created_at, s.revoked_at,
            p.name, p.username
       FROM market_pvz_staff s JOIN profiles p ON p.id = s.profile_id
      WHERE s.pvz_id = $1 ORDER BY s.status, s.created_at`, [pvzId]);
  return rows.map((r) => ({
    id: r.id, profileId: r.profile_id, name: r.name, username: r.username,
    role: r.role, status: r.status,
    createdAt: r.created_at.toISOString(), revokedAt: r.revoked_at?.toISOString() ?? null,
  }));
};

/**
 * Нанять или переназначить сотрудника точки.
 *
 * Кто кого вправе назначить — решает ранг ролей, а не сам факт
 * распоряжения точкой: manager вправе завести employee/read_only, но
 * не другого manager и не owner — это назначение мог бы использовать
 * для того, чтобы возвыситься самому через подставного человека.
 * Только owner (или Sky-администрация) заводит owner/manager.
 */
export const addStaff = async (pvzId, actorId, targetProfileId, role) => {
  if (!(await pvzExists(pvzId))) return { error: 'not_found' };
  const r = ROLES.includes(String(role)) ? String(role) : null;
  if (!r) return { error: 'bad_role' };

  const callerRank = await rankOf(pvzId, actorId);
  const isSkyAdmin = await can(actorId, 'market');
  const effectiveCallerRank = isSkyAdmin ? ROLE_RANK.owner : callerRank;
  if (effectiveCallerRank < ROLE_RANK.manager) return { error: 'not_allowed' };
  if (ROLE_RANK[r] >= ROLE_RANK.manager && effectiveCallerRank < ROLE_RANK.owner) {
    return { error: 'not_allowed' };
  }

  const target = text(targetProfileId, 80);
  if (!target) return { error: 'bad_profile' };
  const { rows: p } = await query('SELECT id FROM profiles WHERE id = $1', [target]);
  if (!p[0]) return { error: 'bad_profile' };

  const id = `pzs-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO market_pvz_staff (id, pvz_id, profile_id, role, permissions, added_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (pvz_id, profile_id) DO UPDATE SET
       role = EXCLUDED.role, status = 'active', revoked_at = NULL, revoked_by = NULL
     RETURNING id`,
    [id, pvzId, target, r, [], actorId]);
  await logPvz(null, pvzId, actorId, 'staff_added', { type: 'staff', id: rows[0].id }, { profileId: target, role: r });
  return { id: rows[0].id };
};

export const revokeStaff = async (pvzId, actorId, staffId) => {
  if (!STAFF_ID_RE.test(String(staffId ?? ''))) return { error: 'not_found' };
  const { rows: targetRows } = await query(
    `SELECT profile_id, role FROM market_pvz_staff WHERE id = $1 AND pvz_id = $2 AND status = 'active'`,
    [staffId, pvzId]);
  const target = targetRows[0];
  if (!target) return { error: 'not_found' };

  const callerRank = await rankOf(pvzId, actorId);
  const isSkyAdmin = await can(actorId, 'market');
  const effectiveCallerRank = isSkyAdmin ? ROLE_RANK.owner : callerRank;
  if (effectiveCallerRank < ROLE_RANK.manager) return { error: 'not_allowed' };
  if (ROLE_RANK[target.role] >= ROLE_RANK.manager && effectiveCallerRank < ROLE_RANK.owner) {
    return { error: 'not_allowed' };
  }
  /* Точка без единого владельца — точка, в которую больше никто не
     войдёт с полными правами. Последнего owner снять нельзя, даже
     самому себе, даже Sky-администрации этой ручкой. */
  if (target.role === 'owner') {
    const { rows: owners } = await query(
      `SELECT count(*)::int AS n FROM market_pvz_staff
        WHERE pvz_id = $1 AND role = 'owner' AND status = 'active'`, [pvzId]);
    if ((owners[0]?.n ?? 0) <= 1) return { error: 'last_owner' };
  }

  const { rows } = await query(
    `UPDATE market_pvz_staff SET status = 'revoked', revoked_at = now(), revoked_by = $3
      WHERE id = $1 AND pvz_id = $2 AND status = 'active' RETURNING profile_id`,
    [staffId, pvzId, actorId]);
  if (!rows[0]) return { error: 'not_found' };
  await logPvz(null, pvzId, actorId, 'staff_revoked', { type: 'staff', id: staffId }, { profileId: rows[0].profile_id });
  return { ok: true };
};

/** Точки, где человек работает — чтобы кабинет знал, куда его пускать. */
export const myPvzMemberships = async (profileId) => {
  const { rows } = await query(
    `SELECT s.pvz_id, s.role, p.title, p.city, p.address, p.staff_closed, p.owner_status
       FROM market_pvz_staff s JOIN market_pickup_points p ON p.id = s.pvz_id
      WHERE s.profile_id = $1 AND s.status = 'active' ORDER BY p.title`, [profileId]);
  return rows.map((r) => ({
    pvzId: r.pvz_id, role: r.role, title: r.title, city: r.city,
    address: r.address, staffClosed: r.staff_closed, ownerStatus: r.owner_status,
  }));
};

/* ─── Создание и подписка точки ──────────────────────────────────────── */

const MAX_TITLE = 120;
const MAX_ADDR = 300;
const MAX_PAYMENT_DETAILS = 600;

/**
 * Владелец заводит свою точку. Она видна ему сразу (кабинет, сотрудники,
 * ячейки), но в публичный каталог (listPickupPoints) не попадает, пока
 * не оплачена подписка — owner_status начинается с pending_activation,
 * и marketdelivery.mjs уже учитывает staff_closed/active тем же
 * способом.
 */
export const createPvz = async (actorId, input = {}) => {
  const title = text(input.title, MAX_TITLE);
  const city = text(input.city, 80);
  const address = text(input.address, MAX_ADDR);
  if (!title || !city || !address) return { error: 'bad_pvz' };
  const cellCount = int(input.cellCount, 0, 2000) ?? 0;

  const id = `mpp-${generateId()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO market_pickup_points
         (id, title, city, address, phone, work_from, work_to, hold_days, active, owner_id, owner_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,'pending_activation')`,
      [id, title, city, address, text(input.phone, 40),
        text(input.workFrom, 5) || '09:00', text(input.workTo, 5) || '21:00',
        int(input.holdDays, 1, 60) ?? 7, actorId]);
    const staffId = `pzs-${generateId()}`;
    await client.query(
      `INSERT INTO market_pvz_staff (id, pvz_id, profile_id, role, permissions, added_by)
       VALUES ($1,$2,$3,'owner',$4,$3)`,
      [staffId, id, actorId, []]);
    for (let n = 1; n <= cellCount; n += 1) {
      await client.query(
        `INSERT INTO market_pvz_cells (id, pvz_id, number) VALUES ($1,$2,$3)`,
        [`pzc-${generateId()}`, id, String(n)]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await logPvz(null, id, actorId, 'pvz_created', { type: 'pvz', id }, { title, cellCount });
  return { id };
};

/**
 * Оплата активации — тем же способом, что подписка продавца
 * (market.mjs, paySellerSubscription): списание с кошелька Sky, не
 * внешний платёж. Sky не принимает деньги за товар и не держит их —
 * это плата за место в каталоге ПВЗ, и платится она туда же, куда
 * продавец платит за место на витрине.
 */
export const activatePvzSubscription = async (pvzId, actorId) => {
  if (!(await isOwnerOf(pvzId, actorId))) return { error: 'not_allowed' };
  const { rows: pvzRows } = await query('SELECT id FROM market_pickup_points WHERE id = $1', [pvzId]);
  if (!pvzRows[0]) return { error: 'not_found' };

  const paid = await wallet.spend(
    actorId, PVZ_SUBSCRIPTION_PRICE, 'pvz_subscription',
    `Sky ПВЗ: активация точки, ${PVZ_SUBSCRIPTION_DAYS} дн.`);
  if (paid.error) return paid;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE market_pickup_points
          SET owner_status = 'active', active = TRUE
        WHERE id = $1 RETURNING id`, [pvzId]);
    const until = new Date(Date.now() + PVZ_SUBSCRIPTION_DAYS * 86400_000);
    await client.query(
      `INSERT INTO market_pvz_owner_payments (id, pvz_id, profile_id, amount, days, until)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [`mpo-${generateId()}`, pvzId, actorId, PVZ_SUBSCRIPTION_PRICE, PVZ_SUBSCRIPTION_DAYS, until]);
    await client.query('COMMIT');
    if (!rows[0]) throw new Error('pvz vanished mid-activation');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await wallet.refund(actorId, PVZ_SUBSCRIPTION_PRICE, 'Sky ПВЗ: возврат за активацию').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await logPvz(null, pvzId, actorId, 'subscription_paid', { type: 'pvz', id: pvzId }, { days: PVZ_SUBSCRIPTION_DAYS });
  return { ok: true, balance: paid.balance };
};

/* ─── Временное закрытие точки ───────────────────────────────────────── */

export const setStaffClosed = async (pvzId, actorId, closed, reason = '') => {
  if (!(await mayManagePvz(pvzId, actorId))) {
    return { error: 'not_allowed' };
  }
  await query(
    `UPDATE market_pickup_points SET staff_closed = $2, staff_closed_reason = $3 WHERE id = $1`,
    [pvzId, Boolean(closed), closed ? text(reason, 200) : '']);
  await logPvz(null, pvzId, actorId, closed ? 'pvz_closed' : 'pvz_reopened', { type: 'pvz', id: pvzId }, { reason }, closed);
  return { ok: true };
};

/**
 * Настройки точки, которые вправе менять сам владелец: часы работы,
 * срок хранения, телефон. Название/город/адрес — только через
 * администрацию (upsertPickupPoint в market.mjs): их меняет карточка в
 * публичном каталоге и Google Карты, а не кабинет владельца.
 */
export const updatePvzSettings = async (pvzId, actorId, patch = {}) => {
  if (!(await isOwnerOf(pvzId, actorId))) return { error: 'not_allowed' };
  if (!(await pvzExists(pvzId))) return { error: 'not_found' };

  const sets = [];
  const args = [pvzId];
  const push = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
  /* В журнал попадают только имена изменённых полей, не значения —
     платёжные реквизиты в открытом виде в market_pvz_audit.detail не
     место (тот же принцип, что и у самих реквизитов: зашифрованы в
     покое, а не только на входе). */
  const changedFields = [];

  if (patch.phone !== undefined) { push('phone', text(patch.phone, 40)); changedFields.push('phone'); }
  if (patch.workFrom !== undefined) { push('work_from', text(patch.workFrom, 5) || '09:00'); changedFields.push('workFrom'); }
  if (patch.workTo !== undefined) { push('work_to', text(patch.workTo, 5) || '21:00'); changedFields.push('workTo'); }
  if (patch.holdDays !== undefined) { push('hold_days', int(patch.holdDays, 1, 60) ?? 7); changedFields.push('holdDays'); }
  if (patch.paymentDetails !== undefined) {
    const details = text(patch.paymentDetails, MAX_PAYMENT_DETAILS);
    push('owner_payment_details_enc', details ? encryptContent(details) : null);
    args.push(Boolean(details));
    sets.push(`has_owner_payment_details = $${args.length}`);
    changedFields.push('paymentDetails');
  }
  if (sets.length === 0) return { error: 'nothing_to_update' };

  await query(`UPDATE market_pickup_points SET ${sets.join(', ')} WHERE id = $1`, args);
  await logPvz(null, pvzId, actorId, 'pvz_settings_updated', { type: 'pvz', id: pvzId }, { fields: changedFields });
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

    /* Реальное размещение в ячейку и есть «готов к выдаче» — не слово
       продавца, а факт, который здесь же проверил сотрудник. Старый
       путь (продавец сам ставит ready_for_pickup в marketdelivery.mjs,
       для точек без владельца и кабинета) никуда не делся и по-прежнему
       работает — эта проверка просто не отступает назад и не дублирует
       переход, если он уже случился. */
    const ORDER_RANK = { fulfillment: 0, seller_shipped: 1, in_transit: 2 };
    if (Object.prototype.hasOwnProperty.call(ORDER_RANK, order.status)) {
      const { rows: pvzRows } = await client.query(
        'SELECT hold_days FROM market_pickup_points WHERE id = $1', [pvzId]);
      const holdDays = Number(pvzRows[0]?.hold_days ?? 7);
      if (!order.pickup_code_enc) await issuePickupCode(client, order.id);
      if (!order.pickup_qr_token_enc) await issuePickupQr(client, order.id);
      const { notes } = await applyTransition(client, order, {
        to: 'ready_for_pickup', actorId, actorRole: 'pvz_staff',
        detail: { pvzId, cellId, auto: true },
        extraSets: ['pickup_until = $$'],
        extraArgs: [new Date(Date.now() + holdDays * 86400_000)],
      });
      await client.query('COMMIT');
      for (const n of notes) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
      await logPvz(null, pvzId, actorId, 'order_placed', { type: 'order', id }, { cellId, cellNumber: cell.number });
      return { ok: true };
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
 * QR получения — тот же смысл, что код получения, только для сканера,
 * а не для голоса: длинный случайный токен вместо шести цифр, потому
 * что его не нужно произносить вслух или набирать руками. Оба
 * привязаны к заказу и служат друг другу вторым фактором — раздел 26.
 */
export const issuePickupQr = async (client, orderId) => {
  const token = crypto.randomBytes(24).toString('base64url');
  await client.query(
    `UPDATE market_orders SET pickup_qr_token_enc = $2 WHERE id = $1`,
    [orderId, encryptContent(token)]);
  return token;
};

export const pickupQrTokenFor = (order) => {
  if (!order.pickup_qr_token_enc) return null;
  return decryptContent(order.pickup_qr_token_enc) || null;
};

/** Что кодирует QR получения в приложении покупателя. */
export const pickupQrPayload = (orderId, token) => `skypvz:pickup:${orderId}:${token}`;

const parsePickupQrPayload = (raw) => {
  const m = /^skypvz:pickup:(mo-[0-9a-f-]{36}):([\w-]{20,64})$/.exec(String(raw ?? '').trim());
  return m ? { orderId: m[1], token: m[2] } : null;
};

/**
 * Начислить владельцу точки комиссию с закрытого заказа — один раз,
 * кто бы ни закрыл заказ: сотрудник по сканеру (verifyPickup) или сам
 * покупатель кнопкой «Получил» (marketorders.mjs, actOnOrder). Заказ
 * без владельца (точка администрации Sky) комиссии не создаёт —
 * начислять её там некому. ON CONFLICT (order_id) страхует от
 * повторного начисления, если оба пути каким-то образом сработают
 * по одному заказу.
 */
export const accrueCommissionIfNeeded = async (client, order) => {
  if (!order?.pickup_point_id) return;
  const { rows } = await client.query(
    `SELECT owner_id FROM market_pickup_points WHERE id = $1 AND owner_id IS NOT NULL`,
    [order.pickup_point_id]);
  const ownerId = rows[0]?.owner_id;
  if (!ownerId) return;
  const percent = PVZ_OWNER_COMMISSION_PERCENT;
  const amountKop = Math.round((Number(order.total_kop) * percent) / 100);
  await client.query(
    `INSERT INTO market_pvz_commissions
       (id, order_id, pvz_id, owner_id, seller_id, order_amount_kop, percent, amount_kop)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (order_id) DO NOTHING`,
    [`mpc-${generateId()}`, order.id, order.pickup_point_id, ownerId, order.seller_id,
      order.total_kop, percent, amountKop]);
};

/**
 * Выдать заказ покупателю, проверив код или QR на сервере.
 *
 * Сервер сам устанавливает всю цепочку покупатель ↔ заказ ↔ пункт ↔
 * ячейка по своим собственным записям: из запроса читаются только
 * orderId и то, что предъявил покупатель (код или содержимое QR),
 * ничего похожего на buyerId здесь не принимается.
 */
export const verifyPickup = async (pvzId, actorId, orderId, proof) => {
  if (!(await hasPermission(pvzId, actorId, 'issue'))) return { error: 'not_allowed' };

  const qr = parsePickupQrPayload(proof);
  const id = qr ? qr.orderId : String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  const givenCode = qr ? '' : text(proof, 20).replace(/\D/g, '');
  if (!qr && !givenCode) return { error: 'bad_code' };

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

    const ok = qr
      ? (() => {
          const real = pickupQrTokenFor(order);
          return Boolean(real) && codesEqual(hashCode(qr.token, id), hashCode(real, id));
        })()
      : (() => {
          const real = pickupCodeFor(order);
          return Boolean(real) && codesEqual(hashCode(givenCode, id), hashCode(real, id));
        })();
    if (!ok) {
      await client.query('ROLLBACK');
      await logPvz(null, pvzId, actorId, 'issue_denied', { type: 'order', id }, { reason: 'bad_proof' }, true);
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
    await accrueCommissionIfNeeded(client, done.row);

    await client.query(
      `UPDATE market_pvz_cells SET status = 'FREE', current_order_id = NULL, updated_at = now()
        WHERE current_order_id = $1`, [id]);

    await client.query('COMMIT');
    for (const n of [...notes, ...done.notes]) pushMarket([n.userId], { type: 'market-notification', payload: n.note });
    await logPvz(null, pvzId, actorId, 'order_issued', { type: 'order', id }, { via: qr ? 'qr' : 'code' });
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
  const role = await roleOf(pvzId, actorId);
  if (!role && !(await can(actorId, 'market'))) return null;
  const { rows } = await query(
    `SELECT id, title, city, address, phone, work_from, work_to, hold_days,
            active, staff_closed, staff_closed_reason, owner_id, owner_status,
            has_owner_payment_details, owner_payment_details_enc
       FROM market_pickup_points WHERE id = $1`, [pvzId]);
  const p = rows[0];
  if (!p) return null;
  const { rows: waiting } = await query(
    `SELECT id, title_snap, pickup_until FROM market_orders
      WHERE pickup_point_id = $1 AND status = 'ready_for_pickup' ORDER BY pickup_until`, [pvzId]);
  const { rows: pending } = await query(
    `SELECT count(*)::int AS n FROM market_pvz_cells WHERE pvz_id = $1`, [pvzId]);
  return {
    id: p.id, title: p.title, city: p.city, address: p.address, phone: p.phone,
    workFrom: p.work_from, workTo: p.work_to, holdDays: p.hold_days,
    active: p.active, staffClosed: p.staff_closed, staffClosedReason: p.staff_closed_reason,
    hasOwner: Boolean(p.owner_id), ownerStatus: p.owner_status, myRole: role,
    cellCount: pending[0]?.n ?? 0,
    hasOwnerPaymentDetails: Boolean(p.has_owner_payment_details),
    /* Сами реквизиты — только самому владельцу, тем же приёмом, что и
       у продавца (market.mjs, toSeller): постороннему сотруднику
       видно только, что реквизиты заданы, не что в них. */
    ownerPaymentDetails: ROLE_RANK[role] >= ROLE_RANK.owner && p.owner_payment_details_enc
      ? (decryptContent(p.owner_payment_details_enc) ?? '')
      : undefined,
    waitingOrders: waiting.map((o) => ({
      id: o.id, title: o.title_snap, pickupUntil: o.pickup_until?.toISOString?.() ?? null,
    })),
  };
};

/* ─── QR заказа (продавец → ПВЗ) ─────────────────────────────────────── */

/**
 * QR, который продавец печатает на коробку. Тот же приём, что у кода
 * получения: обратимо зашифрованный случайный токен, потому что
 * продавцу нужно уметь открыть его снова, если он не распечатал сразу.
 * Заводится по первому запросу — до этого момента заказу просто
 * нечего печатать.
 */
export const sellerOrderQr = async (orderId, sellerId, { regenerate = false } = {}) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT id, seller_id, pvz_ship_token_enc, status FROM market_orders WHERE id = $1', [id]);
  const order = rows[0];
  if (!order || order.seller_id !== sellerId) return { error: 'not_found' };

  let tokenEnc = order.pvz_ship_token_enc;
  /* Старый QR при замене инвалидируется самим фактом перезаписи — вторую
     проверку заводить незачем: verifyShipmentScan сверяет только с тем,
     что лежит в столбце сейчас. */
  if (!tokenEnc || regenerate) {
    const token = crypto.randomBytes(24).toString('base64url');
    tokenEnc = encryptContent(token);
    await query('UPDATE market_orders SET pvz_ship_token_enc = $2 WHERE id = $1', [id, tokenEnc]);
    await logMarket(sellerId, regenerate ? 'pvz_qr_regenerated' : 'pvz_qr_issued', id);
  }
  const token = decryptContent(tokenEnc);
  return { orderId: id, token, payload: `skypvz:order:${id}:${token}` };
};

export const parseOrderQrPayload = (raw) => {
  const m = /^skypvz:order:(mo-[0-9a-f-]{36}):([\w-]{20,64})$/.exec(String(raw ?? '').trim());
  return m ? { orderId: m[1], token: m[2] } : null;
};

export const orderShipTokenValid = (order, given) => {
  if (!order.pvz_ship_token_enc || !given) return false;
  const real = decryptContent(order.pvz_ship_token_enc);
  return Boolean(real) && codesEqual(hashCode(given, order.id), hashCode(real, order.id));
};

/* ─── Комиссия владельцу: просмотр и заявление о выплате ─────────────── */

export const commissionsForOwner = async (actorId, { limit } = {}) => {
  const lim = int(limit, 1, 300) ?? 100;
  const { rows } = await query(
    `SELECT c.*, p.title AS pvz_title, o.title_snap AS order_title
       FROM market_pvz_commissions c
       JOIN market_pickup_points p ON p.id = c.pvz_id
       JOIN market_orders o ON o.id = c.order_id
      WHERE c.owner_id = $1 ORDER BY c.created_at DESC LIMIT $2`, [actorId, lim]);
  return rows.map(toCommission);
};

/**
 * Продавцу — вместе с реквизитами владельца точки: ему нужно знать,
 * куда переводить комиссию, и узнать это он должен от сервера, а не
 * из переписки — тот же принцип, что у paymentDetailsForOrder
 * (market.mjs) для оплаты самого товара. Видно только по своей
 * собственной комиссии (WHERE seller_id = $1), IDOR тут структурно
 * невозможен — реквизиты приходят вместе со строкой начисления, а не
 * отдельной ручкой по pvzId, до которой чужому продавцу дотянуться
 * нечем.
 */
export const commissionsForSeller = async (actorId, { limit } = {}) => {
  const lim = int(limit, 1, 300) ?? 100;
  const { rows } = await query(
    `SELECT c.*, p.title AS pvz_title, p.owner_payment_details_enc, o.title_snap AS order_title
       FROM market_pvz_commissions c
       JOIN market_pickup_points p ON p.id = c.pvz_id
       JOIN market_orders o ON o.id = c.order_id
      WHERE c.seller_id = $1 ORDER BY c.created_at DESC LIMIT $2`, [actorId, lim]);
  return rows.map((r) => toCommission(r, true));
};

function toCommission(r, forSeller = false) {
  return {
    id: r.id, orderId: r.order_id, pvzId: r.pvz_id, pvzTitle: r.pvz_title, orderTitle: r.order_title,
    orderAmountKop: Number(r.order_amount_kop), percent: Number(r.percent), amountKop: Number(r.amount_kop),
    status: r.status, declaredPaidAt: r.declared_paid_at?.toISOString?.() ?? null,
    createdAt: r.created_at.toISOString(),
    ownerPaymentDetails: forSeller && r.owner_payment_details_enc
      ? (decryptContent(r.owner_payment_details_enc) ?? '')
      : undefined,
  };
}

/**
 * Продавец заявляет, что выплатил комиссию владельцу точки — прямым
 * переводом, мимо Sky, как и вся оплата сделки. Sky этого перевода не
 * видит и не проверяет: это заявление, а не банковская верификация,
 * тем же словом, каким уже помечено «отправил оплату» покупателя.
 */
export const declareCommissionPaid = async (commissionId, sellerId) => {
  const { rows } = await query(
    `UPDATE market_pvz_commissions SET status = 'declared_paid', declared_paid_at = now()
      WHERE id = $1 AND seller_id = $2 AND status = 'accrued' RETURNING pvz_id`,
    [String(commissionId ?? ''), sellerId]);
  if (!rows[0]) return { error: 'not_found' };
  await logPvz(null, rows[0].pvz_id, sellerId, 'commission_declared_paid', { type: 'commission', id: commissionId }, {});
  return { ok: true };
};

export const disputeCommission = async (commissionId, actorId) => {
  const { rows } = await query(
    `SELECT owner_id, seller_id, pvz_id FROM market_pvz_commissions WHERE id = $1`,
    [String(commissionId ?? '')]);
  const c = rows[0];
  if (!c) return { error: 'not_found' };
  if (actorId !== c.owner_id && actorId !== c.seller_id && !(await can(actorId, 'market'))) {
    return { error: 'not_allowed' };
  }
  await query(
    `UPDATE market_pvz_commissions SET status = 'disputed' WHERE id = $1 AND status IN ('accrued','declared_paid')`,
    [commissionId]);
  await logPvz(null, c.pvz_id, actorId, 'commission_disputed', { type: 'commission', id: commissionId }, {}, true);
  return { ok: true };
};

export { CELL_STATES, KEY_STATES };
