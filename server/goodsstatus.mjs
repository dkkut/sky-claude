/**
 * Статус товара в заказе Sky Market: где он, примерное время доставки.
 *
 * Источники (по убыванию свежести берётся самый новый для «где»):
 *   · продавец или назначенный им сотрудник вносит место и срок вручную
 *     (Sky это НЕ проверяет — так и показывается);
 *   · трек-номер: последнее событие у службы доставки (tracking.mjs);
 *   · отправление Sky Market (market_shipments.location / eta).
 * Менять статус может только продавец заказа и его сотрудники, и только
 * пока заказ в работе. Читают: покупатель, продавец, сотрудники продавца,
 * поддержка Market. Адреса и контакты покупателя здесь не отдаются.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logMarket, ORDER_ID_RE } from './market.mjs';
import { systemMessage } from './marketchat.mjs';
import { notifyGift } from './giftnotify.mjs';
import { lookupParcel } from './tracking.mjs';
import { PROVIDERS, trackingUrl } from './trackingproviders.mjs';

const ACTIVE = new Set(['seller_payment_confirmed', 'fulfillment', 'seller_shipped', 'in_transit', 'ready_for_pickup']);
const MAX_STAFF = 10;
const DAY = 86400_000;

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Это сотрудник продавца? */
export const isStaffOf = async (sellerId, profileId) => {
  if (!sellerId || !profileId) return false;
  const { rows } = await query('SELECT 1 FROM market_seller_staff WHERE seller_id=$1 AND profile_id=$2', [sellerId, profileId]);
  return rows.length > 0;
};

const orderOf = async (id) => {
  if (!ORDER_ID_RE.test(String(id ?? ''))) return null;
  const { rows } = await query(
    'SELECT id, buyer_id, seller_id, status, title_snap, delivery_method FROM market_orders WHERE id=$1', [id]);
  return rows[0] ?? null;
};

const roleOf = async (order, viewer) => {
  if (order.buyer_id === viewer) return 'buyer';
  if (order.seller_id === viewer) return 'seller';
  if (await isStaffOf(order.seller_id, viewer)) return 'staff';
  if (await can(viewer, 'market')) return 'support';
  return null;
};

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Собирает итоговый статус. null — заказа нет или он не ваш. */
export const getGoodsStatus = async (orderId, viewerId) => {
  const order = await orderOf(orderId);
  if (!order) return null;
  const role = await roleOf(order, viewerId);
  if (!role) return null;

  const [{ rows: m }, { rows: sh }, { rows: tr }, { rows: lg }] = await Promise.all([
    query('SELECT place, note, eta, eta_to, set_by, set_role, updated_at FROM market_goods_status WHERE order_id=$1', [order.id]),
    query('SELECT status, status_text, location, eta, updated_at FROM market_shipments WHERE order_id=$1', [order.id]),
    query('SELECT provider, number FROM parcel_tracking WHERE order_id=$1', [order.id]),
    query(`SELECT actor_role, place, note, eta, eta_to, created_at FROM market_goods_status_log
           WHERE order_id=$1 ORDER BY id DESC LIMIT 20`, [order.id]),
  ]);
  const manual = m[0] ?? null;
  const ship = sh[0] ?? null;

  let parcel = null; let tracking = null; let parcelError = null;
  if (tr[0]) {
    const r = await lookupParcel(tr[0].provider, tr[0].number);
    tracking = {
      provider: tr[0].provider, providerTitle: PROVIDERS[tr[0].provider]?.title ?? tr[0].provider,
      number: tr[0].number, url: trackingUrl(tr[0].provider, tr[0].number),
    };
    if (r.ok) parcel = r.data; else parcelError = r.error;
  }
  const lastEvent = parcel?.events?.length
    ? [...parcel.events].sort((a, b) => new Date(b.time) - new Date(a.time))[0] : null;

  // «Где»: самое свежее из трёх источников.
  const cands = [];
  if (manual?.place) cands.push({ at: new Date(manual.updated_at).getTime(), source: manual.set_role === 'staff' ? 'staff' : 'seller', place: manual.place, text: manual.note });
  if (lastEvent) cands.push({ at: new Date(lastEvent.time).getTime() || 0, source: 'tracking', place: lastEvent.location || parcel.statusText || '', text: lastEvent.text || parcel.statusText || '' });
  if (ship?.location) cands.push({ at: new Date(ship.updated_at).getTime(), source: 'shipment', place: ship.location, text: ship.status_text || '' });
  cands.sort((a, b) => b.at - a.at);
  const cur = cands[0] ?? null;

  let eta = null;
  if (manual?.eta) eta = { from: iso(manual.eta), to: iso(manual.eta_to), source: manual.set_role === 'staff' ? 'staff' : 'seller' };
  else if (ship?.eta) eta = { from: iso(ship.eta), to: null, source: 'shipment' };

  const canEdit = (role === 'seller' || role === 'staff') && ACTIVE.has(order.status);
  return {
    orderId: order.id,
    orderStatus: order.status,
    title: order.title_snap,
    deliveryMethod: order.delivery_method ?? null,
    role,
    current: cur ? { place: cur.place, text: cur.text, source: cur.source, at: new Date(cur.at || Date.now()).toISOString() } : null,
    eta,
    manual: manual ? {
      place: manual.place, note: manual.note, eta: iso(manual.eta), etaTo: iso(manual.eta_to),
      setRole: manual.set_role, updatedAt: iso(manual.updated_at),
    } : null,
    parcel: parcel ? {
      status: parcel.status, statusText: parcel.statusText, carrierName: parcel.carrierName,
      events: (parcel.events ?? []).slice(0, 12),
    } : null,
    tracking, parcelError,
    history: lg.map((r) => ({ role: r.actor_role, place: r.place, note: r.note, eta: iso(r.eta), etaTo: iso(r.eta_to), at: iso(r.created_at) })),
    canEdit,
    /* Sky не проверяет то, что внесено вручную. */
    verified: false,
  };
};

const parseDate = (v) => {
  if (v == null || v === '') return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? undefined : t;
};

/** Продавец или его сотрудник вносит место и срок. */
export const setGoodsStatus = async (orderId, actorId, input = {}) => {
  const order = await orderOf(orderId);
  if (!order) return { error: 'not_found' };
  const role = await roleOf(order, actorId);
  if (role !== 'seller' && role !== 'staff') return { error: 'not_found' };
  if (!ACTIVE.has(order.status)) return { error: 'bad_status' };

  const place = clean(input.place, 120);
  const note = clean(input.note, 300);
  const eta = parseDate(input.eta);
  const etaTo = parseDate(input.etaTo);
  if (eta === undefined || etaTo === undefined) return { error: 'bad_date' };
  const now = Date.now();
  if (eta && (eta.getTime() < now - DAY || eta.getTime() > now + 120 * DAY)) return { error: 'bad_date' };
  if (etaTo && (!eta || etaTo < eta || etaTo.getTime() > now + 120 * DAY)) return { error: 'bad_date' };
  if (!place && !eta) return { error: 'empty' };

  await query(
    `INSERT INTO market_goods_status (order_id, place, note, eta, eta_to, set_by, set_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (order_id) DO UPDATE SET place=EXCLUDED.place, note=EXCLUDED.note, eta=EXCLUDED.eta,
       eta_to=EXCLUDED.eta_to, set_by=EXCLUDED.set_by, set_role=EXCLUDED.set_role, updated_at=now()`,
    [order.id, place, note, eta, etaTo, actorId, role]);
  await query(
    `INSERT INTO market_goods_status_log (order_id, actor_id, actor_role, place, note, eta, eta_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [order.id, actorId, role, place, note, eta, etaTo]);
  await logMarket(actorId, 'goods_status_set', order.id, { role });

  const placeText = place || 'место не указано';
  const range = eta ? `${eta.toLocaleDateString('ru-RU')}${etaTo ? ` – ${etaTo.toLocaleDateString('ru-RU')}` : ''}` : '';
  const line = eta ? `Статус товара: ${placeText}. Ожидаемая доставка: ${range}.` : `Статус товара: ${placeText}.`;
  await systemMessage(order.id, line).catch(() => {});
  await notifyGift(order.buyer_id, 'market_goods_status', 'Обновился статус товара', line, order.id).catch(() => {});
  return { ok: true };
};

export const clearGoodsStatus = async (orderId, actorId) => {
  const order = await orderOf(orderId);
  if (!order) return { error: 'not_found' };
  const role = await roleOf(order, actorId);
  if (role !== 'seller' && role !== 'staff') return { error: 'not_found' };
  await query('DELETE FROM market_goods_status WHERE order_id=$1', [order.id]);
  await logMarket(actorId, 'goods_status_cleared', order.id, { role });
  return { ok: true };
};

/* ── Сотрудники продавца ─────────────────────────────────────────── */

export const listStaff = async (sellerId) => {
  const { rows } = await query(
    `SELECT s.profile_id, p.username, p.name, s.created_at FROM market_seller_staff s
     JOIN profiles p ON p.id = s.profile_id WHERE s.seller_id=$1 ORDER BY s.created_at`, [sellerId]);
  return { staff: rows.map((r) => ({ id: r.profile_id, username: r.username, name: r.name, since: iso(r.created_at) })), max: MAX_STAFF };
};

export const addStaff = async (sellerId, username) => {
  const uname = String(username ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.]{2,32}$/.test(uname)) return { error: 'bad_username' };
  const { rows: seller } = await query('SELECT 1 FROM market_sellers WHERE profile_id=$1', [sellerId]);
  if (!seller.length) return { error: 'not_seller' };
  const { rows: tp } = await query('SELECT id FROM profiles WHERE lower(username)=$1 AND deleted_at IS NULL', [uname]);
  if (!tp[0]) return { error: 'user_not_found' };
  if (tp[0].id === sellerId) return { error: 'self' };
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM market_seller_staff WHERE seller_id=$1', [sellerId]);
  if (cnt[0].n >= MAX_STAFF) return { error: 'too_many' };
  await query(
    'INSERT INTO market_seller_staff (seller_id, profile_id, added_by) VALUES ($1,$2,$1) ON CONFLICT DO NOTHING',
    [sellerId, tp[0].id]);
  await logMarket(sellerId, 'goods_staff_add', tp[0].id);
  await notifyGift(tp[0].id, 'market_goods_staff', 'Вас назначили сотрудником магазина',
    'Вы можете обновлять статус товаров в заказах: где товар и когда доставка.', sellerId).catch(() => {});
  return { ok: true };
};

export const removeStaff = async (sellerId, profileId) => {
  await query('DELETE FROM market_seller_staff WHERE seller_id=$1 AND profile_id=$2', [sellerId, String(profileId ?? '')]);
  await logMarket(sellerId, 'goods_staff_remove', profileId);
  return { ok: true };
};

/** Заказы в работе, где человек может обновлять статус (продавец или сотрудник). */
export const workQueue = async (viewerId) => {
  const { rows } = await query(
    `SELECT o.id, o.title_snap, o.status, g.place, g.eta, g.updated_at
       FROM market_orders o
  LEFT JOIN market_goods_status g ON g.order_id = o.id
      WHERE o.status = ANY($2::text[])
        AND (o.seller_id = $1 OR EXISTS (SELECT 1 FROM market_seller_staff s WHERE s.seller_id=o.seller_id AND s.profile_id=$1))
      ORDER BY o.created_at DESC LIMIT 50`,
    [viewerId, [...ACTIVE]]);
  return { orders: rows.map((r) => ({ id: r.id, title: r.title_snap, status: r.status, place: r.place ?? '', eta: iso(r.eta), updatedAt: iso(r.updated_at) })) };
};
