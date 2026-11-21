/**
 * SkyKassa Business, этап 2: каталог и заказы, витрина (на Sky и на собственном VPS бизнеса), чаевые, счета.
 *
 * Деньги по-прежнему идут напрямую владельцу: заказ, счёт и страница чаевых создают платёжную страницу (kb_qr нужного вида),
 * а статус оплаты ставит владелец. Цены, состав и суммы считает сервер; из запроса покупателя берутся только id позиций,
 * количество и контакты. Контакты покупателей зашифрованы.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { notifyGift } from './giftnotify.mjs';
import { newId, inTx, sealJson, openJson, clean } from './gocore.mjs';
import { promoCheck, publicReviews } from './kbextra.mjs';
import { err, publicId, ipHash, keyHash, audit, subState, payUrl, payOrigin, imageFromDataUrl, MAX_AMOUNT } from './kbiz.mjs';

const RESERVED = new Set(['admin', 'api', 'www', 'shop', 'static', 'assets', 'p', 's', 'sky', 'skykassa', 'pay', 'login', 'null', 'undefined']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const ORDER_LABEL = { new: 'Новый', confirmed: 'Подтверждён', rejected: 'Отклонён', in_progress: 'В работе', ready: 'Готов', done: 'Выполнен', cancelled: 'Отменён' };
const ORDER_ACT = {
  confirm:  { from: ['new'], to: 'confirmed' },
  reject:   { from: ['new'], to: 'rejected', comment: true },
  progress: { from: ['confirmed'], to: 'in_progress' },
  ready:    { from: ['confirmed', 'in_progress'], to: 'ready' },
  done:     { from: ['confirmed', 'in_progress', 'ready'], to: 'done' },
  cancel:   { from: ['new', 'confirmed', 'in_progress', 'ready'], to: 'cancelled', comment: true },
};
export const INVOICE_LABEL = { draft: 'Черновик', sent: 'Отправлен', reported: 'Покупатель сообщил об оплате', confirmed: 'Оплата подтверждена владельцем', expired: 'Истёк срок', cancelled: 'Отменён' };

const ownBiz = async (profileId) => (await query('SELECT id, status, name FROM kb_businesses WHERE id = kb_cur_biz($1)', [profileId])).rows[0] ?? null;
const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

/* ─── Каталог (владелец) ─── */

const shapeItem = (r) => ({ id: r.id, title: r.title, description: r.description, priceRub: r.price_rub, category: r.category, sku: r.sku, variants: r.variants ?? [], leadTime: r.lead_time,
  available: r.available, kind: r.kind ?? 'product', stock: r.stock ?? null, durationMin: r.duration_min ?? null, capacity: r.capacity ?? 1, depositRub: r.deposit_rub ?? 0, status: r.status, sort: r.sort, photoUrl: r.media_id ? `/api/kbiz/public/media/${r.media_id}` : null });

const parseItem = (b) => {
  const title = clean(b?.title, 120); if (title.length < 2) return err('bad_field', { field: 'title' });
  const price = int(b?.priceRub, 1, MAX_AMOUNT); if (price == null) return err('bad_field', { field: 'priceRub' });
  const variants = [];
  for (const v of Array.isArray(b?.variants) ? b.variants.slice(0, 20) : []) {
    const name = clean(v?.name, 60); if (!name) continue;
    const p = v?.priceRub === undefined || v?.priceRub === null || v?.priceRub === '' ? null : int(v.priceRub, 1, MAX_AMOUNT);
    if (v?.priceRub !== undefined && v?.priceRub !== null && v?.priceRub !== '' && p == null) return err('bad_field', { field: 'variants' });
    variants.push(p == null ? { name } : { name, priceRub: p });
  }
  const noStock = b?.stock === undefined || b?.stock === null || b?.stock === '';
  const stockV = noStock ? null : int(b.stock, 0, 1_000_000);
  if (!noStock && stockV == null) return err('bad_field', { field: 'stock' });
  if (b?.durationMin != null && b?.durationMin !== '' && int(b.durationMin, 5, 1440) == null) return err('bad_field', { field: 'durationMin' });
  if (int(b?.capacity ?? 1, 1, 100) == null) return err('bad_field', { field: 'capacity' });
  if (int(b?.depositRub ?? 0, 0, 100000) == null) return err('bad_field', { field: 'depositRub' });
  return { v: { title, description: clean(b?.description, 1000), price, category: clean(b?.category, 60), sku: clean(b?.sku, 40), variants, leadTime: clean(b?.leadTime, 60), available: b?.available !== false, sort: int(b?.sort, 0, 100000) ?? 0,
    kind: b?.kind === 'service' ? 'service' : 'product', stock: stockV,
    durationMin: b?.durationMin == null || b?.durationMin === '' ? null : int(b.durationMin, 5, 1440), capacity: int(b?.capacity ?? 1, 1, 100), depositRub: int(b?.depositRub ?? 0, 0, 100000) ?? 0 } };

};

export const listItems = async (profileId) => {
  const b = await ownBiz(profileId); if (!b) return { items: [] };
  const { rows } = await query(`SELECT * FROM kb_items WHERE business_id = $1 AND status = 'active' ORDER BY sort, created_at DESC LIMIT 500`, [b.id]);
  return { items: rows.map(shapeItem) };
};

export const saveItem = async (profileId, id, body) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const p = parseItem(body ?? {}); if (p.error) return p;
  const v = p.v;
  if (v.stock != null && v.kind === 'service') v.stock = null;   // у услуги остатка нет — доступность задаёт расписание
  if (id) {
    const { rowCount } = await query(`UPDATE kb_items SET title=$3, description=$4, price_rub=$5, category=$6, sku=$7, variants=$8::jsonb, lead_time=$9, available=$10, sort=$11, kind=$12, stock=$13, duration_min=$14, capacity=$15, deposit_rub=$16, updated_at=now() WHERE id=$1 AND business_id=$2 AND status='active'`,
      [String(id), b.id, v.title, v.description, v.price, v.category, v.sku, JSON.stringify(v.variants), v.leadTime, v.available, v.sort, v.kind, v.stock, v.kind === 'service' ? v.durationMin : null, v.capacity, v.kind === 'service' ? Math.min(v.depositRub, v.price) : 0]);
    if (!rowCount) return err('not_found');
    await audit(b.id, profileId, 'item_updated', v.title);
    return { ok: true, id };
  }
  const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM kb_items WHERE business_id = $1 AND status = 'active'`, [b.id]);
  if (cnt[0].n >= 500) return err('too_many_items');
  const nid = newId('kbi');
  await query(`INSERT INTO kb_items (id, business_id, title, description, price_rub, category, sku, variants, lead_time, available, sort, kind, stock, duration_min, capacity, deposit_rub) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [nid, b.id, v.title, v.description, v.price, v.category, v.sku, JSON.stringify(v.variants), v.leadTime, v.available, v.sort, v.kind, v.stock, v.kind === 'service' ? v.durationMin : null, v.capacity, v.kind === 'service' ? Math.min(v.depositRub, v.price) : 0]);
  await audit(b.id, profileId, 'item_created', v.title);
  return { ok: true, id: nid };
};

export const archiveItem = async (profileId, id) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const { rows } = await query(`UPDATE kb_items SET status = 'archived', updated_at = now() WHERE id = $1 AND business_id = $2 AND status = 'active' RETURNING title`, [String(id ?? ''), b.id]);
  if (!rows[0]) return err('not_found');
  await audit(b.id, profileId, 'item_archived', rows[0].title);
  return { ok: true };
};

const saveMedia = async (businessId, kind, dataUrl) => {
  const img = imageFromDataUrl(dataUrl); if (img.error) return img;
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM kb_media WHERE business_id = $1', [businessId]);
  if (cnt[0].n >= 1000) return err('too_many_media');
  const id = newId('kbm');
  await query('INSERT INTO kb_media (id, business_id, kind, data, mime) VALUES ($1,$2,$3,$4,$5)', [id, businessId, kind, img.buf, img.mime]);
  return { id };
};

export const setItemPhoto = async (profileId, itemId, dataUrl) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const { rows } = await query(`SELECT id FROM kb_items WHERE id = $1 AND business_id = $2 AND status = 'active'`, [String(itemId ?? ''), b.id]);
  if (!rows[0]) return err('not_found');
  const m = await saveMedia(b.id, 'item', dataUrl); if (m.error) return m;
  await query('UPDATE kb_items SET media_id = $2, updated_at = now() WHERE id = $1', [rows[0].id, m.id]);
  return { ok: true, photoUrl: `/api/kbiz/public/media/${m.id}` };
};

/** Изображение отдаётся публично, но только у действующего бизнеса. */
export const mediaOf = async (id) => {
  const { rows } = await query(`SELECT m.data, m.mime FROM kb_media m JOIN kb_businesses b ON b.id = m.business_id WHERE m.id = $1 AND b.status = 'active'`, [String(id ?? '')]);
  return rows[0] ? { data: rows[0].data, type: rows[0].mime } : null;
};

/* ─── Витрина: настройки владельца ─── */

export const getShop = async (profileId) => {
  const { rows } = await query('SELECT shop_slug, shop_enabled, shop_origins, shop_notice FROM kb_businesses WHERE id = kb_cur_biz($1)', [profileId]);
  if (!rows[0]) return { shop: null };
  const r = rows[0];
  return { shop: { slug: r.shop_slug, enabled: r.shop_enabled, origins: r.shop_origins ?? [], notice: r.shop_notice, url: r.shop_slug ? `${payOrigin()}/s/${r.shop_slug}` : null, apiBase: payOrigin() } };
};

export const setShop = async (profileId, body) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const slug = clean(body?.slug, 40).toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED.has(slug) || slug.includes('--')) return err('bad_field', { field: 'slug' });
  const origins = [];
  for (const o of Array.isArray(body?.origins) ? body.origins.slice(0, 5) : []) {
    const t = clean(o, 200); if (!t) continue;
    try { const u = new URL(t); if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return err('bad_field', { field: 'origins' }); origins.push(u.origin); } catch { return err('bad_field', { field: 'origins' }); }
  }
  try {
    await query('UPDATE kb_businesses SET shop_slug = $2, shop_enabled = $3, shop_origins = $4, shop_notice = $5, updated_at = now() WHERE id = $1', [b.id, slug, body?.enabled === true, [...new Set(origins)], clean(body?.notice, 300)]);
  } catch (e) { if (e.code === '23505') return err('slug_taken'); throw e; }
  await audit(b.id, profileId, 'shop_updated', `${slug}${body?.enabled === true ? ' · включена' : ' · выключена'} · сайтов: ${origins.length}`);
  return { ok: true };
};

/* ─── Витрина: публичная часть ─── */

const shopBiz = async (slug) => (await query(
  `SELECT id, name, description, contacts, website, status, owner_id, shop_enabled, shop_origins, shop_notice, (logo IS NOT NULL) AS has_logo FROM kb_businesses WHERE shop_slug = $1`, [String(slug ?? '').toLowerCase()])).rows[0] ?? null;

/** Для CORS предварительного запроса: этот Origin указан хотя бы у одной витрины (или это сам сайт Sky). */
export const knownShopOrigin = async (origin) => {
  if (!origin) return false;
  if (origin === payOrigin()) return true;
  const { rows } = await query('SELECT 1 FROM kb_businesses WHERE shop_enabled AND $1 = ANY(shop_origins) LIMIT 1', [origin]);
  return Boolean(rows[0]);
};
const originOk = (b, origin) => !origin || origin === payOrigin() || (b.shop_origins ?? []).includes(origin);

export const shopPublic = async (slug, origin) => {
  const b = await shopBiz(slug);
  if (!b || !b.shop_enabled) return err('not_found');
  if (!originOk(b, origin)) return err('origin_not_allowed');
  const base = { business: { name: b.name, description: b.description, contacts: b.contacts || undefined, website: b.website || undefined, logoUrl: b.has_logo ? `/api/kbiz/public/logo/${b.id}` : null }, notice: b.shop_notice || undefined };
  if (b.status === 'suspended') return { ...base, state: 'suspended', items: [] };
  const sub = await subState(b.id);
  const { rows: rq } = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [b.id]);
  if (b.status !== 'active' || !sub.active || !rq[0]) return { ...base, state: 'unavailable', items: [] };
  const { rows } = await query(`SELECT * FROM kb_items WHERE business_id = $1 AND status = 'active' AND available ORDER BY sort, created_at DESC LIMIT 500`, [b.id]);
  const items = rows.map((r) => { const x = shapeItem(r); delete x.status; delete x.sort; delete x.available; return x; });
  const reviews = await publicReviews(b.id);
  return { ...base, state: 'open', reviews, items, categories: [...new Set(items.map((i) => i.category).filter(Boolean))] };
};

const parseContact = (c) => {
  const name = clean(c?.name, 80); if (name.length < 2) return err('bad_field', { field: 'name' });
  const phone = clean(c?.phone, 30); if (!/^[0-9+() -]{5,30}$/.test(phone)) return err('bad_field', { field: 'phone' });
  const email = clean(c?.email, 120); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err('bad_field', { field: 'email' });
  return { v: { name, phone, email, address: clean(c?.address, 200) } };
};

/** Предпросмотр скидки по промокоду для корзины (то же вычисление, что и при заказе; расход не списывается). */
export const promoPreview = async (slug, body, origin) => {
  const b = await shopBiz(slug);
  if (!b || !b.shop_enabled) return err('not_found');
  if (!originOk(b, origin)) return err('origin_not_allowed');
  const raw = Array.isArray(body?.items) ? body.items.slice(0, 30) : [];
  const ids = [...new Set(raw.map((x) => String(x?.id ?? '')))];
  const { rows: items } = await query(`SELECT * FROM kb_items WHERE business_id = $1 AND id = ANY($2) AND status = 'active' AND available`, [b.id, ids]);
  const byId = new Map(items.map((r) => [r.id, r])); let subtotal = 0;
  for (const x of raw) {
    const it = byId.get(String(x?.id ?? '')); const qty = int(x?.qty, 1, 99); if (!it || qty == null) return err('item_unavailable');
    let price = it.price_rub; if (x?.variant) { const v = (it.variants ?? []).find((y) => y.name === String(x.variant)); if (v?.priceRub) price = v.priceRub; }
    subtotal += qty * price;
  }
  const pc = await promoCheck(b.id, body?.promo, subtotal); if (pc.error) return pc;
  if (pc.none) return err('promo_invalid');
  return { ok: true, code: pc.code, subtotalRub: subtotal, discountRub: pc.discount, totalRub: subtotal - pc.discount };
};

/** Заказ покупателя. Цены и сумму считает сервер по каталогу; создаётся платёжная страница на 48 часов. */
export const createOrder = async (slug, body, ip, origin) => {
  const b = await shopBiz(slug);
  if (!b || !b.shop_enabled) return err('not_found');
  if (!originOk(b, origin)) return err('origin_not_allowed');
  return createOrderCore(b, body, ip, origin, null);
};

/** Общая часть заказа: витрина (гость) и Sky GO «Организации» (buyerProfileId). Цены, остатки и сумма — только по данным сервера. */
export const createOrderCore = async (b, body, ip, origin, buyerProfileId) => {
  const sub = await subState(b.id);
  const { rows: rq } = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [b.id]);
  if (b.status !== 'active' || !sub.active || !rq[0]) return err('shop_unavailable');
  const raw = Array.isArray(body?.items) ? body.items.slice(0, 30) : [];
  if (!raw.length) return err('empty_cart');
  const c = parseContact(body?.contact); if (c.error) return c;
  const ids = [...new Set(raw.map((x) => String(x?.id ?? '')))];
  const { rows: items } = await query(`SELECT * FROM kb_items WHERE business_id = $1 AND id = ANY($2) AND status = 'active' AND available`, [b.id, ids]);
  const byId = new Map(items.map((r) => [r.id, r]));
  const lines = []; let total = 0;
  for (const x of raw) {
    const it = byId.get(String(x?.id ?? '')); if (!it) return err('item_unavailable', { id: String(x?.id ?? '') });
    const qty = int(x?.qty, 1, 99); if (qty == null) return err('bad_field', { field: 'qty' });
    let price = it.price_rub; let variant = '';
    if (x?.variant) { const v = (it.variants ?? []).find((y) => y.name === String(x.variant)); if (!v) return err('bad_field', { field: 'variant' }); variant = v.name; if (v.priceRub) price = v.priceRub; }
    else if ((it.variants ?? []).length) return err('variant_required', { id: it.id });
    if (it.stock != null && it.stock < qty) return err('out_of_stock', { id: it.id, left: it.stock });
    lines.push({ itemId: it.id, title: it.title, variant, qty, priceRub: price, kind: it.kind ?? 'product' }); total += qty * price;
  }
  if (total < 1 || total > MAX_AMOUNT) return err('bad_amount');
  const subtotal = total;
  const pc = await promoCheck(b.id, body?.promo, subtotal); if (pc.error) return pc;
  const discount = pc.none ? 0 : pc.discount; total = subtotal - discount;
  const h = ipHash(ip);
  const { rows: lim } = await query(`SELECT count(*) FILTER (WHERE ip_hash = $1 AND created_at > now() - interval '1 hour')::int AS ip_n, count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS day_n FROM kb_orders WHERE business_id = $2`, [h, b.id]);
  if (lim[0].ip_n >= 5 || lim[0].day_n >= 300) return err('too_many_requests');
  const id = newId('kbo'); const key = crypto.randomBytes(18).toString('base64url');
  let res;
  try { res = await inTx(async (cl) => {
    await cl.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kbord:${b.id}`]);
    if (!pc.none) {   // расход промокода списывается атомарно: последний экземпляр достаётся одному заказу
      const { rowCount } = await cl.query(`UPDATE kb_promos SET used = used + 1 WHERE id = $1 AND status = 'active' AND (max_uses IS NULL OR used < max_uses)`, [pc.promo.id]);
      if (!rowCount) throw Object.assign(new Error('promo_exhausted'), { kbErr: 'promo_exhausted' });
    }
    // Остаток списывается атомарно: двое за последний экземпляр не пройдут. Повтор одной позиции в корзине суммируется.
    const need = new Map(); for (const l of lines) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty);
    for (const [itemId, q] of need) {
      const r = await cl.query('UPDATE kb_items SET stock = stock - $2 WHERE id = $1 AND stock IS NOT NULL AND stock >= $2', [itemId, q]);
      if (!r.rowCount) { const chk = await cl.query('SELECT stock FROM kb_items WHERE id = $1', [itemId]); if (chk.rows[0]?.stock != null) throw Object.assign(new Error('out_of_stock'), { kbErr: 'out_of_stock' }); }
    }
    const { rows: n } = await cl.query('SELECT COALESCE(max(number), 0) + 1 AS n FROM kb_orders WHERE business_id = $1', [b.id]);
    const number = n[0].n;
    const qid = newId('kbq'); const pid = publicId();
    await cl.query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, expires_at, config) VALUES ($1,$2,$3,'order',$4,'',$5,$6, now() + interval '48 hours', $7::jsonb)`,
      [qid, pid, b.id, `Заказ № ${number}`, total, String(number), JSON.stringify({ orderId: id, number, lines, discountRub: discount })]);
    await cl.query(`INSERT INTO kb_orders (id, business_id, number, lines, total_rub, contact_enc, note, qr_id, buyer_key_hash, ip_hash, origin, promo_code, discount_rub, subtotal_rub, buyer_profile_id, source) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, b.id, number, JSON.stringify(lines), total, sealJson(c.v), clean(body?.note, 300), qid, keyHash(key), h, String(origin ?? '').slice(0, 200), pc.none ? '' : pc.code, discount, subtotal, buyerProfileId, buyerProfileId ? 'gonet' : 'shop']);
    return { number, pid };
  }); } catch (e) { if (e.kbErr) return err(e.kbErr); throw e; }
  await notifyGift(b.owner_id, 'kassa_biz', 'Новый заказ', `Заказ № ${res.number} на ${total} ₽. Подтвердите его в SkyKassa Business.`, `kbo:${id}`).catch(() => {});
  return { ok: true, id, number: res.number, key, totalRub: total, subtotalRub: subtotal, discountRub: discount, payUrl: payUrl(res.pid), payPublicId: res.pid };
};

export const buyerOrder = async (id, key) => {
  const { rows } = await query(
    `SELECT o.number, o.status, o.total_rub, b.name, (SELECT 1 FROM kb_reviews r WHERE r.order_id = o.id) AS reviewed, (SELECT p.status FROM kb_payments p WHERE p.qr_id = o.qr_id ORDER BY p.created_at DESC LIMIT 1) AS pay_status, q.public_id
       FROM kb_orders o JOIN kb_businesses b ON b.id = o.business_id LEFT JOIN kb_qr q ON q.id = o.qr_id WHERE o.id = $1 AND o.buyer_key_hash = $2`, [String(id ?? ''), keyHash(key)]);
  if (!rows[0]) return err('not_found');
  return { number: rows[0].number, status: rows[0].status, statusLabel: ORDER_LABEL[rows[0].status], totalRub: rows[0].total_rub, business: rows[0].name,
    reviewed: Boolean(rows[0].reviewed), payment: rows[0].pay_status ?? null, payUrl: rows[0].public_id ? payUrl(rows[0].public_id) : null };
};

/* ─── Заказы (владелец) ─── */

const shapeOrder = (r) => ({ id: r.id, number: r.number, lines: r.lines, totalRub: r.total_rub, contact: openJson(r.contact_enc), note: r.note, status: r.status, statusLabel: ORDER_LABEL[r.status],
  ownerComment: r.owner_comment, promoCode: r.promo_code || undefined, discountRub: r.discount_rub || 0, subtotalRub: r.subtotal_rub ?? r.total_rub, createdAt: r.created_at.toISOString(), payUrl: r.public_id ? payUrl(r.public_id) : null, payExpired: Boolean(r.qr_expires && r.qr_expires <= new Date()),
  paymentStatus: r.pay_status ?? null });

export const listOrders = async (profileId, { status } = {}) => {
  const b = await ownBiz(profileId); if (!b) return { orders: [] };
  const vals = [b.id]; let w = 'o.business_id = $1';
  if (status && Object.hasOwn(ORDER_LABEL, status)) { vals.push(status); w += ` AND o.status = $2`; }
  const { rows } = await query(
    `SELECT o.*, q.public_id, q.expires_at AS qr_expires, (SELECT p.status FROM kb_payments p WHERE p.qr_id = o.qr_id ORDER BY p.created_at DESC LIMIT 1) AS pay_status
       FROM kb_orders o LEFT JOIN kb_qr q ON q.id = o.qr_id WHERE ${w} ORDER BY o.created_at DESC LIMIT 200`, vals);
  return { orders: rows.map(shapeOrder) };
};

export const actOnOrder = async (profileId, id, action, comment) => {
  const t = ORDER_ACT[action]; if (!t) return err('bad_action');
  let buyerNote = null;
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT o.id, o.status, o.business_id, o.number FROM kb_orders o JOIN kb_businesses b ON b.id = o.business_id WHERE o.id = $1 AND b.id = kb_cur_biz($2) FOR UPDATE OF o', [String(id ?? ''), profileId]);
    if (!rows[0]) return err('not_found');
    if (rows[0].status === t.to) return { ok: true, duplicate: true, status: t.to };
    if (!t.from.includes(rows[0].status)) return err('bad_state', { status: rows[0].status });
    const note = clean(comment, 300);
    if (t.comment && note.length < 3) return err('comment_required');
    await c.query(`UPDATE kb_orders SET status = $2, owner_comment = CASE WHEN $3 = '' THEN owner_comment ELSE $3 END, updated_at = now() WHERE id = $1`, [rows[0].id, t.to, note]);
    if (t.to === 'rejected' || t.to === 'cancelled') await returnStock(c, rows[0].id);
    buyerNote = { id: rows[0].id, number: rows[0].number, to: t.to, note };
    // Отклонённый/отменённый заказ закрывает его платёжную страницу: по ней больше нельзя сообщить об оплате.
    if (t.to === 'rejected' || t.to === 'cancelled') await c.query(`UPDATE kb_qr SET status = 'disabled', updated_at = now() WHERE id = (SELECT qr_id FROM kb_orders WHERE id = $1) AND status = 'active'`, [rows[0].id]);
    await c.query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [rows[0].business_id, (String(profileId).startsWith('biz:') ? 'staff' : profileId), `order_${action}`, `№ ${rows[0].number}`]);
    return { ok: true, status: t.to, statusLabel: ORDER_LABEL[t.to] };
  });
  if (buyerNote && out.ok && !out.duplicate) void notifyBuyerOrder(buyerNote.id, buyerNote.number, buyerNote.to, buyerNote.note);
  return out;
};

/** Новая платёжная ссылка по заказу (прежняя истекла или отключена). Сумма — из заказа, а не из запроса. */
export const renewOrderPay = async (profileId, id) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const sub = await subState(b.id); if (!sub.active) return err('subscription_required');
  const { rows } = await query(`SELECT id, number, lines, total_rub, status FROM kb_orders WHERE id = $1 AND business_id = $2`, [String(id ?? ''), b.id]);
  if (!rows[0]) return err('not_found');
  if (['rejected', 'cancelled', 'done'].includes(rows[0].status)) return err('bad_state', { status: rows[0].status });
  const qid = newId('kbq'); const pid = publicId();
  await inTx(async (c) => {
    await c.query(`UPDATE kb_qr SET status = 'disabled' WHERE id = (SELECT qr_id FROM kb_orders WHERE id = $1) AND status = 'active'`, [rows[0].id]);
    await c.query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, amount_rub, order_no, expires_at, config) VALUES ($1,$2,$3,'order',$4,$5,$6, now() + interval '48 hours', $7::jsonb)`,
      [qid, pid, b.id, `Заказ № ${rows[0].number}`, rows[0].total_rub, String(rows[0].number), JSON.stringify({ orderId: rows[0].id, number: rows[0].number, lines: rows[0].lines })]);
    await c.query('UPDATE kb_orders SET qr_id = $2, updated_at = now() WHERE id = $1', [rows[0].id, qid]);
  });
  await audit(b.id, profileId, 'order_pay_renewed', `№ ${rows[0].number}`);
  return { ok: true, payUrl: payUrl(pid) };
};

/* ─── Чаевые ─── */

export const createTip = async (profileId, body) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const sub = await subState(b.id); if (!sub.active) return err('subscription_required');
  const recipient = clean(body?.recipient, 60); if (recipient.length < 2) return err('bad_field', { field: 'recipient' });
  const amounts = [...new Set((Array.isArray(body?.amounts) && body.amounts.length ? body.amounts : [50, 100, 200]).slice(0, 6).map((x) => int(x, 1, 100000)))];
  if (amounts.some((x) => x == null)) return err('bad_field', { field: 'amounts' });
  const min = int(body?.min ?? 10, 1, 100000); const max = int(body?.max ?? 50000, 1, MAX_AMOUNT);
  if (min == null || max == null || min > max) return err('bad_field', { field: 'min' });
  let mediaId = null;
  if (body?.photo) { const m = await saveMedia(b.id, 'tip', body.photo); if (m.error) return m; mediaId = m.id; }
  const id = newId('kbq');
  await query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, instruction, config, created_by) VALUES ($1,$2,$3,'tip',$4,'',$5,$6::jsonb,$7)`,
    [id, publicId(), b.id, `Чаевые: ${recipient}`, clean(body?.instruction, 300), JSON.stringify({ recipient, message: clean(body?.message, 200), amounts, allowCustom: body?.allowCustom !== false, min, max, mediaId }), profileId]);
  await audit(b.id, profileId, 'tip_created', recipient);
  return { ok: true, id };
};

export const listTips = async (profileId) => {
  const b = await ownBiz(profileId); if (!b) return { tips: [], stats: null };
  const { rows } = await query(
    `SELECT q.id, q.public_id, q.title, q.status, q.config, q.created_at,
            (SELECT count(*)::int FROM kb_qr_opens o WHERE o.qr_id = q.id) AS opens,
            (SELECT count(*)::int FROM kb_payments p WHERE p.qr_id = q.id AND p.status <> 'created') AS requests,
            (SELECT count(*)::int FROM kb_payments p WHERE p.qr_id = q.id AND p.status = 'confirmed') AS confirmed,
            (SELECT COALESCE(SUM(amount_rub), 0)::int FROM kb_payments p WHERE p.qr_id = q.id AND p.currency = 'RUB' AND p.status = 'confirmed') AS confirmed_sum
       FROM kb_qr q WHERE q.business_id = $1 AND q.kind = 'tip' AND q.status <> 'archived' ORDER BY q.created_at DESC LIMIT 100`, [b.id]);
  const { rows: s } = await query(
    `SELECT count(*) FILTER (WHERE p.status <> 'created')::int AS requests, count(*) FILTER (WHERE p.status = 'confirmed')::int AS confirmed,
            COALESCE(SUM(p.amount_rub) FILTER (WHERE p.currency = 'RUB' AND p.status = 'confirmed'), 0)::int AS confirmed_sum
       FROM kb_payments p JOIN kb_qr q ON q.id = p.qr_id WHERE q.business_id = $1 AND q.kind = 'tip'`, [b.id]);
  const { rows: d } = await query(
    `SELECT to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS requests, COALESCE(SUM(p.amount_rub) FILTER (WHERE p.currency = 'RUB' AND p.status = 'confirmed'), 0)::int AS confirmed_sum
       FROM kb_payments p JOIN kb_qr q ON q.id = p.qr_id WHERE q.business_id = $1 AND q.kind = 'tip' AND p.created_at > now() - interval '30 days' AND p.status <> 'created' GROUP BY 1 ORDER BY 1`, [b.id]);
  return {
    tips: rows.map((r) => ({ id: r.id, publicId: r.public_id, title: r.title, status: r.status, recipient: r.config?.recipient, message: r.config?.message, amounts: r.config?.amounts, allowCustom: r.config?.allowCustom !== false,
      min: r.config?.min, max: r.config?.max, url: payUrl(r.public_id), opens: r.opens, requests: r.requests, confirmed: r.confirmed, confirmedSumRub: r.confirmed_sum })),
    stats: { requests: s[0].requests, confirmed: s[0].confirmed, confirmedSumRub: s[0].confirmed_sum, averageRub: s[0].confirmed ? Math.round(s[0].confirmed_sum / s[0].confirmed) : 0, byDay: d.map((x) => ({ day: x.day, requests: x.requests, confirmedSumRub: x.confirmed_sum })) },
  };
};

/* ─── Счета ─── */

const parseInvoice = (b) => {
  const lines = []; let subtotal = 0;
  for (const l of Array.isArray(b?.lines) ? b.lines.slice(0, 50) : []) {
    const title = clean(l?.title, 120); if (!title) continue;
    const qty = int(l?.qty ?? 1, 1, 9999); const price = int(l?.priceRub, 1, MAX_AMOUNT); const disc = int(l?.discountRub ?? 0, 0, MAX_AMOUNT);
    if (qty == null || price == null || disc == null) return err('bad_field', { field: 'lines' });
    const sum = qty * price - disc; if (sum < 1) return err('bad_field', { field: 'lines' });
    lines.push({ title, qty, priceRub: price, discountRub: disc }); subtotal += sum;
  }
  if (!lines.length) return err('bad_field', { field: 'lines' });
  const discount = int(b?.discountRub ?? 0, 0, MAX_AMOUNT); if (discount == null) return err('bad_field', { field: 'discountRub' });
  const total = subtotal - discount; if (total < 1 || total > MAX_AMOUNT) return err('bad_field', { field: 'discountRub' });
  let due = null; if (b?.dueAt) { due = new Date(b.dueAt); if (Number.isNaN(due.getTime()) || due <= new Date()) return err('bad_field', { field: 'dueAt' }); }
  return { v: { lines, subtotal, discount, total, due, orderNo: clean(b?.orderNo, 40), comment: clean(b?.comment, 300) } };
};

export const listInvoices = async (profileId) => {
  const b = await ownBiz(profileId); if (!b) return { invoices: [] };
  const { rows } = await query(
    `SELECT i.*, q.public_id, q.expires_at AS qr_expires,
            (SELECT bool_or(p.status = 'confirmed') FROM kb_payments p WHERE p.qr_id = i.qr_id) AS paid,
            (SELECT bool_or(p.status IN ('reported','pending_check')) FROM kb_payments p WHERE p.qr_id = i.qr_id) AS reported
       FROM kb_invoices i LEFT JOIN kb_qr q ON q.id = i.qr_id WHERE i.business_id = $1 ORDER BY i.number DESC LIMIT 200`, [b.id]);
  return { invoices: rows.map((r) => {
    let status = r.status;
    if (r.status === 'sent') status = r.paid ? 'confirmed' : r.reported ? 'reported' : (r.due_at ?? r.qr_expires) && (r.due_at ?? r.qr_expires) <= new Date() ? 'expired' : 'sent';
    return { id: r.id, number: r.number, lines: r.lines, subtotalRub: r.subtotal_rub, discountRub: r.discount_rub, totalRub: r.total_rub, dueAt: r.due_at?.toISOString?.() ?? null, orderNo: r.order_no, comment: r.comment,
      status, statusLabel: INVOICE_LABEL[status], url: r.public_id ? payUrl(r.public_id) : null, createdAt: r.created_at.toISOString() };
  }) };
};

export const createInvoice = async (profileId, body) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const sub = await subState(b.id); if (!sub.active) return err('subscription_required');
  const p = parseInvoice(body ?? {}); if (p.error) return p;
  const v = p.v; const id = newId('kbv');
  const number = await inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kbinv:${b.id}`]);
    const { rows: n } = await c.query('SELECT COALESCE(max(number), 0) + 1 AS n FROM kb_invoices WHERE business_id = $1', [b.id]);
    await c.query(`INSERT INTO kb_invoices (id, business_id, number, lines, subtotal_rub, discount_rub, total_rub, due_at, order_no, comment) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)`,
      [id, b.id, n[0].n, JSON.stringify(v.lines), v.subtotal, v.discount, v.total, v.due, v.orderNo, v.comment]);
    return n[0].n;
  });
  await audit(b.id, profileId, 'invoice_created', `№ ${number}: ${v.total} ₽`);
  return { ok: true, id, number };
};

export const updateInvoice = async (profileId, id, body) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const p = parseInvoice(body ?? {}); if (p.error) return p;
  const v = p.v;
  const { rowCount } = await query(`UPDATE kb_invoices SET lines=$3::jsonb, subtotal_rub=$4, discount_rub=$5, total_rub=$6, due_at=$7, order_no=$8, comment=$9, updated_at=now() WHERE id=$1 AND business_id=$2 AND status='draft'`,
    [String(id ?? ''), b.id, JSON.stringify(v.lines), v.subtotal, v.discount, v.total, v.due, v.orderNo, v.comment]);
  return rowCount ? { ok: true } : err('bad_state');
};

/** Отправить счёт: создаёт платёжную страницу на сумму счёта. После отправки счёт не редактируется. */
export const sendInvoice = async (profileId, id) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const sub = await subState(b.id); if (!sub.active) return err('subscription_required');
  const { rows: rq } = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [b.id]);
  if (!rq[0]) return err('requisites_required');
  return inTx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM kb_invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`, [String(id ?? ''), b.id]);
    const r = rows[0]; if (!r) return err('not_found');
    if (r.status === 'sent' && r.qr_id) { const { rows: q } = await c.query('SELECT public_id FROM kb_qr WHERE id = $1', [r.qr_id]); return { ok: true, duplicate: true, url: payUrl(q[0].public_id) }; }
    if (r.status !== 'draft') return err('bad_state', { status: r.status });
    const qid = newId('kbq'); const pid = publicId();
    await c.query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, instruction, expires_at, config) VALUES ($1,$2,$3,'invoice',$4,$5,$6,$7,'',COALESCE($8, now() + interval '30 days'),$9::jsonb)`,
      [qid, pid, b.id, `Счёт № ${r.number}`, r.comment, r.total_rub, r.order_no || String(r.number), r.due_at, JSON.stringify({ invoiceId: r.id, number: r.number, lines: r.lines, discountRub: r.discount_rub })]);
    await c.query(`UPDATE kb_invoices SET status = 'sent', qr_id = $2, updated_at = now() WHERE id = $1`, [r.id, qid]);
    await c.query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [b.id, (String(profileId).startsWith('biz:') ? 'staff' : profileId), 'invoice_sent', `№ ${r.number}: ${r.total_rub} ₽`]);
    return { ok: true, url: payUrl(pid) };
  });
};

export const cancelInvoice = async (profileId, id) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  return inTx(async (c) => {
    const { rows } = await c.query(`SELECT id, number, status, qr_id FROM kb_invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`, [String(id ?? ''), b.id]);
    const r = rows[0]; if (!r) return err('not_found');
    if (r.status === 'cancelled') return { ok: true, duplicate: true };
    const { rows: paid } = r.qr_id ? await c.query(`SELECT 1 FROM kb_payments WHERE qr_id = $1 AND status = 'confirmed'`, [r.qr_id]) : { rows: [] };
    if (paid[0]) return err('bad_state', { status: 'confirmed' });          // оплаченный счёт не отменяют: нужен возврат по заявке
    await c.query(`UPDATE kb_invoices SET status = 'cancelled', updated_at = now() WHERE id = $1`, [r.id]);
    if (r.qr_id) await c.query(`UPDATE kb_qr SET status = 'disabled', updated_at = now() WHERE id = $1`, [r.qr_id]);
    await c.query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [b.id, (String(profileId).startsWith('biz:') ? 'staff' : profileId), 'invoice_cancelled', `№ ${r.number}`]);
    return { ok: true };
  });
};

/** Счёт из заказа: строки и сумма берутся из заказа (черновик, дальше — обычный счёт). */
export const invoiceFromOrder = async (profileId, orderId) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const { rows } = await query('SELECT number, lines FROM kb_orders WHERE id = $1 AND business_id = $2', [String(orderId ?? ''), b.id]);
  if (!rows[0]) return err('not_found');
  return createInvoice(profileId, { orderNo: String(rows[0].number), lines: rows[0].lines.map((l) => ({ title: l.variant ? `${l.title} (${l.variant})` : l.title, qty: l.qty, priceRub: l.priceRub })) });
};

/* ─── Sky GO: остатки и уведомления покупателю ─── */

/** Вернуть списанный остаток (отказ/отмена заказа). Один раз на заказ (stock_returned). */
export const returnStock = async (c, orderId) => {
  const { rows } = await c.query('UPDATE kb_orders SET stock_returned = TRUE WHERE id = $1 AND NOT stock_returned RETURNING lines', [orderId]);
  if (!rows[0]) return;
  for (const l of rows[0].lines ?? []) await c.query('UPDATE kb_items SET stock = stock + $2 WHERE id = $1 AND stock IS NOT NULL', [l.itemId, Number(l.qty) || 0]);
};

const BUYER_TEXT = { confirmed: 'принят', rejected: 'отклонён', in_progress: 'выполняется', ready: 'готов к выдаче', done: 'завершён', cancelled: 'отменён' };
/** Уведомление покупателю Sky GO о смене статуса; повторная обработка того же статуса не шлёт второго (ref + статус). */
export const notifyBuyerOrder = async (orderId, number, to, note = '') => {
  try {
    const { rows } = await query('SELECT o.buyer_profile_id, b.name FROM kb_orders o JOIN kb_businesses b ON b.id = o.business_id WHERE o.id = $1', [orderId]);
    const buyer = rows[0]?.buyer_profile_id; if (!buyer) return;
    const ref = `kbo:${orderId}:${to}`;
    const dup = await query('SELECT 1 FROM gift_notifications WHERE user_id = $1 AND ref_id = $2 LIMIT 1', [buyer, ref]);
    if (dup.rows[0]) return;
    await notifyGift(buyer, 'go_place_order', `Заказ № ${number}: ${BUYER_TEXT[to] ?? to}`, `${rows[0].name}${note ? ` — ${note}` : ''}`, ref);
  } catch { /* уведомление не должно ломать заказ */ }
};
