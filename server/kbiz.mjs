/**
 * SkyKassa Business — этап 1: бизнес, реквизиты, подписка, QR-коды, публичная страница оплаты, заявки, журнал.
 *
 * Главное правило: Sky НЕ принимает деньги покупателей, не держит балансов бизнеса и не берёт комиссию с продаж.
 * При прямой оплате покупатель переводит деньги владельцу по его реквизитам, а «Я перевёл деньги» — лишь заявление
 * покупателя. Статус «Оплата подтверждена владельцем» ставит только владелец; банковской проверки Sky не делает и так и пишет.
 * Единственные деньги, которые проходят через Sky, — подписка бизнеса (89 ₽ за 30 дней, с кошелька Sky, без автосписаний).
 *
 * Сервер решает всё: сумму фиксированного QR, валюту, владельца, статус. Из запроса покупателя берутся только
 * свободная сумма (в пределах) и короткая заметка.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { wallet } from './wallet.mjs';
import { hasPrime, verifySkyTwoFactor } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { award } from './cashbackrules.mjs';
import { newId, inTx, sealJson, openJson, clean } from './gocore.mjs';

export const SUB_PRICE_RUB = Math.max(1, Number(process.env.KBIZ_SUB_PRICE_RUB) || 89);
export const SUB_PERIOD_DAYS = 30;
const EXPIRING_DAYS = 3;
const MODES = ['online', 'point', 'both'];
const LEGAL = ['person', 'selfemployed', 'ip', 'company', 'other'];
const METHODS = ['phone', 'account', 'card', 'other'];
export const MAX_AMOUNT = 1_000_000;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const STATUS_LABEL = {
  created: 'Создана', reported: 'Покупатель сообщил об оплате', pending_check: 'Ожидает проверки', confirmed: 'Оплата подтверждена владельцем',
  not_found: 'Оплата не обнаружена', cancelled: 'Отменена', expired: 'Срок действия истёк', refunded: 'Возврат выполнен владельцем',
};
const TRANSITIONS = {
  take:      { from: ['reported'], to: 'pending_check' },
  confirm:   { from: ['reported', 'pending_check', 'not_found'], to: 'confirmed' },
  not_found: { from: ['reported', 'pending_check'], to: 'not_found' },
  cancel:    { from: ['created', 'reported', 'pending_check', 'not_found'], to: 'cancelled' },
  refund:    { from: ['confirmed'], to: 'refunded' },
};

export const err = (error, extra = {}) => ({ error, ...extra });
export const publicId = () => { const b = crypto.randomBytes(12); let s = ''; for (const x of b) s += ALPHABET[x % ALPHABET.length]; return s; };
export const ipHash = (ip) => (ip ? crypto.createHmac('sha256', `${config.jwtSecret}:kbiz-ip:v1`).update(String(ip)).digest('hex') : null);
export const keyHash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
export const payOrigin = () => (process.env.KBIZ_PUBLIC_ORIGIN || config.publicOrigin || '').replace(/\/+$/, '');
export const payUrl = (pid) => `${payOrigin()}/p/${pid}`;

/** Слова, которых в реквизитах и инструкциях быть не должно: Sky не собирает секреты банковских операций. */
const SECRET_WORDS = /(cvv|cvc|\bpin\b|пин[- ]?код|\bпин\b|парол[ьяю]|одноразов\w* код|код (из )?(sms|смс)|секретн\w* (код|слово))/i;

export const audit = async (businessId, actor, action, detail = '') =>
  query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [businessId, String(actor), action, String(detail).slice(0, 300)]).catch(() => {});

/* ─── Подписка ─── */

export const subState = async (businessId) => {
  const { rows } = await query('SELECT started_at, expires_at FROM kb_subscriptions WHERE business_id = $1 ORDER BY expires_at DESC LIMIT 1', [businessId]);
  const r = rows[0];
  const { rows: b } = await query('SELECT status FROM kb_businesses WHERE id = $1', [businessId]);
  const now = Date.now();
  const until = r?.expires_at?.getTime?.() ?? 0;
  let status = 'inactive';
  if (b[0]?.status === 'suspended') status = 'suspended';
  else if (r && until > now) status = until - now <= EXPIRING_DAYS * 86_400_000 ? 'expiring' : 'active';
  else if (r) status = 'expired';
  return { status, active: status === 'active' || status === 'expiring', startedAt: r?.started_at?.toISOString?.() ?? null, expiresAt: r?.expires_at?.toISOString?.() ?? null,
    priceRub: SUB_PRICE_RUB, periodDays: SUB_PERIOD_DAYS };
};

export const subHistory = async (businessId) => {
  const { rows } = await query('SELECT id, price_rub, started_at, expires_at, created_at FROM kb_subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50', [businessId]);
  return rows.map((r) => ({ id: r.id, priceRub: r.price_rub, startedAt: r.started_at.toISOString(), expiresAt: r.expires_at.toISOString(), at: r.created_at.toISOString() }));
};

/** Оплата/продление: списание с кошелька и строка подписки — одна транзакция; повтор ключа не продлевает дважды; цену и срок определяет сервер. */
export const buySub = async (profileId, idemKey) => {
  const key = clean(idemKey, 64) || newId('idem');
  const res = await inTx(async (c) => {
    const { rows: b } = await c.query('SELECT id, status FROM kb_businesses WHERE owner_id = $1 FOR UPDATE', [profileId]);
    if (!b[0]) return err('no_business');
    if (b[0].status === 'suspended') return err('suspended');
    const { rows: dup } = await c.query('SELECT expires_at FROM kb_subscriptions WHERE business_id = $1 AND payment_ref = $2', [b[0].id, key]);
    if (dup[0]) return { ok: true, duplicate: true, expiresAt: dup[0].expires_at.toISOString() };
    const { rows: cur } = await c.query('SELECT max(expires_at) AS until FROM kb_subscriptions WHERE business_id = $1', [b[0].id]);
    const now = new Date();
    const startsAt = cur[0].until && cur[0].until > now ? cur[0].until : now;
    const expires = new Date(startsAt.getTime() + SUB_PERIOD_DAYS * 86_400_000);
    const spent = await wallet.spendIn(c, profileId, SUB_PRICE_RUB, 'kbiz_sub', `SkyKassa Business, ${SUB_PERIOD_DAYS} дн.`, `kbiz:${b[0].id}`);
    if (spent.error) return err(spent.error, { balance: spent.balance });
    await c.query('INSERT INTO kb_subscriptions (id, business_id, profile_id, price_rub, started_at, expires_at, payment_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [newId('kbs'), b[0].id, profileId, SUB_PRICE_RUB, startsAt, expires, key]);
    await c.query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [b[0].id, profileId, 'subscription_paid', `${SUB_PRICE_RUB} ₽ до ${expires.toISOString().slice(0, 10)}`]);
    return { ok: true, expiresAt: expires.toISOString(), priceRub: SUB_PRICE_RUB, businessId: b[0].id };
  });
  if (res.ok && !res.duplicate) await notifyGift(profileId, 'kassa_biz', 'SkyKassa Business: подписка оплачена', `Доступ открыт до ${new Date(res.expiresAt).toLocaleDateString('ru-RU')}.`, `kbsub:${res.businessId}`).catch(() => {});
  return res;
};

/* ─── Бизнес ─── */

const shapeBusiness = (r) => ({
  id: r.id, name: r.name, description: r.description, category: r.category, country: r.country, mode: r.mode, legalType: r.legal_type, legalVerified: false,
  contacts: r.contacts, website: r.website, hasLogo: Boolean(r.has_logo), status: r.status, suspendedReason: r.status === 'suspended' ? r.suspended_reason : undefined, createdAt: r.created_at.toISOString(),
});
const BSEL = 'SELECT id, owner_id, name, description, category, country, mode, legal_type, contacts, website, (logo IS NOT NULL) AS has_logo, status, suspended_reason, created_at FROM kb_businesses';

const parseBusiness = (b, partial = false) => {
  const v = {};
  if (!partial || b.name !== undefined) { v.name = clean(b?.name, 80); if (v.name.length < 2) return err('bad_field', { field: 'name' }); }
  if (!partial || b.description !== undefined) v.description = clean(b?.description, 500);
  if (!partial || b.category !== undefined) v.category = clean(b?.category, 60);
  if (!partial || b.country !== undefined) { v.country = clean(b?.country, 2).toUpperCase() || 'RU'; if (!/^[A-Z]{2}$/.test(v.country)) return err('bad_field', { field: 'country' }); }
  if (!partial || b.mode !== undefined) { v.mode = MODES.includes(b?.mode) ? b.mode : null; if (!v.mode) return err('bad_field', { field: 'mode' }); }
  if (!partial || b.legalType !== undefined) { v.legal_type = LEGAL.includes(b?.legalType) ? b.legalType : null; if (!v.legal_type) return err('bad_field', { field: 'legalType' }); }
  if (!partial || b.contacts !== undefined) v.contacts = clean(b?.contacts, 200);
  if (!partial || b.website !== undefined) {
    const w = clean(b?.website, 200);
    if (w) { try { const u = new URL(w); if (u.protocol !== 'https:' || u.username || u.password) return err('bad_field', { field: 'website' }); v.website = u.toString(); } catch { return err('bad_field', { field: 'website' }); } } else v.website = '';
  }
  return { v };
};

export const myBusiness = async (profileId) => {
  const { rows } = await query(`${BSEL} WHERE owner_id = $1`, [profileId]);
  if (!rows[0]) return { business: null, subscription: { status: 'inactive', active: false, priceRub: SUB_PRICE_RUB, periodDays: SUB_PERIOD_DAYS } };
  const sub = await subState(rows[0].id);
  const { rows: rq } = await query('SELECT data_enc, updated_at FROM kb_requisites WHERE business_id = $1', [rows[0].id]);
  return { business: shapeBusiness(rows[0]), subscription: sub, requisites: rq[0] ? { ...openJson(rq[0].data_enc), updatedAt: rq[0].updated_at.toISOString() } : null, payOrigin: payOrigin() };
};

export const createBusiness = async (profileId, body) => {
  const p = parseBusiness(body ?? {});
  if (p.error) return p;
  const id = newId('kbz');
  try {
    await query(`INSERT INTO kb_businesses (id, owner_id, name, description, category, country, mode, legal_type, contacts, website) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, profileId, p.v.name, p.v.description ?? '', p.v.category ?? '', p.v.country, p.v.mode, p.v.legal_type, p.v.contacts ?? '', p.v.website ?? '']);
  } catch (e) { if (e.code === '23505') return err('already_exists'); throw e; }
  await audit(id, profileId, 'business_created', `${p.v.name} · ${p.v.mode}`);
  return { ok: true, id };
};

export const updateBusiness = async (profileId, body) => {
  const { rows } = await query('SELECT id, status FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!rows[0]) return err('no_business');
  const p = parseBusiness(body ?? {}, true);
  if (p.error) return p;
  const keys = Object.keys(p.v);
  if (!keys.length) return { ok: true };
  await query(`UPDATE kb_businesses SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [rows[0].id, ...keys.map((k) => p.v[k])]);
  await audit(rows[0].id, profileId, 'business_updated', keys.join(', '));
  return { ok: true };
};

/** data:image/(png|jpeg|webp);base64 → { buf, mime } с проверкой сигнатуры и размера (300 КБ) или { error }. */
export const imageFromDataUrl = (dataUrl) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return err('bad_logo');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 300 * 1024) return err('logo_too_large');
  const sig = LOGO_TYPES[m[1]];
  if (sig ? !sig.every((x, i) => buf[i] === x) : !(buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP')) return err('bad_logo');
  return { buf, mime: m[1] };
};
const LOGO_TYPES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': null };
export const setLogo = async (profileId, dataUrl) => {
  const { rows } = await query('SELECT id FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!rows[0]) return err('no_business');
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return err('bad_logo');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 300 * 1024) return err('logo_too_large');
  const sig = LOGO_TYPES[m[1]];
  if (sig ? !sig.every((x, i) => buf[i] === x) : !(buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP')) return err('bad_logo');
  await query('UPDATE kb_businesses SET logo = $2, logo_type = $3, updated_at = now() WHERE id = $1', [rows[0].id, buf, m[1]]);
  await audit(rows[0].id, profileId, 'logo_changed', `${buf.length} байт`);
  return { ok: true };
};

/** Логотип показывается на публичных страницах только у действующего бизнеса. */
export const logoOf = async (businessId) => {
  const { rows } = await query(`SELECT logo, logo_type FROM kb_businesses WHERE id = $1 AND status = 'active' AND logo IS NOT NULL`, [businessId]);
  return rows[0] ? { data: rows[0].logo, type: rows[0].logo_type } : null;
};

/* ─── Реквизиты ─── */

const parseRequisites = (b) => {
  const holder = clean(b?.holder, 120); if (holder.length < 2) return err('bad_field', { field: 'holder' });
  const method = METHODS.includes(b?.method) ? b.method : null; if (!method) return err('bad_field', { field: 'method' });
  const value = clean(b?.value, 64);
  if (value.length < 4 || !/^[0-9A-Za-zА-Яа-я +()\-./]+$/.test(value)) return err('bad_field', { field: 'value' });
  if (method === 'card' && !/^[0-9 ]{16,23}$/.test(value)) return err('bad_field', { field: 'value' });   // только номер карты получателя, без срока и CVV
  const bank = clean(b?.bank, 80); const purpose = clean(b?.purpose, 140); const instruction = clean(b?.instruction, 400);
  const extra = clean(b?.extra, 200);   // БИК, корр. счёт, ИНН — строкой, показывается покупателю как есть
  for (const [f, t] of [['purpose', purpose], ['instruction', instruction], ['extra', extra], ['bank', bank]]) if (SECRET_WORDS.test(t)) return err('secret_words', { field: f });
  return { v: { holder, method, value, bank, purpose, instruction, extra } };
};

/** Смена реквизитов — самое опасное действие бизнеса (деньги покупателей пойдут в другое место): при включённом аутентификаторе нужен его код. */
export const setRequisites = async (profileId, skyId, body) => {
  const { rows } = await query('SELECT id, status FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!rows[0]) return err('no_business');
  if (rows[0].status === 'suspended') return err('suspended');
  const p = parseRequisites(body ?? {});
  if (p.error) return p;
  const tf = await verifySkyTwoFactor(skyId, body?.twoFactorCode);
  if (tf?.error) return err(tf.error === 'invalid_code' ? 'two_factor_required' : tf.error);
  const { rows: old } = await query('SELECT data_enc FROM kb_requisites WHERE business_id = $1', [rows[0].id]);
  const prev = old[0] ? openJson(old[0].data_enc) : null;
  const changed = prev ? Object.keys(p.v).filter((k) => String(prev[k] ?? '') !== String(p.v[k] ?? '')) : Object.keys(p.v);
  if (prev && !changed.length) return { ok: true, unchanged: true };
  await query(`INSERT INTO kb_requisites (business_id, data_enc, updated_by) VALUES ($1,$2,$3) ON CONFLICT (business_id) DO UPDATE SET data_enc = $2, updated_by = $3, updated_at = now()`,
    [rows[0].id, sealJson(p.v), profileId]);
  await audit(rows[0].id, profileId, prev ? 'requisites_changed' : 'requisites_set', changed.join(', '));
  if (prev) await notifyGift(profileId, 'kassa_biz', 'SkyKassa Business: изменены реквизиты', 'Платежи по вашим QR-кодам теперь идут по новым реквизитам. Если это были не вы — смените пароль и завершите чужие сеансы.', `kbreq:${rows[0].id}:${Date.now()}`).catch(() => {});
  return { ok: true, changed };
};

/** Опубликовать: бизнес виден покупателям, когда заданы реквизиты (и действует подписка — проверяется отдельно при показе). */
export const publish = async (profileId, on) => {
  const { rows } = await query('SELECT id, status FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!rows[0]) return err('no_business');
  if (rows[0].status === 'suspended') return err('suspended');
  if (on) {
    const { rows: rq } = await query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [rows[0].id]);
    if (!rq[0]) return err('requisites_required');
  }
  await query('UPDATE kb_businesses SET status = $2, updated_at = now() WHERE id = $1', [rows[0].id, on ? 'active' : 'draft']);
  await audit(rows[0].id, profileId, on ? 'published' : 'unpublished');
  return { ok: true, status: on ? 'active' : 'draft' };
};

/* ─── QR-коды ─── */

const shapeQr = (r) => ({
  id: r.id, publicId: r.public_id, kind: r.kind, title: r.title, description: r.description, amountRub: r.amount_rub, currency: r.currency, orderNo: r.order_no,
  instruction: r.instruction, expiresAt: r.expires_at?.toISOString?.() ?? null, status: r.status, createdAt: r.created_at.toISOString(),
  url: payUrl(r.public_id), opens: r.opens ?? 0, requests: r.requests ?? 0, confirmed: r.confirmed ?? 0,
});
const QSEL = `SELECT q.*, (SELECT count(*)::int FROM kb_qr_opens o WHERE o.qr_id = q.id) AS opens,
  (SELECT count(*)::int FROM kb_payments p WHERE p.qr_id = q.id AND p.status <> 'created') AS requests,
  (SELECT count(*)::int FROM kb_payments p WHERE p.qr_id = q.id AND p.status = 'confirmed') AS confirmed FROM kb_qr q`;

export const listQr = async (profileId) => {
  const { rows: b } = await query('SELECT id FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!b[0]) return { qr: [] };
  const { rows } = await query(`${QSEL} WHERE q.business_id = $1 AND q.kind IN ('pay','permanent') ORDER BY q.created_at DESC LIMIT 200`, [b[0].id]);
  return { qr: rows.map(shapeQr) };
};

const parseQr = (b, permanent) => {
  const title = clean(b?.title, 80); if (title.length < 2) return err('bad_field', { field: 'title' });
  let amount = null;
  if (!permanent && b?.amountRub !== undefined && b?.amountRub !== null && b?.amountRub !== '') {
    amount = Number(b.amountRub);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) return err('bad_field', { field: 'amountRub' });
  }
  let expires = null;
  if (b?.expiresAt) { expires = new Date(b.expiresAt); if (Number.isNaN(expires.getTime()) || expires <= new Date()) return err('bad_field', { field: 'expiresAt' }); }
  return { v: { title, description: clean(b?.description, 300), amount, orderNo: clean(b?.orderNo, 40), instruction: clean(b?.instruction, 300), expires } };
};

export const createQr = async (profileId, body, { permanent = false } = {}) => {
  const { rows: b } = await query('SELECT id, status FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!b[0]) return err('no_business');
  if (b[0].status === 'suspended') return err('suspended');
  const sub = await subState(b[0].id);
  if (!sub.active) return err('subscription_required', { expired: sub.status === 'expired' });
  const p = parseQr(permanent ? { title: body?.title || 'Оплата', instruction: body?.instruction } : body, permanent);
  if (p.error) return p;
  const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM kb_qr WHERE business_id = $1 AND status <> 'archived' AND kind IN ('pay','permanent','tip')`, [b[0].id]);
  if (cnt[0].n >= 500) return err('too_many_qr');
  const id = newId('kbq');
  try {
    await query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, instruction, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, publicId(), b[0].id, permanent ? 'permanent' : 'pay', p.v.title, p.v.description, p.v.amount, p.v.orderNo, p.v.instruction, p.v.expires, profileId]);
  } catch (e) { if (e.code === '23505') return err('already_exists'); throw e; }
  await audit(b[0].id, profileId, permanent ? 'permanent_qr_created' : 'qr_created', p.v.title);
  const { rows } = await query(`${QSEL} WHERE q.id = $1`, [id]);
  return { ok: true, qr: shapeQr(rows[0]) };
};

export const setQrStatus = async (profileId, qrId, status) => {
  if (!['active', 'disabled', 'archived'].includes(status)) return err('bad_status');
  const { rows } = await query('SELECT q.id, q.business_id, q.status, q.title FROM kb_qr q JOIN kb_businesses b ON b.id = q.business_id WHERE q.id = $1 AND b.owner_id = $2', [String(qrId ?? ''), profileId]);
  if (!rows[0]) return err('not_found');
  if (rows[0].status === 'archived') return err('archived');
  if (status === 'active') { const sub = await subState(rows[0].business_id); if (!sub.active) return err('subscription_required'); }
  await query('UPDATE kb_qr SET status = $2, updated_at = now() WHERE id = $1', [rows[0].id, status]);
  await audit(rows[0].business_id, profileId, `qr_${status}`, rows[0].title);
  return { ok: true };
};

/* ─── Публичная страница ─── */

const loadPublic = async (pid) => {
  const { rows } = await query(
    `SELECT q.*, b.name AS biz_name, b.description AS biz_desc, b.status AS biz_status, b.id AS biz_id, b.website, b.contacts, (b.logo IS NOT NULL) AS has_logo
       FROM kb_qr q JOIN kb_businesses b ON b.id = q.business_id WHERE q.public_id = $1`, [String(pid ?? '')]);
  return rows[0] ?? null;
};

/** Доступна ли страница покупателям: бизнес опубликован, не приостановлен, подписка действует, QR включён и не просрочен. */
const pageState = async (q) => {
  if (q.biz_status !== 'active') return q.biz_status === 'suspended' ? 'suspended' : 'unavailable';
  if (q.status !== 'active') return q.status === 'archived' ? 'unavailable' : 'disabled';
  if (q.expires_at && q.expires_at <= new Date()) return 'expired';
  const sub = await subState(q.biz_id);
  if (!sub.active) return 'unavailable';
  return 'open';
};

export const publicPage = async (pid, ip) => {
  const q = await loadPublic(pid);
  if (!q) return err('not_found');
  const state = await pageState(q);
  const base = { business: { name: q.biz_name, description: q.biz_desc, hasLogo: q.has_logo, logoUrl: q.has_logo ? `/api/kbiz/public/logo/${q.biz_id}` : null, website: q.website || undefined, contacts: q.contacts || undefined },
    title: q.title, description: q.description, state, kind: q.kind };
  if (state !== 'open') return base;
  // Открытие считается один раз в сутки с одного адреса: накрутить счётчик одним клиентом нельзя.
  const h = ipHash(ip);
  if (h) await query('INSERT INTO kb_qr_opens (qr_id, day, ip_hash) VALUES ($1, current_date, $2) ON CONFLICT DO NOTHING', [q.id, h]).catch(() => {});
  const { rows: rq } = await query('SELECT data_enc FROM kb_requisites WHERE business_id = $1', [q.biz_id]);
  const r = rq[0] ? openJson(rq[0].data_enc) : null;
  if (!r) return { ...base, state: 'unavailable' };
  const cfg = q.config ?? {};
  const tip = q.kind === 'tip' ? { recipient: cfg.recipient, message: cfg.message, amounts: cfg.amounts, allowCustom: cfg.allowCustom !== false, photoUrl: cfg.mediaId ? `/api/kbiz/public/media/${cfg.mediaId}` : null } : undefined;
  const lines = (q.kind === 'invoice' || q.kind === 'order') && Array.isArray(cfg.lines) ? cfg.lines : undefined;
  return { ...base, amountRub: q.amount_rub, currency: q.currency, orderNo: q.order_no || undefined, instruction: q.instruction || r.instruction || undefined,
    requisites: { holder: r.holder, method: r.method, value: r.value, bank: r.bank || undefined, purpose: r.purpose || undefined, extra: r.extra || undefined },
    tip, lines, number: cfg.number,
    minAmountRub: q.kind === 'tip' ? (cfg.min ?? 1) : 1, maxAmountRub: q.kind === 'tip' ? (cfg.max ?? MAX_AMOUNT) : MAX_AMOUNT, note: 'Это прямой перевод владельцу бизнеса. Sky не принимает деньги и не проверяет перевод: владелец сам подтверждает получение.' };
};

/** «Я перевёл деньги»: создаёт заявку со статусом «Покупатель сообщил об оплате». Это заявление покупателя, а не подтверждение поступления. */
export const reportPayment = async (pid, body, ip) => {
  const q = await loadPublic(pid);
  if (!q) return err('not_found');
  const state = await pageState(q);
  if (state !== 'open') return err('page_unavailable', { state });
  let amount = q.amount_rub;                       // у фиксированного QR сумма — только с сервера
  if (amount == null) {
    amount = Number(body?.amountRub);
    const lo = q.kind === 'tip' ? Number(q.config?.min) || 1 : 1; const hi = q.kind === 'tip' ? Number(q.config?.max) || MAX_AMOUNT : MAX_AMOUNT;
    if (!Number.isInteger(amount) || amount < lo || amount > hi) return err('bad_amount');
  }
  const h = ipHash(ip);
  // Массовые фиктивные заявки: пределы на адрес, на QR и на бизнес в сутки.
  const { rows: lim } = await query(
    `SELECT count(*) FILTER (WHERE ip_hash = $1 AND created_at > now() - interval '1 hour')::int AS ip_n,
            count(*) FILTER (WHERE qr_id = $2 AND created_at > now() - interval '1 day')::int AS qr_n,
            count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS biz_n
       FROM kb_payments WHERE business_id = $3`, [h, q.id, q.biz_id]);
  if (lim[0].ip_n >= 5) return err('too_many_requests');
  if (lim[0].qr_n >= 200 || lim[0].biz_n >= 1000) return err('too_many_requests');
  const id = newId('kbp');
  const key = crypto.randomBytes(18).toString('base64url');
  await inTx(async (c) => {
    await c.query(`INSERT INTO kb_payments (id, business_id, qr_id, amount_rub, currency, order_no, status, buyer_note, buyer_key_hash, ip_hash, reported_at) VALUES ($1,$2,$3,$4,$5,$6,'reported',$7,$8,$9, now())`,
      [id, q.biz_id, q.id, amount, q.currency, q.order_no || clean(body?.orderNo, 40), clean(body?.note, 300), keyHash(key), h]);
    await c.query(`INSERT INTO kb_payment_log (payment_id, actor, from_status, to_status, note) VALUES ($1,'buyer','created','reported','Покупатель сообщил о переводе')`, [id]);
  });
  const { rows: ow } = await query('SELECT owner_id FROM kb_businesses WHERE id = $1', [q.biz_id]);
  if (ow[0]) await notifyGift(ow[0].owner_id, 'kassa_biz', 'Покупатель сообщил об оплате', `${amount} ₽ — «${q.title}». Проверьте поступление и подтвердите.`, `kbp:${id}`).catch(() => {});
  return { ok: true, id, statusKey: key, status: 'reported', statusLabel: STATUS_LABEL.reported };
};

export const buyerStatus = async (id, key) => {
  const { rows } = await query('SELECT p.status, p.amount_rub, b.name FROM kb_payments p JOIN kb_businesses b ON b.id = p.business_id WHERE p.id = $1 AND p.buyer_key_hash = $2', [String(id ?? ''), keyHash(key)]);
  if (!rows[0]) return err('not_found');
  return { status: rows[0].status, statusLabel: STATUS_LABEL[rows[0].status], amountRub: rows[0].amount_rub, business: rows[0].name,
    note: rows[0].status === 'confirmed' ? 'Владелец подтвердил получение перевода.' : 'Статус ставит владелец бизнеса после проверки поступления.' };
};

/* ─── Заявки (владелец) ─── */

const shapePayment = (r) => ({ id: r.id, qrId: r.qr_id, qrTitle: r.qr_title ?? undefined, amountRub: r.amount_rub, currency: r.currency, orderNo: r.order_no, status: r.status, statusLabel: STATUS_LABEL[r.status],
  source: r.source, buyerNote: r.buyer_note, ownerComment: r.owner_comment, confirmedBy: r.confirmed_by ? 'owner' : undefined,
  reportedAt: r.reported_at?.toISOString?.() ?? null, confirmedAt: r.confirmed_at?.toISOString?.() ?? null, createdAt: r.created_at.toISOString() });

export const listPayments = async (profileId, { status, qrId, limit = 100 } = {}) => {
  const { rows: b } = await query('SELECT id FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!b[0]) return { payments: [] };
  await query(`UPDATE kb_payments SET status = 'expired', updated_at = now() WHERE business_id = $1 AND status = 'created' AND created_at < now() - interval '48 hours'`, [b[0].id]);
  const vals = [b[0].id]; let w = 'p.business_id = $1';
  if (status && Object.hasOwn(STATUS_LABEL, status)) { vals.push(status); w += ` AND p.status = $${vals.length}`; }
  if (qrId) { vals.push(String(qrId)); w += ` AND p.qr_id = $${vals.length}`; }
  vals.push(Math.min(500, Math.max(1, Number(limit) || 100)));
  const { rows } = await query(`SELECT p.*, q.title AS qr_title FROM kb_payments p LEFT JOIN kb_qr q ON q.id = p.qr_id WHERE ${w} ORDER BY p.created_at DESC LIMIT $${vals.length}`, vals);
  return { payments: rows.map(shapePayment) };
};

export const paymentLog = async (profileId, id) => {
  const { rows } = await query('SELECT l.actor, l.from_status, l.to_status, l.note, l.at FROM kb_payment_log l JOIN kb_payments p ON p.id = l.payment_id JOIN kb_businesses b ON b.id = p.business_id WHERE p.id = $1 AND b.owner_id = $2 ORDER BY l.id', [String(id ?? ''), profileId]);
  return { log: rows.map((r) => ({ actor: r.actor === 'buyer' || r.actor === 'system' ? r.actor : 'owner', from: r.from_status, to: r.to_status, toLabel: STATUS_LABEL[r.to_status], note: r.note, at: r.at.toISOString() })) };
};

/** Смена статуса заявки владельцем. Допустимые переходы — по таблице; повтор того же действия — без второй записи. */
export const actOnPayment = async (profileId, id, action, comment) => {
  const t = TRANSITIONS[action];
  if (!t) return err('bad_action');
  return inTx(async (c) => {
    const { rows } = await c.query('SELECT p.id, p.status, p.business_id, p.amount_rub FROM kb_payments p JOIN kb_businesses b ON b.id = p.business_id WHERE p.id = $1 AND b.owner_id = $2 FOR UPDATE OF p', [String(id ?? ''), profileId]);
    if (!rows[0]) return err('not_found');
    if (rows[0].status === t.to) return { ok: true, duplicate: true, status: t.to };
    if (!t.from.includes(rows[0].status)) return err('bad_state', { status: rows[0].status });
    const note = clean(comment, 300);
    if ((action === 'not_found' || action === 'cancel' || action === 'refund') && note.length < 3) return err('comment_required');
    await c.query(`UPDATE kb_payments SET status = $2, owner_comment = CASE WHEN $3 = '' THEN owner_comment ELSE $3 END, updated_at = now(),
        confirmed_by = CASE WHEN $2 = 'confirmed' THEN $4 ELSE confirmed_by END, confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END WHERE id = $1`, [rows[0].id, t.to, note, profileId]);
    await c.query('INSERT INTO kb_payment_log (payment_id, actor, from_status, to_status, note) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, profileId, rows[0].status, t.to, note]);
    await c.query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,$2,$3,$4)', [rows[0].business_id, profileId, `payment_${action}`, `${rows[0].id}: ${rows[0].amount_rub} ₽`]);
    return { ok: true, status: t.to, statusLabel: STATUS_LABEL[t.to] };
  });
};

export const auditList = async (profileId, limit = 100) => {
  const { rows } = await query('SELECT a.actor, a.action, a.detail, a.at FROM kb_audit a JOIN kb_businesses b ON b.id = a.business_id WHERE b.owner_id = $1 ORDER BY a.id DESC LIMIT $2', [profileId, Math.min(300, Math.max(1, Number(limit) || 100))]);
  return { audit: rows.map((r) => ({ actor: r.actor === profileId ? 'owner' : 'other', action: r.action, detail: r.detail, at: r.at.toISOString() })) };
};

const csvCell = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}`.replace(/"/g, '""') : s.replace(/"/g, '""'); };
/** Экспорт заявок — доступен и при истёкшей подписке (режим просмотра и выгрузки). Ячейки-формулы экранируются. */
export const exportPaymentsCsv = async (profileId) => {
  const { payments } = await listPayments(profileId, { limit: 500 });
  const head = ['Номер', 'Создана', 'Сумма ₽', 'Статус', 'Кто сообщил', 'QR', 'Номер заказа', 'Комментарий покупателя', 'Комментарий владельца'];
  const lines = [head.join(',')].concat(payments.map((p) => [p.id, p.createdAt, p.amountRub, p.statusLabel, 'покупатель', p.qrTitle ?? '', p.orderNo, p.buyerNote, p.ownerComment].map((c) => `"${csvCell(c)}"`).join(',')));
  return `﻿${lines.join('\n')}\n`;
};

/** Сводка для «Обзора»: заявленное покупателями и подтверждённое владельцем — раздельно (это не банковская выписка). */
export const overview = async (profileId) => {
  const { rows: b } = await query('SELECT id FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!b[0]) return { stats: null };
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE status <> 'created')::int AS requests,
            count(*) FILTER (WHERE status IN ('reported','pending_check'))::int AS awaiting,
            count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
            COALESCE(SUM(amount_rub) FILTER (WHERE status IN ('reported','pending_check','confirmed','not_found','refunded')), 0)::bigint AS claimed_sum,
            COALESCE(SUM(amount_rub) FILTER (WHERE status = 'confirmed'), 0)::bigint AS confirmed_sum
       FROM kb_payments WHERE business_id = $1`, [b[0].id]);
  const { rows: q } = await query(`SELECT count(*)::int AS n, (SELECT count(*)::int FROM kb_qr_opens o JOIN kb_qr x ON x.id = o.qr_id WHERE x.business_id = $1) AS opens FROM kb_qr WHERE business_id = $1 AND status <> 'archived'`, [b[0].id]);
  return { stats: { qr: q[0].n, opens: q[0].opens, requests: rows[0].requests, awaiting: rows[0].awaiting, confirmed: rows[0].confirmed,
    claimedSumRub: Number(rows[0].claimed_sum), confirmedByOwnerSumRub: Number(rows[0].confirmed_sum), confirmedByIntegrationSumRub: 0 } };
};

/* ─── Сканер QR в SkyMoney ─── */

/** pid из отсканированного текста: только наши страницы оплаты /p/<id>. Любой другой адрес не открываем (фишинг). */
export const pidFromScan = (text) => {
  const t = String(text ?? '').trim();
  try {
    const u = new URL(t);
    const m = /^\/p\/([a-z0-9]{12,24})\/?$/.exec(u.pathname);
    if (!m || !['https:', 'http:'].includes(u.protocol)) return null;
    const okHost = [payOrigin(), config.publicOrigin].filter(Boolean).some((o) => { try { return new URL(o).host === u.host; } catch { return false; } });
    return okHost || process.env.NODE_ENV !== 'production' ? m[1] : null;
  } catch { return null; }
};

/**
 * Сканирование QR вошедшим человеком. Открывает страницу (клиент) и — только Prime — начисляет кэшбэк баллами по правилу «Сканирование QR SkyKassa»
 * (правила задаёт администрация; без правила баллов нет). Один бизнес — один кэшбэк в сутки на человека; свой QR кэшбэка не даёт.
 */
export const scan = async (profileId, text) => {
  const pid = pidFromScan(text) ?? (/^[a-z0-9]{12,24}$/.test(String(text ?? '').trim()) ? String(text).trim() : null);
  if (!pid) return err('not_skykassa_qr');
  const q = await loadPublic(pid);
  if (!q) return err('not_found');
  const state = await pageState(q);
  const out = { ok: true, publicId: pid, state, business: q.biz_name, granted: [], prime: false };
  if (state !== 'open') return out;
  const { rowCount } = await query(`INSERT INTO kb_scans (profile_id, business_id, day) VALUES ($1,$2,current_date) ON CONFLICT (profile_id, business_id, day) DO UPDATE SET scans = kb_scans.scans + 1`, [profileId, q.biz_id]);
  void rowCount;
  out.prime = await hasPrime(profileId);
  if (out.prime) {
    const { rows: ow } = await query('SELECT owner_id FROM kb_businesses WHERE id = $1', [q.biz_id]);
    const day = new Date().toISOString().slice(0, 10);
    const r = await award({ trigger: 'kassa_scan', profileId, counterpartyId: ow[0]?.owner_id, amountRub: 0, ref: `kscan:${profileId}:${q.biz_id}:${day}` });
    out.granted = r.granted.map((g) => ({ points: g.points, title: g.title, status: g.status }));
  }
  return out;
};
