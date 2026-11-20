/**
 * Sky GO «Организации»: публичный каталог мест, подключённых из «Sky для бизнеса».
 *
 * Организация — тот же бизнес `kb_businesses` (второй сущности нет): здесь лежит только публичная карточка (`gop_places`),
 * фото (`gop_photos` → `kb_media`) и модерация. Товары и услуги — `kb_items` (kind product|service), заказы — `kb_orders`,
 * оплата — страница оплаты `kb_qr` и заявки `kb_payments` (прямой перевод владельцу, подтверждает он или платёжный партнёр бизнеса).
 * Sky деньги не принимает и не хранит. В каталоге видно место, только если: подключено владельцем + одобрено модерацией
 * + бизнес опубликован (`status = active`). Отключение или блокировка скрывает карточку, бизнес остаётся.
 */
import { query } from './db.mjs';
import { config } from './config.mjs';
import { notifyGift } from './giftnotify.mjs';
import { newId, inTx, clean, haversineKm, routeBetween } from './gocore.mjs';
import { geocode, isRealPoint } from './maps.mjs';
import { can } from './admin.mjs';
import { logAdmin as adminLog } from './adminsec.mjs';
import { subState, imageFromDataUrl } from './kbiz.mjs';
import { depositPaymentChanged } from './goplacebook.mjs';
import { workPaymentChanged } from './gotransport.mjs';
import { createOrderCore, returnStock, notifyBuyerOrder, ORDER_LABEL } from './kbcatalog.mjs';

const err = (error, extra = {}) => ({ error, ...extra });
const ST_LABEL = { draft: 'Черновик', pending: 'На проверке', published: 'Опубликована', rejected: 'Отклонена', hidden: 'Скрыта', blocked: 'Заблокирована' };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MAX_PHOTOS = 8;
const logErr = (where, e) => query('INSERT INTO gop_errors (where_, detail) VALUES ($1,$2)', [where, String(e?.message ?? e).slice(0, 300)]).catch(() => {});
const plog = (businessId, actor, action, detail = '') => query('INSERT INTO gop_log (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [businessId, actor, action, clean(detail, 300)]).catch(() => {});

/* ─── Часы работы ─── */
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const cleanHours = (raw) => {
  const out = {};
  for (const d of DAYS) {
    const slots = Array.isArray(raw?.[d]) ? raw[d].slice(0, 3) : [];
    const ok = slots.filter((x) => Array.isArray(x) && HM.test(String(x[0])) && HM.test(String(x[1])) && x[0] !== x[1]).map((x) => [String(x[0]), String(x[1])]);
    if (ok.length) out[d] = ok;
  }
  return out;
};
const goodTz = (tz) => { try { new Intl.DateTimeFormat('ru', { timeZone: tz }); return true; } catch { return false; } };
const mins = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
/** «Открыто сейчас» по часам и поясу места. null — часы не заданы (ничего не утверждаем). Интервал через полночь учитывается. */
export const openState = (hours, tz = 'Europe/Moscow', now = new Date()) => {
  if (!hours || !Object.keys(hours).length) return { open: null, today: '' };
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  const di = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  const cur = Number(parts.hour) * 60 + Number(parts.minute);
  const today = hours[DAYS[di]] ?? []; const prev = hours[DAYS[(di + 6) % 7]] ?? [];
  let open = false;
  for (const [a, b] of today) { const s = mins(a); const e = mins(b); if (e > s ? cur >= s && cur < e : cur >= s) open = true; }
  for (const [a, b] of prev) { const s = mins(a); const e = mins(b); if (e < s && cur < e) open = true; }   // вчерашний интервал через полночь
  return { open, today: today.length ? today.map(([a, b]) => `${a}–${b}`).join(', ') : 'выходной' };
};

/* ─── Категории ─── */
export const categories = async ({ all = false } = {}) => {
  const { rows } = await query(`SELECT c.*, (SELECT count(*)::int FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE p.category_id = c.id AND p.connected AND p.status = 'published' AND b.status = 'active') AS places FROM gop_categories c ${all ? '' : 'WHERE NOT hidden'} ORDER BY sort, name`);
  return { categories: rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon, sort: r.sort, hidden: r.hidden, places: r.places, groupId: r.group_id ?? null })) };
};
const CAT_ID = /^[a-z][a-z0-9-]{1,30}$/;
export const adminSaveCategory = async (me, id, body) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const name = clean(body?.name, 60); if (name.length < 2) return err('bad_field', { field: 'name' });
  const icon = clean(body?.icon, 30) || 'building'; const sort = Number.isInteger(Number(body?.sort)) ? Math.max(0, Math.min(10000, Number(body.sort))) : 100;
  const hidden = Boolean(body?.hidden);
  const group = body?.groupId === 'transport' ? 'transport' : null;   // единственная группа — «Для транспорта»
  if (id) {
    const { rowCount } = await query('UPDATE gop_categories SET name = $2, icon = $3, sort = $4, hidden = $5, group_id = $6 WHERE id = $1', [id, name, icon, sort, hidden, group]);
    if (!rowCount) return err('not_found');
    await logAdmin(me, 'category_update', `${id}: ${name}${hidden ? ' (скрыта)' : ''}`); return { ok: true, id };
  }
  const nid = CAT_ID.test(String(body?.id ?? '')) ? String(body.id) : `c-${Date.now().toString(36)}`;
  const r = await query('INSERT INTO gop_categories (id, name, icon, sort, hidden, group_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [nid, name, icon, sort, hidden, group]);
  if (!r.rowCount) return err('exists');
  await logAdmin(me, 'category_create', `${nid}: ${name}`); return { ok: true, id: nid };
};
export const adminDeleteCategory = async (me, id) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const { rows } = await query('SELECT count(*)::int AS n FROM gop_places WHERE category_id = $1', [id]);
  if (rows[0].n) return err('category_in_use', { places: rows[0].n });   // с местами — только скрыть
  const r = await query('DELETE FROM gop_categories WHERE id = $1', [id]); if (!r.rowCount) return err('not_found');
  await logAdmin(me, 'category_delete', id); return { ok: true };
};
const logAdmin = (me, action, detail) => adminLog({ actorId: me, targetType: 'go_place', type: `go_places_${action}`, detail: String(detail ?? '') }).catch(() => {});

/* ─── Владелец (через «Sky для бизнеса») ─── */
const ownBiz = async (profileId) => (await query('SELECT id, name, status, owner_id FROM kb_businesses WHERE id = kb_cur_biz($1)', [profileId])).rows[0] ?? null;
const ensure = async (businessId) => { await query('INSERT INTO gop_places (business_id) VALUES ($1) ON CONFLICT DO NOTHING', [businessId]); return (await query('SELECT * FROM gop_places WHERE business_id = $1', [businessId])).rows[0]; };
const photoList = async (businessId) => (await query('SELECT media_id FROM gop_photos WHERE business_id = $1 ORDER BY sort, media_id', [businessId])).rows.map((r) => `/api/go/places/media/${r.media_id}`);

const readiness = async (b, p, photos) => {
  const missing = [];
  if (b.status !== 'active') missing.push('Опубликуйте бизнес в «Sky для бизнеса» (вкладка «Данные»)');
  const rq = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [b.id]); if (!rq.rows[0]) missing.push('Добавьте реквизиты для онлайн-оплаты');
  const sub = await subState(b.id); if (!sub.active) missing.push('Продлите подписку «Sky для бизнеса»');
  if (!p.category_id) missing.push('Выберите категорию');
  if (clean(p.about, 5).length < 1) missing.push('Добавьте описание');
  if (!p.city || !p.address) missing.push('Укажите город и адрес');
  if (!isRealPoint(p.lat, p.lng)) missing.push('Не определено местоположение на карте');
  if (!photos) missing.push('Добавьте хотя бы одну фотографию');
  return missing;
};

const shapeOwner = async (b, p) => {
  const photos = await photoList(b.id); const rd = await readiness(b, p, photos.length);
  const prov = await query('SELECT enabled FROM kb_providers WHERE business_id = $1', [b.id]);
  return { businessId: b.id, name: b.name, connected: p.connected, status: p.status, statusLabel: ST_LABEL[p.status], categoryId: p.category_id, about: p.about, city: p.city, address: p.address,
    lat: p.lat, lng: p.lng, hours: p.hours ?? {}, tz: p.tz, phone: p.phone, links: p.links ?? [], photos, rejectReason: p.reject_reason, missing: rd, canSubmit: rd.length === 0,
    payments: { requisites: !rd.includes('Добавьте реквизиты для онлайн-оплаты'), subscription: !rd.includes('Продлите подписку «Sky для бизнеса»'), partner: Boolean(prov.rows[0]?.enabled) } };
};

export const ownerGet = async (profileId) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  return { ok: true, place: await shapeOwner(b, await ensure(b.id)) };
};

const httpsLinks = (raw) => (Array.isArray(raw) ? raw.slice(0, 5) : []).map((x) => ({ title: clean(x?.title, 40), url: String(x?.url ?? '').trim().slice(0, 300) })).filter((x) => { try { const u = new URL(x.url); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } });
const PHONE = /^[+\d][\d\s()\-]{5,24}$/;
/** Поля, правка которых у опубликованной карточки возвращает её на проверку. */
const MATERIAL = ['category_id', 'about', 'address', 'city', 'links'];

export const ownerSave = async (profileId, body) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  if (b.status === 'suspended') return err('suspended');
  const cur = await ensure(b.id);
  if (cur.status === 'blocked') return err('blocked');
  const next = { ...cur };
  if (body?.categoryId !== undefined) { const { rows } = await query('SELECT 1 FROM gop_categories WHERE id = $1 AND NOT hidden', [String(body.categoryId)]); if (!rows[0]) return err('bad_field', { field: 'categoryId' }); next.category_id = String(body.categoryId); }
  if (body?.about !== undefined) next.about = clean(body.about, 1500);
  if (body?.city !== undefined) next.city = clean(body.city, 80);
  if (body?.address !== undefined) next.address = clean(body.address, 200);
  if (body?.phone !== undefined) { const ph = clean(body.phone, 30); if (ph && !PHONE.test(ph)) return err('bad_field', { field: 'phone' }); next.phone = ph; }
  if (body?.links !== undefined) next.links = httpsLinks(body.links);
  if (body?.hours !== undefined) next.hours = cleanHours(body.hours);
  if (body?.tz !== undefined) { if (!goodTz(String(body.tz))) return err('bad_field', { field: 'tz' }); next.tz = String(body.tz); }
  // Координаты: из адреса через карты Sky; если адрес не нашёлся — владелец отмечает точку на карте вручную.
  let geoFailed = false;
  if (body?.lat !== undefined && body?.lng !== undefined && isRealPoint(Number(body.lat), Number(body.lng))) { next.lat = Number(body.lat); next.lng = Number(body.lng); }
  else if (next.address && (next.address !== cur.address || next.city !== cur.city || !isRealPoint(cur.lat, cur.lng))) {
    const g = await geocode(`${next.city}, ${next.address}`).catch(() => null);
    if (g) { next.lat = g.lat; next.lng = g.lng; } else { geoFailed = true; if (next.address !== cur.address || next.city !== cur.city) { next.lat = null; next.lng = null; } }
  }
  const material = MATERIAL.some((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k])) || next.lat !== cur.lat || next.lng !== cur.lng;
  const back = cur.status === 'published' && material;
  await query(`UPDATE gop_places SET category_id=$2, about=$3, city=$4, address=$5, lat=$6, lng=$7, hours=$8::jsonb, tz=$9, phone=$10, links=$11::jsonb,
      status = CASE WHEN $12 THEN 'draft' ELSE status END, updated_at = now() WHERE business_id = $1`,
    [b.id, next.category_id, next.about, next.city, next.address, next.lat, next.lng, JSON.stringify(next.hours ?? {}), next.tz, next.phone, JSON.stringify(next.links ?? []), back]);
  await plog(b.id, profileId, 'save', back ? 'изменены проверяемые поля — карточка вернулась в черновик' : '');
  const place = await shapeOwner(b, await ensure(b.id));
  return { ok: true, place, geoFailed, returnedToDraft: back };
};

export const ownerConnect = async (profileId, on) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const p = await ensure(b.id);
  if (p.status === 'blocked' && on) return err('blocked');
  await query('UPDATE gop_places SET connected = $2, updated_at = now() WHERE business_id = $1', [b.id, Boolean(on)]);
  await plog(b.id, profileId, on ? 'connect' : 'disconnect');
  return { ok: true, place: await shapeOwner(b, await ensure(b.id)) };
};

export const ownerAddPhoto = async (profileId, dataUrl) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const p = await ensure(b.id); if (p.status === 'blocked') return err('blocked');
  const img = imageFromDataUrl(dataUrl); if (img.error) return img;
  const id = newId('kbm');
  const res = await inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`goph:${b.id}`]);
    const n = await c.query('SELECT count(*)::int AS n FROM gop_photos WHERE business_id = $1', [b.id]);
    if (n.rows[0].n >= MAX_PHOTOS) return err('too_many_photos');
    await c.query(`INSERT INTO kb_media (id, business_id, kind, data, mime) VALUES ($1,$2,'place',$3,$4)`, [id, b.id, img.buf, img.mime]);
    await c.query('INSERT INTO gop_photos (media_id, business_id, sort) VALUES ($1,$2,$3)', [id, b.id, n.rows[0].n]);
    if (p.status === 'published') await c.query(`UPDATE gop_places SET status = 'draft', updated_at = now() WHERE business_id = $1`, [b.id]);
    return { ok: true };
  });
  if (res.error) return res;
  await plog(b.id, profileId, 'photo_add');
  return { ok: true, photos: await photoList(b.id) };
};
export const ownerRemovePhoto = async (profileId, mediaId) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const r = await query('DELETE FROM kb_media WHERE id = $1 AND business_id = $2 AND id IN (SELECT media_id FROM gop_photos)', [String(mediaId ?? ''), b.id]);
  if (!r.rowCount) return err('not_found');
  await plog(b.id, profileId, 'photo_remove');
  return { ok: true, photos: await photoList(b.id) };
};
export const mediaPublic = async (id) => {
  const { rows } = await query(`SELECT m.data, m.mime FROM kb_media m JOIN gop_photos ph ON ph.media_id = m.id JOIN gop_places p ON p.business_id = ph.business_id JOIN kb_businesses b ON b.id = p.business_id
    WHERE m.id = $1 AND p.connected AND p.status = 'published' AND b.status = 'active'`, [String(id ?? '')]);
  return rows[0] ? { data: rows[0].data, type: rows[0].mime } : null;
};
/** Фото владельцу — и пока карточка не опубликована (предпросмотр). */
export const mediaOwn = async (profileId, id) => {
  const { rows } = await query(`SELECT m.data, m.mime FROM kb_media m JOIN gop_photos ph ON ph.media_id = m.id JOIN kb_businesses b ON b.id = ph.business_id WHERE m.id = $1 AND b.id = kb_cur_biz($2)`, [String(id ?? ''), profileId]);
  return rows[0] ? { data: rows[0].data, type: rows[0].mime } : null;
};

export const ownerSubmit = async (profileId) => {
  const b = await ownBiz(profileId); if (!b) return err('no_business');
  const p = await ensure(b.id);
  if (!p.connected) return err('not_connected');
  if (p.status === 'pending') return { ok: true, duplicate: true, place: await shapeOwner(b, p) };
  if (p.status === 'published') return err('already_published');
  if (p.status === 'blocked') return err('blocked');
  const photos = (await query('SELECT count(*)::int AS n FROM gop_photos WHERE business_id = $1', [b.id])).rows[0].n;
  const missing = await readiness(b, p, photos);
  if (missing.length) return err('incomplete', { missing });
  const r = await query(`UPDATE gop_places SET status = 'pending', submitted_at = now(), reject_reason = '', updated_at = now() WHERE business_id = $1 AND status IN ('draft','rejected','hidden')`, [b.id]);
  if (!r.rowCount) return err('bad_state');
  await plog(b.id, profileId, 'submit');
  void import('./staffnotify.mjs').then((m) => m.notifyStaff('go_place', { title: 'Организация Sky GO на проверке', body: b.name, dedupe: `${b.id}:${Date.now() >> 16}`, except: profileId })).catch(() => {});
  return { ok: true, place: await shapeOwner(b, await ensure(b.id)) };
};

/* ─── Публичный каталог ─── */
const visible = `p.connected AND p.status = 'published' AND b.status = 'active'`;
const rowCard = (r, from) => {
  const dist = from && isRealPoint(r.lat, r.lng) ? Math.round(haversineKm(from, { lat: r.lat, lng: r.lng }) * 10) / 10 : null;
  const os = openState(r.hours, r.tz);
  return { id: r.business_id, name: r.name, categoryId: r.category_id, categoryName: r.category_name, city: r.city, address: r.address, lat: r.lat, lng: r.lng, distanceKm: dist,
    open: os.open, today: os.today, about: r.about, logoUrl: r.has_logo ? `/api/kbiz/public/logo/${r.business_id}` : null, photo: r.first_photo ? `/api/go/places/media/${r.first_photo}` : null, fav: Boolean(r.fav) };
};
const SELECT = `SELECT p.*, b.name, (b.logo IS NOT NULL) AS has_logo, c.name AS category_name,
    (SELECT media_id FROM gop_photos WHERE business_id = p.business_id ORDER BY sort, media_id LIMIT 1) AS first_photo,
    EXISTS (SELECT 1 FROM gop_favs f WHERE f.business_id = p.business_id AND f.profile_id = $1) AS fav
  FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id LEFT JOIN gop_categories c ON c.id = p.category_id`;

export const list = async (me, q = {}) => {
  const vals = [me]; let w = visible;
  if (q.category) { vals.push(String(q.category)); w += ` AND p.category_id = $${vals.length}`; }
  if (q.group) { vals.push(String(q.group)); w += ` AND p.category_id IN (SELECT id FROM gop_categories WHERE group_id = $${vals.length})`; }
  if (q.city) { vals.push(`%${String(q.city).replace(/[%_\\]/g, ' ').trim()}%`); w += ` AND p.city ILIKE $${vals.length}`; }
  if (q.q) { vals.push(`%${String(q.q).replace(/[%_\\]/g, ' ').trim().slice(0, 60)}%`); w += ` AND (b.name ILIKE $${vals.length} OR p.about ILIKE $${vals.length} OR p.address ILIKE $${vals.length})`; }
  if (q.fav === '1' || q.fav === true) w += ` AND EXISTS (SELECT 1 FROM gop_favs f WHERE f.business_id = p.business_id AND f.profile_id = $1)`;
  const { rows } = await query(`${SELECT} WHERE ${w} AND NOT EXISTS (SELECT 1 FROM gop_categories hc WHERE hc.id = p.category_id AND hc.hidden) ORDER BY b.name LIMIT 500`, vals);
  const from = isRealPoint(Number(q.lat), Number(q.lng)) ? { lat: Number(q.lat), lng: Number(q.lng) } : null;
  let out = rows.map((r) => rowCard(r, from));
  if (q.open === '1' || q.open === true) out = out.filter((x) => x.open === true);
  if (q.sort === 'distance' && from) out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  return { places: out.slice(0, 200), total: out.length, located: Boolean(from) };
};

export const get = async (me, id, q = {}) => {
  const { rows } = await query(`${SELECT} WHERE p.business_id = $2 AND ${visible}`, [me, String(id ?? '')]);
  if (!rows[0]) return err('not_found');
  const r = rows[0]; const from = isRealPoint(Number(q.lat), Number(q.lng)) ? { lat: Number(q.lat), lng: Number(q.lng) } : null;
  const card = rowCard(r, from); const os = openState(r.hours, r.tz);
  const photos = (await query('SELECT media_id FROM gop_photos WHERE business_id = $1 ORDER BY sort, media_id', [r.business_id])).rows.map((x) => `/api/go/places/media/${x.media_id}`);
  const items = (await query(`SELECT * FROM kb_items WHERE business_id = $1 AND status = 'active' AND available ORDER BY sort, created_at LIMIT 300`, [r.business_id])).rows;
  const sub = await subState(r.business_id); const rq = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [r.business_id]);
  const canOrder = sub.active && Boolean(rq.rows[0]);
  const biz = (await query('SELECT contacts, website FROM kb_businesses WHERE id = $1', [r.business_id])).rows[0];
  return { ok: true, place: { ...card, photos, hours: r.hours ?? {}, tz: r.tz, today: os.today, phone: r.phone, links: r.links ?? [], contacts: biz.contacts, website: biz.website, canOrder,
    items: items.map((it) => ({ id: it.id, title: it.title, description: it.description, priceRub: it.price_rub, kind: it.kind ?? 'product', variants: it.variants ?? [], leadTime: it.lead_time,
      available: it.available && (it.stock == null || it.stock > 0), left: it.stock != null && it.stock <= 10 ? it.stock : null, photo: it.media_id ? `/api/kbiz/public/media/${it.media_id}` : null, category: it.category })) } };
};

export const toggleFav = async (me, id, on) => {
  const ok = await query(`SELECT 1 FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE p.business_id = $1 AND ${visible}`, [String(id ?? '')]);
  if (!ok.rows[0]) return err('not_found');
  if (on) await query('INSERT INTO gop_favs (profile_id, business_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, id]);
  else await query('DELETE FROM gop_favs WHERE profile_id = $1 AND business_id = $2', [me, id]);
  return { ok: true, fav: Boolean(on) };
};

/* ─── Маршрут ─── */
const extLinks = (to, from) => {
  const t = `${to.lat},${to.lng}`; const f = from ? `${from.lat},${from.lng}` : '';
  return { yandex: `https://yandex.ru/maps/?rtext=${f ? `${from.lat}%2C${from.lng}~` : '~'}${to.lat}%2C${to.lng}&rtt=auto`, google: `https://www.google.com/maps/dir/?api=1${f ? `&origin=${f}` : ''}&destination=${t}`,
    twogis: `https://2gis.ru/routeSearch/rsType/car/${from ? `from/${from.lng},${from.lat}/` : ''}to/${to.lng},${to.lat}` };
};
export const route = async (me, id, body) => {
  const { rows } = await query(`SELECT p.lat, p.lng FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE p.business_id = $1 AND ${visible}`, [String(id ?? '')]);
  if (!rows[0] || !isRealPoint(rows[0].lat, rows[0].lng)) return err('not_found');
  const to = { lat: rows[0].lat, lng: rows[0].lng };
  let from = isRealPoint(Number(body?.fromLat), Number(body?.fromLng)) ? { lat: Number(body.fromLat), lng: Number(body.fromLng) } : null;
  if (!from && body?.fromAddress) {
    const g = await geocode(clean(body.fromAddress, 200)).catch(() => null);
    if (!g) return err('from_not_found');
    from = { lat: g.lat, lng: g.lng };
  }
  if (!from) return { ok: true, links: extLinks(to, null), need: 'from' };   // без точки старта — только внешнее приложение (оно спросит само)
  try {
    const r = await routeBetween(from, to);
    return { ok: true, km: Math.round(r.km * 10) / 10, minutes: r.min, estimated: Boolean(r.estimated), from, links: extLinks(to, from) };
  } catch (e) { await logErr('route', e); return { ok: true, unavailable: true, from, links: extLinks(to, from) }; }
};

/* ─── Заказы покупателя ─── */
const PAY_LABEL = { created: 'Ожидает оплаты', reported: 'Оплата заявлена, проверяется', confirmed: 'Оплачен', not_found: 'Оплата не найдена', cancelled: 'Платёж отменён', refunded: 'Возвращён', expired: 'Срок вышел' };
export const createOrder = async (me, id, body, ip) => {
  const { rows } = await query(`SELECT b.id, b.owner_id, b.status, b.name FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE p.business_id = $1 AND ${visible}`, [String(id ?? '')]);
  if (!rows[0]) return err('not_found');
  if (rows[0].owner_id === me) return err('own_place');
  const r = await createOrderCore(rows[0], body, ip, '', me);
  return r;
};
export const myOrders = async (me) => {
  const { rows } = await query(
    `SELECT o.id, o.number, o.lines, o.total_rub, o.status, o.created_at, o.owner_comment, b.id AS business_id, b.name, q.public_id, q.expires_at AS qr_expires,
            (SELECT p.status FROM kb_payments p WHERE p.qr_id = o.qr_id ORDER BY p.created_at DESC LIMIT 1) AS pay_status
       FROM kb_orders o JOIN kb_businesses b ON b.id = o.business_id LEFT JOIN kb_qr q ON q.id = o.qr_id WHERE o.buyer_profile_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [me]);
  const base = config.publicOrigin || '';
  return { orders: rows.map((r) => ({ id: r.id, number: r.number, placeId: r.business_id, placeName: r.name, lines: r.lines, totalRub: r.total_rub, status: r.status, statusLabel: ORDER_LABEL[r.status],
    payStatus: r.pay_status ?? 'created', payLabel: PAY_LABEL[r.pay_status ?? 'created'], comment: r.owner_comment, createdAt: r.created_at.toISOString(),
    payUrl: r.public_id && ['new', 'confirmed', 'in_progress', 'ready'].includes(r.status) && (r.pay_status == null || r.pay_status === 'created' || r.pay_status === 'not_found') && !(r.qr_expires && r.qr_expires <= new Date()) ? `${base}/p/${r.public_id}` : null })) };
};
/** Отмена покупателем — пока заказ новый (владелец ещё не принял). Остаток возвращается, страница оплаты закрывается. */
export const cancelMyOrder = async (me, orderId) => {
  const res = await inTx(async (c) => {
    const { rows } = await c.query('SELECT id, status, number, business_id FROM kb_orders WHERE id = $1 AND buyer_profile_id = $2 FOR UPDATE', [String(orderId ?? ''), me]);
    if (!rows[0]) return err('not_found');
    if (rows[0].status === 'cancelled') return { ok: true, duplicate: true };
    if (rows[0].status !== 'new') return err('bad_state', { status: rows[0].status });
    const paid = await c.query(`SELECT 1 FROM kb_payments p JOIN kb_orders o ON o.qr_id = p.qr_id WHERE o.id = $1 AND p.status IN ('reported','confirmed')`, [rows[0].id]);
    if (paid.rows[0]) return err('payment_in_progress');   // деньги уже заявлены/подтверждены — отмену и возврат решает организация
    await c.query(`UPDATE kb_orders SET status = 'cancelled', owner_comment = 'Отменён покупателем', updated_at = now() WHERE id = $1`, [rows[0].id]);
    await c.query(`UPDATE kb_qr SET status = 'disabled', updated_at = now() WHERE id = (SELECT qr_id FROM kb_orders WHERE id = $1) AND status = 'active'`, [rows[0].id]);
    await returnStock(c, rows[0].id);
    await c.query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [rows[0].business_id, me, 'order_cancel_buyer', `№ ${rows[0].number}`]);
    return { ok: true, number: rows[0].number, businessId: rows[0].business_id };
  });
  if (res.ok && !res.duplicate) { const o = (await query('SELECT owner_id FROM kb_businesses WHERE id = $1', [res.businessId])).rows[0]; if (o) void notifyGift(o.owner_id, 'kassa_biz', 'Заказ отменён покупателем', `Заказ № ${res.number} отменён покупателем.`, `kbo:cancel:${orderId}`).catch(() => {}); }
  return res;
};
/** Платёж по заказу изменил статус (из kbiz.actOnPayment / kbprovider): уведомить покупателя Sky GO один раз. */
export const paymentChanged = (paymentId, to) => {
  setTimeout(async () => {
    try {
      if (await depositPaymentChanged(paymentId, to)) return;
      if (await workPaymentChanged(paymentId, to)) return;
      const { rows } = await query(`SELECT p.status, o.id, o.number, o.buyer_profile_id FROM kb_payments p JOIN kb_orders o ON o.qr_id = p.qr_id WHERE p.id = $1 AND o.buyer_profile_id IS NOT NULL`, [paymentId]);
      const r = rows[0]; if (!r || r.status !== to) return;
      const text = { confirmed: ['Оплата подтверждена', 'Организация подтвердила оплату.'], refunded: ['Оплата возвращена', 'Организация вернула оплату.'], cancelled: ['Платёж отменён', 'Платёж по заказу отменён организацией.'] }[to];
      if (!text) return;
      const ref = `kbo:pay:${paymentId}:${to}`;
      const dup = await query('SELECT 1 FROM gift_notifications WHERE user_id = $1 AND ref_id = $2 LIMIT 1', [r.buyer_profile_id, ref]); if (dup.rows[0]) return;
      await notifyGift(r.buyer_profile_id, 'go_place_order', `Заказ № ${r.number}: ${text[0]}`, text[1], ref);
    } catch { /* уведомление необязательно */ }
  }, 600);
};

/* ─── Администрация ─── */
export const adminList = async (me, q = {}) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const vals = []; const w = ['p.connected OR p.status <> \'draft\''];
  if (q.status && ST_LABEL[q.status]) { vals.push(q.status); w.push(`p.status = $${vals.length}`); }
  if (q.q) { vals.push(`%${String(q.q).replace(/[%_\\]/g, ' ').trim().slice(0, 60)}%`); w.push(`(b.name ILIKE $${vals.length} OR p.city ILIKE $${vals.length} OR b.id = ${'$' + (vals.length + 1)})`); vals.push(String(q.q).trim()); }
  const { rows } = await query(`SELECT p.business_id, p.connected, p.status, p.city, p.address, p.submitted_at, p.reject_reason, b.name, b.status AS biz_status, c.name AS category_name,
      (SELECT count(*)::int FROM gop_photos WHERE business_id = p.business_id) AS photos
      FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id LEFT JOIN gop_categories c ON c.id = p.category_id WHERE ${w.join(' AND ')}
      ORDER BY (p.status = 'pending') DESC, p.submitted_at DESC NULLS LAST LIMIT 200`, vals);
  return { places: rows.map((r) => ({ id: r.business_id, name: r.name, connected: r.connected, status: r.status, statusLabel: ST_LABEL[r.status], bizStatus: r.biz_status, city: r.city, address: r.address, category: r.category_name,
    photos: r.photos, submittedAt: r.submitted_at, rejectReason: r.reject_reason })) };
};
export const adminDetail = async (me, id) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const { rows } = await query(`SELECT p.*, b.name, b.contacts, b.website, b.status AS biz_status FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE p.business_id = $1`, [String(id ?? '')]);
  if (!rows[0]) return err('not_found');
  const log = (await query('SELECT actor, action, detail, at FROM gop_log WHERE business_id = $1 ORDER BY id DESC LIMIT 100', [rows[0].business_id])).rows;
  const photos = (await query('SELECT media_id FROM gop_photos WHERE business_id = $1 ORDER BY sort', [rows[0].business_id])).rows.map((x) => `/api/admin/go/places/media/${x.media_id}`);
  const items = (await query(`SELECT title, price_rub, kind, available, stock FROM kb_items WHERE business_id = $1 AND status = 'active' ORDER BY sort LIMIT 100`, [rows[0].business_id])).rows;
  const r = rows[0];
  return { ok: true, place: { id: r.business_id, name: r.name, status: r.status, statusLabel: ST_LABEL[r.status], connected: r.connected, bizStatus: r.biz_status, categoryId: r.category_id, about: r.about, city: r.city, address: r.address, lat: r.lat, lng: r.lng,
    hours: r.hours, phone: r.phone, links: r.links, contacts: r.contacts, website: r.website, photos, rejectReason: r.reject_reason, items: items.map((i) => ({ title: i.title, priceRub: i.price_rub, kind: i.kind, available: i.available, stock: i.stock })),
    log: log.map((l) => ({ actor: l.actor, action: l.action, detail: l.detail, at: l.at.toISOString() })) } };
};
export const adminMedia = async (me, id) => {
  if (!(await can(me, 'go_places'))) return null;
  const { rows } = await query('SELECT m.data, m.mime FROM kb_media m JOIN gop_photos ph ON ph.media_id = m.id WHERE m.id = $1', [String(id ?? '')]);
  return rows[0] ? { data: rows[0].data, type: rows[0].mime } : null;
};
const NEXT = { approve: ['pending', 'published'], reject: ['pending', 'rejected'], hide: ['published', 'hidden'], unhide: ['hidden', 'published'], block: ['draft,pending,published,rejected,hidden', 'blocked'], unblock: ['blocked', 'draft'] };
export const adminDecide = async (me, id, action, reason) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const t = NEXT[action]; if (!t) return err('bad_action');
  const why = clean(reason, 300);
  if (['reject', 'hide', 'block'].includes(action) && why.length < 5) return err('reason_required');
  const res = await inTx(async (c) => {
    const { rows } = await c.query('SELECT p.status, b.owner_id, b.name FROM gop_places p JOIN kb_businesses b ON b.id = p.business_id WHERE p.business_id = $1 FOR UPDATE OF p', [String(id ?? '')]);
    if (!rows[0]) return err('not_found');
    if (rows[0].owner_id === me && action !== 'hide') return err('self_review');   // свою карточку не одобряют; скрыть её можно
    const to = t[1];
    if (rows[0].status === to) return { ok: true, duplicate: true, status: to };
    if (!t[0].split(',').includes(rows[0].status)) return err('bad_state', { status: rows[0].status });
    await c.query(`UPDATE gop_places SET status = $2, reject_reason = CASE WHEN $2 IN ('rejected','hidden','blocked') THEN $3 ELSE '' END, moderated_by = $4, moderated_at = now(), updated_at = now() WHERE business_id = $1`, [id, to, why, me]);
    await c.query('INSERT INTO gop_log (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [id, me, `admin_${action}`, why]);
    return { ok: true, status: to, owner: rows[0].owner_id, name: rows[0].name };
  });
  if (res.ok && !res.duplicate) {
    await logAdmin(me, action, `${id}${why ? `: ${why}` : ''}`);
    const T = { approve: ['Организация опубликована в Sky GO', 'Карточка прошла проверку и теперь видна в каталоге.'], reject: ['Карточка отклонена', why], hide: ['Организация скрыта из каталога', why], unhide: ['Организация снова в каталоге', ''], block: ['Организация заблокирована в Sky GO', why], unblock: ['Блокировка снята', 'Отправьте карточку на проверку снова.'] }[action];
    void notifyGift(res.owner, 'kassa_biz', T[0], `${res.name}. ${T[1]}`.trim(), `goplace:${id}:${action}:${Date.now() >> 10}`).catch(() => {});
  }
  return res;
};
export const adminCategories = async (me) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  return categories({ all: true });
};

export const adminErrors = async (me) => {
  if (!(await can(me, 'go_places'))) return err('not_allowed');
  const { rows } = await query('SELECT where_, detail, at FROM gop_errors ORDER BY id DESC LIMIT 100');
  return { errors: rows.map((r) => ({ where: r.where_, detail: r.detail, at: r.at.toISOString() })) };
};

/** Карточка скрывается из каталога вместе с бизнесом при удалении/приостановке — это делают условия `visible`; отдельной уборки нет. */
export const placeStatusLabel = ST_LABEL;
