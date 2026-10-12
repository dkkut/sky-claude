/**
 * Sky GO — общее: настройки, журнал, уведомления, маршруты, шифрование сведений.
 *
 * Деньги здесь — целые рубли (как в кошельке). Всё, что решает права и цену, считает сервер;
 * клиент присылает только намерение (адреса, выбор тарифа, позиции меню).
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { notifyGift } from './giftnotify.mjs';
import { pushToOffline } from './webpush.mjs';
import { pushGoEvent } from './signal.mjs';
import { computeRoute, isRealPoint, geocode } from './maps.mjs';

export const newId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export const ROLES = ['taxi_driver', 'courier', 'food_seller', 'company', 'host', 'tour_operator', 'hotel'];
export const ROLE_LABEL = { taxi_driver: 'Водитель такси', courier: 'Курьер', food_seller: 'Продавец еды', company: 'Компания (доставки)',
  host: 'Квартиры и дома', tour_operator: 'Туры', hotel: 'Отель' };
export const LEGAL_FORMS = ['npd', 'ip', 'ooo'];
export const LEGAL_LABEL = { npd: 'Самозанятый (НПД)', ip: 'ИП', ooo: 'ООО' };
export const EXEC_STATUSES = ['draft', 'submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'suspended', 'blocked'];

export const clean = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Транзакция: BEGIN/COMMIT, откат при ошибке. */
export const inTx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Шифрование сведений (JSON) ───────────────────────────────────── */
export const sealJson = (obj) => encryptContent(JSON.stringify(obj ?? {}));
export const openJson = (blob) => { try { return JSON.parse(decryptContent(blob) ?? '{}'); } catch { return {}; } };

/* ─── Настройки (правит администрация) ─────────────────────────────── */
const cache = new Map();
export const getSetting = async (key, fallback = null) => {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const { rows } = await query('SELECT value FROM go_settings WHERE key = $1', [key]);
  const value = rows[0]?.value ?? fallback;
  cache.set(key, { value, until: Date.now() + 15_000 });
  return value;
};
export const setSetting = async (key, value, actorId) => {
  await query(
    `INSERT INTO go_settings (key, value, updated_by) VALUES ($1,$2::jsonb,$3)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now(), updated_by = $3`, [key, JSON.stringify(value), actorId ?? null]);
  cache.delete(key);
};

export const cities = async () => (await getSetting('cities', [])) ?? [];
export const cityOk = async (city) => (await cities()).includes(String(city ?? ''));

/* ─── Журнал и уведомления ─────────────────────────────────────────── */
export const goLog = async (actorId, action, subject, detail = {}) => {
  try {
    await query('INSERT INTO go_log (actor_id, action, subject, detail) VALUES ($1,$2,$3,$4::jsonb)',
      [actorId ?? null, clean(action, 64), subject ? clean(subject, 128) : null, JSON.stringify(detail ?? {})]);
  } catch { /* журнал не должен ронять описываемое */ }
};

/**
 * Уведомление через существующий механизм Sky (экран уведомлений + пуш тем, кого нет в сети).
 * dedupe — ключ события: по одному ключу человеку уходит одно уведомление, сколько бы раз событие ни повторилось
 * (повторный запрос, повтор события, гонка двух вкладок).
 */
export const notifyGo = async (userId, kind, title, body, refId = null, dedupe = null) => {
  if (!userId) return;
  if (dedupe) {
    const { rowCount } = await query('INSERT INTO go_notified (user_id, key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, clean(dedupe, 160)]).catch(() => ({ rowCount: 1 }));
    if (!rowCount) return;
  }
  try { await notifyGift(userId, `go_${kind}`, clean(title, 120), clean(body, 300), refId); } catch { /* уведомление — не повод откатывать действие */ }
  try { await pushToOffline([userId], { title, body, url: '/?go=1', tag: `go:${refId ?? kind}` }); } catch { /* пуши не настроены */ }
};

/** Сообщить открытым экранам, что заказ изменился: они перечитают его с сервера (сокет — ускорение, опрос остаётся запасом). */
export const pushOrderChanged = async (orderId) => {
  try {
    const { rows } = await query('SELECT customer_id, executor_id, org_id, status FROM go_orders WHERE id = $1', [orderId]);
    const r = rows[0]; if (!r) return;
    const ids = new Set([r.customer_id, r.executor_id].filter(Boolean));
    if (r.org_id) {
      const { rows: st } = await query(`SELECT profile_id FROM go_org_members WHERE org_id = $1 AND status = 'active' AND role IN ('owner','admin','manager')`, [r.org_id]);
      for (const m of st) ids.add(m.profile_id);
    }
    pushGoEvent([...ids], { type: 'go:order', payload: { orderId, status: r.status } });
  } catch { /* живое обновление — необязательное */ }
};

/* ─── Гео ──────────────────────────────────────────────────────────── */
export const haversineKm = (a, b) => {
  const R = 6371; const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const cleanPoint = (p) => {
  const lat = Number(p?.lat); const lng = Number(p?.lng);
  const address = clean(p?.address, 240);
  return { address, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null };
};
export const pointOk = (p) => isRealPoint(p?.lat, p?.lng);

/**
 * Расстояние и время между двумя точками. Если подключены карты — настоящий маршрут; иначе оценка по прямой
 * (×1.35 и 28 км/ч) с пометкой estimated: цена всё равно считается сервером, но человек видит, что это оценка.
 */
export const routeBetween = async (a, b) => {
  const r = await computeRoute({ origin: a, stops: [{ id: 'b', lat: b.lat, lng: b.lng }] }).catch(() => ({ error: 'route_failed' }));
  if (r?.ok && r.distanceM > 0) return { km: r.distanceM / 1000, min: Math.max(1, Math.round(r.durationS / 60)), estimated: false };
  const km = haversineKm(a, b) * 1.35;
  return { km, min: Math.max(1, Math.round((km / 28) * 60)), estimated: true };
};

/* ─── Заказ: общие операции ────────────────────────────────────────── */
export const addEvent = (client, orderId, actorId, from, to, note = '') =>
  client.query('INSERT INTO go_order_events (order_id, actor_id, from_status, to_status, note) VALUES ($1,$2,$3,$4,$5)',
    [orderId, actorId ?? null, from, to, clean(note, 300)]);

export const lockOrder = async (client, id) => {
  const { rows } = await client.query('SELECT * FROM go_orders WHERE id = $1 FOR UPDATE', [String(id ?? '')]);
  return rows[0] ?? null;
};

/** Смена статуса: запись в истории и обновление строки — вместе. extra — дополнительные колонки. */
export const setStatus = async (client, order, to, actorId, note = '', extra = {}) => {
  const sets = ['status = $2', 'updated_at = now()'];
  const args = [order.id, to];
  for (const [col, val] of Object.entries(extra)) {
    if (!/^[a-z_]+$/.test(col)) throw new Error('bad column');
    args.push(val); sets.push(`${col} = $${args.length}`);
  }
  await client.query(`UPDATE go_orders SET ${sets.join(', ')} WHERE id = $1`, args);
  await addEvent(client, order.id, actorId, order.status, to, note);
  return { ...order, status: to, ...extra };
};

export const profileCards = async (ids) => {
  const list = [...new Set((ids ?? []).filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await query('SELECT id, name, username, avatar FROM profiles WHERE id = ANY($1::text[])', [list]);
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, username: r.username, avatar: r.avatar ?? null }]));
};

/** Одноразовый код: шесть цифр, хеш в базе, показывается заказчику, проверяется сервером. */
const codeMac = (orderId, purpose, code) => crypto.createHmac('sha256', `go-code:${orderId}:${purpose}`).update(String(code)).digest('hex');
export const issueCode = async (client, orderId, purpose, ttlHours = 48) => {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await client.query(
    `INSERT INTO go_order_codes (order_id, purpose, code_hash, code_enc, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)
     ON CONFLICT (order_id, purpose) DO UPDATE SET code_hash = $3, code_enc = $4, expires_at = excluded.expires_at, attempts = 0, used_at = NULL`,
    [orderId, purpose, codeMac(orderId, purpose, code), encryptContent(code), String(ttlHours)]);
  return code;
};
export const showCode = async (orderId, purpose) => {
  const { rows } = await query('SELECT code_enc, expires_at, used_at FROM go_order_codes WHERE order_id = $1 AND purpose = $2', [orderId, purpose]);
  const r = rows[0];
  if (!r) return null;
  return { code: r.used_at ? null : decryptContent(r.code_enc), used: Boolean(r.used_at), expiresAt: r.expires_at.toISOString() };
};
/** Проверить код внутри транзакции. 5 попыток, срок, одноразовость; постоянное время сравнения. */
export const checkCode = async (client, orderId, purpose, given) => {
  const { rows } = await client.query('SELECT * FROM go_order_codes WHERE order_id = $1 AND purpose = $2 FOR UPDATE', [orderId, purpose]);
  const r = rows[0];
  if (!r || r.used_at) return { error: 'code_used' };
  if (r.expires_at < new Date()) return { error: 'code_expired' };
  if (r.attempts >= 5) return { error: 'code_locked' };
  const a = Buffer.from(codeMac(orderId, purpose, String(given ?? '').replace(/\D/g, '')));
  const b = Buffer.from(r.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await client.query('UPDATE go_order_codes SET attempts = attempts + 1 WHERE order_id = $1 AND purpose = $2', [orderId, purpose]);
    return { error: 'bad_code', left: 4 - r.attempts };
  }
  await client.query('UPDATE go_order_codes SET used_at = now() WHERE order_id = $1 AND purpose = $2', [orderId, purpose]);
  return { ok: true };
};

/**
 * Точка с координатами: если клиент прислал координаты — берём их; иначе пробуем геокодировать адрес (карты Google, ключ на сервере).
 * Выдуманных координат нет: не нашлось — ошибка, и человек уточняет адрес или отмечает точку.
 */
export const resolvePoint = async (raw) => {
  const p = cleanPoint(raw);
  if (!p.address && !pointOk(p)) return { error: 'address_required' };
  if (pointOk(p)) return { ok: true, point: p };
  const g = await geocode(p.address).catch(() => null);
  if (!g) return { error: 'address_not_found' };
  return { ok: true, point: { ...p, lat: g.lat, lng: g.lng } };
};
