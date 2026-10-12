/**
 * Sky GO — рабочее пространство исполнителя (курьер, водитель): одно состояние для экрана, маршрут по точкам,
 * положение на линии, проблемы доставки, история и смены.
 *
 * Положение хранится ОДНО, последнее, и только пока человек на линии (go_presence); истории перемещений нет,
 * после ухода с линии координаты стираются (gosubs.setPresence). Показываются они только сотрудникам организации
 * по заказу, который исполнитель сейчас везёт (goorg.getOrder / dashboard).
 * Персональные данные получателя исполнитель видит только после получения отправления.
 */
import { query } from './db.mjs';
import { canAccept, canWork, subscriptionState } from './gosubs.mjs';
import { executorStatus } from './goreg.mjs';
import * as delivery from './godelivery.mjs';
import * as taxi from './gotaxi.mjs';
import { orderView } from './gopay.mjs';
import { computeOrdered } from './maps.mjs';
import { newId, inTx, lockOrder, addEvent, notifyGo, clean, haversineKm, pointOk, pushOrderChanged, openJson } from './gocore.mjs';

const ROLES = ['courier', 'taxi_driver'];
const KIND = { courier: 'delivery', taxi_driver: 'taxi' };
const WORKING = { delivery: ['assigned', 'heading_pickup', 'at_pickup', 'picked_up', 'delivering', 'at_recipient'], taxi: ['assigned', 'en_route', 'arrived', 'in_ride'] };
const PICKUP_DONE = { delivery: ['picked_up', 'delivering', 'at_recipient'], taxi: ['in_ride'] };
const PROBLEM_KINDS = ['recipient_unavailable', 'wrong_address', 'mismatch', 'damaged', 'closed', 'other'];
export const PROBLEM_LABEL = {
  recipient_unavailable: 'Получатель недоступен', wrong_address: 'Неверный адрес', mismatch: 'Отправление не соответствует описанию',
  damaged: 'Отправление повреждено', closed: 'Точка закрыта', other: 'Другое',
};

const isMember = async (profileId) =>
  Boolean((await query(`SELECT 1 FROM go_org_members WHERE profile_id = $1 AND status = 'active' LIMIT 1`, [profileId])).rows[0]);

/** Доступ к работе: свободный поток (как раньше) и/или назначения организации. Объясняет, чего не хватает. */
const access = async (profileId, role) => {
  const pool = await canAccept(profileId, role);
  if (pool.ok) return { pool: true, assigned: true };
  const w = role === 'courier' && (await isMember(profileId)) ? await canWork(profileId, role) : { error: pool.error };
  return { pool: false, poolError: pool.error, assigned: Boolean(w.ok), assignedError: w.ok ? undefined : (w.error ?? pool.error) };
};

/** До получения отправления контактов получателя исполнитель не видит. */
const maskedForExecutor = (view, kind) => {
  if (kind === 'delivery' && !PICKUP_DONE.delivery.includes(view.status) && view.data) {
    const { recipient, ...rest } = view.data; void recipient;
    return { ...view, data: { ...rest, recipient: view.data.recipient ? { name: '', phone: '', hidden: true } : undefined } };
  }
  return view;
};

export const workState = async (profileId, role) => {
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  const kind = KIND[role];
  const ex = await executorStatus(profileId, role);
  const acc = await access(profileId, role);
  const sub = await subscriptionState(profileId, role);
  const { rows: pr } = await query('SELECT online, lat, lng, updated_at FROM go_presence WHERE profile_id = $1 AND role = $2', [profileId, role]);
  const { rows: rs } = await query(
    `SELECT * FROM go_orders WHERE executor_id = $1 AND kind = $2 AND status IN (${[...WORKING[kind], 'awaiting_payment', 'payment_reported', 'dispute'].map((x) => `'${x}'`).join(',')}) ORDER BY created_at`, [profileId, kind]);
  const orders = [];
  for (const r of rs) {
    const v = maskedForExecutor(await orderView(r, profileId, { events: true }), kind);
    const { rows: pb } = await query(`SELECT id, kind, state, created_at FROM go_order_problems WHERE order_id = $1 ORDER BY created_at DESC LIMIT 3`, [r.id]);
    const { rows: nt } = await query(`SELECT body, at FROM go_order_notes WHERE order_id = $1 AND to_executor ORDER BY id DESC LIMIT 3`, [r.id]);
    orders.push({ ...v, internal: Boolean(r.data.internal), needsAccept: Boolean(r.data.dispatch && !r.data.dispatch.accepted),
      orgName: r.data.org?.name ?? null, problems: pb.map((p) => ({ id: p.id, kind: p.kind, label: PROBLEM_LABEL[p.kind], state: p.state, at: p.created_at.toISOString() })),
      dispatcherNotes: nt.map((n) => ({ body: n.body, at: n.at.toISOString() })) });
  }
  let offers = [];
  let offersError;
  if (pr[0]?.online && acc.pool) {
    const o = await (role === 'courier' ? delivery.availableFor(profileId) : taxi.availableFor(profileId));
    if (o.error) offersError = o.error; else offers = o.orders;
  }
  const { rows: shift } = await query(`SELECT started_at FROM go_shifts WHERE profile_id = $1 AND role = $2 AND ended_at IS NULL`, [profileId, role]);
  const { rows: today } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('paid','awaiting_payment','payment_reported') AND completed_at >= date_trunc('day', now()))::int AS done_today
       FROM go_orders WHERE executor_id = $1 AND kind = $2`, [profileId, kind]);
  const { rows: orgs } = await query(`SELECT o.id, o.name, m.role FROM go_org_members m JOIN go_orgs o ON o.id = m.org_id WHERE m.profile_id = $1 AND m.status = 'active'`, [profileId]);
  return {
    role, serverTime: new Date().toISOString(),
    executor: ex ? { status: ex.status, city: ex.city, transport: openJson(ex.data_enc).extra?.transport ?? null } : null,
    access: acc, subscription: { active: sub.active, expiresAt: sub.expiresAt, expired: sub.expired },
    presence: { online: Boolean(pr[0]?.online), lat: pr[0]?.lat ?? null, lng: pr[0]?.lng ?? null, updatedAt: pr[0]?.updated_at?.toISOString?.() ?? null },
    shiftStartedAt: shift[0]?.started_at.toISOString() ?? null, doneToday: today[0].done_today,
    orders, offers, offersError, orgs: orgs.map((g) => ({ id: g.id, name: g.name, role: g.role })),
  };
};

/* ─── Маршрут по точкам ────────────────────────────────────────────── */

/**
 * Порядок точек: пока что-то не забрано, едем за ближайшим отправлением; доставить можно только то, что уже на руках.
 * Жадно, от текущего места. Забор и вручение одного заказа никогда не переставляются местами.
 */
export const sequenceStops = (here, orders, kind) => {
  const todo = [];
  for (const o of orders) {
    const picked = PICKUP_DONE[kind].includes(o.status);
    if (!picked && pointOk(o.data.from)) todo.push({ key: `${o.id}:pickup`, orderId: o.id, type: 'pickup', point: o.data.from, after: null });
    if (pointOk(o.data.to)) todo.push({ key: `${o.id}:dropoff`, orderId: o.id, type: 'dropoff', point: o.data.to, after: picked ? null : `${o.id}:pickup` });
  }
  const out = []; const done = new Set(); let cur = here;
  while (todo.length) {
    const ready = todo.filter((t) => !t.after || done.has(t.after));
    if (!ready.length) break;
    ready.sort((a, b) => (cur ? haversineKm(cur, a.point) - haversineKm(cur, b.point) : 0));
    const next = ready[0];
    out.push(next); done.add(next.key); cur = next.point;
    todo.splice(todo.indexOf(next), 1);
  }
  return out;
};

export const workRoute = async (profileId, role) => {
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  const kind = KIND[role];
  const { rows } = await query(`SELECT * FROM go_orders WHERE executor_id = $1 AND kind = $2 AND status = ANY($3::text[]) ORDER BY created_at`, [profileId, kind, WORKING[kind]]);
  if (!rows.length) return { ok: true, stops: [], empty: true };
  const { rows: pr } = await query('SELECT online, lat, lng FROM go_presence WHERE profile_id = $1 AND role = $2', [profileId, role]);
  const here = pr[0]?.online && pr[0].lat != null ? { lat: pr[0].lat, lng: pr[0].lng } : null;
  const seq = sequenceStops(here, rows, kind);
  const stops = seq.map((t) => ({ key: t.key, orderId: t.orderId, type: t.type, address: t.point.address, lat: t.point.lat, lng: t.point.lng }));
  if (!stops.length) return { ok: true, stops: [], noPoints: true };
  if (!here) return { ok: true, stops, locationRequired: true };
  const r = await computeOrdered({ origin: here, points: stops, vehicle: role === 'courier' ? (openJson((await executorStatus(profileId, 'courier'))?.data_enc).extra?.transport ?? 'car') : 'car' });
  if (r.ok) {
    return { ok: true, stops: stops.map((s, i) => ({ ...s, distanceM: r.legs[i]?.distanceM ?? null, durationS: r.legs[i]?.durationS ?? null })),
      distanceM: r.distanceM, durationS: r.durationS, polyline: r.polyline, estimated: false };
  }
  // Карты недоступны: честная оценка по прямой (×1,35, 28 км/ч) с пометкой — и список адресов остаётся рабочим.
  let prev = here; let m = 0; let sec = 0;
  const est = stops.map((s) => { const km = haversineKm(prev, s) * 1.35; prev = s; m += km * 1000; sec += (km / 28) * 3600; return { ...s, distanceM: Math.round(km * 1000), durationS: Math.round((km / 28) * 3600) }; });
  return { ok: true, stops: est, distanceM: Math.round(m), durationS: Math.round(sec), estimated: true, mapError: r.error };
};

/* ─── Проблемы доставки ────────────────────────────────────────────── */
export const reportProblem = async (profileId, orderId, { kind, note }) => {
  if (!PROBLEM_KINDS.includes(kind)) return { error: 'bad_kind' };
  const text = clean(note, 400);
  if (kind === 'other' && text.length < 5) return { error: 'note_required' };
  const res = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o || o.executor_id !== profileId || !['delivery', 'taxi'].includes(o.kind)) return { error: 'not_found' };
    if (!WORKING[o.kind].includes(o.status)) return { error: 'bad_state', status: o.status };
    const { rows: n } = await c.query(`SELECT count(*)::int AS n FROM go_order_problems WHERE order_id = $1 AND state = 'open'`, [o.id]);
    if (n[0].n >= 3) return { error: 'too_many_problems' };
    const id = newId('prb');
    await c.query('INSERT INTO go_order_problems (id, order_id, reporter_id, kind, note) VALUES ($1,$2,$3,$4,$5)', [id, o.id, profileId, kind, text]);
    await c.query(`UPDATE go_orders SET data = data || '{"problemOpen":true}'::jsonb, updated_at = now() WHERE id = $1`, [o.id]);
    await addEvent(c, o.id, profileId, o.status, o.status, `Проблема: ${PROBLEM_LABEL[kind]}${text ? ` — ${text}` : ''}`);
    return { ok: true, id, orgId: o.org_id, customerId: o.customer_id };
  });
  if (res.error) return res;
  const org = await import('./goorg.mjs');
  const msg = `${PROBLEM_LABEL[kind]}${text ? `: ${text}` : ''}`;
  if (res.orgId) await org.notifyStaff(res.orgId, 'Проблема с доставкой', msg, orderId, `problem:${res.id}`);
  else await notifyGo(res.customerId, 'delivery', 'Проблема с доставкой', `${msg}. Исполнитель обратился в поддержку.`, orderId, `problem:${res.id}:c`);
  await pushOrderChanged(orderId);
  return { ok: true, id: res.id };
};

const sniffImage = (b) => {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
};
export const attachProblemPhoto = async (profileId, problemId, bytes) => {
  const mime = sniffImage(bytes); if (!mime) return { error: 'unsupported_type' };
  const { rowCount } = await query(`UPDATE go_order_problems SET photo = $3, photo_mime = $4 WHERE id = $1 AND reporter_id = $2 AND state = 'open' AND photo IS NULL`, [String(problemId ?? ''), profileId, bytes, mime]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};
/** Фото смотрят: автор, сотрудники организации заказа, администрация Sky (право go). */
export const problemPhoto = async (viewerId, problemId, isAdmin) => {
  const { rows } = await query(`SELECT p.photo, p.photo_mime, p.reporter_id, o.org_id, o.customer_id FROM go_order_problems p JOIN go_orders o ON o.id = p.order_id WHERE p.id = $1`, [String(problemId ?? '')]);
  const r = rows[0]; if (!r?.photo) return { error: 'not_found' };
  let ok = r.reporter_id === viewerId || r.customer_id === viewerId || isAdmin;
  if (!ok && r.org_id) ok = Boolean((await query(`SELECT 1 FROM go_org_members WHERE org_id = $1 AND profile_id = $2 AND status = 'active' AND role IN ('owner','admin','manager')`, [r.org_id, viewerId])).rows[0]);
  return ok ? { mime: r.photo_mime, data: r.photo } : { error: 'not_found' };
};

/** Администрация Sky решает проблему любого заказа (когда организации нет или нужен арбитр). */
export const adminProblems = async () => {
  const { rows } = await query(
    `SELECT p.id, p.order_id, p.kind, p.note, p.state, p.created_at, o.org_id, o.status FROM go_order_problems p JOIN go_orders o ON o.id = p.order_id
      WHERE p.state = 'open' ORDER BY p.created_at LIMIT 100`);
  return { problems: rows.map((r) => ({ id: r.id, orderId: r.order_id, kind: r.kind, label: PROBLEM_LABEL[r.kind], note: r.note, orgId: r.org_id, status: r.status, at: r.created_at.toISOString() })) };
};

/* ─── История, статистика, смены ───────────────────────────────────── */
export const workHistory = async (profileId, role, { limit, offset } = {}) => {
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  const kind = KIND[role];
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100); const off = Math.max(Number(offset) || 0, 0);
  const { rows } = await query(
    `SELECT o.*, (SELECT at FROM go_order_events WHERE order_id = o.id AND to_status = 'assigned' ORDER BY id DESC LIMIT 1) AS assigned_at
       FROM go_orders o WHERE o.executor_id = $1 AND o.kind = $2 AND o.status IN ('paid','awaiting_payment','payment_reported','cancelled','dispute')
      ORDER BY coalesce(o.completed_at, o.updated_at) DESC LIMIT ${lim} OFFSET ${off}`, [profileId, kind]);
  const orders = rows.map((r) => ({
    id: r.id, status: r.status, scenario: r.data.scenario ?? null, priceRub: r.price_rub, from: r.data.from?.address, to: r.data.to?.address,
    km: r.data.km ?? null, kmEstimated: Boolean(r.data.estimated), internal: Boolean(r.data.internal), org: r.data.org?.name ?? null,
    at: (r.completed_at ?? r.updated_at).toISOString(),
    minutes: r.completed_at && r.assigned_at ? Math.max(1, Math.round((r.completed_at - r.assigned_at) / 60000)) : null,
  }));
  const { rows: st } = await query(
    `SELECT count(*) FILTER (WHERE status IN ('paid','awaiting_payment','payment_reported'))::int AS done,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE status = 'dispute')::int AS disputes,
            coalesce(sum((data->>'km')::numeric) FILTER (WHERE status IN ('paid','awaiting_payment','payment_reported') AND NOT coalesce((data->>'estimated')::boolean, false)), 0)::float AS km_route,
            count(*) FILTER (WHERE status IN ('paid','awaiting_payment','payment_reported') AND coalesce((data->>'estimated')::boolean, false))::int AS km_estimated_orders
       FROM go_orders WHERE executor_id = $1 AND kind = $2`, [profileId, kind]);
  const { rows: avg } = await query(
    `SELECT round(avg(extract(epoch FROM (o.completed_at - e.at)) / 60))::int AS minutes, count(*)::int AS n
       FROM go_orders o JOIN LATERAL (SELECT at FROM go_order_events WHERE order_id = o.id AND to_status = 'assigned' ORDER BY id DESC LIMIT 1) e ON TRUE
      WHERE o.executor_id = $1 AND o.kind = $2 AND o.completed_at IS NOT NULL AND o.completed_at > e.at AND o.status IN ('paid','awaiting_payment','payment_reported')`, [profileId, kind]);
  const { rows: pb } = await query(`SELECT count(*)::int AS n FROM go_order_problems WHERE reporter_id = $1`, [profileId]);
  // Деньги — только подтверждённые оплаты, пришедшие НАПРЯМУЮ от заказчиков; расчётов с организацией Sky не знает.
  const { rows: paid } = await query(
    `SELECT coalesce(sum(p.amount_rub), 0)::int AS rub, count(*)::int AS n FROM go_order_pay p JOIN go_orders o ON o.id = p.order_id
      WHERE p.payee_id = $1 AND p.state = 'confirmed' AND o.kind = $2`, [profileId, kind]);
  const { rows: sh } = await query(
    `SELECT started_at, ended_at FROM go_shifts WHERE profile_id = $1 AND role = $2 ORDER BY started_at DESC LIMIT 30`, [profileId, role]);
  const { rows: hrs } = await query(
    `SELECT coalesce(sum(extract(epoch FROM (coalesce(ended_at, now()) - started_at))), 0)::float AS sec FROM go_shifts WHERE profile_id = $1 AND role = $2 AND started_at >= now() - interval '30 days'`, [profileId, role]);
  return {
    orders,
    stats: { done: st[0].done, cancelled: st[0].cancelled, disputes: st[0].disputes, problemsReported: pb[0].n,
      avgMinutes: avg[0].n > 0 ? avg[0].minutes : null, kmRoute: Math.round(st[0].km_route * 10) / 10, kmEstimatedOrders: st[0].km_estimated_orders,
      receivedRub: paid[0].rub, receivedOrders: paid[0].n, shiftHours30: Math.round((hrs[0].sec / 3600) * 10) / 10 },
    shifts: sh.map((s) => ({ startedAt: s.started_at.toISOString(), endedAt: s.ended_at?.toISOString?.() ?? null })),
    // Оценок и рейтинга в Sky GO нет — их не выдумываем; доход считается только по подтверждённым прямым оплатам.
    notes: { rating: null, earnings: 'Суммы — подтверждённые прямые оплаты от заказчиков. Расчёты с организацией (если вы её сотрудник) вне Sky GO.' },
  };
};
