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
  if (t.kind === 'daily') return { cost: Math.ceil(m / 1440) * price, minutes: m };
  const paid = Math.max(0, m - Number(t.free_minutes || 0));
  return { cost: Math.ceil(paid / 60) * price, minutes: m };
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
export const listStaff = async (me, orgId) => {
  const g = await needRole(me, orgId, 'admin'); if (g.error) return g;
  const { rows } = await query(
    `SELECT s.profile_id, s.role, s.created_at, p.username, p.display_name FROM parking_staff s JOIN profiles p ON p.id=s.profile_id WHERE s.org_id=$1 ORDER BY s.created_at`, [orgId]);
  return { staff: rows.map((r) => ({ profileId: r.profile_id, role: r.role, username: r.username, name: r.display_name, at: r.created_at })) };
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
  return inTx(async (c) => {
    const o = (await c.query('SELECT owner_id FROM parking_orgs WHERE id=$1 FOR UPDATE', [orgId])).rows[0];
    if (o.owner_id === target.id) return { error: 'already_owner' };
    const cnt = Number((await c.query('SELECT COUNT(*)::int c FROM parking_staff WHERE org_id=$1', [orgId])).rows[0].c);
    const had = (await c.query('SELECT role FROM parking_staff WHERE org_id=$1 AND profile_id=$2', [orgId, target.id])).rows[0];
    if (!had && cnt >= MAX_STAFF) return { error: 'too_many_staff' };
    if (had?.role === 'admin' && g.role !== 'owner') return { error: 'not_allowed' };
    await c.query(`INSERT INTO parking_staff (org_id, profile_id, role, added_by) VALUES ($1,$2,$3,$4)
                   ON CONFLICT (org_id, profile_id) DO UPDATE SET role=EXCLUDED.role`, [orgId, target.id, role, me]);
    await ev(c, orgId, null, me, 'staff_set', { target: target.id, role });
    return { ok: true };
  });
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
  rejectReason: l.reject_reason, version: l.version, updatedAt: l.updated_at, publishedAt: l.published_at,
  tariffs: tariffs.map((t) => ({ id: t.id, kind: t.kind, priceRub: t.price_rub, freeMinutes: t.free_minutes, minMinutes: t.min_minutes, maxMinutes: t.max_minutes, active: t.active })),
});
const tariffsOf = async (lotIds) => {
  if (!lotIds.length) return new Map();
  const { rows } = await query('SELECT * FROM parking_tariffs WHERE lot_id = ANY($1) ORDER BY price_rub', [lotIds]);
  const m = new Map(); for (const r of rows) { if (!m.has(r.lot_id)) m.set(r.lot_id, []); m.get(r.lot_id).push(r); } return m;
};

export const orgLots = async (me, orgId) => {
  const g = await needRole(me, orgId, 'moderator'); if (g.error) return g;
  const { rows } = await query('SELECT * FROM parking_lots WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 300', [orgId]);
  const t = await tariffsOf(rows.map((r) => r.id));
  const acc = await acceptingOrgs([orgId]);
  return { role: g.role, acceptsPayment: acc.has(orgId), lots: rows.map((r) => lotRow(r, t.get(r.id) ?? [])) };
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

const loadLotFor = async (me, lotId, min, client = null) => {
  const q = (client ?? { query });
  const l = (await q.query(`SELECT * FROM parking_lots WHERE id=$1${client ? ' FOR UPDATE' : ''}`, [lotId])).rows[0];
  if (!l) return { error: 'not_found' };
  const g = await needRole(me, l.org_id, min, client); if (g.error) return g;
  return { lot: l, role: g.role, suspended: g.suspended };
};

export const updateLot = async (me, lotId, input) => inTx(async (c) => {
  const r = await loadLotFor(me, lotId, 'moderator', c); if (r.error) return r;
  if (r.suspended) return { error: 'org_suspended' };
  const l = r.lot;
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

export const submitLot = async (me, lotId) => {
  const out = await inTx(async (c) => {
    const r = await loadLotFor(me, lotId, 'moderator', c); if (r.error) return r;
    if (r.suspended) return { error: 'org_suspended' };
    const l = r.lot;
    if (!['draft', 'rejected'].includes(l.status)) return { error: 'bad_state' };
    if (l.title.length < 3 || !l.address || l.lat == null || l.spaces_total < 1) return { error: 'incomplete', hint: 'Нужны название, адрес, точка на карте и число мест.' };
    const t = Number((await c.query('SELECT COUNT(*)::int c FROM parking_tariffs WHERE lot_id=$1 AND active', [lotId])).rows[0].c);
    if (!t) return { error: 'no_tariff' };
    await c.query("UPDATE parking_lots SET status='review', submitted_by=$2, reject_reason='', updated_at=now() WHERE id=$1", [lotId, me]);
    await ev(c, l.org_id, lotId, me, 'lot_submitted', {});
    return { ok: true, title: l.title };
  });
  if (out.ok) void notifyStaff('parking_lot', { title: 'Парковка на проверке', body: out.title, dedupe: `pklot:${lotId}:${Date.now() >> 16}`, except: me }).catch(() => {});
  return out.ok ? { ok: true } : out;
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
  return { kind, price, free: kind === 'hourly' ? free : 0, min, max };
};
export const addTariff = async (me, lotId, input) => inTx(async (c) => {
  const r = await loadLotFor(me, lotId, 'admin', c); if (r.error) return r;
  if (r.suspended) return { error: 'org_suspended' };
  if (['suspended', 'archived'].includes(r.lot.status)) return { error: 'not_editable' };
  const t = cleanTariff(input); if (t.error) return t;
  const n = Number((await c.query('SELECT COUNT(*)::int c FROM parking_tariffs WHERE lot_id=$1', [lotId])).rows[0].c);
  if (n >= MAX_TARIFFS_PER_LOT) return { error: 'too_many_tariffs' };
  const id = newId('pkt');
  await c.query('INSERT INTO parking_tariffs (id, lot_id, kind, price_rub, free_minutes, min_minutes, max_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, lotId, t.kind, t.price, t.free, t.min, t.max]);
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
  return { lots: rows.map((r) => { const x = lotRow(r, (t.get(r.id) ?? []).filter((z) => z.active)); delete x.rejectReason; x.acceptsPayment = acc.has(r.org_id); return x; }), limit: lim, offset: off };
};
export const getPublicLot = async (id) => {
  const l = (await query(`SELECT l.* FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id WHERE l.id=$1 AND l.status='approved' AND o.status='active'`, [id])).rows[0];
  if (!l) return { error: 'not_found' };
  const t = await tariffsOf([id]); const x = lotRow(l, (t.get(id) ?? []).filter((z) => z.active)); delete x.rejectReason; x.acceptsPayment = (await acceptingOrgs([l.org_id])).has(l.org_id); return { lot: x };
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

export const adminQueue = async (me, status = 'review') => {
  const g = await staffGuard(me, 'parking_moderation'); if (g) return g;
  const st = ['review', 'approved', 'rejected', 'suspended'].includes(status) ? status : 'review';
  const { rows } = await query(
    `SELECT l.*, o.name AS org_name FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id WHERE l.status=$1 ORDER BY l.updated_at LIMIT 200`, [st]);
  const t = await tariffsOf(rows.map((r) => r.id));
  return { lots: rows.map((r) => ({ ...lotRow(r, t.get(r.id) ?? []), orgName: r.org_name, submittedBy: r.submitted_by })) };
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
    if (action === 'approve') {
      if (l.status !== 'review') return { error: 'bad_state' };
      await c.query("UPDATE parking_lots SET status='approved', reviewed_by=$2, reject_reason='', published_at=now(), updated_at=now() WHERE id=$1", [lotId, me]);
    } else if (action === 'reject') {
      if (l.status !== 'review') return { error: 'bad_state' };
      await c.query("UPDATE parking_lots SET status='rejected', reviewed_by=$2, reject_reason=$3, published_at=NULL, updated_at=now() WHERE id=$1", [lotId, me, reason]);
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
