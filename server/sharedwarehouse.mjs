/**
 * Общедоступный склад: настройки, ячейки, аренда, ключи.
 *
 * Личный склад — это владелец, его сотрудники и его же товар. Общий
 * устроен иначе: приходит чужой продавец, кладёт чужой товар в
 * запираемую ячейку и платит за неё владельцу склада. Всё, что ниже,
 * следует из этого различия.
 *
 * Денег Sky не держит и здесь. Аренда ячейки — тот же прямой перевод,
 * что и в сделке маркета: арендатор платит владельцу склада по его
 * реквизитам, и слова «оплачено» означают заявление стороны, а не
 * проверку платежа. Ни баланса склада, ни вывода, ни комиссии нет.
 *
 * Открыть общий склад одним переключателем нельзя. Требуется два
 * условия, и оба проверяются по базе:
 *
 *   — одобренный администрацией видеообзор помещения;
 *   — принятый владельцем регламент действующей редакции.
 *
 * Присланным признакам вроде shared: true здесь не верят нигде.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { isAdmin } from './admin.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { marketText as text, marketInt as int } from './market.mjs';
import { logLogi } from './logistics.mjs';
import { hasAccepted } from './agreements.mjs';
import { hasApprovedReview } from './videoreview.mjs';
import { warehouseAccess, WAREHOUSE_ID_RE } from './warehouses.mjs';

export const CELL_ID_RE = /^lwc-[0-9a-f-]{36}$/;
export const RENTAL_ID_RE = /^lcr-[0-9a-f-]{36}$/;

export const CELL_SIZES = ['small', 'medium', 'large'];

const MAX_CELLS = 2000;
const MAX_NUMBER = 24;
const MAX_ZONE = 60;
const MAX_RULES = 4000;
const MAX_REASON = 300;
const MAX_NOTE = 300;
const MAX_PAYMENT_DETAILS = 600;
/** Копейки. Верхняя граница — чтобы опечатка в поле не стала ценой. */
const MAX_CELL_PRICE_KOP = 100_000_00;

const MAY_MANAGE = new Set(['owner', 'manager', 'support']);
const MAY_OWN = new Set(['owner', 'support']);

const rub = (kop) => Math.round(Number(kop ?? 0)) / 100;
const kop = (rubles) => {
  const n = Number(rubles);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_CELL_PRICE_KOP, Math.round(n * 100));
};

/* ─── Настройки общего склада ──────────────────────────────────────── */

/**
 * Настройки глазами того, кто их смотрит.
 *
 * Реквизиты — только своему: платить по ним будет арендатор, и приходить
 * они должны вместе с его арендой, а не лежать в общем списке складов.
 */
export const toSharedSettings = (row, { own = false } = {}) => ({
  state: row.shared_state,
  cellPrice: rub(row.cell_price_kop),
  cellPriceKop: Number(row.cell_price_kop ?? 0),
  cellPeriodDays: Number(row.cell_period_days ?? 7),
  minRentDays: Number(row.min_rent_days ?? 7),
  maxRentDays: Number(row.max_rent_days ?? 180),
  hasPaymentDetails: Boolean(row.has_payment_details),
  paymentDetails: own && row.payment_details_enc
    ? (decryptContent(row.payment_details_enc) ?? '')
    : undefined,
  rules: row.shared_rules ?? '',
  zones: Array.isArray(row.zones) ? row.zones : [],
  hasCctv: Boolean(row.has_cctv),
  hasGuard: Boolean(row.has_guard),
});

const cleanZones = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const z of raw.slice(0, 20)) {
    const s = text(z, MAX_ZONE);
    if (s) out.push(s);
  }
  return out;
};

/**
 * Изменить настройки общего склада.
 *
 * Цену и сроки правит распорядитель склада. Состояние заявки он не
 * правит ничем: для этого есть отдельный путь с обзором и регламентом.
 */
export const updateSharedSettings = async (warehouseId, actorId, patch = {}) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };

  const sets = [];
  const args = [warehouseId];
  const push = (sql, val) => { args.push(val); sets.push(sql.replace('$$', `$${args.length}`)); };

  if (patch.cellPrice !== undefined) push('cell_price_kop = $$', kop(patch.cellPrice));
  if (patch.cellPeriodDays !== undefined) {
    const d = int(patch.cellPeriodDays, 1, 365);
    if (d === null) return { error: 'bad_period' };
    push('cell_period_days = $$', d);
  }
  if (patch.minRentDays !== undefined) {
    const d = int(patch.minRentDays, 1, 365);
    if (d === null) return { error: 'bad_days' };
    push('min_rent_days = $$', d);
  }
  if (patch.maxRentDays !== undefined) {
    const d = int(patch.maxRentDays, 1, 3650);
    if (d === null) return { error: 'bad_days' };
    push('max_rent_days = $$', d);
  }
  if (patch.rules !== undefined) push('shared_rules = $$', text(patch.rules, MAX_RULES));
  if (patch.zones !== undefined) {
    args.push(JSON.stringify(cleanZones(patch.zones)));
    sets.push(`zones = $${args.length}::jsonb`);
  }
  if (patch.hasCctv !== undefined) push('has_cctv = $$', patch.hasCctv === true);
  if (patch.hasGuard !== undefined) push('has_guard = $$', patch.hasGuard === true);
  /* Реквизиты правит только владелец: это адрес, по которому чужие люди
     будут переводить деньги, и менеджер склада подменить его не должен. */
  if (patch.paymentDetails !== undefined && MAY_OWN.has(found.role)) {
    const details = text(patch.paymentDetails, MAX_PAYMENT_DETAILS);
    push('payment_details_enc = $$', details ? encryptContent(details) : null);
    push('has_payment_details = $$', Boolean(details));
  }

  if (sets.length === 0) {
    return { settings: toSharedSettings(found.warehouse, { own: MAY_OWN.has(found.role) }) };
  }

  const { rows } = await query(
    `UPDATE logi_warehouses SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 RETURNING *`, args);

  /* Минимум больше максимума — это склад, у которого нельзя снять
     ячейку ни на какой срок. Проверяется после записи по итоговой
     строке: частичная правка меняет одну границу, а противоречие
     возникает между двумя. */
  const row = rows[0];
  if (Number(row.min_rent_days) > Number(row.max_rent_days)) {
    await query('UPDATE logi_warehouses SET min_rent_days = $2, max_rent_days = $3 WHERE id = $1',
      [warehouseId, found.warehouse.min_rent_days, found.warehouse.max_rent_days]);
    return { error: 'bad_days' };
  }

  await logLogi(actorId, 'shared_settings_updated', warehouseId);
  return { settings: toSharedSettings(row, { own: MAY_OWN.has(found.role) }) };
};

/**
 * Чего не хватает, чтобы открыть общий склад.
 *
 * Отдельной функцией, потому что этот же список показывается владельцу
 * на экране: «нельзя» без объяснения заставляет гадать.
 */
export const sharedReadiness = async (warehouseId, ownerId) => {
  const { rows } = await query(
    'SELECT * FROM logi_warehouses WHERE id = $1', [String(warehouseId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  const { rows: cells } = await query(
    'SELECT count(*)::int AS n FROM logi_cells WHERE warehouse_id = $1', [warehouseId]);
  return {
    video: await hasApprovedReview('warehouse', warehouseId),
    rules: await hasAccepted(ownerId, 'shared_warehouse_rules'),
    payment: Boolean(row.has_payment_details),
    price: Number(row.cell_price_kop ?? 0) > 0,
    cells: Number(cells[0]?.n ?? 0) > 0,
  };
};

/**
 * Подать заявку на общий склад.
 *
 * Заявка не включает склад — она ставит его в очередь. Включение
 * происходит отдельным действием и только после одобрения обзора:
 * человек, снявший видео и тут же увидевший «склад открыт», решил бы,
 * что проверять никто и не собирался.
 */
export const requestShared = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_OWN.has(found.role)) return { error: 'not_allowed' };
  if (found.warehouse.shared_state === 'active') return { error: 'already_shared' };
  if (found.warehouse.shared_state === 'suspended') return { error: 'shared_suspended' };

  if (!(await hasAccepted(actorId, 'shared_warehouse_rules'))) {
    return { error: 'warehouse_rules_required' };
  }
  const { rows: video } = await query(
    `SELECT status FROM logi_video_reviews
      WHERE subject_kind = 'warehouse' AND subject_id = $1
      ORDER BY created_at DESC LIMIT 1`, [warehouseId]);
  if (!video[0]) return { error: 'video_review_required' };
  if (video[0].status === 'rejected') return { error: 'video_review_rejected' };

  const { rows } = await query(
    `UPDATE logi_warehouses SET shared_state = 'review', updated_at = now()
      WHERE id = $1 AND shared_state IN ('off', 'rejected') RETURNING *`, [warehouseId]);
  if (!rows[0]) return { error: 'wrong_state' };
  await logLogi(actorId, 'shared_requested', warehouseId);
  return { settings: toSharedSettings(rows[0], { own: true }) };
};

/**
 * Включить общий склад.
 *
 * Здесь сходится всё: одобренный обзор, принятый регламент, реквизиты
 * для оплаты, назначенная цена и хотя бы одна ячейка. Ячейки нет —
 * снимать нечего, и «общий склад» был бы пустым словом на карточке.
 */
export const activateShared = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_OWN.has(found.role)) return { error: 'not_allowed' };
  if (found.warehouse.shared_state === 'suspended') return { error: 'shared_suspended' };

  const owner = found.warehouse.seller_id;
  const ready = await sharedReadiness(warehouseId, owner);
  if (!ready.video) return { error: 'video_review_required' };
  if (!ready.rules) return { error: 'warehouse_rules_required' };
  if (!ready.payment) return { error: 'payment_details_required' };
  if (!ready.price) return { error: 'cell_price_required' };
  if (!ready.cells) return { error: 'cells_required' };

  const { rows } = await query(
    `UPDATE logi_warehouses SET shared_state = 'active', updated_at = now()
      WHERE id = $1 AND shared_state IN ('review', 'off', 'rejected') RETURNING *`,
    [warehouseId]);
  if (!rows[0]) return { error: 'wrong_state' };
  await logLogi(actorId, 'shared_activated', warehouseId);
  return { settings: toSharedSettings(rows[0], { own: true }) };
};

/**
 * Закрыть общий склад.
 *
 * Живые аренды при этом не рвутся: у людей внутри лежит товар, и
 * выключатель на чужом экране не должен означать, что за ним можно не
 * приходить. Склад просто перестаёт принимать новых.
 */
export const closeShared = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_OWN.has(found.role)) return { error: 'not_allowed' };
  const { rows } = await query(
    `UPDATE logi_warehouses SET shared_state = 'off', updated_at = now()
      WHERE id = $1 AND shared_state <> 'suspended' RETURNING *`, [warehouseId]);
  if (!rows[0]) return { error: 'wrong_state' };
  await logLogi(actorId, 'shared_closed', warehouseId);
  return { settings: toSharedSettings(rows[0], { own: true }) };
};

/** Отключение администрацией — по нарушению регламента. Владелец обратно не включит. */
export const suspendShared = async (warehouseId, actorId, on) => {
  if (!(await isAdmin(actorId))) return { error: 'not_allowed' };
  if (!WAREHOUSE_ID_RE.test(String(warehouseId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    `UPDATE logi_warehouses SET shared_state = $2, updated_at = now()
      WHERE id = $1 RETURNING *`, [warehouseId, on ? 'suspended' : 'off']);
  if (!rows[0]) return { error: 'not_found' };
  await logLogi(actorId, on ? 'shared_suspended' : 'shared_unsuspended', warehouseId);
  return { settings: toSharedSettings(rows[0]) };
};

/* ─── Витрина общих складов ────────────────────────────────────────── */

/**
 * Открытые склады — для продавца, который ищет, где снять ячейку.
 *
 * Адрес здесь не отдаётся: он нужен тому, кто уже снял, и приходит
 * вместе с арендой. Реквизиты — тем более.
 */
export const listSharedWarehouses = async ({ city, limit } = {}) => {
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  const args = [];
  let where = "w.shared_state = 'active'";
  const cityId = text(city, 60);
  if (cityId) { args.push(cityId); where += ` AND w.city_id = $${args.length}`; }
  args.push(n);

  const { rows } = await query(
    `SELECT w.id, w.name, w.city_id, w.lat, w.lng, w.cell_price_kop, w.cell_period_days,
            w.min_rent_days, w.max_rent_days, w.shared_rules, w.zones,
            w.has_cctv, w.has_guard,
            count(c.id) FILTER (WHERE c.state = 'free')::int AS free_cells,
            count(c.id)::int AS total_cells
       FROM logi_warehouses w
       LEFT JOIN logi_cells c ON c.warehouse_id = w.id
      WHERE ${where}
      GROUP BY w.id
      ORDER BY w.name
      LIMIT $${args.length}`, args);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cityId: r.city_id,
    location: { lat: Number(r.lat ?? 0), lng: Number(r.lng ?? 0) },
    cellPrice: rub(r.cell_price_kop),
    cellPeriodDays: Number(r.cell_period_days ?? 7),
    minRentDays: Number(r.min_rent_days ?? 7),
    maxRentDays: Number(r.max_rent_days ?? 180),
    rules: r.shared_rules ?? '',
    zones: Array.isArray(r.zones) ? r.zones : [],
    hasCctv: Boolean(r.has_cctv),
    hasGuard: Boolean(r.has_guard),
    freeCells: Number(r.free_cells ?? 0),
    totalCells: Number(r.total_cells ?? 0),
  }));
};

/* ─── Ячейки ───────────────────────────────────────────────────────── */

const toCell = (row, { inside = false } = {}) => ({
  id: row.id,
  warehouseId: row.warehouse_id,
  number: row.number,
  zone: row.zone ?? '',
  size: row.size,
  price: row.price_kop == null ? null : rub(row.price_kop),
  state: row.state,
  /* Почему ячейка выведена из эксплуатации — дело склада, а не тех, кто
     выбирает свободную. */
  blockReason: inside ? (row.block_reason ?? '') : undefined,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

/**
 * Список ячеек.
 *
 * Распорядителю — все, со состояниями и причинами блокировки. Всем
 * прочим на открытом складе — только свободные: чужие номера и то, что
 * какая-то ячейка заблокирована после вскрытия, посетителя не касается.
 */
export const listCells = async (warehouseId, actorId) => {
  if (!WAREHOUSE_ID_RE.test(String(warehouseId ?? ''))) return null;
  const found = await warehouseAccess(warehouseId, actorId);
  if (found && MAY_MANAGE.has(found.role)) {
    const { rows } = await query(
      'SELECT * FROM logi_cells WHERE warehouse_id = $1 ORDER BY number', [warehouseId]);
    return rows.map((r) => toCell(r, { inside: true }));
  }

  const { rows: wh } = await query(
    'SELECT shared_state FROM logi_warehouses WHERE id = $1', [warehouseId]);
  if (wh[0]?.shared_state !== 'active') return null;
  const { rows } = await query(
    `SELECT * FROM logi_cells WHERE warehouse_id = $1 AND state = 'free' ORDER BY number`,
    [warehouseId]);
  return rows.map((r) => toCell(r));
};

export const createCell = async (warehouseId, actorId, input = {}) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };

  const number = text(input.number, MAX_NUMBER);
  if (!number) return { error: 'bad_number' };
  const size = CELL_SIZES.includes(String(input.size)) ? String(input.size) : 'medium';
  const price = input.price === undefined || input.price === null || input.price === ''
    ? null : kop(input.price);

  const { rows: count } = await query(
    'SELECT count(*)::int AS n FROM logi_cells WHERE warehouse_id = $1', [warehouseId]);
  if ((count[0]?.n ?? 0) >= MAX_CELLS) return { error: 'too_many_cells' };

  /* Номер уникален на складе: две дверцы с одним номером — это два
     разных ответа на вопрос, в какую класть. Проверка стоит условием
     самой вставки, а не отдельным запросом перед ней. */
  const { rows } = await query(
    `INSERT INTO logi_cells (id, warehouse_id, number, zone, size, price_kop)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (warehouse_id, number) DO NOTHING
     RETURNING *`,
    [`lwc-${generateId()}`, warehouseId, number, text(input.zone, MAX_ZONE), size, price]);
  if (!rows[0]) return { error: 'number_taken' };

  await logCell(rows[0].id, null, actorId, 'created', `Ячейка №${number}`);
  return { cell: toCell(rows[0], { inside: true }) };
};

export const updateCell = async (cellId, actorId, patch = {}) => {
  const found = await cellAccess(cellId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };

  const sets = [];
  const args = [cellId];
  if (patch.number !== undefined) {
    const number = text(patch.number, MAX_NUMBER);
    if (!number) return { error: 'bad_number' };
    args.push(number); sets.push(`number = $${args.length}`);
  }
  if (patch.zone !== undefined) { args.push(text(patch.zone, MAX_ZONE)); sets.push(`zone = $${args.length}`); }
  if (patch.size !== undefined) {
    args.push(CELL_SIZES.includes(String(patch.size)) ? String(patch.size) : 'medium');
    sets.push(`size = $${args.length}`);
  }
  if (patch.price !== undefined) {
    args.push(patch.price === null || patch.price === '' ? null : kop(patch.price));
    sets.push(`price_kop = $${args.length}`);
  }
  if (sets.length === 0) return { cell: toCell(found.cell, { inside: true }) };

  try {
    const { rows } = await query(
      `UPDATE logi_cells SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, args);
    return { cell: toCell(rows[0], { inside: true }) };
  } catch (err) {
    /* Единственное ограничение на этой таблице — номер. Разбирать текст
       ошибки не нужно: другого повода для конфликта здесь нет. */
    if (err.code === '23505') return { error: 'number_taken' };
    throw err;
  }
};

/**
 * Вывести ячейку из эксплуатации и вернуть обратно.
 *
 * Регламент, п. 3.8 и 5.4: пропал ключ, сломан замок, есть следы
 * вскрытия — ячейка закрывается до разбирательства. Снятая аренда при
 * этом не отменяется: товар внутри остаётся, и отменять аренду за
 * арендатора склад не вправе.
 */
export const blockCell = async (cellId, actorId, on, reason = '') => {
  const found = await cellAccess(cellId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };

  const why = text(reason, MAX_REASON);
  if (on && !why) return { error: 'reason_required' };

  if (on) {
    const { rows } = await query(
      `UPDATE logi_cells SET state = 'blocked', block_reason = $2, updated_at = now()
        WHERE id = $1 AND state <> 'blocked' RETURNING *`, [cellId, why]);
    if (!rows[0]) return { error: 'wrong_state' };
    await logCell(cellId, null, actorId, 'blocked', why);
    return { cell: toCell(rows[0], { inside: true }) };
  }

  /* Обратно ячейка возвращается не в «свободна», а в то состояние, в
     котором она была: если внутри чей-то товар по живой аренде, она
     занята, и объявлять её свободной нельзя. */
  const { rows: live } = await query(
    `SELECT 1 FROM logi_cell_rentals
      WHERE cell_id = $1 AND status IN ('created','payment_declared','active') LIMIT 1`,
    [cellId]);
  const next = live[0] ? 'rented' : 'free';
  const { rows } = await query(
    `UPDATE logi_cells SET state = $2, block_reason = '', updated_at = now()
      WHERE id = $1 AND state = 'blocked' RETURNING *`, [cellId, next]);
  if (!rows[0]) return { error: 'wrong_state' };
  await logCell(cellId, null, actorId, 'unblocked', '');
  return { cell: toCell(rows[0], { inside: true }) };
};

export const deleteCell = async (cellId, actorId) => {
  const found = await cellAccess(cellId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };
  /* Ячейку с живой арендой не удаляют: внутри чужой товар, а строка
     аренды ушла бы каскадом вместе с ней. */
  const { rows: live } = await query(
    `SELECT 1 FROM logi_cell_rentals
      WHERE cell_id = $1 AND status IN ('created','payment_declared','active') LIMIT 1`,
    [cellId]);
  if (live[0]) return { error: 'cell_rented' };
  await query('DELETE FROM logi_cells WHERE id = $1', [cellId]);
  await logLogi(actorId, 'cell_deleted', cellId);
  return { ok: true };
};

/** Ячейка и роль спрашивающего на её складе. */
const cellAccess = async (cellId, actorId) => {
  if (!CELL_ID_RE.test(String(cellId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM logi_cells WHERE id = $1', [cellId]);
  const cell = rows[0];
  if (!cell) return null;
  const found = await warehouseAccess(cell.warehouse_id, actorId);
  if (!found) return null;
  return { cell, warehouse: found.warehouse, role: found.role };
};

/* ─── Журнал ячейки ────────────────────────────────────────────────── */

const logCell = async (cellId, rentalId, actorId, action, note = '') => {
  await query(
    `INSERT INTO logi_cell_events (id, cell_id, rental_id, actor_id, action, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [`lce-${generateId()}`, cellId, rentalId, actorId ?? null,
      String(action).slice(0, 40), String(note ?? '').slice(0, MAX_NOTE)]);
};

/**
 * Журнал ячейки — распорядителю склада и арендатору её живой аренды.
 *
 * Арендатору он нужен ровно затем, зачем регламент вообще требует
 * журнала: увидеть, кто и когда брал ключ от дверцы, за которой лежит
 * его товар.
 */
export const cellEvents = async (cellId, actorId, { limit } = {}) => {
  if (!CELL_ID_RE.test(String(cellId ?? ''))) return null;
  const found = await cellAccess(cellId, actorId);
  let allowed = Boolean(found && MAY_MANAGE.has(found.role));
  if (!allowed) {
    const { rows } = await query(
      `SELECT 1 FROM logi_cell_rentals
        WHERE cell_id = $1 AND tenant_id = $2
          AND status IN ('created','payment_declared','active') LIMIT 1`,
      [cellId, actorId ?? '']);
    allowed = rows.length > 0;
  }
  if (!allowed) return null;

  const n = Math.min(200, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    `SELECT * FROM logi_cell_events WHERE cell_id = $1
      ORDER BY created_at DESC LIMIT $2`, [cellId, n]);
  return rows.map((r) => ({
    action: r.action,
    note: r.note ?? '',
    at: r.created_at?.toISOString?.() ?? undefined,
  }));
};

/* ─── Аренда ───────────────────────────────────────────────────────── */

const toRental = (row, role) => ({
  id: row.id,
  cellId: row.cell_id,
  cellNumber: row.cell_number ?? undefined,
  warehouseId: row.warehouse_id,
  warehouseName: row.warehouse_name ?? undefined,
  tenantId: row.tenant_id,
  role,
  days: Number(row.days),
  price: rub(row.price_kop),
  total: rub(row.total_kop),
  status: row.status,
  keyState: row.key_state,
  /* Куда платить — только арендатору этой аренды: платит он. Склад свои
     же реквизиты видит в настройках. */
  paymentDetails: role === 'tenant' && row.payment_details_enc
    ? (decryptContent(row.payment_details_enc) ?? '')
    : undefined,
  /* Адрес склада приходит вместе с арендой: до неё он не нужен, после
     неё без него не приедешь. */
  address: row.address_enc ? (decryptContent(row.address_enc) ?? '') : undefined,
  paidDeclaredAt: row.paid_declared_at?.toISOString?.() ?? null,
  startedAt: row.started_at?.toISOString?.() ?? null,
  endsAt: row.ends_at?.toISOString?.() ?? null,
  endedAt: row.ended_at?.toISOString?.() ?? null,
  cancelReason: row.cancel_reason ?? '',
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

const SELECT_RENTAL = `
  SELECT r.*, c.number AS cell_number, w.name AS warehouse_name,
         w.payment_details_enc, w.address_enc, w.seller_id AS owner_id
    FROM logi_cell_rentals r
    JOIN logi_cells c ON c.id = r.cell_id
    JOIN logi_warehouses w ON w.id = r.warehouse_id`;

/** Кто спрашивает про аренду: арендатор, распорядитель склада или никто. */
const rentalAccess = async (rentalId, actorId) => {
  if (!RENTAL_ID_RE.test(String(rentalId ?? ''))) return null;
  const { rows } = await query(`${SELECT_RENTAL} WHERE r.id = $1`, [rentalId]);
  const row = rows[0];
  if (!row) return null;
  if (row.tenant_id === actorId) return { row, role: 'tenant' };
  const found = await warehouseAccess(row.warehouse_id, actorId);
  if (found && MAY_MANAGE.has(found.role)) return { row, role: 'keeper' };
  await logLogi(actorId, 'rental_denied', rentalId);
  return null;
};

/**
 * Снять ячейку.
 *
 * Занятие ячейки и создание аренды — одна запись под замком строки.
 * «Посмотрел, что свободна, потом записал» двумя запросами — это два
 * продавца, оплативших одну дверцу, и оба правы.
 *
 * Цену считает сервер по своей базе. Присланная цена не читается: иначе
 * ячейку за сто рублей в неделю снимали бы за копейку.
 */
export const rentCell = async (cellId, tenantId, days) => {
  if (!CELL_ID_RE.test(String(cellId ?? ''))) return { error: 'not_found' };

  /* Регламент принимает и тот, кто снимает: он получает доступ к складу
     и обязан знать, чего там нельзя (п. 12.2). */
  if (!(await hasAccepted(tenantId, 'shared_warehouse_rules'))) {
    return { error: 'warehouse_rules_required' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cells } = await client.query(
      `SELECT c.*, w.shared_state, w.cell_price_kop, w.cell_period_days,
              w.min_rent_days, w.max_rent_days, w.seller_id
         FROM logi_cells c JOIN logi_warehouses w ON w.id = c.warehouse_id
        WHERE c.id = $1 FOR UPDATE OF c`, [cellId]);
    const cell = cells[0];
    if (!cell) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (cell.shared_state !== 'active') { await client.query('ROLLBACK'); return { error: 'not_shared' }; }
    if (cell.state === 'blocked') { await client.query('ROLLBACK'); return { error: 'cell_blocked' }; }
    if (cell.state !== 'free') { await client.query('ROLLBACK'); return { error: 'cell_taken' }; }
    if (cell.seller_id === tenantId) { await client.query('ROLLBACK'); return { error: 'own_warehouse' }; }

    const n = int(days, Number(cell.min_rent_days), Number(cell.max_rent_days));
    if (n === null) {
      await client.query('ROLLBACK');
      return { error: 'bad_days', min: Number(cell.min_rent_days), max: Number(cell.max_rent_days) };
    }

    /* Цена берётся своя у ячейки, иначе складская. Сумма считается от
       расчётного срока: цена «за неделю» при аренде на две недели — это
       две цены, а не одна. */
    const priceKop = cell.price_kop == null ? Number(cell.cell_price_kop) : Number(cell.price_kop);
    if (priceKop <= 0) { await client.query('ROLLBACK'); return { error: 'cell_price_required' }; }
    const period = Math.max(1, Number(cell.cell_period_days));
    const totalKop = Math.round(priceKop * (n / period));

    const id = `lcr-${generateId()}`;
    await client.query(
      `INSERT INTO logi_cell_rentals
         (id, cell_id, warehouse_id, tenant_id, days, price_kop, total_kop, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($5::int * interval '1 day'))`,
      [id, cellId, cell.warehouse_id, tenantId, n, priceKop, totalKop]);
    await client.query(
      `UPDATE logi_cells SET state = 'rented', updated_at = now() WHERE id = $1`, [cellId]);
    await client.query('COMMIT');

    await logCell(cellId, id, tenantId, 'rented', `на ${n} дн.`);
    const { rows } = await query(`${SELECT_RENTAL} WHERE r.id = $1`, [id]);
    return { rental: toRental(rows[0], 'tenant') };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    /* Живая аренда на ячейку одна — так стоит в частичном уникальном
       указателе. Гонка добирается сюда, и это отказ, а не сбой. */
    if (err.code === '23505') return { error: 'cell_taken' };
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Ход аренды.
 *
 * Переходы те же по смыслу, что у заказа маркета: арендатор заявляет,
 * что перевёл, склад подтверждает, что получил. Sky перевода не видит и
 * подтверждать за склад не может.
 *
 * Условие перехода стоит в самом UPDATE: из двух одновременных нажатий
 * срабатывает ровно одно.
 */
const FLOW = {
  declare_paid: { role: 'tenant', from: ['created'], to: 'payment_declared',
    set: 'paid_declared_at = now()' },
  confirm_paid: { role: 'keeper', from: ['created', 'payment_declared'], to: 'active',
    set: "started_at = now(), ends_at = now() + (days * interval '1 day')" },
  finish: { role: 'keeper', from: ['active'], to: 'ended', set: 'ended_at = now()' },
};

export const moveRental = async (rentalId, actorId, action) => {
  const flow = FLOW[String(action ?? '')];
  if (!flow) return { error: 'bad_action' };
  const found = await rentalAccess(rentalId, actorId);
  if (!found) return { error: 'not_found' };
  if (found.role !== flow.role) return { error: 'not_allowed' };

  const { rows } = await query(
    `UPDATE logi_cell_rentals SET status = $2, ${flow.set}, updated_at = now()
      WHERE id = $1 AND status = ANY($3::text[]) RETURNING id`,
    [rentalId, flow.to, flow.from]);
  if (!rows[0]) {
    /* Повторное нажатие по уже совершённому переходу — не ошибка: у
       человека мигнула сеть и он нажал снова. Отдаём нынешнее состояние. */
    const now = await query(`${SELECT_RENTAL} WHERE r.id = $1`, [rentalId]);
    return { rental: toRental(now.rows[0], found.role), repeated: true };
  }

  /* Ячейка освобождается вместе с концом аренды — но только если её не
     закрыли по регламенту: разбирательство из-за одного человека не
     должно кончаться тем, что дверцу сдали следующему. */
  if (flow.to === 'ended') {
    await query(
      `UPDATE logi_cells SET state = 'free', updated_at = now()
        WHERE id = $1 AND state = 'rented'`, [found.row.cell_id]);
  }
  await logCell(found.row.cell_id, rentalId, actorId, action, '');

  const now = await query(`${SELECT_RENTAL} WHERE r.id = $1`, [rentalId]);
  return { rental: toRental(now.rows[0], found.role) };
};

/** Отменить аренду. Пока она не началась — обе стороны; после — склад. */
export const cancelRental = async (rentalId, actorId, reason = '') => {
  const found = await rentalAccess(rentalId, actorId);
  if (!found) return { error: 'not_found' };
  const from = found.role === 'tenant'
    ? ['created', 'payment_declared']
    : ['created', 'payment_declared', 'active'];

  const { rows } = await query(
    `UPDATE logi_cell_rentals
        SET status = 'cancelled', cancel_reason = $3, ended_at = now(), updated_at = now()
      WHERE id = $1 AND status = ANY($2::text[]) RETURNING cell_id`,
    [rentalId, from, text(reason, MAX_REASON)]);
  if (!rows[0]) return { error: 'wrong_state' };

  await query(
    `UPDATE logi_cells SET state = 'free', updated_at = now()
      WHERE id = $1 AND state = 'rented'`, [rows[0].cell_id]);
  await logCell(rows[0].cell_id, rentalId, actorId, 'cancelled', '');

  const now = await query(`${SELECT_RENTAL} WHERE r.id = $1`, [rentalId]);
  return { rental: toRental(now.rows[0], found.role) };
};

/**
 * Выдать и принять ключ.
 *
 * Регламент, п. 3.4 и 3.6: выдача фиксируется, а после работы ключ
 * возвращается на место. Выдаёт кладовщик — не арендатор: ключ лежит у
 * склада, и «я взял» без второй стороны записью не является.
 */
export const moveKey = async (rentalId, actorId, next, note = '') => {
  const states = { issued: 'issued', stored: 'stored', lost: 'lost' };
  const to = states[String(next ?? '')];
  if (!to) return { error: 'bad_key_state' };

  const found = await rentalAccess(rentalId, actorId);
  if (!found) return { error: 'not_found' };
  if (found.role !== 'keeper') return { error: 'not_allowed' };
  if (found.row.status !== 'active') return { error: 'wrong_state' };

  const { rows } = await query(
    `UPDATE logi_cell_rentals SET key_state = $2, updated_at = now()
      WHERE id = $1 AND key_state <> $2 RETURNING cell_id`, [rentalId, to]);
  if (!rows[0]) return { error: 'wrong_state' };

  /* Пропавший ключ выводит ячейку из эксплуатации до перекодировки
     замка — п. 3.8. Это не пожелание складу, а то, что происходит. */
  if (to === 'lost') {
    await query(
      `UPDATE logi_cells SET state = 'blocked', block_reason = $2, updated_at = now()
        WHERE id = $1`, [rows[0].cell_id, 'Утрачен ключ — до замены замка']);
  }
  await logCell(rows[0].cell_id, rentalId, actorId, `key_${to}`, text(note, MAX_NOTE));

  const now = await query(`${SELECT_RENTAL} WHERE r.id = $1`, [rentalId]);
  return { rental: toRental(now.rows[0], found.role) };
};

/** Мои аренды — как арендатора. */
export const myRentals = async (tenantId, { limit } = {}) => {
  const n = Math.min(100, Math.max(1, Number(limit) || 50));
  const { rows } = await query(
    `${SELECT_RENTAL} WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
    [tenantId, n]);
  return rows.map((r) => toRental(r, 'tenant'));
};

/** Аренды склада — распорядителю. */
export const warehouseRentals = async (warehouseId, actorId, { limit } = {}) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found || !MAY_MANAGE.has(found.role)) return null;
  const n = Math.min(200, Math.max(1, Number(limit) || 100));
  const { rows } = await query(
    `${SELECT_RENTAL} WHERE r.warehouse_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
    [warehouseId, n]);
  return rows.map((r) => toRental(r, 'keeper'));
};

export const readRental = async (rentalId, actorId) => {
  const found = await rentalAccess(rentalId, actorId);
  return found ? toRental(found.row, found.role) : null;
};

/**
 * Закрыть аренды, у которых вышел срок.
 *
 * Ячейка при этом не освобождается сама: внутри может остаться товар, и
 * решать, что с ним, — дело склада и регламента, а не расписания.
 */
export const sweepExpiredRentals = async () => {
  const { rows } = await query(
    `UPDATE logi_cell_rentals
        SET status = 'ended', ended_at = now(), updated_at = now()
      WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at < now()
      RETURNING id, cell_id`);
  for (const r of rows) await logCell(r.cell_id, r.id, null, 'expired', 'Срок аренды истёк');
  return rows.length;
};
