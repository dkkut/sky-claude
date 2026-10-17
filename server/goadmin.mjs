/**
 * Sky GO — администрирование: заявки исполнителей, тарифы, подписки, заказы, споры, настройки, интеграции.
 * Право `go` — работа с заявками, заказами и спорами; `go_finance` — тарифы и стоимость. Критические действия — в журнал
 * администрации (цепочка с хешами) и в go_log.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { mapsSettings } from './maps.mjs';
import { flightsStatus } from './goflights.mjs';
import { fuelStatus } from './gofuel.mjs';
import { clean, getSetting, setSetting, goLog, ROLES, routeStats } from './gocore.mjs';
import { orderView, resolveDispute } from './gopay.mjs';
import * as stay from './gostay.mjs';
import { cargoTariff } from './godelivery.mjs';
import { tariffVersion } from './gopricing.mjs';

const KEYS = {
  cities: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 200 && v.every((x) => typeof x === 'string' && x.trim().length >= 2 && x.length <= 60) ? v.map((x) => x.trim()) : null,
  taxi_tariffs: (v) => {
    if (!v || typeof v !== 'object') return null;
    const out = {};
    for (const [code, t] of Object.entries(v)) {
      if (!/^[a-z_]{2,20}$/.test(code)) return null;
      const n = (k) => Number(t?.[k]);
      if (![n('base'), n('perKm'), n('perMin'), n('min')].every((x) => Number.isFinite(x) && x >= 0 && x <= 100000)) return null;
      out[code] = { title: clean(t.title, 40) || code, base: n('base'), perKm: n('perKm'), perMin: n('perMin'), min: n('min') };
    }
    return Object.keys(out).length ? out : null;
  },
  delivery_tariff: (v) => {
    const f = ['base', 'perKm', 'minRub', 'foodBase', 'foodPerKm', 'foodMin'];
    if (!v || !f.every((k) => Number.isFinite(Number(v[k])) && Number(v[k]) >= 0 && Number(v[k]) <= 100000)) return null;
    const sur = v.sizeSurcharge ?? {};
    return { ...Object.fromEntries(f.map((k) => [k, Number(v[k])])), sizeSurcharge: { s: Number(sur.s) || 0, m: Number(sur.m) || 0, l: Number(sur.l) || 0 } };
  },
  cargo_tariff: (v) => {
    const n = (x) => Number(x);
    if (!v || ![v.base, v.perKm, v.minRub, v.loaderRub].every((x) => Number.isFinite(n(x)) && n(x) >= 0 && n(x) <= 100000)) return null;
    const bodies = {};
    for (const k of ['s', 'm', 'l']) {
      const b = v.bodies?.[k];
      if (!b || !Number.isFinite(n(b.maxKg)) || n(b.maxKg) < 1 || n(b.maxKg) > 50000 || !Number.isFinite(n(b.surcharge)) || n(b.surcharge) < 0 || n(b.surcharge) > 100000) return null;
      bodies[k] = { maxKg: n(b.maxKg), dims: clean(b.dims, 30), surcharge: n(b.surcharge) };
    }
    return { base: n(v.base), perKm: n(v.perKm), minRub: n(v.minRub), loaderRub: n(v.loaderRub), bodies };
  },
  dispatch_mode: (v) => (v === 'offers' || v === 'pool' ? v : null),
  dispatch_offer_sec: (v) => (Number.isFinite(Number(v)) && Number(v) >= 10 && Number(v) <= 120 ? Math.round(Number(v)) : null),
  dispatch_max_offers: (v) => (Number.isFinite(Number(v)) && Number(v) >= 1 && Number(v) <= 20 ? Math.round(Number(v)) : null),
  dispatch_search_timeout_min: (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 240 ? Math.round(Number(v)) : null),
  dispatch_presence_fresh_sec: (v) => (Number.isFinite(Number(v)) && Number(v) >= 30 && Number(v) <= 3600 ? Math.round(Number(v)) : null),
  dispatch_radius_km: (v) => (Number.isFinite(Number(v)) && Number(v) >= 1 && Number(v) <= 200 ? Number(v) : null),
  quote_ttl_sec: (v) => (Number.isFinite(Number(v)) && Number(v) >= 60 && Number(v) <= 3600 ? Math.round(Number(v)) : null),
  maps_route_daily_limit: (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1_000_000 ? Math.round(Number(v)) : null),
  payment_terms: (v) => {
    const ok = (x) => ['before', 'after', 'on_accept', 'after_ride', 'after_delivery'].includes(x);
    if (!v || !ok(v.taxi) || !ok(v.food) || !ok(v.delivery)) return null;
    return { taxi: 'after_ride', food: v.food === 'before' || v.food === 'on_accept' ? 'before' : 'after', delivery: v.delivery === 'before' || v.delivery === 'on_accept' ? 'before' : 'after' };
  },
};

export const getSettings = async (adminId) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const out = {};
  for (const k of Object.keys(KEYS)) out[k] = await getSetting(k, null);
  out.cargo_tariff = await cargoTariff();
  const t = await query('SELECT code, title, price_rub, period_days FROM go_tariffs ORDER BY code');
  const rt = await query('SELECT role, tariff_code FROM go_role_tariff');
  return { settings: out, tariffs: t.rows.map((r) => ({ code: r.code, title: r.title, priceRub: r.price_rub, periodDays: r.period_days })), roleTariff: Object.fromEntries(rt.rows.map((r) => [r.role, r.tariff_code])) };
};

export const putSetting = async (adminId, key, value) => {
  if (!(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };
  if (!KEYS[key]) return { error: 'bad_key' };
  const v = KEYS[key](value);
  if (v === null) return { error: 'invalid_value' };
  const was = key === 'taxi_tariffs' ? tariffVersion(await getSetting(key, {})) : null;
  await setSetting(key, v, adminId);
  const ver = key === 'taxi_tariffs' ? ` · версия тарифа ${was} → ${tariffVersion(v)}` : '';
  await logAdmin({ actorId: adminId, type: 'go_setting', targetType: 'system', targetId: key, detail: (JSON.stringify(v).slice(0, 140) + ver).slice(0, 220) });
  await goLog(adminId, 'setting', key, {});
  return { ok: true };
};

export const putTariff = async (adminId, code, { priceRub, periodDays, title }) => {
  if (!(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };
  const price = Number(priceRub); const days = Number(periodDays);
  if (!Number.isInteger(price) || price < 0 || price > 100000) return { error: 'bad_price' };
  if (!Number.isInteger(days) || days < 1 || days > 366) return { error: 'bad_period' };
  const { rows } = await query('SELECT price_rub, period_days FROM go_tariffs WHERE code = $1', [String(code ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  await query('UPDATE go_tariffs SET price_rub = $2, period_days = $3, title = COALESCE(NULLIF($4, \'\'), title), updated_at = now(), updated_by = $5 WHERE code = $1', [code, price, days, clean(title, 80), adminId]);
  await logAdmin({ actorId: adminId, type: 'go_tariff', targetType: 'system', targetId: code, detail: `${rows[0].price_rub}→${price} ₽, ${rows[0].period_days}→${days} дн.` });
  await goLog(adminId, 'tariff', code, { from: rows[0].price_rub, to: price });
  return { ok: true };
};

export const putRoleTariff = async (adminId, role, code) => {
  if (!(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  const { rows } = await query('SELECT 1 FROM go_tariffs WHERE code = $1', [String(code ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  await query('UPDATE go_role_tariff SET tariff_code = $2 WHERE role = $1', [role, code]);
  await logAdmin({ actorId: adminId, type: 'go_role_tariff', targetType: 'system', targetId: role, detail: code });
  return { ok: true };
};

export const listSubscriptions = async (adminId, { q, limit } = {}) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const args = [];
  let where = '';
  if (q) { args.push(`%${clean(q, 40).toLowerCase()}%`); where = `WHERE lower(p.username) LIKE $1 OR lower(p.name) LIKE $1`; }
  args.push(Math.min(Math.max(Number(limit) || 100, 1), 300));
  const { rows } = await query(
    `SELECT s.profile_id, s.role, p.username, p.name, max(s.expires_at) AS until, count(*)::int AS payments, sum(s.price_rub)::int AS total
       FROM go_subscriptions s JOIN profiles p ON p.id = s.profile_id ${where}
      GROUP BY s.profile_id, s.role, p.username, p.name ORDER BY until DESC LIMIT $${args.length}`, args);
  return { items: rows.map((r) => ({ profileId: r.profile_id, role: r.role, username: r.username, name: r.name, expiresAt: r.until.toISOString(), active: r.until > new Date(), payments: r.payments, totalRub: r.total })) };
};

export const listOrders = async (adminId, { kind, status, q, limit } = {}) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const args = []; const where = [];
  if (['taxi', 'food', 'delivery', 'stay'].includes(kind)) { args.push(kind); where.push(`o.kind = $${args.length}`); }
  if (status && /^[a-z_]{3,24}$/.test(status)) { args.push(status); where.push(`o.status = $${args.length}`); }
  if (q) { args.push(`%${clean(q, 40).toLowerCase()}%`); where.push(`(lower(o.id) LIKE $${args.length} OR lower(c.username) LIKE $${args.length})`); }
  args.push(Math.min(Math.max(Number(limit) || 100, 1), 300));
  const { rows } = await query(
    `SELECT o.*, c.username AS cu FROM go_orders o JOIN profiles c ON c.id = o.customer_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.created_at DESC LIMIT $${args.length}`, args);
  return { items: rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, priceRub: r.price_rub, city: r.city, customer: r.cu, executorId: r.executor_id, createdAt: r.created_at.toISOString() })) };
};

export const orderDetail = async (adminId, id) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM go_orders WHERE id = $1', [String(id ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  await goLog(adminId, 'order_view', id, {});
  return { order: await orderView(rows[0], adminId, { events: true, staff: true }) };
};

export const adminResolve = resolveDispute;

export const integrations = async (adminId) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  return { maps: { ...mapsSettings(), routes: routeStats(), note: 'Карты и адреса: GOOGLE_MAPS_KEY и/или YANDEX_MAPS_KEY (серверные ключи); маршруты — только Google.' },
    flights: flightsStatus(), fuel: fuelStatus(),
    push: { note: 'Пуши: VAPID_* / FCM — см. раздел уведомлений.' } };
};

export const overview = async (adminId) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const { rows: ex } = await query(`SELECT status, count(*)::int AS n FROM go_executors GROUP BY status`);
  const { rows: ord } = await query(`SELECT kind, status, count(*)::int AS n FROM go_orders WHERE created_at > now() - interval '30 days' GROUP BY kind, status`);
  const { rows: sub } = await query(`SELECT count(DISTINCT (profile_id, role))::int AS active FROM go_subscriptions WHERE expires_at > now()`);
  return { executors: Object.fromEntries(ex.map((r) => [r.status, r.n])), orders30d: ord, activeSubscriptions: sub[0].active };
};

/** Персональный тариф: цена и срок для одного исполнителя и кабинета (право go_finance). Пустая цена — сброс на общий. */
export const putExecutorTariff = async (adminId, { username, profileId, role, priceRub, periodDays, note, reset }) => {
  if (!(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  const { rows } = await query(profileId ? 'SELECT id, username FROM profiles WHERE id = $1' : 'SELECT id, username FROM profiles WHERE lower(username) = lower($1)', [profileId || String(username ?? '').replace(/^@/, '')]);
  if (!rows[0]) return { error: 'not_found' };
  const pid = rows[0].id;
  if (reset) {
    await query('DELETE FROM go_executor_tariffs WHERE profile_id = $1 AND role = $2', [pid, role]);
    await logAdmin({ actorId: adminId, type: 'go_exec_tariff', targetType: 'user', targetId: pid, detail: `${role}: сброс на общий` });
    return { ok: true, reset: true };
  }
  const price = Number(priceRub); const days = Number(periodDays);
  if (!Number.isInteger(price) || price < 0 || price > 100000) return { error: 'bad_price' };
  if (!Number.isInteger(days) || days < 1 || days > 366) return { error: 'bad_period' };
  await query(
    `INSERT INTO go_executor_tariffs (profile_id, role, price_rub, period_days, note, set_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (profile_id, role) DO UPDATE SET price_rub = $3, period_days = $4, note = $5, set_by = $6, updated_at = now()`,
    [pid, role, price, days, clean(note, 160), adminId]);
  await logAdmin({ actorId: adminId, type: 'go_exec_tariff', targetType: 'user', targetId: pid, detail: `${role}: ${price} ₽ / ${days} дн.` });
  await goLog(adminId, 'exec_tariff', pid, { role, price, days });
  return { ok: true, username: rows[0].username };
};

export const listExecutorTariffs = async (adminId) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const { rows } = await query(`SELECT t.*, p.username FROM go_executor_tariffs t JOIN profiles p ON p.id = t.profile_id ORDER BY t.updated_at DESC LIMIT 200`);
  return { items: rows.map((r) => ({ profileId: r.profile_id, username: r.username, role: r.role, priceRub: r.price_rub, periodDays: r.period_days, note: r.note })) };
};

export const stayListings = async (adminId, f) => (await can(adminId, 'go')) ? stay.adminListings(f) : { error: 'not_allowed' };
export const stayModerate = async (adminId, id, action, note) => (await can(adminId, 'go')) ? stay.adminModerate(adminId, id, action, note) : { error: 'not_allowed' };
export const stayPhoto = async (adminId, photoId) => stay.getPhoto(adminId, photoId, await can(adminId, 'go'));
