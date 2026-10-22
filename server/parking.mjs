/**
 * Sky Parking, этап A: организации, парковки, тарифы, модерация карточек.
 * Права внутри организации: owner (один) → admin (парковки, тарифы, модераторы) → moderator (правка текста, отправка на проверку).
 * Карточки проверяет администрация Sky (право parking_moderation) — не тот, кто отправил. Места и карту не выдумываем.
 */
import { query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { newId, inTx, clean, notifyGo } from './gocore.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { subState } from './kbiz.mjs';

export const TARIFF_KINDS = ['hourly', 'daily', 'flat'];
const MAX_ORGS_PER_OWNER = 3;
const MAX_LOTS_PER_ORG = 200;
const MAX_TARIFFS_PER_LOT = 6;
const MAX_STAFF = 30;
// Поля, изменение которых у уже одобренной парковки возвращает её на проверку.
const SENSITIVE = ['title', 'city', 'address', 'lat', 'lng', 'spaces_total', 'description'];

const ev = async (client, orgId, lotId, actor, action, detail = {}) => {
  await (client ?? { query }).query('INSERT INTO parking_events (org_id, lot_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [orgId, lotId, actor, action, JSON.stringify(detail)]);
};

/** Журнал ошибок парковок: код и безопасное сообщение, без секретов и тел запросов. Сбой записи не ломает вызывающего. */
const scrubMsg = (m) => String(m ?? '').replace(/(bearer|token|secret|password|authorization)[^\s,;]*/gi, '$1=…').slice(0, 300);
export const logParkingError = async (scope, code, message, ctx = {}) => {
  try {
    await query('INSERT INTO parking_errors (scope, code, message, actor_id, org_id, lot_id) VALUES ($1,$2,$3,$4,$5,$6)', [String(scope).slice(0, 60), String(code ?? '').slice(0, 80), scrubMsg(message), ctx.actor ?? null, ctx.orgId ?? null, ctx.lotId ?? null]);
    if (ctx.critical) void notifyStaff('parking_error', { title: 'Сбой в Sky Parking', body: `${scope}: ${code}`, dedupe: `pkerr:${scope}:${Date.now() >> 18}` }).catch(() => {});
  } catch { /* журнал не должен ломать запрос */ }
};

/* ─── Роль человека в организации ─── */
export const orgRole = async (profileId, orgId, client = null) => {
  const q = (client ?? { query }).query.bind(client ?? { query });
  const o = (await q('SELECT owner_id, status FROM parking_orgs WHERE id=$1', [orgId])).rows[0];
  if (!o) return { role: null };
  if (o.owner_id === profileId) return { role: 'owner', suspended: o.status === 'suspended' };
  const s = (await q('SELECT role FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [orgId, profileId])).rows[0];
  return { role: s?.role ?? null, suspended: o.status === 'suspended' };
};
const RANK = { owner: 3, admin: 2, moderator: 1 };
const needRole = async (me, orgId, min, client = null) => {
  const r = await orgRole(me, orgId, client);
  if (!r.role) return { error: 'not_found' };          // посторонний не узнаёт, что организация есть
  if ((RANK[r.role] ?? 0) < RANK[min]) return { error: 'not_allowed' };
  return { role: r.role, suspended: r.suspended };
};

/* ─── Расчёт стоимости: считает только сервер ─── */
export const calcCost = (t, minutes) => {
  const m = Math.floor(Number(minutes));
  if (!Number.isFinite(m) || m < t.min_minutes) return { error: 'duration_too_short', min: t.min_minutes };
  if (m > t.max_minutes) return { error: 'duration_too_long', max: t.max_minutes };
  const price = Number(t.price_rub);
  if (t.kind === 'flat') return { cost: price, minutes: m };
  const floor = (c) => (c > 0 ? Math.max(c, Number(t.min_cost_rub || 0)) : c);   // минимальная стоимость не касается бесплатной части
  if (t.kind === 'daily') return { cost: floor(Math.ceil(m / 1440) * price), minutes: m };
  const paid = Math.max(0, m - Number(t.free_minutes || 0));
  return { cost: floor(Math.ceil(paid / 60) * price), minutes: m };
};

const cleanLotInput = (b, partial = false) => {
  const out = {};
  const put = (k, v) => { if (!partial || b[k] !== undefined) out[k] = v; };
  put('title', clean(b.title, 120));
  put('city', clean(b.city, 80));
  put('address', clean(b.address, 240));
  put('description', clean(b.description, 1000));
  put('hours', clean(b.hours, 120));
  if (!partial || b.spaces_total !== undefined || b.spacesTotal !== undefined) {
    const n = Math.floor(Number(b.spacesTotal ?? b.spaces_total)); out.spaces_total = Number.isFinite(n) ? Math.max(0, Math.min(10000, n)) : 0;
  }
  if (!partial || b.lat !== undefined || b.lng !== undefined) {
    const lat = Number(b.lat); const lng = Number(b.lng);
    const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    out.lat = ok ? lat : null; out.lng = ok ? lng : null;
  }
  return out;
};

/* ─── Организации ─── */
export const createOrg = async (me, input) => {
  const name = clean(input?.name, 100);
  if (name.length < 3) return { error: 'bad_name' };
  const n = Number((await query('SELECT COUNT(*)::int c FROM parking_orgs WHERE owner_id=$1', [me])).rows[0].c);
  if (n >= MAX_ORGS_PER_OWNER) return { error: 'too_many_orgs' };
  const id = newId('pko');
  await query('INSERT INTO parking_orgs (id, owner_id, name) VALUES ($1,$2,$3)', [id, me, name]);
  await ev(null, id, null, me, 'org_created', { name });
  return { ok: true, id };
};

export const myOrgs = async (me) => {
  const { rows } = await query(
    `SELECT o.id, o.name, o.status, o.suspend_reason, CASE WHEN o.owner_id=$1 THEN 'owner' ELSE s.role END AS role,
            (SELECT COUNT(*)::int FROM parking_lots l WHERE l.org_id=o.id) AS lots
       FROM parking_orgs o LEFT JOIN parking_staff s ON s.org_id=o.id AND s.profile_id=$1
      WHERE o.owner_id=$1 OR s.profile_id=$1 ORDER BY o.created_at DESC LIMIT 20`, [me]);
  return { orgs: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, suspendReason: r.status === 'suspended' ? r.suspend_reason : '', role: r.role, lots: r.lots })) };
};

/* ─── Сотрудники ─── */
const STAFF_PERMS = ['edit', 'submit'];
const cleanScope = async (orgId, input) => {
  let lotIds = null;
  if (Array.isArray(input?.lotIds)) {
    const ids = [...new Set(input.lotIds.map((x) => String(x)))].slice(0, 200);
    const ok = ids.length ? (await query('SELECT id FROM parking_lots WHERE org_id=$1 AND id = ANY($2)', [orgId, ids])).rows.map((r) => r.id) : [];
    lotIds = ok;                                    // пустой список = ни одной парковки (доступ закрыт), а не «все»
  }
  const perms = Array.isArray(input?.perms) ? [...new Set(input.perms.map(String).filter((x) => STAFF_PERMS.includes(x)))] : undefined;
  return { lotIds, perms };
};
export const listStaff = async (me, orgId) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  const { rows } = await query(
    `SELECT s.profile_id, s.role, s.created_at, s.lot_ids, s.perms, p.username, p.name FROM parking_staff s JOIN profiles p ON p.id=s.profile_id WHERE s.org_id=$1 ORDER BY s.created_at`, [orgId]);
  return { staff: rows.map((r) => ({ profileId: r.profile_id, role: r.role, username: r.username, name: r.name, at: r.created_at, lotIds: r.lot_ids, perms: r.perms })) };
};
export const addStaff = async (me, orgId, input) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  if (g.suspended) return { error: 'org_suspended' };
  const role = String(input?.role ?? '');
  if (!['admin', 'moderator'].includes(role)) return { error: 'bad_role' };
  if (role === 'admin' && g.role !== 'owner') return { error: 'not_allowed' };   // администратора назначает только владелец
  const uname = clean(input?.username, 40).replace(/^@/, '').toLowerCase();
  const target = (await query('SELECT id FROM profiles WHERE lower(username)=$1', [uname])).rows[0];
  if (!target) return { error: 'user_not_found' };
  if (target.id === me) return { error: 'self_change' };
  const sc = await cleanScope(orgId, input);
  return inTx(async (c) => {
    const o = (await c.query('SELECT owner_id FROM parking_orgs WHERE id=$1 FOR UPDATE', [orgId])).rows[0];
    if (o.owner_id === target.id) return { error: 'already_owner' };
    const cnt = Number((await c.query('SELECT COUNT(*)::int c FROM parking_staff WHERE org_id=$1', [orgId])).rows[0].c);
    const had = (await c.query('SELECT role FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [orgId, target.id])).rows[0];
    if (!had && cnt >= MAX_STAFF) return { error: 'too_many_staff' };
    if (had?.role === 'admin' && g.role !== 'owner') return { error: 'not_allowed' };
    await c.query(`INSERT INTO parking_staff (org_id, profile_id, role, added_by, lot_ids, perms) VALUES ($1,$2,$3,$4,$5,$6)
                   ON CONFLICT (org_id, profile_id) DO UPDATE SET role=EXCLUDED.role, lot_ids=EXCLUDED.lot_ids, perms=EXCLUDED.perms`,
      [orgId, target.id, role, me, role === 'admin' ? null : sc.lotIds, sc.perms ?? STAFF_PERMS]);
    await ev(c, orgId, null, me, 'staff_set', { target: target.id, role, lotIds: sc.lotIds, perms: sc.perms });
    return { ok: true };
  });
};
/** Изменить область и права модератора. Роль не повышается; администратором его назначает только владелец через addStaff. */
export const updateStaff = async (me, orgId, profileId, input) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  if (g.suspended) return { error: 'org_suspended' };
  if (profileId === me) return { error: 'self_change' };                           // свои права не расширить
  const cur = (await query('SELECT role FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [orgId, profileId])).rows[0];
  if (!cur) return { error: 'not_found' };
  if (cur.role === 'admin') return { error: 'not_allowed' };                       // администратор — отдельная роль без ограничений по парковкам
  const sc = await cleanScope(orgId, input);
  await query('UPDATE parking_staff SET lot_ids=$3, perms=$4 WHERE org_id=$1 AND profile_id=$2', [orgId, profileId, input?.lotIds === null ? null : sc.lotIds, sc.perms ?? STAFF_PERMS]);
  await ev(null, orgId, null, me, 'staff_scope', { target: profileId, lotIds: sc.lotIds, perms: sc.perms });
  return { ok: true };
};
/** Журнал действий организации (владелец и администратор). */
export const orgAudit = async (me, orgId, f = {}) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  const lim = Math.min(100, Math.max(1, Number(f.limit) || 50)); const off = Math.max(0, Number(f.offset) || 0);
  const { rows } = await query(
    `SELECT e.id, e.action, e.detail, e.at, e.lot_id, e.actor_id, p.username FROM parking_events e LEFT JOIN profiles p ON p.id=e.actor_id
      WHERE e.org_id=$1 ORDER BY e.id DESC LIMIT ${lim} OFFSET ${off}`, [orgId]);
  return { events: rows.map((r) => ({ id: r.id, action: r.action, detail: r.detail, at: r.at, lotId: r.lot_id, actor: r.username ?? r.actor_id })), limit: lim, offset: off };
};
export const removeStaff = async (me, orgId, profileId) => {
  const g = await needRole(me, orgId, 'moderator'); if (g.error) return g;
  const cur = (await query('SELECT role FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [orgId, profileId])).rows[0];
  if (!cur) return { error: 'not_found' };
  const self = profileId === me;
  // выйти может сам; убрать другого: владелец — любого, администратор — только модератора
  if (!self && !(g.role === 'owner' || (g.role === 'admin' && cur.role === 'moderator'))) return { error: 'not_allowed' };
  await query('DELETE FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [orgId, profileId]);
  await ev(null, orgId, null, me, 'staff_removed', { target: profileId });
  return { ok: true };
};

/** Какие организации сейчас могут принимать оплату: у владельца SkyKassa Business опубликован, подписка действует, есть реквизиты. */
export const acceptingOrgs = async (orgIds) => {
  const ids = [...new Set(orgIds)]; if (!ids.length) return new Set();
  const { rows } = await query(
    `SELECT o.id AS org_id, b.id AS biz_id FROM parking_orgs o JOIN kb_businesses b ON b.owner_id = o.owner_id AND b.status = 'active'
      WHERE o.id = ANY($1) AND EXISTS (SELECT 1 FROM kb_requisites r WHERE r.business_id = b.id)`, [ids]);
  const ok = new Set();
  for (const r of rows) if ((await subState(r.biz_id)).active) ok.add(r.org_id);
  return ok;
};

/* ─── Парковки ─── */
const lotRow = (l, tariffs = []) => ({
  id: l.id, orgId: l.org_id, title: l.title, city: l.city, address: l.address, lat: l.lat, lng: l.lng,
  spacesTotal: l.spaces_total, description: l.description, hours: l.hours, status: l.status,
  rejectReason: l.reject_reason, closed: Boolean(l.closed), closedReason: l.closed_reason ?? '', version: l.version, updatedAt: l.updated_at, publishedAt: l.published_at,
  tariffs: tariffs.map((t) => ({ id: t.id, kind: t.kind, priceRub: t.price_rub, freeMinutes: t.free_minutes, minMinutes: t.min_minutes, maxMinutes: t.max_minutes, minCostRub: t.min_cost_rub ?? 0, active: t.active })),
});
const tariffsOf = async (lotIds) => {
  if (!lotIds.length) return new Map();
  const { rows } = await query('SELECT * FROM parking_tariffs WHERE lot_id = ANY($1) ORDER BY price_rub', [lotIds]);
  const m = new Map(); for (const r of rows) { if (!m.has(r.lot_id)) m.set(r.lot_id, []); m.get(r.lot_id).push(r); } return m;
};

export const orgLots = async (me, orgId, f = {}) => {
  const g = await needRole(me, orgId, 'moderator'); if (g.error) return g;
  const where = ['org_id=$1']; const args = [orgId];
  const st = clean(f.status, 20); if (['draft', 'review', 'approved', 'rejected', 'suspended', 'archived'].includes(st)) { args.push(st); where.push(`status=$${args.length}`); }
  if (f.closed === '1') where.push('closed'); else if (f.closed === '0') where.push('NOT closed');
  const text = clean(f.q, 60).toLowerCase(); if (text) { args.push(`%${text}%`); where.push(`(lower(title) LIKE $${args.length} OR lower(address) LIKE $${args.length} OR lower(city) LIKE $${args.length})`); }
  if (g.role === 'moderator') { const sc = await staffScope(orgId, me); if (sc.lotIds) { args.push(sc.lotIds); where.push(`id = ANY($${args.length})`); } }
  const lim = Math.min(100, Math.max(1, Number(f.limit) || 100)); const off = Math.max(0, Number(f.offset) || 0);
  const total = Number((await query(`SELECT COUNT(*)::int c FROM parking_lots WHERE ${where.join(' AND ')}`, args)).rows[0].c);
  const { rows } = await query(`SELECT * FROM parking_lots WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ${lim} OFFSET ${off}`, args);
  const t = await tariffsOf(rows.map((r) => r.id));
  const acc = await acceptingOrgs([orgId]);
  return { role: g.role, acceptsPayment: acc.has(orgId), total, limit: lim, offset: off, lots: rows.map((r) => lotRow(r, t.get(r.id) ?? [])) };
};

export const createLot = async (me, orgId, input) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  if (g.suspended) return { error: 'org_suspended' };
  const f = cleanLotInput(input ?? {});
  if (f.title.length < 3) return { error: 'bad_title' };
  const n = Number((await query('SELECT COUNT(*)::int c FROM parking_lots WHERE org_id=$1 AND status<>$2', [orgId, 'archived'])).rows[0].c);
  if (n >= MAX_LOTS_PER_ORG) return { error: 'too_many_lots' };
  const id = newId('pkl');
  await query(`INSERT INTO parking_lots (id, org_id, title, city, address, lat, lng, spaces_total, description, hours, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, orgId, f.title, f.city, f.address, f.lat, f.lng, f.spaces_total, f.description, f.hours, me]);
  await ev(null, orgId, id, me, 'lot_created', { title: f.title });
  return { ok: true, id };
};

/** Ограничения модератора организации: список доступных парковок (NULL — все) и разрешённые действия. */
export const staffScope = async (orgId, profileId, client = null) => {
  const r = (await (client ?? { query }).query('SELECT lot_ids, perms FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [orgId, profileId])).rows[0];
  return { lotIds: r?.lot_ids ?? null, perms: r?.perms ?? ['edit', 'submit'] };
};
const loadLotFor = async (me, lotId, min, client = null) => {
  const q = (client ?? { query });
  const l = (await q.query(`SELECT * FROM parking_lots WHERE id=$1${client ? ' FOR UPDATE' : ''}`, [lotId])).rows[0];
  if (!l) return { error: 'not_found' };
  const g = await needRole(me, l.org_id, min, client); if (g.error) return g;
  let perms = null;
  if (g.role === 'moderator') {
    const sc = await staffScope(l.org_id, me, client);
    if (sc.lotIds && !sc.lotIds.includes(lotId)) return { error: 'not_found' };      // чужая для него парковка — как будто её нет
    perms = sc.perms;
  }
  return { lot: l, role: g.role, suspended: g.suspended, perms };
};

export const updateLot = async (me, lotId, input) => inTx(async (c) => {
  const r = await loadLotFor(me, lotId, 'moderator', c); if (r.error) return r;
  if (r.suspended) return { error: 'org_suspended' };
  const l = r.lot;
  if (r.perms && !r.perms.includes('edit')) return { error: 'not_allowed' };
  if (['suspended', 'archived'].includes(l.status)) return { error: 'not_editable' };
  if (l.status === 'review') return { error: 'in_review' };
  const f = cleanLotInput(input ?? {}, true);
  if (f.title !== undefined && f.title.length < 3) return { error: 'bad_title' };
  // модератор организации правит текстовые поля, но не число мест и не координаты
  if (r.role === 'moderator' && ('spaces_total' in f || 'lat' in f || 'lng' in f)) return { error: 'not_allowed' };
  const keys = Object.keys(f); if (!keys.length) return { ok: true, status: l.status };
  const sens = keys.some((k) => SENSITIVE.includes(k) && String(f[k] ?? '') !== String(l[k] ?? ''));
  const toReview = l.status === 'approved' && sens;           // изменение проверяемого — снова на проверку и скрытие
  const set = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  await c.query(`UPDATE parking_lots SET ${set}, version=version+1, updated_at=now()${toReview ? ", status='draft', published_at=NULL" : ''} WHERE id=$1`, [lotId, ...keys.map((k) => f[k])]);
  await ev(c, l.org_id, lotId, me, 'lot_updated', { fields: keys, returnedToDraft: toReview });
  return { ok: true, status: toReview ? 'draft' : l.status };
});

const MISSING_HINT = { title: 'название (от 3 знаков)', address: 'адрес', coords: 'точка на карте', spaces: 'число мест', tariff: 'хотя бы один тариф' };
/** Отправка на проверку одним действием: несохранённые правки формы (fields) сохраняются в той же транзакции, повторное нажатие безвредно. */
export const submitLot = async (me, lotId, body = {}) => {
  const out = await inTx(async (c) => {
    const r = await loadLotFor(me, lotId, 'moderator', c); if (r.error) return r;
    if (r.suspended) return { error: 'org_suspended' };
    if (r.perms && !r.perms.includes('submit')) return { error: 'not_allowed' };
    let l = r.lot;
    if (l.status === 'review') return l.submitted_by === me ? { ok: true, already: true, title: l.title } : { error: 'in_review' };
    if (!['draft', 'rejected'].includes(l.status)) return { error: 'bad_state' };
    if (body?.fields && typeof body.fields === 'object' && !(r.perms && !r.perms.includes('edit'))) {
      const f = cleanLotInput(body.fields, true);
      if (r.role === 'moderator') { delete f.lat; delete f.lng; delete f.spaces_total; }
      const keys = Object.keys(f).filter((k) => !(k === 'title' && f.title.length < 3));
      if (keys.length) {
        await c.query(`UPDATE parking_lots SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, version=version+1, updated_at=now() WHERE id=$1`, [lotId, ...keys.map((k) => f[k])]);
        l = (await c.query('SELECT * FROM parking_lots WHERE id=$1', [lotId])).rows[0];
      }
    }
    const tariffs = Number((await c.query('SELECT COUNT(*)::int c FROM parking_tariffs WHERE lot_id=$1 AND active', [lotId])).rows[0].c);
    const missing = [];
    if (String(l.title ?? '').length < 3) missing.push('title');
    if (!l.address) missing.push('address');
    if (l.lat == null || l.lng == null) missing.push('coords');
    if (!(l.spaces_total >= 1)) missing.push('spaces');
    if (!tariffs) missing.push('tariff');
    if (missing.length) {
      await ev(c, l.org_id, lotId, me, 'submit_failed', { missing });
      return { error: missing.length === 1 && missing[0] === 'tariff' ? 'no_tariff' : 'incomplete', missing, hint: `Не хватает: ${missing.map((k) => MISSING_HINT[k]).join(', ')}.` };
    }
    await c.query("UPDATE parking_lots SET status='review', submitted_by=$2, reject_reason='', claimed_by=NULL, claimed_at=NULL, updated_at=now() WHERE id=$1", [lotId, me]);
    await ev(c, l.org_id, lotId, me, 'lot_submitted', {});
    return { ok: true, title: l.title };
  });
  if (out.ok && !out.already) void notifyStaff('parking_lot', { title: 'Парковка на проверке', body: out.title, dedupe: `pklot:${lotId}:${Date.now() >> 16}`, except: me }).catch(() => {});
  if (!out.ok && ['incomplete', 'no_tariff'].includes(out.error) === false && out.error !== 'bad_state') void logParkingError('submit', out.error, `submit ${lotId}`, { actor: me, lotId }).catch(() => {});
  return out.ok ? { ok: true, ...(out.already ? { already: true } : {}) } : out;
};

export const archiveLot = async (me, lotId) => inTx(async (c) => {
  const r = await loadLotFor(me, lotId, 'admin', c); if (r.error) return r;
  await c.query("UPDATE parking_lots SET status='archived', published_at=NULL, updated_at=now() WHERE id=$1", [lotId]);
  await ev(c, r.lot.org_id, lotId, me, 'lot_archived', {});
  return { ok: true };
});

/* ─── Тарифы ─── */
const cleanTariff = (b) => {
  const kind = String(b?.kind ?? ''); if (!TARIFF_KINDS.includes(kind)) return { error: 'bad_kind' };
  const price = Math.floor(Number(b.priceRub)); if (!Number.isFinite(price) || price < 1 || price > 100000) return { error: 'bad_price' };
  const free = Math.floor(Number(b.freeMinutes ?? 0)); if (!Number.isFinite(free) || free < 0 || free > 240) return { error: 'bad_free' };
  const min = Math.floor(Number(b.minMinutes ?? 15)); const max = Math.floor(Number(b.maxMinutes ?? 1440));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 5 || max > 43200 || max < min) return { error: 'bad_limits' };
  const minCost = Math.floor(Number(b.minCostRub ?? 0)); if (!Number.isFinite(minCost) || minCost < 0 || minCost > 100000) return { error: 'bad_min_cost' };
  return { kind, price, free: kind === 'hourly' ? free : 0, min, max, minCost };
};
export const addTariff = async (me, lotId, input) => inTx(async (c) => {
  const r = await loadLotFor(me, lotId, 'admin', c); if (r.error) return r;
  if (r.suspended) return { error: 'org_suspended' };
  if (['suspended', 'archived'].includes(r.lot.status)) return { error: 'not_editable' };
  const t = cleanTariff(input); if (t.error) return t;
  const n = Number((await c.query('SELECT COUNT(*)::int c FROM parking_tariffs WHERE lot_id=$1', [lotId])).rows[0].c);
  if (n >= MAX_TARIFFS_PER_LOT) return { error: 'too_many_tariffs' };
  const id = newId('pkt');
  await c.query('INSERT INTO parking_tariffs (id, lot_id, kind, price_rub, free_minutes, min_minutes, max_minutes, min_cost_rub) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, lotId, t.kind, t.price, t.free, t.min, t.max, t.minCost]);
  // цена — проверяемое поле: у одобренной парковки изменение тарифа тоже требует проверки
  if (r.lot.status === 'approved') await c.query("UPDATE parking_lots SET status='draft', published_at=NULL, version=version+1, updated_at=now() WHERE id=$1", [lotId]);
  await ev(c, r.lot.org_id, lotId, me, 'tariff_added', { kind: t.kind, price: t.price });
  return { ok: true, id, status: r.lot.status === 'approved' ? 'draft' : r.lot.status };
});
export const removeTariff = async (me, lotId, tariffId) => inTx(async (c) => {
  const r = await loadLotFor(me, lotId, 'admin', c); if (r.error) return r;
  const d = await c.query('DELETE FROM parking_tariffs WHERE id=$1 AND lot_id=$2', [tariffId, lotId]);
  if (!d.rowCount) return { error: 'not_found' };
  if (r.lot.status === 'approved') {
    const left = Number((await c.query('SELECT COUNT(*)::int c FROM parking_tariffs WHERE lot_id=$1 AND active', [lotId])).rows[0].c);
    await c.query("UPDATE parking_lots SET status='draft', published_at=NULL, version=version+1, updated_at=now() WHERE id=$1", [lotId]);
    void left;
  }
  await ev(c, r.lot.org_id, lotId, me, 'tariff_removed', { tariffId });
  return { ok: true };
});

/** Правка тарифа. Оплаченные сессии не меняются (тариф скопирован в сессию), у одобренной парковки правка цены возвращает её на проверку. */
export const updateTariff = async (me, lotId, tariffId, input) => inTx(async (c) => {
  const r = await loadLotFor(me, lotId, 'admin', c); if (r.error) return r;
  if (r.suspended) return { error: 'org_suspended' };
  if (['suspended', 'archived'].includes(r.lot.status)) return { error: 'not_editable' };
  if (r.lot.status === 'review') return { error: 'in_review' };
  const t = cleanTariff(input); if (t.error) return t;
  const d = await c.query('UPDATE parking_tariffs SET kind=$3, price_rub=$4, free_minutes=$5, min_minutes=$6, max_minutes=$7, min_cost_rub=$8 WHERE id=$1 AND lot_id=$2',
    [tariffId, lotId, t.kind, t.price, t.free, t.min, t.max, t.minCost]);
  if (!d.rowCount) return { error: 'not_found' };
  if (r.lot.status === 'approved') await c.query("UPDATE parking_lots SET status='draft', published_at=NULL, version=version+1, updated_at=now() WHERE id=$1", [lotId]);
  await ev(c, r.lot.org_id, lotId, me, 'tariff_updated', { tariffId, kind: t.kind, price: t.price });
  return { ok: true, status: r.lot.status === 'approved' ? 'draft' : r.lot.status };
});

/** Закрыть парковку для новых сессий (причина обязательна) и открыть снова. Начатые сессии доводятся до конца, история не затрагивается. */
export const setLotClosed = async (me, lotId, closed, reasonRaw) => {
  const reason = clean(reasonRaw, 300);
  if (closed && reason.length < 5) return { error: 'reason_required' };
  const out = await inTx(async (c) => {
    const r = await loadLotFor(me, lotId, 'admin', c); if (r.error) return r;
    if (r.suspended) return { error: 'org_suspended' };
    if (r.lot.status !== 'approved') return { error: 'bad_state' };
    if (Boolean(r.lot.closed) === closed) return { ok: true, already: true, title: r.lot.title };
    await c.query('UPDATE parking_lots SET closed=$2, closed_reason=$3, closed_by=$4, closed_at=now(), updated_at=now() WHERE id=$1', [lotId, closed, closed ? reason : '', me]);
    await ev(c, r.lot.org_id, lotId, me, closed ? 'lot_closed' : 'lot_reopened', { reason });
    return { ok: true, title: r.lot.title };
  });
  return out;
};

/* ─── Панель владельца: сводка, заявки, платежи ─── */
const PERIODS = { day: "now() - interval '1 day'", week: "now() - interval '7 days'", month: "now() - interval '30 days'" };
/** Сводка организации. «Оборот» — подтверждённые платежи на ваши реквизиты, а не доход: деньги идут напрямую вам, Sky их не принимает. */
export const orgDashboard = async (me, orgId) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  const lots = (await query(`SELECT status, closed, COUNT(*)::int n FROM parking_lots WHERE org_id=$1 GROUP BY status, closed`, [orgId])).rows;
  const byStatus = {}; let open = 0; let closedN = 0;
  for (const r of lots) { byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n; if (r.status === 'approved') { if (r.closed) closedN += r.n; else open += r.n; } }
  const act = Number((await query("SELECT COUNT(*)::int c FROM parking_sessions WHERE org_id=$1 AND status='active' AND ends_at>now()", [orgId])).rows[0].c);
  const users = (await query(`SELECT COUNT(DISTINCT profile_id)::int total, COUNT(DISTINCT profile_id) FILTER (WHERE created_at > now() - interval '30 days')::int m30 FROM parking_sessions WHERE org_id=$1 AND status IN ('active','ended')`, [orgId])).rows[0];
  const money = {};
  for (const [k, since] of Object.entries(PERIODS)) {
    const r = (await query(
      `SELECT COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status='paid'),0)::int paid, COUNT(*) FILTER (WHERE p.status='paid')::int paid_n,
              COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status='refunded'),0)::int refunded, COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status='pending'),0)::int pending
         FROM parking_payments p JOIN parking_sessions s ON s.id=p.session_id WHERE s.org_id=$1 AND p.created_at >= ${since}`, [orgId])).rows[0];
    money[k] = { confirmedRub: r.paid, confirmedCount: r.paid_n, refundedRub: r.refunded, pendingRub: r.pending };
  }
  const days = (await query(
    `SELECT to_char(d::date,'YYYY-MM-DD') AS day,
            COALESCE((SELECT COUNT(*) FROM parking_sessions s WHERE s.org_id=$1 AND s.created_at::date = d::date AND s.status IN ('active','ended')),0)::int AS sessions,
            COALESCE((SELECT SUM(p.amount_rub) FROM parking_payments p JOIN parking_sessions s ON s.id=p.session_id WHERE s.org_id=$1 AND p.status='paid' AND p.created_at::date = d::date),0)::int AS rub
       FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') d ORDER BY d`, [orgId])).rows;
  const recent = (await query(
    `SELECT e.id, e.action, e.detail, e.at, l.title FROM parking_events e LEFT JOIN parking_lots l ON l.id=e.lot_id
      WHERE e.org_id=$1 AND e.action IN ('lot_submitted','admin_approve','admin_reject','admin_suspend','admin_restore','submit_failed','lot_closed','lot_reopened') ORDER BY e.id DESC LIMIT 8`, [orgId])).rows;
  const errs = (await query('SELECT at, scope, code, message FROM parking_errors WHERE org_id=$1 ORDER BY id DESC LIMIT 8', [orgId])).rows;
  const refunds = Number((await query("SELECT COUNT(*)::int c FROM parking_refunds WHERE org_id=$1 AND status='requested'", [orgId])).rows[0].c);
  return { role: g.role, lots: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus, open, closed: closedN }, activeSessions: act, users: { total: users.total, last30: users.m30 },
    money, days, recent: recent.map((r) => ({ id: r.id, action: r.action, title: r.title, at: r.at, detail: r.detail })), errors: errs, pendingRefunds: refunds,
    note: 'Оборот — подтверждённые платежи на ваши реквизиты через SkyKassa Business (подтверждаете вы). Это не доход организации: Sky деньги не принимает и комиссию не удерживает.' };
};

/** История платежей организации с фильтрами и постраничной выдачей. */
export const orgPayments = async (me, orgId, f = {}) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  const where = ['s.org_id=$1']; const args = [orgId];
  const st = clean(f.status, 12); if (['pending', 'paid', 'refunded', 'cancelled'].includes(st)) { args.push(st); where.push(`p.status=$${args.length}`); }
  if (f.lotId) { args.push(String(f.lotId)); where.push(`s.lot_id=$${args.length}`); }
  const d1 = f.from ? new Date(f.from) : null; const d2 = f.to ? new Date(f.to) : null;
  if (d1 && !Number.isNaN(+d1)) { args.push(d1); where.push(`p.created_at >= $${args.length}`); }
  if (d2 && !Number.isNaN(+d2)) { args.push(new Date(+d2 + 86400000)); where.push(`p.created_at < $${args.length}`); }
  const mn = Number(f.min); const mx = Number(f.max);
  if (f.min !== undefined && f.min !== '' && Number.isFinite(mn)) { args.push(Math.floor(mn)); where.push(`p.amount_rub >= $${args.length}`); }
  if (f.max !== undefined && f.max !== '' && Number.isFinite(mx)) { args.push(Math.floor(mx)); where.push(`p.amount_rub <= $${args.length}`); }
  const lim = Math.min(500, Math.max(1, Number(f.limit) || 30)); const off = Math.max(0, Number(f.offset) || 0);
  const w = where.join(' AND ');
  const sum = (await query(`SELECT COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status='paid'),0)::int paid, COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status='refunded'),0)::int refunded,
                                   COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status='pending'),0)::int pending, COUNT(*)::int n FROM parking_payments p JOIN parking_sessions s ON s.id=p.session_id WHERE ${w}`, args)).rows[0];
  const { rows } = await query(
    `SELECT p.id, p.kind, p.amount_rub, p.status, p.pay_via, p.created_at, p.minutes, s.id AS session_id, s.lot_id, l.title, r.status AS refund_status
       FROM parking_payments p JOIN parking_sessions s ON s.id=p.session_id JOIN parking_lots l ON l.id=s.lot_id LEFT JOIN parking_refunds r ON r.payment_id=p.id
      WHERE ${w} ORDER BY p.created_at DESC LIMIT ${lim} OFFSET ${off}`, args);
  return { total: sum.n, limit: lim, offset: off, totals: { confirmedRub: sum.paid, refundedRub: sum.refunded, pendingRub: sum.pending },
    payments: rows.map((r) => ({ id: r.id, kind: r.kind, amountRub: r.amount_rub, status: r.status, payVia: r.pay_via, at: r.created_at, minutes: r.minutes, sessionId: r.session_id, lotId: r.lot_id, lotTitle: r.title, refund: r.refund_status ?? null })),
    note: 'Это оборот платежей на ваши реквизиты, а не доход организации.' };
};
const csvCell = (v) => { const t = String(v ?? ''); return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; };
export const orgPaymentsCsv = async (me, orgId, f = {}) => {
  const r = await orgPayments(me, orgId, { ...f, limit: 500, offset: 0 }); if (r.error) return r;
  const head = 'id;дата;парковка;вид;сумма ₽;статус;способ;возврат';
  const rows = r.payments.map((p) => [p.id, new Date(p.at).toISOString(), p.lotTitle, p.kind, p.amountRub, p.status, p.payVia, p.refund ?? ''].map((x) => `"${csvCell(x).replace(/"/g, '""')}"`).join(';'));
  await ev(null, orgId, null, me, 'payments_exported', { rows: rows.length });
  return { csv: [head, ...rows].join('\n') };
};

/* ─── Публичная часть: только одобренные ─── */
export const catalog = async (q = {}) => {
  const city = clean(q.city, 80).toLowerCase();
  const lim = Math.min(50, Math.max(1, Number(q.limit) || 30)); const off = Math.max(0, Number(q.offset) || 0);
  const { rows } = await query(
    `SELECT l.* FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id
      WHERE l.status='approved' AND o.status='active' AND ($1='' OR lower(l.city)=$1)
      ORDER BY l.published_at DESC NULLS LAST, l.id LIMIT $2 OFFSET $3`, [city, lim, off]);
  const t = await tariffsOf(rows.map((r) => r.id));
  const acc = await acceptingOrgs(rows.map((r) => r.org_id));
  return { lots: rows.map((r) => { const x = lotRow(r, (t.get(r.id) ?? []).filter((z) => z.active)); delete x.rejectReason; x.acceptsPayment = acc.has(r.org_id) && !r.closed; return x; }), limit: lim, offset: off };
};
export const getPublicLot = async (id) => {
  const l = (await query(`SELECT l.* FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id WHERE l.id=$1 AND l.status='approved' AND o.status='active'`, [id])).rows[0];
  if (!l) return { error: 'not_found' };
  const t = await tariffsOf([id]); const x = lotRow(l, (t.get(id) ?? []).filter((z) => z.active)); delete x.rejectReason; x.acceptsPayment = (await acceptingOrgs([l.org_id])).has(l.org_id) && !l.closed; return { lot: x };
};
export const quote = async (lotId, tariffId, minutes) => {
  const l = await getPublicLot(lotId); if (l.error) return l;
  const t = (await query('SELECT * FROM parking_tariffs WHERE id=$1 AND lot_id=$2 AND active', [tariffId, lotId])).rows[0];
  if (!t) return { error: 'not_found' };
  const c = calcCost(t, minutes); if (c.error) return c;
  return { ok: true, costRub: c.cost, minutes: c.minutes, kind: t.kind };
};

/* ─── Администрация Sky ─── */
const staffGuard = async (me, perm) => (await can(me, perm)) ? null : { error: 'not_allowed' };

const CLAIM_MIN = 15;   // «взятая» заявка закреплена за модератором на 15 минут
/** Очередь проверки: фильтры по статусу, типу (новая / изменение), дате и поиск; постранично. */
export const adminQueue = async (me, f = {}) => {
  const g = await staffGuard(me, 'parking_moderation'); if (g) return g;
  const flt = typeof f === 'string' ? { status: f } : f;
  const st = ['review', 'approved', 'rejected', 'suspended'].includes(flt.status) ? flt.status : 'review';
  const where = ['l.status=$1']; const args = [st];
  const isNew = "NOT EXISTS (SELECT 1 FROM parking_events e WHERE e.lot_id=l.id AND e.action='admin_approve')";
  if (flt.kind === 'new') where.push(isNew); else if (flt.kind === 'edit') where.push(`NOT ${isNew}`);
  const text = clean(flt.q, 60).toLowerCase(); if (text) { args.push(`%${text}%`); where.push(`(lower(l.title) LIKE $${args.length} OR lower(l.address) LIKE $${args.length} OR lower(o.name) LIKE $${args.length} OR l.id LIKE $${args.length})`); }
  const d1 = flt.from ? new Date(flt.from) : null; const d2 = flt.to ? new Date(flt.to) : null;
  if (d1 && !Number.isNaN(+d1)) { args.push(d1); where.push(`l.updated_at >= $${args.length}`); }
  if (d2 && !Number.isNaN(+d2)) { args.push(new Date(+d2 + 86400000)); where.push(`l.updated_at < $${args.length}`); }
  const lim = Math.min(100, Math.max(1, Number(flt.limit) || 30)); const off = Math.max(0, Number(flt.offset) || 0);
  const w = where.join(' AND ');
  const total = Number((await query(`SELECT COUNT(*)::int c FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id WHERE ${w}`, args)).rows[0].c);
  const { rows } = await query(
    `SELECT l.*, o.name AS org_name, ${isNew} AS is_new, pu.username AS submitter FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id LEFT JOIN profiles pu ON pu.id=l.submitted_by
      WHERE ${w} ORDER BY l.updated_at LIMIT ${lim} OFFSET ${off}`, args);
  const t = await tariffsOf(rows.map((r) => r.id));
  return { total, limit: lim, offset: off, lots: rows.map((r) => ({ ...lotRow(r, t.get(r.id) ?? []), orgName: r.org_name, submittedBy: r.submitted_by, submitter: r.submitter, kind: r.is_new ? 'new' : 'edit',
    claimedBy: r.claimed_by && r.claimed_at && Date.now() - new Date(r.claimed_at).getTime() < CLAIM_MIN * 60000 ? r.claimed_by : null, mine: r.claimed_by === me })) };
};

/** Взять заявку в работу: пока она закреплена, решить её может только взявший (владелец сервиса — всегда). Повтор тем же человеком продлевает. */
export const adminClaim = async (me, lotId, release = false) => {
  const g = await staffGuard(me, 'parking_moderation'); if (g) return g;
  const l = (await query('SELECT status, claimed_by, claimed_at, submitted_by, created_by, org_id FROM parking_lots WHERE id=$1', [lotId])).rows[0];
  if (!l) return { error: 'not_found' };
  if (release) { await query('UPDATE parking_lots SET claimed_by=NULL, claimed_at=NULL WHERE id=$1 AND claimed_by=$2', [lotId, me]); return { ok: true }; }
  if (l.status !== 'review') return { error: 'bad_state' };
  const r = await query(`UPDATE parking_lots SET claimed_by=$2, claimed_at=now() WHERE id=$1 AND status='review' AND (claimed_by IS NULL OR claimed_by=$2 OR claimed_at < now() - interval '${CLAIM_MIN} minutes')`, [lotId, me]);
  if (!r.rowCount) return { error: 'claimed_by_other' };
  return { ok: true, until: new Date(Date.now() + CLAIM_MIN * 60000).toISOString() };
};

/** Подробности заявки для модератора: карточка, тарифы, история действий. */
export const adminLotDetail = async (me, lotId) => {
  const g = await staffGuard(me, 'parking_moderation'); if (g) return g;
  const l = (await query('SELECT l.*, o.name AS org_name FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id WHERE l.id=$1', [lotId])).rows[0];
  if (!l) return { error: 'not_found' };
  const t = await tariffsOf([lotId]);
  const { rows } = await query(`SELECT e.id, e.action, e.detail, e.at, p.username FROM parking_events e LEFT JOIN profiles p ON p.id=e.actor_id WHERE e.lot_id=$1 ORDER BY e.id DESC LIMIT 60`, [lotId]);
  return { lot: { ...lotRow(l, t.get(lotId) ?? []), orgName: l.org_name, claimedBy: l.claimed_by }, events: rows.map((r) => ({ id: r.id, action: r.action, detail: r.detail, at: r.at, actor: r.username })) };
};

/** Последние ошибки парковок для администрации. */
export const adminErrors = async (me) => {
  const g = await staffGuard(me, 'parking'); if (g) return g;
  const { rows } = await query('SELECT id, at, scope, code, message, org_id, lot_id FROM parking_errors ORDER BY id DESC LIMIT 50');
  return { errors: rows };
};

export const adminDecide = async (me, lotId, action, reasonRaw) => {
  const g = await staffGuard(me, 'parking_moderation'); if (g) return g;
  const reason = clean(reasonRaw, 400);
  if (!['approve', 'reject', 'suspend', 'restore'].includes(action)) return { error: 'bad_action' };
  if (action !== 'approve' && action !== 'restore' && reason.length < 5) return { error: 'reason_required' };
  const out = await inTx(async (c) => {
    const l = (await c.query('SELECT l.*, o.owner_id FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id WHERE l.id=$1 FOR UPDATE OF l', [lotId])).rows[0];
    if (!l) return { error: 'not_found' };
    // кто отправил — не проверяет; и сотрудник организации не проверяет собственную парковку
    if (l.submitted_by === me || l.created_by === me || l.owner_id === me) { if (!(await isOwner(me))) return { error: 'self_review' }; }
    const mem = (await c.query('SELECT 1 FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [l.org_id, me])).rowCount;
    if (mem && !(await isOwner(me))) return { error: 'self_review' };
    if (l.status === 'review' && ['approve', 'reject'].includes(action) && l.claimed_by && l.claimed_by !== me && l.claimed_at && Date.now() - new Date(l.claimed_at).getTime() < CLAIM_MIN * 60000 && !(await isOwner(me))) return { error: 'claimed_by_other' };
    if (action === 'approve') {
      if (l.status !== 'review') return { error: 'bad_state' };
      await c.query("UPDATE parking_lots SET status='approved', reviewed_by=$2, reject_reason='', published_at=now(), claimed_by=NULL, claimed_at=NULL, updated_at=now() WHERE id=$1", [lotId, me]);
    } else if (action === 'reject') {
      if (l.status !== 'review') return { error: 'bad_state' };
      await c.query("UPDATE parking_lots SET status='rejected', reviewed_by=$2, reject_reason=$3, published_at=NULL, claimed_by=NULL, claimed_at=NULL, updated_at=now() WHERE id=$1", [lotId, me, reason]);
    } else if (action === 'suspend') {
      if (!['approved', 'review'].includes(l.status)) return { error: 'bad_state' };
      await c.query("UPDATE parking_lots SET status='suspended', reviewed_by=$2, reject_reason=$3, published_at=NULL, updated_at=now() WHERE id=$1", [lotId, me, reason]);
    } else {
      if (l.status !== 'suspended') return { error: 'bad_state' };
      await c.query("UPDATE parking_lots SET status='draft', reviewed_by=$2, reject_reason='', updated_at=now() WHERE id=$1", [lotId, me]);
    }
    await ev(c, l.org_id, lotId, me, `admin_${action}`, { reason });
    return { ok: true, owner: l.owner_id, sub: l.submitted_by, title: l.title };
  });
  if (!out.ok) return out;
  await logAdmin({ actorId: me, targetId: lotId, targetType: 'parking_lot', type: `parking_${action}`, detail: reason }).catch(() => {});
  const txt = { approve: 'Парковка одобрена и опубликована', reject: `Парковка отклонена: ${reason}`, suspend: `Парковка приостановлена: ${reason}`, restore: 'Парковка возвращена в черновик' }[action];
  for (const u of new Set([out.owner, out.sub].filter(Boolean))) void notifyGo(u, 'parking', 'Sky Parking', `${out.title}: ${txt}`, lotId, `pk:${lotId}:${action}:${Date.now() >> 14}`).catch(() => {});
  return { ok: true };
};

export const adminOrgs = async (me, q) => {
  const g = await staffGuard(me, 'parking'); if (g) return g;
  const s = `%${clean(q, 60).toLowerCase()}%`;
  const { rows } = await query(
    `SELECT o.*, (SELECT COUNT(*)::int FROM parking_lots l WHERE l.org_id=o.id) AS lots FROM parking_orgs o
      WHERE lower(o.name) LIKE $1 OR o.id LIKE $1 OR o.owner_id LIKE $1 ORDER BY o.created_at DESC LIMIT 100`, [s]);
  return { orgs: rows.map((o) => ({ id: o.id, name: o.name, ownerId: o.owner_id, status: o.status, suspendReason: o.suspend_reason, lots: o.lots })) };
};
export const adminSuspendOrg = async (me, orgId, suspend, reasonRaw) => {
  const g = await staffGuard(me, 'parking'); if (g) return g;
  const reason = clean(reasonRaw, 400);
  if (suspend && reason.length < 5) return { error: 'reason_required' };
  const o = (await query('SELECT owner_id, status FROM parking_orgs WHERE id=$1', [orgId])).rows[0];
  if (!o) return { error: 'not_found' };
  if (o.owner_id === me) return { error: 'self_review' };
  await query('UPDATE parking_orgs SET status=$2, suspend_reason=$3 WHERE id=$1', [orgId, suspend ? 'suspended' : 'active', suspend ? reason : '']);
  await ev(null, orgId, null, me, suspend ? 'org_suspended' : 'org_restored', { reason });
  await logAdmin({ actorId: me, targetId: orgId, targetType: 'parking_org', type: suspend ? 'parking_org_suspend' : 'parking_org_restore', detail: reason }).catch(() => {});
  void notifyGo(o.owner_id, 'parking', 'Sky Parking', suspend ? `Организация приостановлена: ${reason}` : 'Организация снова активна', orgId, `pko:${orgId}:${suspend}:${Date.now() >> 14}`).catch(() => {});
  return { ok: true };
};
export const lotEvents = async (me, lotId) => {
  const l = (await query('SELECT org_id FROM parking_lots WHERE id=$1', [lotId])).rows[0];
  if (!l) return { error: 'not_found' };
  const staff = await can(me, 'parking_moderation') || await can(me, 'parking');
  if (!staff) { const g = await needRole(me, l.org_id, 'admin'); if (g.error) return g; }
  const { rows } = await query('SELECT id, actor_id, action, detail, at FROM parking_events WHERE lot_id=$1 ORDER BY id DESC LIMIT 100', [lotId]);
  return { events: rows };
};
