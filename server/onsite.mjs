/**
 * Sky Market — «На месте»: продажа вещей с осмотром на месте в городе, области или стране.
 *
 * Что это и чем НЕ является:
 *  - Это объявления людей и встречи. Sky деньги за вещь НЕ принимает, не удерживает и не возвращает — расчёт при встрече
 *    напрямую между людьми. Товар Sky не проверяет и не хранит (как и в остальном Market, это продуктовая политика, не юридическая оценка).
 *  - Радиус встречи (scope) задаёт продавец: city — только в его городе, region — в любом городе его области, country — по стране.
 *    Покупатель видит то, до чего может дотянуться (reach: свой город / + область / + страна).
 *  - Сделка: покупатель просит осмотр → продавец принимает (назначает время и место, объявление «забронировано», покупатель
 *    получает разовый код встречи) → на встрече продавец вводит код покупателя («встретились») → обе стороны подтверждают
 *    «сделка состоялась» либо покупатель/продавец отмечает «не состоялась/не подошло» (объявление снова в продаже).
 *  - Запрещённые к продаже категории (оружие, лекарства, алкоголь, табак, документы, животные и т. п.) в списке категорий отсутствуют;
 *    жалобы разбирает сотрудник с правом market_moderation.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { newId, inTx, clean, notifyGo, sealJson, openJson, goLog } from './gocore.mjs';
import { config } from './config.mjs';

export const CATEGORIES = ['electronics', 'home', 'furniture', 'clothes', 'kids', 'auto_parts', 'sport', 'hobby', 'books', 'tools', 'garden', 'other'];
export const CONDITIONS = ['new', 'like_new', 'used', 'for_parts'];
export const SCOPES = ['city', 'region', 'country'];
const MAX_PHOTOS = 6; const MAX_PHOTO = 4 * 1024 * 1024; const MAX_LISTINGS = 20; const MAX_OPEN_DEALS = 10;
const REQUEST_TTL_H = 48; const MEET_GRACE_H = 24; const AUTO_DONE_H = 72;
const REPORT_REASONS = ['forbidden', 'fraud', 'wrong_info', 'spam', 'other'];

const key = (v) => clean(v, 80).toLowerCase().replace(/ё/g, 'е');
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const sha = (s) => crypto.createHmac('sha256', config.jwtSecret ?? 'onsite').update(String(s)).digest('hex');
const sniffImage = (b) => {
  if (!b || b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
};
const photoIds = async (id) => (await query('SELECT id FROM onsite_photos WHERE listing_id = $1 ORDER BY sort, created_at', [id])).rows.map((r) => r.id);

export const meta = () => ({ categories: CATEGORIES, conditions: CONDITIONS, scopes: SCOPES, maxPhotos: MAX_PHOTOS, maxListings: MAX_LISTINGS,
  note: 'Sky не принимает деньги за вещь и не проверяет её: осмотр и расчёт происходят при встрече между людьми.' });

/* ─── Рейтинг продавца: только настоящие оценки после состоявшихся сделок ─── */
const ratingOf = async (profileId) => {
  const { rows } = await query('SELECT count(*)::int AS n, round(avg(rating)::numeric, 1)::float AS avg FROM onsite_reviews WHERE about_id = $1', [profileId]);
  const { rows: deals } = await query(`SELECT count(*)::int AS n FROM onsite_deals WHERE seller_id = $1 AND status = 'completed'`, [profileId]);
  return { reviews: rows[0].n, avg: rows[0].n ? rows[0].avg : null, completedDeals: deals[0].n };
};

const card = async (r, withSeller = false) => ({
  id: r.id, title: r.title, priceRub: r.price_rub, negotiable: r.negotiable, category: r.category, condition: r.condition, status: r.status,
  country: r.country, region: r.region, city: r.city, scope: r.scope, area: r.area, photo: (await photoIds(r.id))[0] ?? null, publishedAt: r.published_at?.toISOString?.() ?? null,
  ...(withSeller ? { seller: { id: r.seller_id, username: r.username, name: r.pname, ...(await ratingOf(r.seller_id)) } } : {}),
});

/* ─── Каталог ─── */
export const catalog = async (viewerId, q) => {
  const country = clean(q.country, 4).toUpperCase() || 'RU';
  const region = key(q.region); const city = key(q.city);
  const reach = SCOPES.includes(q.reach) ? q.reach : 'country';
  const args = [country]; const where = [`l.status IN ('published','reserved')`, 'l.country = $1'];
  // До чего может дотянуться покупатель: свой город — всегда; область — если продавец готов ехать по области; страна — если по стране.
  const parts = [];
  if (city) { args.push(city); parts.push(`l.city_key = $${args.length}`); }
  if (reach !== 'city' && region) { args.push(region); parts.push(`(l.region_key = $${args.length} AND l.scope IN ('region','country'))`); }
  if (reach === 'country') parts.push(`l.scope = 'country'`);
  if (city || region) where.push(`(${parts.join(' OR ') || 'false'})`);
  const cat = String(q.category ?? ''); if (CATEGORIES.includes(cat)) { args.push(cat); where.push(`l.category = $${args.length}`); }
  const text = clean(q.q, 80); if (text) { args.push(`%${text.replace(/[%_\\]/g, '\\$&')}%`); where.push(`(l.title ILIKE $${args.length} OR l.descr ILIKE $${args.length})`); }
  const min = int(q.min, 0, 1e8); if (min !== null && q.min !== '' && q.min != null) { args.push(min); where.push(`l.price_rub >= $${args.length}`); }
  const max = int(q.max, 0, 1e8); if (max !== null && q.max !== '' && q.max != null) { args.push(max); where.push(`l.price_rub <= $${args.length}`); }
  if (viewerId) { args.push(viewerId); where.push(`l.seller_id <> $${args.length}`); }
  const order = q.sort === 'cheap' ? 'l.price_rub ASC, l.published_at DESC' : q.sort === 'expensive' ? 'l.price_rub DESC, l.published_at DESC' : 'l.published_at DESC';
  const lim = Math.min(Math.max(int(q.limit, 1, 60) ?? 30, 1), 60); const off = Math.max(int(q.offset, 0, 1e6) ?? 0, 0);
  args.push(lim, off);
  const { rows } = await query(
    `SELECT l.*, p.username, p.name AS pname FROM onsite_listings l JOIN profiles p ON p.id = l.seller_id WHERE ${where.join(' AND ')}
      ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  return { ok: true, items: await Promise.all(rows.map((r) => card(r, false))), reach };
};

export const getListing = async (viewerId, id) => {
  const { rows } = await query(`SELECT l.*, p.username, p.name AS pname FROM onsite_listings l JOIN profiles p ON p.id = l.seller_id WHERE l.id = $1`, [String(id ?? '')]);
  const l = rows[0]; if (!l) return { error: 'not_found' };
  const own = l.seller_id === viewerId;
  if (!['published', 'reserved'].includes(l.status) && !own) return { error: 'not_found' };
  if (!own) await query('UPDATE onsite_listings SET views = views + 1 WHERE id = $1', [l.id]).catch(() => {});
  const base = await card(l, true);
  let myDeal = null;
  if (viewerId && !own) { const { rows: d } = await query(`SELECT id, status FROM onsite_deals WHERE listing_id = $1 AND buyer_id = $2 ORDER BY created_at DESC LIMIT 1`, [l.id, viewerId]); myDeal = d[0] ?? null; }
  const { rows: rev } = await query(`SELECT r.rating, r.text, r.created_at, p.username FROM onsite_reviews r JOIN profiles p ON p.id = r.author_id WHERE r.about_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [l.seller_id]);
  return { ok: true, listing: { ...base, descr: l.descr, photos: await photoIds(l.id), own, modNote: own ? l.mod_note || undefined : undefined, views: own ? l.views : undefined },
    myDeal, reviews: rev.map((x) => ({ rating: x.rating, text: x.text, at: x.created_at.toISOString(), by: x.username })) };
};

/* ─── Мои объявления ─── */
export const myListings = async (me) => {
  const { rows } = await query(`SELECT l.*, p.username, p.name AS pname,
      (SELECT count(*)::int FROM onsite_deals d WHERE d.listing_id = l.id AND d.status = 'requested') AS requests
      FROM onsite_listings l JOIN profiles p ON p.id = l.seller_id WHERE l.seller_id = $1 AND l.status <> 'removed' ORDER BY l.updated_at DESC`, [me]);
  return { ok: true, items: await Promise.all(rows.map(async (r) => ({ ...(await card(r)), requests: r.requests, modNote: r.mod_note || undefined, views: r.views }))) };
};

const parseListing = (b) => {
  const title = clean(b?.title, 100); if (title.length < 3) return { error: 'title_required' };
  const category = String(b?.category ?? ''); if (!CATEGORIES.includes(category)) return { error: 'bad_category' };
  const condition = CONDITIONS.includes(b?.condition) ? b.condition : 'used';
  const price = int(b?.priceRub, 0, 1e8); if (price === null) return { error: 'bad_price' };
  const scope = String(b?.scope ?? ''); if (!SCOPES.includes(scope)) return { error: 'bad_scope' };
  const country = clean(b?.country, 4).toUpperCase() || 'RU'; if (!/^[A-Z]{2}$/.test(country)) return { error: 'bad_country' };
  const city = clean(b?.city, 80); if (city.length < 2) return { error: 'city_required' };
  const region = clean(b?.region, 80); if (scope !== 'city' && region.length < 2) return { error: 'region_required' };
  return { v: { title, descr: String(b?.descr ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 2000), category, condition, price, negotiable: b?.negotiable === true, scope, country, city, region, area: clean(b?.area, 120) } };
};

export const saveListing = async (me, b) => {
  const p = parseListing(b); if (p.error) return p;
  const v = p.v; const id = b?.id ? String(b.id) : null;
  if (id) {
    const { rows } = await query('SELECT * FROM onsite_listings WHERE id = $1 AND seller_id = $2', [id, me]);
    const cur = rows[0]; if (!cur || cur.status === 'removed') return { error: 'not_found' };
    if (['sold', 'closed'].includes(cur.status)) return { error: 'not_editable' };
    await query(`UPDATE onsite_listings SET title=$2, descr=$3, category=$4, condition=$5, price_rub=$6, negotiable=$7, scope=$8, country=$9, city=$10, region=$11, city_key=$12, region_key=$13, area=$14, updated_at=now() WHERE id=$1`,
      [id, v.title, v.descr, v.category, v.condition, v.price, v.negotiable, v.scope, v.country, v.city, v.region, key(v.city), key(v.region), v.area]);
    return { ok: true, id };
  }
  const { rows: n } = await query(`SELECT count(*)::int AS n FROM onsite_listings WHERE seller_id = $1 AND status IN ('draft','published','reserved')`, [me]);
  if (n[0].n >= MAX_LISTINGS) return { error: 'too_many_listings', max: MAX_LISTINGS };
  const nid = newId('os');
  await query(`INSERT INTO onsite_listings (id, seller_id, title, descr, category, condition, price_rub, negotiable, scope, country, city, region, city_key, region_key, area) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [nid, me, v.title, v.descr, v.category, v.condition, v.price, v.negotiable, v.scope, v.country, v.city, v.region, key(v.city), key(v.region), v.area]);
  return { ok: true, id: nid };
};

const ownRow = async (me, id) => (await query('SELECT * FROM onsite_listings WHERE id = $1 AND seller_id = $2', [String(id ?? ''), me])).rows[0] ?? null;

/** Опубликовать / снять с публикации / закрыть. Публикация требует хотя бы одно фото. */
export const setStatus = async (me, id, action) => {
  const l = await ownRow(me, id); if (!l) return { error: 'not_found' };
  if (l.status === 'removed') return { error: 'removed_by_moderation', note: l.mod_note };
  if (action === 'publish') {
    if (!['draft', 'closed'].includes(l.status)) return { error: 'bad_state', status: l.status };
    if ((await photoIds(l.id)).length < 1) return { error: 'photo_required' };
    await query(`UPDATE onsite_listings SET status = 'published', published_at = coalesce(published_at, now()), updated_at = now() WHERE id = $1`, [l.id]);
    return { ok: true, status: 'published' };
  }
  if (action === 'close') {
    if (!['draft', 'published', 'reserved'].includes(l.status)) return { error: 'bad_state', status: l.status };
    const out = await inTx(async (c) => {
      const { rows: live } = await c.query(`SELECT id, buyer_id FROM onsite_deals WHERE listing_id = $1 AND status IN ('requested','accepted','met') FOR UPDATE`, [l.id]);
      await c.query(`UPDATE onsite_deals SET status = 'cancelled', outcome_note = 'Объявление снято продавцом', closed_at = now(), updated_at = now() WHERE listing_id = $1 AND status IN ('requested','accepted','met')`, [l.id]);
      await c.query(`UPDATE onsite_listings SET status = 'closed', updated_at = now() WHERE id = $1`, [l.id]);
      return { ok: true, buyers: live.map((d) => ({ id: d.id, buyer: d.buyer_id })) };
    });
    for (const d of out.buyers ?? []) await notifyGo(d.buyer, 'onsite', 'Объявление снято', 'Продавец снял объявление, встреча отменена.', d.id, `${d.id}:listing-closed`);
    return { ok: true, status: 'closed' };
  }
  return { error: 'bad_action' };
};

export const removeListing = async (me, id) => {
  const l = await ownRow(me, id); if (!l) return { error: 'not_found' };
  if (['reserved'].includes(l.status)) return { error: 'has_active_deal' };
  const { rows } = await query(`SELECT 1 FROM onsite_deals WHERE listing_id = $1 AND status IN ('requested','accepted','met') LIMIT 1`, [l.id]);
  if (rows[0]) return { error: 'has_active_deal' };
  await query('DELETE FROM onsite_listings WHERE id = $1', [l.id]);
  return { ok: true };
};

/* ─── Фото ─── */
export const addPhoto = async (me, id, bytes) => {
  const l = await ownRow(me, id); if (!l || l.status === 'removed') return { error: 'not_found' };
  if (!bytes || bytes.length > MAX_PHOTO) return { error: 'file_too_large' };
  const mime = sniffImage(bytes); if (!mime) return { error: 'unsupported_type' };
  const { rows } = await query('SELECT count(*)::int AS n FROM onsite_photos WHERE listing_id = $1', [l.id]);
  if (rows[0].n >= MAX_PHOTOS) return { error: 'too_many_photos' };
  const pid = newId('osp');
  await query('INSERT INTO onsite_photos (id, listing_id, sort, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6)', [pid, l.id, rows[0].n, mime, bytes.length, bytes]);
  return { ok: true, id: pid };
};
export const removePhoto = async (me, id, photoId) => {
  const l = await ownRow(me, id); if (!l) return { error: 'not_found' };
  const { rowCount } = await query('DELETE FROM onsite_photos WHERE id = $1 AND listing_id = $2', [String(photoId ?? ''), l.id]);
  if (!rowCount) return { error: 'not_found' };
  if ((await photoIds(l.id)).length < 1 && l.status === 'published') await query(`UPDATE onsite_listings SET status = 'draft' WHERE id = $1`, [l.id]);
  return { ok: true };
};
/** Фото видны всем вошедшим у публикуемых объявлений; черновик — владельцу и сотрудникам. */
export const getPhoto = async (viewerId, photoId, staff) => {
  const { rows } = await query(`SELECT p.mime, p.data, l.seller_id, l.status FROM onsite_photos p JOIN onsite_listings l ON l.id = p.listing_id WHERE p.id = $1`, [String(photoId ?? '')]);
  const r = rows[0]; if (!r) return { error: 'not_found' };
  if (!['published', 'reserved'].includes(r.status) && r.seller_id !== viewerId && !staff) return { error: 'not_found' };
  return { ok: true, mime: r.mime, data: r.data };
};

/* ─── Сделки (встречи) ─── */
const dealView = (d, viewerId, extra = {}) => ({
  id: d.id, listingId: d.listing_id, status: d.status, role: viewerId === d.buyer_id ? 'buyer' : 'seller', note: d.note,
  meetAt: d.meet_at?.toISOString?.() ?? null, meetPlace: d.meet_place, codeAttempts: d.code_attempts, buyerDone: d.buyer_done, sellerDone: d.seller_done,
  outcomeNote: d.outcome_note, createdAt: d.created_at.toISOString(), updatedAt: d.updated_at.toISOString(), ...extra,
});

export const requestViewing = async (buyerId, listingId, input) => {
  const note = clean(input?.note, 300);
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM onsite_listings WHERE id = $1 FOR UPDATE', [String(listingId ?? '')]);
    const l = rows[0]; if (!l || !['published', 'reserved'].includes(l.status)) return { error: 'not_found' };
    if (l.seller_id === buyerId) return { error: 'own_listing' };
    const { rows: open } = await c.query(`SELECT count(*)::int AS n FROM onsite_deals WHERE buyer_id = $1 AND status IN ('requested','accepted','met')`, [buyerId]);
    if (open[0].n >= MAX_OPEN_DEALS) return { error: 'too_many_open', max: MAX_OPEN_DEALS };
    const { rows: ex } = await c.query(`SELECT id FROM onsite_deals WHERE listing_id = $1 AND buyer_id = $2 AND status IN ('requested','accepted','met')`, [l.id, buyerId]);
    if (ex[0]) return { error: 'deal_exists', id: ex[0].id };
    const id = newId('od');
    await c.query(`INSERT INTO onsite_deals (id, listing_id, buyer_id, seller_id, status, note) VALUES ($1,$2,$3,$4,'requested',$5)`, [id, l.id, buyerId, l.seller_id, note]);
    if (note) await c.query(`INSERT INTO onsite_messages (deal_id, sender_id, text) VALUES ($1,$2,$3)`, [id, buyerId, note]);
    return { ok: true, id, sellerId: l.seller_id, title: l.title };
  });
  if (out.ok) await notifyGo(out.sellerId, 'onsite', 'Хотят посмотреть вещь', `По объявлению «${out.title.slice(0, 60)}» просят показать вещь на месте.`, out.id, `${out.id}:requested`);
  return out;
};

export const myDeals = async (me) => {
  const { rows } = await query(`SELECT d.*, l.title, l.price_rub, l.city, p.username AS buyer_name, s.username AS seller_name,
      (SELECT id FROM onsite_photos WHERE listing_id = l.id ORDER BY sort LIMIT 1) AS photo
      FROM onsite_deals d JOIN onsite_listings l ON l.id = d.listing_id JOIN profiles p ON p.id = d.buyer_id JOIN profiles s ON s.id = d.seller_id
      WHERE d.buyer_id = $1 OR d.seller_id = $1 ORDER BY d.updated_at DESC LIMIT 100`, [me]);
  return { ok: true, items: rows.map((d) => dealView(d, me, { title: d.title, priceRub: d.price_rub, city: d.city, photo: d.photo, with: me === d.buyer_id ? d.seller_name : d.buyer_name })) };
};

export const getDeal = async (me, id) => {
  const { rows } = await query(`SELECT d.*, l.title, l.price_rub, l.city, l.area, l.status AS lstatus FROM onsite_deals d JOIN onsite_listings l ON l.id = d.listing_id WHERE d.id = $1`, [String(id ?? '')]);
  const d = rows[0]; if (!d || (d.buyer_id !== me && d.seller_id !== me)) return { error: 'not_found' };
  const { rows: msgs } = await query('SELECT id, sender_id, text, at FROM onsite_messages WHERE deal_id = $1 ORDER BY id LIMIT 300', [d.id]);
  const { rows: rv } = await query('SELECT author_id, rating, text FROM onsite_reviews WHERE deal_id = $1', [d.id]);
  const { rows: who } = await query('SELECT id, username, name FROM profiles WHERE id = ANY($1::text[])', [[d.buyer_id, d.seller_id]]);
  const name = Object.fromEntries(who.map((x) => [x.id, { username: x.username, name: x.name }]));
  // Код встречи видит только покупатель и только пока встреча не состоялась.
  const code = d.buyer_id === me && d.status === 'accepted' && d.code_enc ? openJson(d.code_enc).code ?? null : null;
  return { ok: true, deal: dealView(d, me, { title: d.title, priceRub: d.price_rub, city: d.city, area: d.area, listingStatus: d.lstatus, meetCode: code, buyer: name[d.buyer_id], seller: name[d.seller_id],
    myReview: rv.find((x) => x.author_id === me) ?? null, theirReview: rv.find((x) => x.author_id !== me) ?? null }),
    messages: msgs.map((m) => ({ id: Number(m.id), mine: m.sender_id === me, text: m.text, at: m.at.toISOString() })) };
};

export const sendMessage = async (me, id, textRaw) => {
  const text = clean(textRaw, 500); if (!text) return { error: 'text_required' };
  const { rows } = await query('SELECT * FROM onsite_deals WHERE id = $1', [String(id ?? '')]);
  const d = rows[0]; if (!d || (d.buyer_id !== me && d.seller_id !== me)) return { error: 'not_found' };
  if (['declined', 'cancelled', 'expired'].includes(d.status)) return { error: 'closed' };
  const { rows: n } = await query(`SELECT count(*)::int AS n FROM onsite_messages WHERE deal_id = $1 AND sender_id = $2 AND at > now() - interval '1 minute'`, [d.id, me]);
  if (n[0].n >= 12) return { error: 'rate_limited' };
  await query('INSERT INTO onsite_messages (deal_id, sender_id, text) VALUES ($1,$2,$3)', [d.id, me, text]);
  await query('UPDATE onsite_deals SET updated_at = now() WHERE id = $1', [d.id]);
  const other = me === d.buyer_id ? d.seller_id : d.buyer_id;
  // Уведомление не чаще раза в 10 минут на встречу — чтобы переписка не превращалась в поток.
  await notifyGo(other, 'onsite', 'Новое сообщение по встрече', text.slice(0, 80), d.id, `${d.id}:msg:${Math.floor(Date.now() / 600000)}`);
  return { ok: true };
};

const genCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

/** Продавец принимает заявку: назначает время и место, объявление бронируется, покупателю выдаётся код встречи. Остальные заявки отклоняются. */
export const accept = async (me, id, input) => {
  const when = new Date(String(input?.meetAt ?? ''));
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 10 * 60000 || when.getTime() > Date.now() + 30 * 86400000) return { error: 'bad_time' };
  const place = clean(input?.place, 160); if (place.length < 3) return { error: 'place_required' };
  const code = genCode();
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM onsite_deals WHERE id = $1 FOR UPDATE', [String(id ?? '')]);
    const d = rows[0]; if (!d || d.seller_id !== me) return { error: 'not_found' };
    if (d.status !== 'requested') return { error: 'bad_state', status: d.status };
    const { rows: ls } = await c.query('SELECT * FROM onsite_listings WHERE id = $1 FOR UPDATE', [d.listing_id]);
    const l = ls[0]; if (!l || l.status !== 'published') return { error: 'listing_unavailable', status: l?.status };
    await c.query(`UPDATE onsite_deals SET status = 'accepted', meet_at = $2, meet_place = $3, code_hash = $4, code_enc = $5, code_attempts = 0, updated_at = now() WHERE id = $1`, [d.id, when, place, sha(`${d.id}:${code}`), sealJson({ code })]);
    await c.query(`UPDATE onsite_listings SET status = 'reserved', updated_at = now() WHERE id = $1`, [l.id]);
    const { rows: others } = await c.query(`UPDATE onsite_deals SET status = 'declined', outcome_note = 'Вещь забронирована другим покупателем', closed_at = now(), updated_at = now() WHERE listing_id = $1 AND status = 'requested' AND id <> $2 RETURNING id, buyer_id`, [l.id, d.id]);
    return { ok: true, buyer: d.buyer_id, title: l.title, others };
  });
  if (out.ok) {
    await notifyGo(out.buyer, 'onsite', 'Встреча назначена', `«${out.title.slice(0, 50)}»: ${when.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}, ${place}. Код встречи — в карточке.`, id, `${id}:accepted`);
    for (const o of out.others) await notifyGo(o.buyer_id, 'onsite', 'Вещь забронирована', 'Продавец принял другую заявку по этому объявлению.', o.id, `${o.id}:declined`);
  }
  return out.ok ? { ok: true } : out;
};

export const decline = async (me, id, noteRaw) => {
  const note = clean(noteRaw, 200);
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM onsite_deals WHERE id = $1 FOR UPDATE', [String(id ?? '')]);
    const d = rows[0]; if (!d || d.seller_id !== me) return { error: 'not_found' };
    if (d.status !== 'requested') return { error: 'bad_state', status: d.status };
    await c.query(`UPDATE onsite_deals SET status = 'declined', outcome_note = $2, closed_at = now(), updated_at = now() WHERE id = $1`, [d.id, note]);
    return { ok: true, buyer: d.buyer_id };
  });
  if (out.ok) await notifyGo(out.buyer, 'onsite', 'Заявка отклонена', note || 'Продавец отклонил заявку на осмотр.', id, `${id}:declined`);
  return out;
};

/** Возврат объявления в продажу после отмены/провала/просрочки встречи (внутри транзакции, под блокировкой). */
const reopen = async (c, listingId) => {
  const { rows: live } = await c.query(`SELECT 1 FROM onsite_deals WHERE listing_id = $1 AND status IN ('accepted','met') LIMIT 1`, [listingId]);
  if (!live[0]) await c.query(`UPDATE onsite_listings SET status = 'published', updated_at = now() WHERE id = $1 AND status = 'reserved'`, [listingId]);
};

/** Отмена одной из сторон до встречи (или покупателем свою заявку). */
export const cancel = async (me, id, noteRaw) => {
  const note = clean(noteRaw, 200);
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM onsite_deals WHERE id = $1 FOR UPDATE', [String(id ?? '')]);
    const d = rows[0]; if (!d || (d.buyer_id !== me && d.seller_id !== me)) return { error: 'not_found' };
    if (!['requested', 'accepted'].includes(d.status)) return { error: 'bad_state', status: d.status };
    await c.query(`UPDATE onsite_deals SET status = 'cancelled', outcome_note = $2, closed_at = now(), updated_at = now() WHERE id = $1`, [d.id, note]);
    await c.query('SELECT 1 FROM onsite_listings WHERE id = $1 FOR UPDATE', [d.listing_id]);
    await reopen(c, d.listing_id);
    return { ok: true, other: me === d.buyer_id ? d.seller_id : d.buyer_id };
  });
  if (out.ok) await notifyGo(out.other, 'onsite', 'Встреча отменена', note || 'Вторая сторона отменила встречу.', id, `${id}:cancelled`);
  return out;
};

/** Продавец вводит код покупателя на встрече — «встретились». Пять неверных попыток закрывают ввод (дальше — отмена или жалоба). */
export const confirmMeeting = async (me, id, codeRaw) => {
  const code = String(codeRaw ?? '').replace(/\D/g, '').slice(0, 4);
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM onsite_deals WHERE id = $1 FOR UPDATE', [String(id ?? '')]);
    const d = rows[0]; if (!d || d.seller_id !== me) return { error: 'not_found' };
    if (d.status !== 'accepted') return { error: 'bad_state', status: d.status };
    if (d.code_attempts >= 5) return { error: 'code_locked' };
    if (code.length !== 4 || sha(`${d.id}:${code}`) !== d.code_hash) {
      await c.query('UPDATE onsite_deals SET code_attempts = code_attempts + 1, updated_at = now() WHERE id = $1', [d.id]);
      return { error: 'bad_code', left: Math.max(0, 4 - d.code_attempts) };
    }
    await c.query(`UPDATE onsite_deals SET status = 'met', met_at = now(), code_enc = '', updated_at = now() WHERE id = $1`, [d.id]);
    return { ok: true, buyer: d.buyer_id };
  });
  if (out.error === 'bad_code') return out;
  if (out.ok) await notifyGo(out.buyer, 'onsite', 'Встреча подтверждена', 'Продавец подтвердил встречу кодом. После осмотра подтвердите, что сделка состоялась, или откажитесь.', id, `${id}:met`);
  return out;
};

/** После встречи: done — «сделка состоялась» (обе стороны), fail — «не состоялась / не подошло» (любая сторона). */
export const finish = async (me, id, action, noteRaw) => {
  const note = clean(noteRaw, 300);
  if (!['done', 'fail'].includes(action)) return { error: 'bad_action' };
  if (action === 'fail' && note.length < 3) return { error: 'note_required' };
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM onsite_deals WHERE id = $1 FOR UPDATE', [String(id ?? '')]);
    const d = rows[0]; if (!d || (d.buyer_id !== me && d.seller_id !== me)) return { error: 'not_found' };
    if (d.status !== 'met') return { error: 'bad_state', status: d.status };
    const isBuyer = me === d.buyer_id; const other = isBuyer ? d.seller_id : d.buyer_id;
    await c.query('SELECT 1 FROM onsite_listings WHERE id = $1 FOR UPDATE', [d.listing_id]);
    if (action === 'fail') {
      await c.query(`UPDATE onsite_deals SET status = 'failed', outcome_note = $2, closed_at = now(), updated_at = now() WHERE id = $1`, [d.id, note]);
      await reopen(c, d.listing_id);
      return { ok: true, status: 'failed', other };
    }
    const b = isBuyer ? true : d.buyer_done; const s = isBuyer ? d.seller_done : true;
    if (b && s) {
      await c.query(`UPDATE onsite_deals SET status = 'completed', buyer_done = true, seller_done = true, closed_at = now(), updated_at = now() WHERE id = $1`, [d.id]);
      await c.query(`UPDATE onsite_listings SET status = 'sold', updated_at = now() WHERE id = $1`, [d.listing_id]);
      return { ok: true, status: 'completed', other };
    }
    await c.query(`UPDATE onsite_deals SET buyer_done = $2, seller_done = $3, updated_at = now() WHERE id = $1`, [d.id, b, s]);
    return { ok: true, status: 'met', waiting: true, other };
  });
  if (out.ok) {
    const T = { failed: 'Встреча закончилась без сделки.', completed: 'Сделка состоялась. Можно оставить отзыв.', met: 'Вторая сторона подтвердила сделку — подтвердите и вы.' };
    await notifyGo(out.other, 'onsite', 'Итог встречи', T[out.status], id, `${id}:fin:${out.status}`);
  }
  return out;
};

export const review = async (me, id, input) => {
  const rating = int(input?.rating, 1, 5); if (rating === null) return { error: 'bad_rating' };
  const text = clean(input?.text, 400);
  const { rows } = await query('SELECT * FROM onsite_deals WHERE id = $1', [String(id ?? '')]);
  const d = rows[0]; if (!d || (d.buyer_id !== me && d.seller_id !== me)) return { error: 'not_found' };
  if (d.status !== 'completed') return { error: 'bad_state', status: d.status };
  const about = me === d.buyer_id ? d.seller_id : d.buyer_id;
  const { rowCount } = await query('INSERT INTO onsite_reviews (deal_id, author_id, about_id, rating, text) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [d.id, me, about, rating, text]);
  return rowCount ? { ok: true } : { error: 'already_reviewed' };
};

/* ─── Жалобы и модерация ─── */
export const report = async (me, listingId, input) => {
  const reason = String(input?.reason ?? ''); if (!REPORT_REASONS.includes(reason)) return { error: 'bad_reason' };
  const { rows } = await query('SELECT seller_id, status FROM onsite_listings WHERE id = $1', [String(listingId ?? '')]);
  const l = rows[0]; if (!l || l.status === 'removed') return { error: 'not_found' };
  if (l.seller_id === me) return { error: 'own_listing' };
  const { rows: today } = await query(`SELECT count(*)::int AS n FROM onsite_reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'`, [me]);
  if (today[0].n >= 20) return { error: 'rate_limited' };
  const { rowCount } = await query(`INSERT INTO onsite_reports (id, listing_id, deal_id, reporter_id, reason, text) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [newId('osr'), listingId, input?.dealId ? String(input.dealId).slice(0, 60) : null, me, reason, clean(input?.text, 500)]);
  return rowCount ? { ok: true } : { error: 'already_reported' };
};

export const adminReports = async (adminId, status) => {
  if (!(await can(adminId, 'market_moderation'))) return { error: 'not_allowed' };
  const st = ['open', 'removed', 'dismissed'].includes(status) ? status : 'open';
  const { rows } = await query(`SELECT r.*, l.title, l.status AS lstatus, l.seller_id, p.username AS seller, rp.username AS reporter,
      (SELECT count(*)::int FROM onsite_reports x WHERE x.listing_id = r.listing_id) AS total
      FROM onsite_reports r JOIN onsite_listings l ON l.id = r.listing_id JOIN profiles p ON p.id = l.seller_id JOIN profiles rp ON rp.id = r.reporter_id
      WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200`, [st]);
  return { ok: true, items: rows.map((r) => ({ id: r.id, listingId: r.listing_id, title: r.title, listingStatus: r.lstatus, seller: r.seller, reporter: r.reporter, reason: r.reason, text: r.text, status: r.status, total: r.total, note: r.note, at: r.created_at.toISOString() })) };
};

export const adminDecide = async (adminId, reportId, action, noteRaw) => {
  if (!(await can(adminId, 'market_moderation'))) return { error: 'not_allowed' };
  const note = clean(noteRaw, 300); if (note.length < 5) return { error: 'note_required' };
  if (!['remove', 'dismiss'].includes(action)) return { error: 'bad_action' };
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM onsite_reports WHERE id = $1 FOR UPDATE', [String(reportId ?? '')]);
    const r = rows[0]; if (!r) return { error: 'not_found' };
    if (r.status !== 'open') return { error: 'bad_state' };
    const { rows: ls } = await c.query('SELECT * FROM onsite_listings WHERE id = $1 FOR UPDATE', [r.listing_id]);
    const l = ls[0];
    if (l && l.seller_id === adminId) return { error: 'self_review' };
    await c.query(`UPDATE onsite_reports SET status = $2, decided_by = $3, note = $4, decided_at = now() WHERE id = $1`, [r.id, action === 'remove' ? 'removed' : 'dismissed', adminId, note]);
    let buyers = [];
    if (action === 'remove' && l) {
      await c.query(`UPDATE onsite_listings SET status = 'removed', mod_note = $2, updated_at = now() WHERE id = $1`, [l.id, note]);
      await c.query(`UPDATE onsite_reports SET status = 'removed', decided_by = $2, note = $3, decided_at = now() WHERE listing_id = $1 AND status = 'open'`, [l.id, adminId, note]);
      const { rows: dl } = await c.query(`UPDATE onsite_deals SET status = 'cancelled', outcome_note = 'Объявление снято модерацией', closed_at = now(), updated_at = now() WHERE listing_id = $1 AND status IN ('requested','accepted','met') RETURNING id, buyer_id`, [l.id]);
      buyers = dl;
    }
    return { ok: true, seller: l?.seller_id, title: l?.title, buyers, removed: action === 'remove' };
  });
  if (!out.ok) return out;
  await logAdmin({ actorId: adminId, type: 'onsite_report', targetType: 'system', targetId: reportId, detail: `${action}: ${note}`.slice(0, 220) });
  await goLog(adminId, 'onsite_report', reportId, { action });
  if (out.removed) {
    await notifyGo(out.seller, 'onsite', 'Объявление снято', `«${(out.title ?? '').slice(0, 50)}» снято модерацией: ${note}`, null, `${reportId}:removed`);
    for (const b of out.buyers) await notifyGo(b.buyer_id, 'onsite', 'Встреча отменена', 'Объявление снято модерацией.', b.id, `${b.id}:mod`);
  }
  return { ok: true };
};

/* ─── Уборка: просрочки ─── */
export const sweepOnsite = async () => {
  // Заявка без ответа продавца за 48 часов — истекает.
  const { rows: a } = await query(`UPDATE onsite_deals SET status = 'expired', outcome_note = 'Продавец не ответил', closed_at = now(), updated_at = now()
      WHERE status = 'requested' AND created_at < now() - ($1 || ' hours')::interval RETURNING id, buyer_id`, [String(REQUEST_TTL_H)]);
  for (const d of a) await notifyGo(d.buyer_id, 'onsite', 'Заявка истекла', 'Продавец не ответил за 48 часов.', d.id, `${d.id}:expired`);
  // Встреча назначена, но прошла более чем на сутки, а код так и не подтвердили — бронь снимается.
  const { rows: b } = await query(`SELECT id, listing_id, buyer_id, seller_id FROM onsite_deals WHERE status = 'accepted' AND meet_at < now() - ($1 || ' hours')::interval LIMIT 100`, [String(MEET_GRACE_H)]);
  for (const d of b) {
    await inTx(async (c) => {
      const { rows } = await c.query('SELECT status FROM onsite_deals WHERE id = $1 FOR UPDATE', [d.id]);
      if (rows[0]?.status !== 'accepted') return;
      await c.query(`UPDATE onsite_deals SET status = 'expired', outcome_note = 'Встреча не подтверждена', closed_at = now(), updated_at = now() WHERE id = $1`, [d.id]);
      await c.query('SELECT 1 FROM onsite_listings WHERE id = $1 FOR UPDATE', [d.listing_id]);
      await reopen(c, d.listing_id);
    }).catch(() => {});
    for (const u of [d.buyer_id, d.seller_id]) await notifyGo(u, 'onsite', 'Бронь снята', 'Встреча не была подтверждена вовремя, объявление снова в продаже.', d.id, `${d.id}:meet-expired:${u}`);
  }
  // Продавец подтвердил сделку, покупатель молчит 72 часа — сделка считается состоявшейся (покупатель всегда может отказаться сразу после осмотра).
  const { rows: c2 } = await query(`SELECT id, listing_id, buyer_id, seller_id FROM onsite_deals WHERE status = 'met' AND seller_done AND NOT buyer_done AND updated_at < now() - ($1 || ' hours')::interval LIMIT 100`, [String(AUTO_DONE_H)]);
  for (const d of c2) {
    await inTx(async (c) => {
      const { rows } = await c.query('SELECT status FROM onsite_deals WHERE id = $1 FOR UPDATE', [d.id]);
      if (rows[0]?.status !== 'met') return;
      await c.query(`UPDATE onsite_deals SET status = 'completed', buyer_done = true, outcome_note = 'Покупатель не ответил 72 часа', closed_at = now(), updated_at = now() WHERE id = $1`, [d.id]);
      await c.query(`UPDATE onsite_listings SET status = 'sold', updated_at = now() WHERE id = $1`, [d.listing_id]);
    }).catch(() => {});
    await notifyGo(d.buyer_id, 'onsite', 'Сделка закрыта', 'Продавец подтвердил сделку, вы не ответили за 72 часа — сделка закрыта.', d.id, `${d.id}:auto-done`);
  }
  return { expired: a.length, released: b.length, autoDone: c2.length };
};
