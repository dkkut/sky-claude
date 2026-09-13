/**
 * Sky Market / Логистика: пропуска на склад и поставки.
 *
 * Пропуск — это ключ от склада, и обращаться с ним нужно как с ключом.
 *
 * В базе лежит отпечаток кода (SHA-256), а не сам код: утёкший дамп не
 * должен превращаться в связку ключей от всех складов сразу. Сам код
 * хранится зашифрованным — только чтобы его можно было переслать
 * владельцу повторно, — и отдаётся тому, кто пропуск выписал.
 *
 * Сканирование ищет по отпечатку и только среди складов, к которым у
 * сканирующего есть доступ. Иначе подбор кода шёл бы сразу по всем
 * складам платформы, а ответ «такого кода нет» отличался бы от «код
 * есть, но не ваш» — и это само по себе ответ.
 *
 * Поставка — это наклейка: номер, короткий код, отправитель, получатель
 * и сортировочный центр. Находится по коду, но только своим владельцем.
 */
import { query } from './db.mjs';
import crypto from 'node:crypto';
import { generateId } from './security.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { marketText as text, marketInt as int } from './market.mjs';
import { logLogi } from './logistics.mjs';
import { warehouseAccess, logWarehouse, PASS_ID_RE, SUPPLY_ID_RE } from './warehouses.mjs';

const LEVELS = ['guest', 'employee', 'manager', 'owner'];
const PASS_TYPES = ['temporary', 'permanent'];
const CHANNELS = ['sms', 'email', 'chat'];
const MAX_NAME = 120;
const MAX_CONTACT = 200;

const MAY_MANAGE = new Set(['owner', 'manager', 'support']);

/** Отпечаток кода. По нему ищут; по нему же код не восстановить. */
const fingerprint = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

/**
 * Код пропуска.
 *
 * Берётся из криптографического источника, а не из Math.random:
 * предсказуемый ключ от склада — это ключ, который подберут.
 */
const issueCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
};

const toPass = (row, { withCode = false } = {}) => ({
  id: row.id,
  warehouseId: row.warehouse_id,
  sellerId: row.seller_id,
  holderName: row.holder_name,
  holderContact: row.holder_contact_enc ? (decryptContent(row.holder_contact_enc) ?? '') : '',
  accessLevel: row.access_level,
  type: row.type,
  /* Код видит тот, кто пропуск выписал: ему его пересылать. */
  code: withCode ? (decryptContent(row.code_enc) ?? '') : '',
  validFrom: row.valid_from?.toISOString?.() ?? undefined,
  validUntil: row.valid_until?.toISOString?.() ?? null,
  active: Boolean(row.active),
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

/* ─── Пропуска ─────────────────────────────────────────────────────── */

export const listPasses = async (warehouseId, actorId) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return null;
  const { rows } = await query(
    'SELECT * FROM logi_passes WHERE warehouse_id = $1 ORDER BY created_at DESC', [warehouseId]);
  /* Код показывается только тем, кто вправе им распоряжаться. */
  const withCode = MAY_MANAGE.has(found.role);
  return rows.map((r) => toPass(r, { withCode }));
};

export const createPass = async (warehouseId, actorId, input = {}) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { error: 'not_found' };
  if (!MAY_MANAGE.has(found.role)) return { error: 'not_allowed' };

  const holderName = text(input.holderName, MAX_NAME);
  if (holderName.length < 2) return { error: 'bad_holder' };

  const type = PASS_TYPES.includes(String(input.type)) ? String(input.type) : 'temporary';
  const level = LEVELS.includes(String(input.accessLevel)) ? String(input.accessLevel) : 'guest';

  /* Временный пропуск без срока — это постоянный, только назван иначе.
     Срок по умолчанию сутки: пропуск, выданный «на сегодня», не должен
     работать через год. */
  let validUntil = null;
  if (type === 'temporary') {
    const raw = input.validUntil ? new Date(String(input.validUntil)) : null;
    validUntil = raw && Number.isFinite(raw.getTime()) && raw.getTime() > Date.now()
      ? raw
      : new Date(Date.now() + 86400_000);
    /* Год вперёд — уже не «временный». */
    const cap = Date.now() + 365 * 86400_000;
    if (validUntil.getTime() > cap) validUntil = new Date(cap);
  }

  const code = issueCode();
  const { rows } = await query(
    `INSERT INTO logi_passes
       (id, warehouse_id, seller_id, holder_name, holder_contact_enc,
        access_level, type, code_hash, code_enc, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [`lp-${generateId()}`, warehouseId, found.warehouse.seller_id, holderName,
      text(input.holderContact, MAX_CONTACT) ? encryptContent(text(input.holderContact, MAX_CONTACT)) : null,
      level, type, fingerprint(code), encryptContent(code), validUntil]);

  await logWarehouse(warehouseId, actorId, 'pass_created', `Выписан пропуск: ${holderName}`);
  await logLogi(actorId, 'pass_created', rows[0].id, { level, type });
  return { pass: toPass(rows[0], { withCode: true }) };
};

export const updatePass = async (passId, actorId, patch = {}) => {
  if (!PASS_ID_RE.test(String(passId ?? ''))) return { error: 'not_found' };
  const { rows: p } = await query('SELECT warehouse_id FROM logi_passes WHERE id = $1', [passId]);
  if (!p[0]) return { error: 'not_found' };
  const found = await warehouseAccess(p[0].warehouse_id, actorId);
  if (!found || !MAY_MANAGE.has(found.role)) return { error: 'not_found' };

  const sets = [];
  const args = [passId];
  if (patch.holderName !== undefined) {
    const name = text(patch.holderName, MAX_NAME);
    if (name.length < 2) return { error: 'bad_holder' };
    args.push(name); sets.push(`holder_name = $${args.length}`);
  }
  if (patch.holderContact !== undefined) {
    const c = text(patch.holderContact, MAX_CONTACT);
    args.push(c ? encryptContent(c) : null); sets.push(`holder_contact_enc = $${args.length}`);
  }
  if (patch.accessLevel !== undefined && LEVELS.includes(String(patch.accessLevel))) {
    args.push(String(patch.accessLevel)); sets.push(`access_level = $${args.length}`);
  }
  if (patch.active !== undefined) { args.push(patch.active === true); sets.push(`active = $${args.length}`); }
  if (patch.validUntil !== undefined) {
    const raw = patch.validUntil ? new Date(String(patch.validUntil)) : null;
    args.push(raw && Number.isFinite(raw.getTime()) ? raw : null);
    sets.push(`valid_until = $${args.length}`);
  }
  if (sets.length === 0) return { error: 'nothing_to_change' };

  const { rows } = await query(
    `UPDATE logi_passes SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);
  await logLogi(actorId, 'pass_updated', passId);
  return { pass: toPass(rows[0], { withCode: true }) };
};

export const deletePass = async (passId, actorId) => {
  if (!PASS_ID_RE.test(String(passId ?? ''))) return { error: 'not_found' };
  const { rows: p } = await query('SELECT warehouse_id FROM logi_passes WHERE id = $1', [passId]);
  if (!p[0]) return { error: 'not_found' };
  const found = await warehouseAccess(p[0].warehouse_id, actorId);
  if (!found || !MAY_MANAGE.has(found.role)) return { error: 'not_found' };
  await query('DELETE FROM logi_passes WHERE id = $1', [passId]);
  await logWarehouse(p[0].warehouse_id, actorId, 'pass_removed', 'Пропуск удалён');
  return { ok: true };
};

/**
 * Сканирование пропуска.
 *
 * Ищем только среди складов, к которым у сканирующего есть доступ.
 * Поэтому чужой код отвечает ровно то же, что несуществующий: «не
 * подходит». Разница в ответах сама по себе рассказывала бы, что такой
 * код где-то есть.
 *
 * Проход записывается всегда — и удачный, и нет: журнал попыток нужен
 * именно на случай подбора.
 */
export const scanPass = async (code, actorId, warehouseId) => {
  const clean = text(code, 40).toUpperCase();
  if (!clean) return { ok: false, reason: 'Код не распознан' };

  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return { ok: false, reason: 'Нет доступа к складу' };

  const { rows } = await query(
    'SELECT * FROM logi_passes WHERE code_hash = $1 AND warehouse_id = $2',
    [fingerprint(clean), found.warehouse.id]);
  const row = rows[0];

  if (!row) {
    await logLogi(actorId, 'pass_scan_failed', found.warehouse.id);
    return { ok: false, reason: 'Пропуск не найден' };
  }
  if (!row.active) return { ok: false, reason: 'Пропуск заблокирован', pass: toPass(row) };
  if (row.valid_from && new Date(row.valid_from) > new Date()) {
    return { ok: false, reason: 'Пропуск ещё не действует', pass: toPass(row) };
  }
  if (row.valid_until && new Date(row.valid_until) <= new Date()) {
    return { ok: false, reason: 'Срок пропуска истёк', pass: toPass(row) };
  }

  /* Вход и выход чередуются: если последней записью был вход — это
     выход, и наоборот. Так журнал остаётся связным без отдельной
     кнопки «я выхожу». */
  const { rows: last } = await query(
    'SELECT action FROM logi_pass_visits WHERE pass_id = $1 ORDER BY at DESC LIMIT 1', [row.id]);
  const action = last[0]?.action === 'entry' ? 'exit' : 'entry';

  await query(
    `INSERT INTO logi_pass_visits (pass_id, warehouse_id, action, confirmed_by, actor_id)
     VALUES ($1,$2,$3,'qr_scan',$4)`,
    [row.id, row.warehouse_id, action, actorId]);
  await logWarehouse(row.warehouse_id, actorId, 'pass_scan',
    `${action === 'entry' ? 'Вход' : 'Выход'}: ${row.holder_name}`);
  return { ok: true, action, pass: toPass(row) };
};

export const listVisits = async (warehouseId, actorId, { passId, limit } = {}) => {
  const found = await warehouseAccess(warehouseId, actorId);
  if (!found) return null;
  const lim = int(limit, 1, 200) ?? 100;
  const args = [warehouseId];
  let where = 'v.warehouse_id = $1';
  if (passId) { args.push(String(passId)); where += ` AND v.pass_id = $${args.length}`; }
  args.push(lim);
  const { rows } = await query(
    `SELECT v.id, v.pass_id, v.warehouse_id, v.action, v.confirmed_by, v.at
       FROM logi_pass_visits v WHERE ${where}
      ORDER BY v.at DESC LIMIT $${args.length}`, args);
  return rows.map((r) => ({
    id: String(r.id),
    passId: r.pass_id,
    warehouseId: r.warehouse_id,
    action: r.action,
    confirmedBy: r.confirmed_by,
    at: r.at?.toISOString?.() ?? undefined,
  }));
};

/**
 * Отметка об отправке пропуска.
 *
 * Сервер записывает, что пропуск переслали, и куда именно — адрес
 * хранится зашифрованным. Самой отправки отсюда не происходит: письма и
 * сообщения уходят своими путями, а здесь остаётся след.
 */
export const logPassSend = async (passId, actorId, channel, target) => {
  if (!PASS_ID_RE.test(String(passId ?? ''))) return { error: 'not_found' };
  if (!CHANNELS.includes(String(channel))) return { error: 'bad_channel' };

  const { rows: p } = await query('SELECT warehouse_id FROM logi_passes WHERE id = $1', [passId]);
  if (!p[0]) return { error: 'not_found' };
  const found = await warehouseAccess(p[0].warehouse_id, actorId);
  if (!found || !MAY_MANAGE.has(found.role)) return { error: 'not_found' };

  const to = text(target, MAX_CONTACT);
  if (!to) return { error: 'bad_target' };

  const { rows } = await query(
    `INSERT INTO logi_pass_sends (pass_id, channel, target_enc)
     VALUES ($1,$2,$3) RETURNING id, channel, sent_at`,
    [passId, String(channel), encryptContent(to)]);
  await logLogi(actorId, 'pass_sent', passId, { channel: String(channel) });
  return { send: { id: String(rows[0].id), passId, channel: rows[0].channel, target: to,
    sentAt: rows[0].sent_at?.toISOString?.() ?? undefined } };
};

export const listPassSends = async (passId, actorId) => {
  if (!PASS_ID_RE.test(String(passId ?? ''))) return null;
  const { rows: p } = await query('SELECT warehouse_id FROM logi_passes WHERE id = $1', [passId]);
  if (!p[0]) return null;
  const found = await warehouseAccess(p[0].warehouse_id, actorId);
  if (!found || !MAY_MANAGE.has(found.role)) return null;

  const { rows } = await query(
    'SELECT id, channel, target_enc, sent_at FROM logi_pass_sends WHERE pass_id = $1 ORDER BY sent_at DESC',
    [passId]);
  return rows.map((r) => ({
    id: String(r.id),
    passId,
    channel: r.channel,
    target: decryptContent(r.target_enc) ?? '',
    sentAt: r.sent_at?.toISOString?.() ?? undefined,
  }));
};

/* ═══ Поставки ═════════════════════════════════════════════════════ */

const SUPPLY_STATUSES = ['draft', 'preparing', 'in_transit', 'at_sorting_center', 'delivered', 'cancelled'];

const toSupply = (row) => ({
  id: row.id,
  number: row.number,
  code: row.code,
  sellerId: row.seller_id,
  name: row.name,
  senderName: row.sender_name,
  senderAddress: row.sender_addr_enc ? (decryptContent(row.sender_addr_enc) ?? '') : '',
  recipientName: row.recipient_name,
  recipientAddress: row.recipient_addr_enc ? (decryptContent(row.recipient_addr_enc) ?? '') : '',
  placesCount: Number(row.places),
  weightKg: row.weight_g == null ? undefined : Number(row.weight_g) / 1000,
  volumeM3: row.volume_ml == null ? undefined : Number(row.volume_ml) / 1_000_000,
  sortingCenterId: row.sorting_center_id ?? null,
  sortingCenterName: row.sorting_center_name ?? undefined,
  status: row.status,
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  updatedAt: row.updated_at?.toISOString?.() ?? undefined,
});

/** Номер для человека и короткий код для наклейки. */
const issueSupplyCode = () => {
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
  return { number: `SKY-SHP-${raw.slice(0, 6)}`, code: raw };
};

export const listSupplies = async (sellerId, { limit } = {}) => {
  const lim = int(limit, 1, 200) ?? 100;
  const { rows } = await query(
    'SELECT * FROM logi_supplies WHERE seller_id = $1 ORDER BY created_at DESC LIMIT $2',
    [sellerId, lim]);
  return rows.map(toSupply);
};

/**
 * Поиск поставки.
 *
 * Только среди своих. Поиск по чужому коду не должен находить ничего:
 * иначе по номеру с наклейки открывается чужой адрес получателя.
 */
export const findSupplies = async (sellerId, q) => {
  const needle = text(q, 80).toUpperCase();
  if (!needle) return [];
  const { rows } = await query(
    `SELECT * FROM logi_supplies
      WHERE seller_id = $1
        AND (upper(number) LIKE $2 OR upper(code) LIKE $2 OR upper(name) LIKE $2)
      ORDER BY created_at DESC LIMIT 50`,
    [sellerId, `%${needle.replace(/([\\%_])/g, '\\$1')}%`]);
  return rows.map(toSupply);
};

export const readSupply = async (supplyId, actorId) => {
  if (!SUPPLY_ID_RE.test(String(supplyId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM logi_supplies WHERE id = $1', [supplyId]);
  const row = rows[0];
  if (!row) return null;
  if (row.seller_id !== actorId) {
    await logLogi(actorId, 'supply_denied', supplyId);
    return null;
  }
  return toSupply(row);
};

export const createSupply = async (sellerId, input = {}) => {
  const name = text(input.name, MAX_NAME);
  if (name.length < 2) return { error: 'bad_name' };

  /* Сортировочный центр берём из базы и по его настоящей роли: иначе
     наклейка поедет на склад, который себя центром не объявлял. */
  let center = null;
  if (input.sortingCenterId) {
    const { rows: c } = await query(
      `SELECT id, name FROM logi_warehouses WHERE id = $1 AND role = 'sorting_center'`,
      [String(input.sortingCenterId)]);
    center = c[0] ?? null;
    if (!center) return { error: 'bad_sorting_center' };
  }

  const { number, code } = issueSupplyCode();
  const senderAddr = text(input.senderAddress, 300);
  const recipientAddr = text(input.recipientAddress, 300);

  const { rows } = await query(
    `INSERT INTO logi_supplies
       (id, seller_id, number, code, name, sender_name, sender_addr_enc,
        recipient_name, recipient_addr_enc, places, weight_g, volume_ml,
        sorting_center_id, sorting_center_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [`ls-${generateId()}`, sellerId, number, code, name,
      text(input.senderName, MAX_NAME), senderAddr ? encryptContent(senderAddr) : null,
      text(input.recipientName, MAX_NAME), recipientAddr ? encryptContent(recipientAddr) : null,
      int(input.placesCount, 1, 10_000) ?? 1,
      input.weightKg == null ? null : Math.round(Number(input.weightKg) * 1000) || 0,
      input.volumeM3 == null ? null : Math.round(Number(input.volumeM3) * 1_000_000) || 0,
      center?.id ?? null, center?.name ?? null]);

  await logSupply(rows[0].id, sellerId, 'created', `Поставка «${name}» создана`);
  await logLogi(sellerId, 'supply_created', rows[0].id);
  return { supply: toSupply(rows[0]) };
};

export const updateSupply = async (supplyId, actorId, patch = {}) => {
  const supply = await readSupply(supplyId, actorId);
  if (!supply) return { error: 'not_found' };

  const sets = [];
  const args = [supplyId];
  const push = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };

  if (patch.name !== undefined) {
    const name = text(patch.name, MAX_NAME);
    if (name.length < 2) return { error: 'bad_name' };
    push('name', name);
  }
  if (patch.senderName !== undefined) push('sender_name', text(patch.senderName, MAX_NAME));
  if (patch.recipientName !== undefined) push('recipient_name', text(patch.recipientName, MAX_NAME));
  if (patch.senderAddress !== undefined) {
    const a = text(patch.senderAddress, 300);
    push('sender_addr_enc', a ? encryptContent(a) : null);
  }
  if (patch.recipientAddress !== undefined) {
    const a = text(patch.recipientAddress, 300);
    push('recipient_addr_enc', a ? encryptContent(a) : null);
  }
  if (patch.placesCount !== undefined) push('places', int(patch.placesCount, 1, 10_000) ?? 1);
  if (patch.weightKg !== undefined) {
    push('weight_g', patch.weightKg == null ? null : Math.round(Number(patch.weightKg) * 1000) || 0);
  }
  if (patch.volumeM3 !== undefined) {
    push('volume_ml', patch.volumeM3 == null ? null : Math.round(Number(patch.volumeM3) * 1_000_000) || 0);
  }
  if (sets.length === 0) return { supply };

  const { rows } = await query(
    `UPDATE logi_supplies SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, args);
  await logSupply(supplyId, actorId, 'updated', 'Поставка изменена');
  return { supply: toSupply(rows[0]) };
};

export const setSupplyStatus = async (supplyId, actorId, status) => {
  const supply = await readSupply(supplyId, actorId);
  if (!supply) return { error: 'not_found' };
  if (!SUPPLY_STATUSES.includes(String(status))) return { error: 'bad_status' };
  if (['delivered', 'cancelled'].includes(supply.status)) return { error: 'already_closed' };

  const { rows } = await query(
    'UPDATE logi_supplies SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [supplyId, String(status)]);
  await logSupply(supplyId, actorId, 'status_changed', `Состояние: ${status}`);
  return { supply: toSupply(rows[0]) };
};

export const setSupplyCenter = async (supplyId, actorId, centerId) => {
  const supply = await readSupply(supplyId, actorId);
  if (!supply) return { error: 'not_found' };

  let center = null;
  if (centerId) {
    const { rows: c } = await query(
      `SELECT id, name FROM logi_warehouses WHERE id = $1 AND role = 'sorting_center'`,
      [String(centerId)]);
    center = c[0] ?? null;
    if (!center) return { error: 'bad_sorting_center' };
  }

  const { rows } = await query(
    `UPDATE logi_supplies SET sorting_center_id = $2, sorting_center_name = $3, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [supplyId, center?.id ?? null, center?.name ?? null]);
  await logSupply(supplyId, actorId, 'sorting_center_changed',
    center ? `Сортировочный центр: ${center.name}` : 'Сортировочный центр убран');
  return { supply: toSupply(rows[0]) };
};

export const deleteSupply = async (supplyId, actorId) => {
  const supply = await readSupply(supplyId, actorId);
  if (!supply) return { error: 'not_found' };
  await query('DELETE FROM logi_supplies WHERE id = $1', [supplyId]);
  await logLogi(actorId, 'supply_deleted', supplyId);
  return { ok: true };
};

export const logSupply = async (supplyId, actorId, type, line) => {
  try {
    await query(
      `INSERT INTO logi_supply_log (supply_id, actor_id, type, text) VALUES ($1,$2,$3,$4)`,
      [supplyId, actorId ?? null, text(type, 40), text(line, 300)]);
  } catch {
    /* Журнал не должен ронять то, что он описывает. */
  }
};

export const listSupplyLog = async (supplyId, actorId) => {
  const supply = await readSupply(supplyId, actorId);
  if (!supply) return null;
  const { rows } = await query(
    'SELECT id, type, text, created_at FROM logi_supply_log WHERE supply_id = $1 ORDER BY created_at',
    [supplyId]);
  return rows.map((r) => ({
    id: String(r.id),
    shipmentId: supplyId,
    type: r.type,
    text: r.text,
    createdAt: r.created_at?.toISOString?.() ?? undefined,
  }));
};
