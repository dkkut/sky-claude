/**
 * SkyKassa Business, этап 3: промокоды, отзывы, аналитика, касса. Сотрудники и роли — kbstaff.mjs.
 * Скидку по промокоду, суммы и допуск к отзыву считает сервер; Sky по-прежнему не принимает деньги: оплата — прямым переводом владельцу.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { newId, inTx, clean } from './gocore.mjs';
import { err, publicId, audit, keyHash, subState, payUrl, MAX_AMOUNT } from './kbiz.mjs';

const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const ownBiz = async (ownerId) => (await query('SELECT id, status, name FROM kb_businesses WHERE owner_id = $1', [ownerId])).rows[0] ?? null;

/* ─── Промокоды ─── */
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
const shapePromo = (r) => ({ id: r.id, code: r.code, kind: r.kind, value: r.value, minOrderRub: r.min_order_rub, maxUses: r.max_uses, used: r.used,
  startsAt: r.starts_at?.toISOString?.() ?? null, expiresAt: r.expires_at?.toISOString?.() ?? null, status: r.status, createdAt: r.created_at.toISOString() });

export const listPromos = async (ownerId) => {
  const b = await ownBiz(ownerId); if (!b) return { promos: [] };
  const { rows } = await query('SELECT * FROM kb_promos WHERE business_id = $1 ORDER BY created_at DESC LIMIT 200', [b.id]);
  return { promos: rows.map(shapePromo) };
};

export const createPromo = async (ownerId, actor, body) => {
  const b = await ownBiz(ownerId); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const code = clean(body?.code, 24).toUpperCase().replace(/\s+/g, '');
  if (!CODE_RE.test(code)) return err('bad_field', { field: 'code' });
  const kind = body?.kind === 'fixed' ? 'fixed' : body?.kind === 'percent' ? 'percent' : null; if (!kind) return err('bad_field', { field: 'kind' });
  const value = int(body?.value, 1, kind === 'percent' ? 90 : MAX_AMOUNT); if (value == null) return err('bad_field', { field: 'value' });
  const min = int(body?.minOrderRub ?? 0, 0, MAX_AMOUNT); if (min == null) return err('bad_field', { field: 'minOrderRub' });
  const maxUses = body?.maxUses === undefined || body?.maxUses === null || body?.maxUses === '' ? null : int(body.maxUses, 1, 1_000_000); if (body?.maxUses && maxUses == null) return err('bad_field', { field: 'maxUses' });
  let starts = null, expires = null;
  if (body?.startsAt) { starts = new Date(body.startsAt); if (Number.isNaN(starts.getTime())) return err('bad_field', { field: 'startsAt' }); }
  if (body?.expiresAt) { expires = new Date(body.expiresAt); if (Number.isNaN(expires.getTime()) || expires <= new Date() || (starts && expires <= starts)) return err('bad_field', { field: 'expiresAt' }); }
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM kb_promos WHERE business_id = $1', [b.id]); if (cnt[0].n >= 200) return err('too_many_promos');
  const id = newId('kbc');
  try { await query('INSERT INTO kb_promos (id, business_id, code, kind, value, min_order_rub, max_uses, starts_at, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, b.id, code, kind, value, min, maxUses, starts, expires, actor]); }
  catch (e) { if (e.code === '23505') return err('code_taken'); throw e; }
  await audit(b.id, actor, 'promo_created', `${code}: ${kind === 'percent' ? `${value}%` : `${value} ₽`}`);
  return { ok: true, id };
};

export const setPromoStatus = async (ownerId, actor, id, status) => {
  if (!['active', 'paused'].includes(status)) return err('bad_status');
  const b = await ownBiz(ownerId); if (!b) return err('no_business');
  const { rows } = await query('UPDATE kb_promos SET status = $3 WHERE id = $1 AND business_id = $2 RETURNING code', [String(id ?? ''), b.id, status]);
  if (!rows[0]) return err('not_found');
  await audit(b.id, actor, `promo_${status}`, rows[0].code);
  return { ok: true };
};

/** Проверка промокода под тот же расчёт, что и при заказе. Скидка — на сумму позиций; итог не меньше 1 ₽. Расход не списывается (это делает заказ атомарно). */
export const promoCheck = async (businessId, codeRaw, subtotal, db = { query }) => {
  const code = clean(codeRaw, 24).toUpperCase().replace(/\s+/g, '');
  if (!code) return { none: true };
  const { rows } = await db.query('SELECT * FROM kb_promos WHERE business_id = $1 AND code = $2', [businessId, code]);
  const p = rows[0];
  if (!p || p.status !== 'active') return err('promo_invalid');
  const now = new Date();
  if ((p.starts_at && p.starts_at > now) || (p.expires_at && p.expires_at <= now)) return err('promo_expired');
  if (p.max_uses != null && p.used >= p.max_uses) return err('promo_exhausted');
  if (subtotal < p.min_order_rub) return err('promo_min_order', { minOrderRub: p.min_order_rub });
  let discount = p.kind === 'percent' ? Math.floor((subtotal * p.value) / 100) : p.value;
  discount = Math.max(0, Math.min(discount, subtotal - 1));
  return { promo: p, discount, code };
};

/* ─── Отзывы ─── */
export const leaveReview = async (orderId, key, body) => {
  const rating = int(body?.rating, 1, 5); if (rating == null) return err('bad_field', { field: 'rating' });
  const text = clean(body?.text, 600);
  return inTx(async (c) => {
    const { rows } = await c.query(`SELECT o.id, o.business_id, o.status, o.contact_enc FROM kb_orders o WHERE o.id = $1 AND o.buyer_key_hash = $2 FOR UPDATE`, [String(orderId ?? ''), keyHash(key)]);
    if (!rows[0]) return err('not_found');
    if (rows[0].status !== 'done') return err('order_not_done');
    const { rows: ex } = await c.query('SELECT 1 FROM kb_reviews WHERE order_id = $1', [rows[0].id]); if (ex[0]) return err('already_reviewed');
    const { openJson } = await import('./gocore.mjs');
    const name = clean(openJson(rows[0].contact_enc)?.name, 40).split(' ')[0] || 'Покупатель';
    await c.query('INSERT INTO kb_reviews (id, business_id, order_id, rating, body, author) VALUES ($1,$2,$3,$4,$5,$6)', [newId('kbr'), rows[0].business_id, rows[0].id, rating, text, name]);
    return { ok: true };
  });
};

const shapeReview = (r) => ({ id: r.id, rating: r.rating, text: r.body, author: r.author, reply: r.owner_reply, status: r.status, createdAt: r.created_at.toISOString(), orderNo: r.number });
export const publicReviews = async (businessId) => {
  const { rows } = await query(`SELECT r.*, o.number FROM kb_reviews r JOIN kb_orders o ON o.id = r.order_id WHERE r.business_id = $1 AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 20`, [businessId]);
  const { rows: s } = await query(`SELECT count(*)::int AS n, COALESCE(round(avg(rating)::numeric, 1), 0)::float AS avg FROM kb_reviews WHERE business_id = $1 AND status = 'published'`, [businessId]);
  return { count: s[0].n, average: s[0].avg, items: rows.map((r) => { const x = shapeReview(r); delete x.status; delete x.orderNo; return x; }) };
};
export const listReviews = async (ownerId) => {
  const b = await ownBiz(ownerId); if (!b) return { reviews: [] };
  const { rows } = await query('SELECT r.*, o.number FROM kb_reviews r JOIN kb_orders o ON o.id = r.order_id WHERE r.business_id = $1 ORDER BY r.created_at DESC LIMIT 200', [b.id]);
  return { reviews: rows.map(shapeReview) };
};
export const moderateReview = async (ownerId, actor, id, { status, reply } = {}) => {
  const b = await ownBiz(ownerId); if (!b) return err('no_business');
  if (status !== undefined && !['published', 'hidden'].includes(status)) return err('bad_status');
  const { rows } = await query(`UPDATE kb_reviews SET status = COALESCE($3, status), owner_reply = CASE WHEN $4::text IS NULL THEN owner_reply ELSE $4 END WHERE id = $1 AND business_id = $2 RETURNING id`,
    [String(id ?? ''), b.id, status ?? null, reply === undefined ? null : clean(reply, 400)]);
  if (!rows[0]) return err('not_found');
  await audit(b.id, actor, status ? `review_${status}` : 'review_reply', id);
  return { ok: true };
};

/* ─── Касса: временная страница оплаты на сумму, которую набрал кассир ─── */
export const createCash = async (ownerId, actor, body) => {
  const b = await ownBiz(ownerId); if (!b) return err('no_business');
  if (b.status !== 'active') return err(b.status === 'suspended' ? 'suspended' : 'not_published');
  const sub = await subState(b.id); if (!sub.active) return err('subscription_required');
  const { rows: rq } = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [b.id]); if (!rq[0]) return err('requisites_required');
  const amount = int(body?.amountRub, 1, MAX_AMOUNT); if (amount == null) return err('bad_field', { field: 'amountRub' });
  const { rows: lim } = await query(`SELECT count(*)::int AS n FROM kb_qr WHERE business_id = $1 AND config->>'cash' = 'true' AND created_at > now() - interval '1 hour'`, [b.id]);
  if (lim[0].n >= 300) return err('too_many_requests');
  const id = newId('kbq'); const pid = publicId();
  await query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, expires_at, created_by, config) VALUES ($1,$2,$3,'pay',$4,$5,$6,$7, now() + interval '15 minutes',$8,$9::jsonb)`,
    [id, pid, b.id, 'Касса', clean(body?.note, 200), amount, clean(body?.orderNo, 40), actor, JSON.stringify({ cash: true })]);
  return { ok: true, id, publicId: pid, url: payUrl(pid), amountRub: amount, expiresInSec: 900 };
};
export const cashStatus = async (ownerId, qrId) => {
  const b = await ownBiz(ownerId); if (!b) return err('no_business');
  const { rows } = await query(`SELECT p.status, p.amount_rub FROM kb_payments p JOIN kb_qr q ON q.id = p.qr_id WHERE q.id = $1 AND q.business_id = $2 AND q.config->>'cash' = 'true' ORDER BY p.created_at DESC LIMIT 1`, [String(qrId ?? ''), b.id]);
  return { status: rows[0]?.status ?? 'waiting', amountRub: rows[0]?.amount_rub ?? null };
};
export const cashRecent = async (ownerId, actor, onlyMine) => {
  const b = await ownBiz(ownerId); if (!b) return { items: [] };
  const { rows } = await query(
    `SELECT q.id, q.public_id, q.amount_rub, q.created_at, q.created_by, (SELECT p.status FROM kb_payments p WHERE p.qr_id = q.id ORDER BY p.created_at DESC LIMIT 1) AS status
       FROM kb_qr q WHERE q.business_id = $1 AND q.config->>'cash' = 'true' AND ($2::text IS NULL OR q.created_by = $2) ORDER BY q.created_at DESC LIMIT 30`, [b.id, onlyMine ? actor : null]);
  return { items: rows.map((r) => ({ id: r.id, publicId: r.public_id, amountRub: r.amount_rub, status: r.status ?? 'waiting', createdAt: r.created_at.toISOString(), url: payUrl(r.public_id) })) };
};

/* ─── Аналитика ─── */
export const analytics = async (ownerId, days = 30) => {
  const b = await ownBiz(ownerId); if (!b) return { analytics: null };
  const d = Math.min(365, Math.max(1, Number(days) || 30));
  const v = [b.id, d];
  const { rows: tot } = await query(
    `SELECT count(*) FILTER (WHERE p.status <> 'created')::int AS requests, count(*) FILTER (WHERE p.status = 'confirmed')::int AS confirmed,
            COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status IN ('reported','pending_check','confirmed','not_found','refunded')), 0)::bigint AS claimed,
            COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status = 'confirmed'), 0)::bigint AS confirmed_sum,
            count(*) FILTER (WHERE p.status = 'not_found')::int AS not_found, count(*) FILTER (WHERE p.status = 'refunded')::int AS refunded
       FROM kb_payments p WHERE p.business_id = $1 AND p.created_at > now() - ($2::int * interval '1 day')`, v);
  const { rows: opens } = await query(`SELECT count(*)::int AS n FROM kb_qr_opens o JOIN kb_qr q ON q.id = o.qr_id WHERE q.business_id = $1 AND o.day > current_date - $2::int`, v);
  const { rows: byDay } = await query(
    `SELECT to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') AS day, count(*) FILTER (WHERE p.status <> 'created')::int AS requests,
            COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status = 'confirmed'), 0)::bigint AS confirmed_sum
       FROM kb_payments p WHERE p.business_id = $1 AND p.created_at > now() - ($2::int * interval '1 day') GROUP BY 1 ORDER BY 1`, v);
  const { rows: byKind } = await query(
    `SELECT CASE WHEN q.config->>'cash' = 'true' THEN 'cash' ELSE COALESCE(q.kind, 'pay') END AS kind, count(*) FILTER (WHERE p.status <> 'created')::int AS requests,
            count(*) FILTER (WHERE p.status = 'confirmed')::int AS confirmed, COALESCE(SUM(p.amount_rub) FILTER (WHERE p.status = 'confirmed'), 0)::bigint AS confirmed_sum
       FROM kb_payments p LEFT JOIN kb_qr q ON q.id = p.qr_id WHERE p.business_id = $1 AND p.created_at > now() - ($2::int * interval '1 day') GROUP BY 1 ORDER BY 4 DESC`, v);
  const { rows: top } = await query(
    `SELECT l->>'title' AS title, SUM((l->>'qty')::int)::int AS qty, SUM((l->>'qty')::int * (l->>'priceRub')::int)::bigint AS sum
       FROM kb_orders o, jsonb_array_elements(o.lines) l
      WHERE o.business_id = $1 AND o.created_at > now() - ($2::int * interval '1 day')
        AND EXISTS (SELECT 1 FROM kb_payments p WHERE p.qr_id = o.qr_id AND p.status = 'confirmed')
      GROUP BY 1 ORDER BY 3 DESC LIMIT 5`, v);
  const { rows: ord } = await query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status IN ('rejected','cancelled'))::int AS lost, COALESCE(SUM(discount_rub), 0)::bigint AS discounts
       FROM kb_orders WHERE business_id = $1 AND created_at > now() - ($2::int * interval '1 day')`, v);
  const { rows: rev } = await query(`SELECT count(*)::int AS n, COALESCE(round(avg(rating)::numeric, 2), 0)::float AS avg FROM kb_reviews WHERE business_id = $1 AND status = 'published'`, [b.id]);
  const t = tot[0];
  return { analytics: { days: d, requests: t.requests, confirmed: t.confirmed, claimedSumRub: Number(t.claimed), confirmedSumRub: Number(t.confirmed_sum), averageRub: t.confirmed ? Math.round(Number(t.confirmed_sum) / t.confirmed) : 0,
    notFound: t.not_found, refunded: t.refunded, opens: opens[0].n,
    conversionPercent: opens[0].n ? Math.round((t.confirmed / opens[0].n) * 1000) / 10 : null,
    byDay: byDay.map((x) => ({ day: x.day, requests: x.requests, confirmedSumRub: Number(x.confirmed_sum) })),
    byKind: byKind.map((x) => ({ kind: x.kind, requests: x.requests, confirmed: x.confirmed, confirmedSumRub: Number(x.confirmed_sum) })),
    topItems: top.map((x) => ({ title: x.title, qty: x.qty, sumRub: Number(x.sum) })),
    orders: { total: ord[0].n, done: ord[0].done, lost: ord[0].lost, discountsRub: Number(ord[0].discounts) }, reviews: { count: rev[0].n, average: rev[0].avg } } };
};
