/**
 * Sky GO → «Билеты на проезд». Перевозчик — обычная организация Sky GO (категория `transit`), как и остальные «Для транспорта»; отдельной платёжной системы нет.
 *  • продукты: разовая поездка, пакет поездок, безлимит на срок; цену задаёт перевозчик, Sky её не проверяет;
 *  • покупка создаёт билет `awaiting_payment` и страницу оплаты SkyKassa Business (прямой перевод перевозчику; Sky деньги не принимает);
 *    билет оживает, когда перевозчик (или его платёжный партнёр) подтвердил оплату — `goplaces.paymentChanged → ticketPaymentChanged`;
 *  • QR билета — токен, который меняется каждые 30 секунд и подписан HMAC: скриншот не работает; проверяет на борту сотрудник организации (роли `door`);
 *  • проверка атомарна под FOR UPDATE: разовый билет гасится, у пакета списывается поездка, повторная отметка в течение 10 минут (пересадка) поездку не списывает;
 *  • возврат неиспользованного билета: запрос покупателя → решение перевозчика; деньги возвращает сам перевозчик через SkyKassa Business.
 * Расписаний, маршрутов и позиции транспорта в Sky нет — только билеты.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { notifyGift } from './giftnotify.mjs';
import { newId, inTx, clean } from './gocore.mjs';
import { payUrl, publicId, subState } from './kbiz.mjs';
import { macOf } from './crypto.mjs';

const err = (error, extra = {}) => ({ error, ...extra });
const note = (to, title, body, ref) => notifyGift(to, 'go_transit', title, body, ref).catch(() => {});
export const KIND_LABEL = { single: 'Разовая поездка', multi: 'Пакет поездок', period: 'Проездной на срок' };
export const TICKET_LABEL = { awaiting_payment: 'Ждёт оплаты', active: 'Действует', used: 'Использован', expired: 'Срок истёк', cancelled: 'Отменён', refund_requested: 'Запрошен возврат', refunded: 'Возвращён' };
const WINDOW_SEC = 30; const RECENT_MIN = 10; const PAY_MIN = 30;

const ownBiz = async (key) => (await query(`SELECT b.id, b.name, b.owner_id, p.category_id FROM kb_businesses b LEFT JOIN gop_places p ON p.business_id = b.id WHERE b.id = kb_cur_biz($1)`, [key])).rows[0] ?? null;
const needTransit = (b) => (!b ? err('no_business') : b.category_id !== 'transit' ? err('not_transit') : null);

/* ─── Перевозчик: продукты ─── */
const prodShape = (r) => ({ id: r.id, name: r.name, description: r.description, kind: r.kind, kindLabel: KIND_LABEL[r.kind], rides: r.rides, validDays: r.valid_days, priceRub: r.price_rub, active: r.active });
export const ownerProducts = async (key) => {
  const b = await ownBiz(key); const bad = needTransit(b); if (bad) return bad;
  return { ok: true, products: (await query('SELECT * FROM gt_products WHERE business_id = $1 ORDER BY sort, created_at', [b.id])).rows.map(prodShape) };
};
export const saveProduct = async (key, id, body) => {
  const b = await ownBiz(key); const bad = needTransit(b); if (bad) return bad;
  const name = clean(body?.name, 80); if (name.length < 3) return err('bad_field', { field: 'name' });
  const kind = String(body?.kind ?? ''); if (!(kind in KIND_LABEL)) return err('bad_field', { field: 'kind' });
  const price = Number(body?.priceRub); if (!Number.isInteger(price) || price < 1 || price > 100000) return err('bad_field', { field: 'priceRub' });
  const days = Number(body?.validDays ?? (kind === 'single' ? 1 : 30)); if (!Number.isInteger(days) || days < 1 || days > 366) return err('bad_field', { field: 'validDays' });
  const rides = kind === 'multi' ? Number(body?.rides) : null; if (kind === 'multi' && (!Number.isInteger(rides) || rides < 2 || rides > 500)) return err('bad_field', { field: 'rides' });
  const active = body?.active !== false; const desc = clean(body?.description, 300);
  if (id) {
    // у проданных билетов — снимок, поэтому правка продукта их не меняет
    const r = await query('UPDATE gt_products SET name=$3, description=$4, kind=$5, rides=$6, valid_days=$7, price_rub=$8, active=$9 WHERE id=$1 AND business_id=$2', [id, b.id, name, desc, kind, rides, days, price, active]);
    return r.rowCount ? { ok: true, id } : err('not_found');
  }
  if ((await query('SELECT count(*)::int AS n FROM gt_products WHERE business_id = $1', [b.id])).rows[0].n >= 30) return err('too_many_products');
  const nid = newId('gtp');
  await query('INSERT INTO gt_products (id, business_id, name, description, kind, rides, valid_days, price_rub, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [nid, b.id, name, desc, kind, rides, days, price, active]);
  return { ok: true, id: nid };
};

/* ─── Покупатель ─── */
export const catalog = async (q = {}) => {
  const vals = []; let w = `p.connected AND p.status = 'published' AND b.status = 'active' AND p.category_id = 'transit'`;
  if (q.city) { vals.push(`%${String(q.city).replace(/[%_\\]/g, ' ').trim().slice(0, 60)}%`); w += ` AND p.city ILIKE $${vals.length}`; }
  const orgs = (await query(`SELECT b.id, b.name, p.city, p.address FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE ${w} ORDER BY b.name LIMIT 100`, vals)).rows;
  const out = [];
  for (const o of orgs) {
    const sub = await subState(o.id); const rq = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [o.id]);
    const products = (await query('SELECT * FROM gt_products WHERE business_id = $1 AND active ORDER BY sort, price_rub', [o.id])).rows.map(prodShape);
    if (products.length) out.push({ id: o.id, name: o.name, city: o.city, address: o.address, canSell: sub.active && Boolean(rq.rows[0]), products });
  }
  return { ok: true, operators: out };
};

export const buy = async (me, productId, idemKey) => {
  const p = (await query(`SELECT t.*, b.owner_id, b.name AS org FROM gt_products t JOIN kb_businesses b ON b.id = t.business_id JOIN gop_places pl ON pl.business_id = b.id
    WHERE t.id = $1 AND t.active AND pl.connected AND pl.status = 'published' AND b.status = 'active' AND pl.category_id = 'transit'`, [String(productId ?? '')])).rows[0];
  if (!p) return err('not_found');
  if (p.owner_id === me) return err('own_operator');
  const sub = await subState(p.business_id); const rq = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [p.business_id]);
  if (!sub.active || !rq.rows[0]) return err('sales_unavailable');
  const idem = clean(idemKey, 60) || null;
  const res = await inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gtbuy:${me}`]);
    if (idem) { const d = (await c.query('SELECT id, status FROM gt_tickets WHERE buyer_id = $1 AND idem_key = $2', [me, idem])).rows[0]; if (d) return { ok: true, duplicate: true, id: d.id }; }
    if ((await c.query(`SELECT count(*)::int AS n FROM gt_tickets WHERE buyer_id = $1 AND status = 'awaiting_payment'`, [me])).rows[0].n >= 5) return err('too_many_pending');
    const id = newId('gtt'); const qid = newId('kbq'); const pid = publicId();
    await c.query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, expires_at, config) VALUES ($1,$2,$3,'order',$4,'',$5,'',now() + ($6 || ' minutes')::interval,$7::jsonb)`,
      [qid, pid, p.business_id, `Билет: ${p.name}`, p.price_rub, String(PAY_MIN), JSON.stringify({ ticketId: id })]);
    await c.query(`INSERT INTO gt_tickets (id, product_id, business_id, buyer_id, name, kind, rides_total, rides_left, valid_days, price_rub, qr_id, idem_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11)`,
      [id, p.id, p.business_id, me, p.name, p.kind, p.kind === 'multi' ? p.rides : null, p.valid_days, p.price_rub, qid, idem]);
    return { ok: true, id, payUrl: payUrl(pid), priceRub: p.price_rub };
  });
  return res;
};

const tShape = async (r) => {
  let pay = null;
  if (r.status === 'awaiting_payment' && r.qr_id) { const q = (await query(`SELECT public_id, expires_at FROM kb_qr WHERE id = $1 AND status = 'active'`, [r.qr_id])).rows[0]; if (q && (!q.expires_at || q.expires_at > new Date())) pay = payUrl(q.public_id); }
  const expired = r.status === 'active' && r.valid_until && r.valid_until <= new Date();
  const st = expired ? 'expired' : r.status;
  return { id: r.id, operator: r.org, operatorId: r.business_id, name: r.name, kind: r.kind, kindLabel: KIND_LABEL[r.kind], status: st, statusLabel: TICKET_LABEL[st], ridesLeft: r.rides_left, ridesTotal: r.rides_total, priceRub: r.price_rub,
    validFrom: r.valid_from?.toISOString() ?? null, validUntil: r.valid_until?.toISOString() ?? null, payUrl: pay, note: r.note, createdAt: r.created_at.toISOString(),
    canRefund: r.status === 'active' && !expired && !r.last_validated_at };
};
export const myTickets = async (me) => {
  const { rows } = await query(`SELECT t.*, b.name AS org FROM gt_tickets t JOIN kb_businesses b ON b.id = t.business_id WHERE t.buyer_id = $1 ORDER BY t.created_at DESC LIMIT 100`, [me]);
  return { ok: true, tickets: await Promise.all(rows.map(tShape)) };
};
export const cancelPending = async (me, id) => {
  const r = await query(`UPDATE gt_tickets SET status='cancelled', updated_at=now() WHERE id=$1 AND buyer_id=$2 AND status='awaiting_payment' RETURNING qr_id`, [String(id ?? ''), me]);
  if (!r.rowCount) return err('not_found');
  await query(`UPDATE kb_qr SET status='disabled', updated_at=now() WHERE id=$1 AND status='active'`, [r.rows[0].qr_id]);
  return { ok: true };
};

/* ─── QR-токен (меняется каждые 30 с) ─── */
const sig = (id, win) => macOf('gt-ticket', `${id}:${win}`).slice(0, 20);
const win = (t = Date.now()) => Math.floor(t / 1000 / WINDOW_SEC);
export const ticketToken = async (me, id) => {
  const t = (await query(`SELECT id, status, valid_until FROM gt_tickets WHERE id = $1 AND buyer_id = $2`, [String(id ?? ''), me])).rows[0];
  if (!t) return err('not_found');
  if (t.status !== 'active' || (t.valid_until && t.valid_until <= new Date())) return err('not_active');
  const w = win();
  return { ok: true, token: `${t.id}.${w}.${sig(t.id, w)}`, refreshSec: WINDOW_SEC - (Math.floor(Date.now() / 1000) % WINDOW_SEC) };
};

/* ─── Проверка на борту ─── */
const same = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
export const validate = async (key, actor, token) => {
  const b = await ownBiz(key); const bad = needTransit(b); if (bad) return bad;
  const m = /^(gtt-[0-9a-f-]{36})\.(\d{1,10})\.([0-9a-f]{20})$/.exec(String(token ?? '').trim());
  const logv = (id, result) => query('INSERT INTO gt_validations (ticket_id, business_id, by_profile, result) VALUES ($1,$2,$3,$4)', [id, b.id, actor, result]).catch(() => {});
  if (!m) { await logv(null, 'bad_token'); return err('bad_token'); }
  const w = Number(m[2]); const now = win();
  if (w > now + 1 || w < now - 1 || !same(sig(m[1], w), m[3])) { await logv(m[1], 'bad_token'); return err('bad_token'); }   // устаревший токен/скриншот
  const res = await inTx(async (c) => {
    const t = (await c.query('SELECT * FROM gt_tickets WHERE id = $1 FOR UPDATE', [m[1]])).rows[0];
    if (!t || t.business_id !== b.id) return err('not_found');
    if (t.status === 'used') return err('used');
    if (t.status !== 'active') return err('not_active', { status: t.status });
    if (t.valid_until <= new Date()) { await c.query(`UPDATE gt_tickets SET status='expired', updated_at=now() WHERE id=$1`, [t.id]); return err('expired'); }
    const recent = t.last_validated_at && Date.now() - t.last_validated_at.getTime() < RECENT_MIN * 60000 && t.kind !== 'single';
    if (recent) return { ok: true, result: 'recent', name: t.name, ridesLeft: t.rides_left, validUntil: t.valid_until.toISOString(), minutesAgo: Math.floor((Date.now() - t.last_validated_at.getTime()) / 60000) };
    let left = t.rides_left; let status = 'active';
    if (t.kind === 'single') status = 'used';
    else if (t.kind === 'multi') { left = t.rides_left - 1; if (left <= 0) status = 'used'; }
    await c.query('UPDATE gt_tickets SET status=$2, rides_left=$3, last_validated_at=now(), updated_at=now() WHERE id=$1', [t.id, status, left]);
    return { ok: true, result: 'valid', name: t.name, ridesLeft: t.kind === 'multi' ? left : null, validUntil: t.valid_until.toISOString(), buyer: t.buyer_id, ticket: t.id };
  });
  await logv(m[1], res.ok ? res.result : res.error);
  if (res.ok && res.result === 'valid' && res.ridesLeft === 0) void note(res.buyer, 'Пакет поездок закончился', res.name, `gtt:${res.ticket}:ended`);
  return res;
};

/* ─── Оплата и возврат ─── */
export const ticketPaymentChanged = async (paymentId, to) => {
  const { rows } = await query(`SELECT p.status AS pay, t.id, t.status, t.valid_days, t.buyer_id, t.name, b.name AS org FROM kb_payments p JOIN gt_tickets t ON t.qr_id = p.qr_id JOIN kb_businesses b ON b.id = t.business_id WHERE p.id = $1`, [paymentId]);
  const r = rows[0]; if (!r) return false;
  if (r.pay !== to) return true;
  if (to === 'confirmed' && r.status === 'awaiting_payment') {
    const u = await query(`UPDATE gt_tickets SET status='active', valid_from=now(), valid_until = now() + ($2 || ' days')::interval, updated_at=now() WHERE id=$1 AND status='awaiting_payment'`, [r.id, String(r.valid_days)]);
    if (u.rowCount) void note(r.buyer_id, `${r.org}: билет оплачен`, `${r.name}. Откройте билет в Sky GO → Билеты на проезд.`, `gtt:${r.id}:active`);
  } else if (['cancelled', 'not_found', 'expired'].includes(to) && r.status === 'awaiting_payment') await query(`UPDATE gt_tickets SET status='cancelled', updated_at=now() WHERE id=$1 AND status='awaiting_payment'`, [r.id]);
  else if (to === 'refunded' && ['active', 'refund_requested'].includes(r.status)) {
    const u = await query(`UPDATE gt_tickets SET status='refunded', updated_at=now() WHERE id=$1 AND status IN ('active','refund_requested')`, [r.id]);
    if (u.rowCount) void note(r.buyer_id, `${r.org}: оплата возвращена`, r.name, `gtt:${r.id}:refunded`);
  }
  return true;
};
export const requestRefund = async (me, id) => {
  const r = await query(`UPDATE gt_tickets SET status='refund_requested', updated_at=now() WHERE id=$1 AND buyer_id=$2 AND status='active' AND last_validated_at IS NULL AND valid_until > now() RETURNING business_id, name`, [String(id ?? ''), me]);
  if (!r.rowCount) return err('refund_not_allowed');
  const o = (await query('SELECT owner_id FROM kb_businesses WHERE id = $1', [r.rows[0].business_id])).rows[0];
  if (o) void note(o.owner_id, 'Запрос на возврат билета', r.rows[0].name, `gtt:${id}:refreq`);
  return { ok: true };
};
export const decideRefund = async (key, actor, id, approve, comment) => {
  const b = await ownBiz(key); const bad = needTransit(b); if (bad) return bad;
  const why = clean(comment, 200); if (!approve && why.length < 3) return err('reason_required');
  const r = await query(`UPDATE gt_tickets SET status = $3, note = $4, updated_at = now() WHERE id = $1 AND business_id = $2 AND status = 'refund_requested' RETURNING buyer_id, name`, [String(id ?? ''), b.id, approve ? 'refunded' : 'active', why]);
  if (!r.rowCount) return err('not_found');
  void note(r.rows[0].buyer_id, approve ? `${b.name}: возврат одобрен` : `${b.name}: в возврате отказано`, `${r.rows[0].name}${approve ? '. Перевозчик вернёт деньги сам.' : `. ${why}`}`, `gtt:${id}:${approve ? 'ref-ok' : 'ref-no'}`);
  return { ok: true };
};

/* ─── Перевозчик: список и статистика ─── */
export const ownerTickets = async (key, q = {}) => {
  const b = await ownBiz(key); const bad = needTransit(b); if (bad) return bad;
  const vals = [b.id]; let w = 't.business_id = $1';
  if (q.status && q.status in TICKET_LABEL) { vals.push(q.status); w += ` AND t.status = $${vals.length}`; }
  const { rows } = await query(`SELECT t.*, b.name AS org FROM gt_tickets t JOIN kb_businesses b ON b.id = t.business_id WHERE ${w} ORDER BY t.updated_at DESC LIMIT 100`, vals);
  return { ok: true, tickets: await Promise.all(rows.map(tShape)) };
};
export const ownerStats = async (key) => {
  const b = await ownBiz(key); const bad = needTransit(b); if (bad) return bad;
  const st = (await query('SELECT status, count(*)::int AS n FROM gt_tickets WHERE business_id = $1 GROUP BY status', [b.id])).rows;
  const v = (await query(`SELECT count(*) FILTER (WHERE result = 'valid')::int AS ok, count(*) FILTER (WHERE result = 'recent')::int AS recent, count(*) FILTER (WHERE result NOT IN ('valid','recent'))::int AS rejected FROM gt_validations WHERE business_id = $1 AND at > now() - interval '30 days'`, [b.id])).rows[0];
  const paid = (await query(`SELECT COALESCE(sum(price_rub),0)::int AS s FROM gt_tickets WHERE business_id = $1 AND status IN ('active','used','expired','refund_requested')`, [b.id])).rows[0].s;
  return { ok: true, byStatus: Object.fromEntries(st.map((x) => [x.status, x.n])), validations30d: v, soldRub: paid };
};
