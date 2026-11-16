/**
 * Sky Marketplace — биржа специалистов для владельцев каналов.
 *
 *  • Анкету специалиста (имя, фото, описание, специализации, услуги, портфолио, доступность) публикует только администрация (право `specialists`,
 *    не свою — `self_review`); правка проверяемых полей возвращает анкету на проверку и снимает с показа.
 *  • Предложение: клиент описывает задачу → обсуждение условий (сообщения) → специалист принимает или отклоняет. Статусы заказа:
 *    accepted → in_progress → completed | cancelled | disputed (спор решает администрация).
 *  • ДЕНЕГ ЗДЕСЬ НЕТ: «бюджет» — справочная цифра предложения, Sky её не принимает, не удерживает и не гарантирует. Проверка финансовой системы (см. docs/SKY-SPECIALISTS.md):
 *    кошелёк не умеет эскроу под заказ; для безопасной оплаты стороны могут оформить обычную сделку Sky Garant вручную. Платёж внутри биржи не имитируется.
 *  • Тексты предложений и обсуждения хранятся зашифрованно; жалобы — на анкету или предложение.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';

export const CATEGORIES = { editors: 'Видеомонтажёры', designers: 'Дизайнеры', writers: 'Сценаристы', covers: 'Создатели обложек', promo: 'Специалисты по продвижению', other: 'Другие специалисты' };
export const WORK_TYPES = { one_time: 'Разовый заказ', long_term: 'Долгосрочное сотрудничество' };
export const AVAIL = { open: 'Принимаю заказы', busy: 'Занят, возможна очередь', closed: 'Не принимаю' };
const REPORT_REASONS = ['fraud', 'spam', 'abuse', 'fake_portfolio', 'illegal', 'other'];
const MAX_PHOTO = 300 * 1024, MAX_WORK = 400 * 1024, MAX_PORTFOLIO = 12, MAX_OPEN_OFFERS = 10, MAX_MSGS = 200;
const err = (code, extra = {}) => ({ error: code, ...extra });
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31 || c === '\n').join('').trim().slice(0, n);
const id = (p) => `${p}-${crypto.randomUUID()}`;
const dec = (b) => { try { return b ? decryptSecret(b) : ''; } catch { return ''; } };
const cleanUrl = (v) => { const s = String(v ?? '').trim(); if (!s) return ''; try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') && s.length <= 200 ? u.toString() : null; } catch { return null; } };
const log = (actor, target, action, detail = '') => query('INSERT INTO specialist_log (actor_id, target_id, action, detail) VALUES ($1,$2,$3,$4)', [actor, target, action, String(detail).slice(0, 300)]).catch(() => {});

/** Картинка по сигнатуре (PNG/JPEG/WebP), data-URL → буфер. */
export const readImage = (dataUrl, max) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) return err('bad_image');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > max) return err('image_too_large');
  const g = buf.subarray(0, 12);
  const ok = (m[1] === 'image/png' && g.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
    || (m[1] === 'image/jpeg' && g[0] === 0xff && g[1] === 0xd8)
    || (m[1] === 'image/webp' && g.subarray(0, 4).toString() === 'RIFF' && g.subarray(8, 12).toString() === 'WEBP');
  return ok ? { buf, type: m[1] } : err('bad_image');
};

const cleanServices = (raw) => (Array.isArray(raw) ? raw : []).slice(0, 12).map((o) => {
  const title = clean(o?.title, 80); if (!title) return null;
  const wt = ['one_time', 'long_term', 'both'].includes(o?.workType) ? o.workType : 'one_time';
  const pf = Number(o?.priceFrom); const priceFrom = Number.isFinite(pf) && pf > 0 && pf <= 10_000_000 ? Math.trunc(pf) : null;
  return { title, workType: wt, priceFrom, note: clean(o?.note, 200) };
}).filter(Boolean);

const shape = (r, { full = false } = {}) => ({
  id: r.id, ownerId: r.owner_id, category: r.category, displayName: r.display_name, headline: r.headline, description: r.description,
  specializations: r.specializations, services: r.services, workTypes: r.work_types, availability: r.availability, availabilityNote: r.availability_note,
  hasPhoto: Boolean(r.photo_type), status: r.status, ...(full ? { statusReason: r.status_reason, updatedAt: r.updated_at } : {}),
});

/* ─── Анкета ───────────────────────────────────────────────────────── */
export const myProfile = async (me) => {
  const { rows } = await query('SELECT * FROM specialist_profiles WHERE owner_id = $1', [me]);
  if (!rows[0]) return { profile: null, categories: CATEGORIES };
  const { rows: pf } = await query('SELECT id, title, description, url, image_type IS NOT NULL AS has_image FROM specialist_portfolio WHERE profile_id = $1 ORDER BY created_at', [rows[0].id]);
  return { profile: { ...shape(rows[0], { full: true }), portfolio: pf.map((x) => ({ id: x.id, title: x.title, description: x.description, url: x.url, hasImage: x.has_image })) }, categories: CATEGORIES };
};

const REVIEW_FIELDS = ['category', 'display_name', 'headline', 'description', 'specializations', 'services'];
export const saveProfile = async (me, body = {}) => {
  const category = String(body.category ?? ''); if (!CATEGORIES[category]) return err('bad_field', { field: 'category' });
  const name = clean(body.displayName, 60); if (name.length < 2) return err('bad_field', { field: 'displayName' });
  const description = clean(body.description, 2000); if (description.length < 20) return err('bad_field', { field: 'description' });
  const specs = [...new Set((Array.isArray(body.specializations) ? body.specializations : []).map((x) => clean(x, 40)).filter(Boolean))].slice(0, 10);
  if (!specs.length) return err('bad_field', { field: 'specializations' });
  const services = cleanServices(body.services);
  const workTypes = [...new Set((Array.isArray(body.workTypes) ? body.workTypes : []).filter((x) => WORK_TYPES[x]))];
  if (!workTypes.length) return err('bad_field', { field: 'workTypes' });
  const availability = AVAIL[body.availability] ? body.availability : 'open';
  const row = {
    category, display_name: name, headline: clean(body.headline, 120), description, specializations: specs, services: JSON.stringify(services), work_types: workTypes,
    availability, availability_note: clean(body.availabilityNote, 160),
  };
  const { rows: cur } = await query('SELECT * FROM specialist_profiles WHERE owner_id = $1', [me]);
  if (!cur[0]) {
    const pid = id('spc');
    await query(`INSERT INTO specialist_profiles (id, owner_id, category, display_name, headline, description, specializations, services, work_types, availability, availability_note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`, [pid, me, row.category, row.display_name, row.headline, row.description, row.specializations, row.services, row.work_types, row.availability, row.availability_note]);
    await log(me, pid, 'created'); return { ok: true, id: pid, status: 'draft' };
  }
  const c = cur[0];
  if (c.status === 'suspended') return err('suspended');
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));   // jsonb переставляет ключи
  const changed = REVIEW_FIELDS.some((f) => canon(f === 'services' ? c.services : c[f]) !== canon(f === 'services' ? JSON.parse(row.services) : row[f]));
  const status = changed && ['published', 'pending'].includes(c.status) ? 'pending' : (changed && c.status === 'rejected' ? 'draft' : c.status);
  await query(`UPDATE specialist_profiles SET category=$2, display_name=$3, headline=$4, description=$5, specializations=$6, services=$7::jsonb, work_types=$8, availability=$9, availability_note=$10, status=$11, updated_at=now() WHERE id=$1`,
    [c.id, row.category, row.display_name, row.headline, row.description, row.specializations, row.services, row.work_types, row.availability, row.availability_note, status]);
  await log(me, c.id, 'edited', changed ? 'проверяемые поля' : 'доступность/условия');
  return { ok: true, id: c.id, status, sentBackToReview: status !== c.status };
};

export const setPhoto = async (me, dataUrl) => {
  const img = readImage(dataUrl, MAX_PHOTO); if (img.error) return img;
  const { rows } = await query('SELECT id, status FROM specialist_profiles WHERE owner_id = $1', [me]); if (!rows[0]) return err('no_profile');
  if (rows[0].status === 'suspended') return err('suspended');
  const status = rows[0].status === 'published' ? 'pending' : rows[0].status;
  await query('UPDATE specialist_profiles SET photo=$2, photo_type=$3, status=$4, updated_at=now() WHERE id=$1', [rows[0].id, img.buf, img.type, status]);
  await log(me, rows[0].id, 'photo'); return { ok: true, status };
};

export const addWork = async (me, body = {}) => {
  const { rows } = await query('SELECT id, status FROM specialist_profiles WHERE owner_id = $1', [me]); if (!rows[0]) return err('no_profile');
  if (rows[0].status === 'suspended') return err('suspended');
  const { rows: n } = await query('SELECT count(*)::int AS n FROM specialist_portfolio WHERE profile_id = $1', [rows[0].id]);
  if (n[0].n >= MAX_PORTFOLIO) return err('too_many_works');
  const title = clean(body.title, 80); if (title.length < 2) return err('bad_field', { field: 'title' });
  const url = cleanUrl(body.url); if (url === null) return err('bad_field', { field: 'url' });
  let img = null; if (body.image) { img = readImage(body.image, MAX_WORK); if (img.error) return img; }
  if (!img && !url) return err('work_needs_proof');          // пример без картинки и без ссылки ничего не показывает
  const wid = id('spw');
  await query('INSERT INTO specialist_portfolio (id, profile_id, title, description, url, image, image_type) VALUES ($1,$2,$3,$4,$5,$6,$7)', [wid, rows[0].id, title, clean(body.description, 400), url, img?.buf ?? null, img?.type ?? null]);
  const status = rows[0].status === 'published' ? 'pending' : rows[0].status;
  if (status !== rows[0].status) await query("UPDATE specialist_profiles SET status='pending', updated_at=now() WHERE id=$1", [rows[0].id]);
  await log(me, rows[0].id, 'work_added', title); return { ok: true, id: wid, status };
};
export const removeWork = async (me, wid) => {
  const r = await query('DELETE FROM specialist_portfolio w USING specialist_profiles p WHERE w.id = $1 AND w.profile_id = p.id AND p.owner_id = $2', [wid, me]);
  return r.rowCount ? { ok: true } : err('not_found');
};

export const submitProfile = async (me) => {
  const { rows } = await query('SELECT * FROM specialist_profiles WHERE owner_id = $1 FOR UPDATE', [me]); const p = rows[0]; if (!p) return err('no_profile');
  if (!['draft', 'rejected', 'pending'].includes(p.status)) return err('bad_state');
  const { rows: w } = await query('SELECT count(*)::int AS n FROM specialist_portfolio WHERE profile_id = $1', [p.id]);
  const missing = [];
  if (!p.photo_type) missing.push('photo'); if (!w[0].n) missing.push('portfolio'); if (!(p.services ?? []).length) missing.push('services');
  if (missing.length) return err('incomplete', { missing });
  await query("UPDATE specialist_profiles SET status='pending', submitted_by=$2, status_reason='', updated_at=now() WHERE id=$1", [p.id, me]);
  await log(me, p.id, 'submitted'); void notifyStaff('specialist_review', { title: 'Новая анкета специалиста', body: 'Анкета ждёт проверки на бирже специалистов.', dedupe: `spc:${p.id}:${Date.now() >> 16}`, except: me });
  return { ok: true, status: 'pending' };
};

export const photoOf = async (pid, { staff = false } = {}) => {
  const { rows } = await query('SELECT photo, photo_type, status FROM specialist_profiles WHERE id = $1', [pid]);
  const r = rows[0]; if (!r?.photo || (!staff && r.status !== 'published')) return null; return { data: r.photo, type: r.photo_type };
};
export const workImage = async (wid, { staff = false, me = null } = {}) => {
  const { rows } = await query('SELECT w.image, w.image_type, p.status, p.owner_id FROM specialist_portfolio w JOIN specialist_profiles p ON p.id = w.profile_id WHERE w.id = $1', [wid]);
  const r = rows[0]; if (!r?.image || (!staff && r.status !== 'published' && r.owner_id !== me)) return null; return { data: r.image, type: r.image_type };
};

/* ─── Каталог ──────────────────────────────────────────────────────── */
export const search = async ({ category = '', spec = '', service = '', workType = '', availability = '', q = '', limit = 30, offset = 0 } = {}) => {
  const w = ["status = 'published'"]; const a = [];
  if (CATEGORIES[category]) { a.push(category); w.push(`category = $${a.length}`); }
  if (WORK_TYPES[workType]) { a.push(workType); w.push(`$${a.length} = ANY(work_types)`); }
  if (AVAIL[availability]) { a.push(availability); w.push(`availability = $${a.length}`); }
  const like = (v) => `%${String(v).replace(/[%_\\]/g, '\\$&').toLowerCase().slice(0, 40)}%`;
  if (spec) { a.push(like(spec)); w.push(`EXISTS (SELECT 1 FROM unnest(specializations) s WHERE lower(s) LIKE $${a.length})`); }
  if (service) { a.push(like(service)); w.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(services) s WHERE lower(s->>'title') LIKE $${a.length})`); }
  if (q) { a.push(like(q)); w.push(`(lower(display_name) LIKE $${a.length} OR lower(headline) LIKE $${a.length} OR lower(description) LIKE $${a.length})`); }
  a.push(Math.max(1, Math.min(60, Number(limit) || 30)), Math.max(0, Number(offset) || 0));
  const { rows } = await query(`SELECT * FROM specialist_profiles WHERE ${w.join(' AND ')} ORDER BY (availability = 'open') DESC, updated_at DESC LIMIT $${a.length - 1} OFFSET $${a.length}`, a);
  return { categories: CATEGORIES, workTypes: WORK_TYPES, availability: AVAIL, specialists: rows.map((r) => shape(r)) };
};
const STAFF = '__staff__';
export const getPublic = async (pid, viewer) => {
  const { rows } = await query('SELECT * FROM specialist_profiles WHERE id = $1', [pid]); const r = rows[0];
  if (!r || (r.status !== 'published' && r.owner_id !== viewer && viewer !== STAFF)) return err('not_found');
  const { rows: w } = await query('SELECT id, title, description, url, image_type IS NOT NULL AS has_image FROM specialist_portfolio WHERE profile_id = $1 ORDER BY created_at', [pid]);
  return { specialist: { ...shape(r), portfolio: w.map((x) => ({ id: x.id, title: x.title, description: x.description, url: x.url, hasImage: x.has_image })), isMine: r.owner_id === viewer } };
};

/* ─── Предложения ──────────────────────────────────────────────────── */
const offerShape = (o, me) => ({ id: o.id, specialistId: o.specialist_id, specialistName: o.display_name, clientId: o.client_id, clientName: o.client_name, kind: o.kind, title: o.title, brief: dec(o.brief_enc), budgetRub: o.budget_rub, deadline: o.deadline, status: o.status, statusReason: o.status_reason, role: o.owner_id === me ? 'specialist' : 'client', createdAt: o.created_at, updatedAt: o.updated_at });
const loadOffer = async (oid, me, forUpdate = false, client = null) => {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(`SELECT o.*, p.owner_id, p.display_name, c.name AS client_name FROM specialist_offers o JOIN specialist_profiles p ON p.id = o.specialist_id JOIN profiles c ON c.id = o.client_id WHERE o.id = $1 ${forUpdate ? 'FOR UPDATE OF o' : ''}`, [oid]);
  const o = rows[0]; if (!o || (o.owner_id !== me && o.client_id !== me)) return null; return o;
};

export const sendOffer = async (me, body = {}) => {
  const { rows } = await query('SELECT * FROM specialist_profiles WHERE id = $1', [String(body.specialistId ?? '')]); const sp = rows[0];
  if (!sp || sp.status !== 'published') return err('not_found');
  if (sp.owner_id === me) return err('own_profile');
  if (sp.availability === 'closed') return err('not_accepting');
  const kind = body.kind === 'long_term' ? 'long_term' : 'one_time';
  if (!sp.work_types.includes(kind)) return err('work_type_not_offered');
  const title = clean(body.title, 100); if (title.length < 3) return err('bad_field', { field: 'title' });
  const brief = clean(body.brief, 3000); if (brief.length < 20) return err('bad_field', { field: 'brief' });
  const bud = body.budgetRub == null || body.budgetRub === '' ? null : Number(body.budgetRub);
  if (bud != null && (!Number.isFinite(bud) || bud < 0 || bud > 10_000_000)) return err('bad_field', { field: 'budgetRub' });
  const dl = body.deadline ? String(body.deadline) : null; if (dl && (!/^\d{4}-\d{2}-\d{2}$/.test(dl) || Number.isNaN(Date.parse(dl)))) return err('bad_field', { field: 'deadline' });
  const { rows: open } = await query("SELECT count(*)::int AS n FROM specialist_offers WHERE client_id = $1 AND status IN ('sent','negotiating')", [me]);
  if (open[0].n >= MAX_OPEN_OFFERS) return err('too_many_open_offers');
  const oid = id('spo');
  try {
    await query('INSERT INTO specialist_offers (id, specialist_id, client_id, kind, title, brief_enc, budget_rub, deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [oid, sp.id, me, kind, title, encryptSecret(brief), bud == null ? null : Math.trunc(bud), dl]);
  } catch (e) { if (e.code === '23505') return err('active_offer_exists'); throw e; }
  await log(me, oid, 'offer_sent', kind);
  void notifyGift(sp.owner_id, 'specialist_offer', 'Новое предложение на бирже', `«${title}» — откройте предложение, чтобы ответить.`, oid).catch(() => {});
  return { ok: true, id: oid, status: 'sent' };
};

export const listOffers = async (me, role = 'all') => {
  const w = role === 'client' ? 'o.client_id = $1' : role === 'specialist' ? 'p.owner_id = $1' : '(o.client_id = $1 OR p.owner_id = $1)';
  const { rows } = await query(`SELECT o.*, p.owner_id, p.display_name, c.name AS client_name FROM specialist_offers o JOIN specialist_profiles p ON p.id = o.specialist_id JOIN profiles c ON c.id = o.client_id WHERE ${w} ORDER BY o.updated_at DESC LIMIT 100`, [me]);
  return { offers: rows.map((o) => offerShape(o, me)) };
};
export const getOffer = async (me, oid) => {
  const o = await loadOffer(oid, me); if (!o) return err('not_found');
  const { rows: m } = await query('SELECT id, sender_id, text_enc, created_at FROM specialist_messages WHERE offer_id = $1 ORDER BY id LIMIT 300', [oid]);
  return { offer: offerShape(o, me), messages: m.map((x) => ({ id: x.id, mine: x.sender_id === me, text: dec(x.text_enc), at: x.created_at })) };
};
export const sendMessage = async (me, oid, text) => {
  const t = clean(text, 2000); if (!t) return err('bad_field', { field: 'text' });
  const o = await loadOffer(oid, me); if (!o) return err('not_found');
  if (!['sent', 'negotiating', 'accepted', 'in_progress', 'disputed'].includes(o.status)) return err('closed');
  const { rows: n } = await query('SELECT count(*)::int AS n FROM specialist_messages WHERE offer_id = $1', [oid]); if (n[0].n >= MAX_MSGS) return err('too_many_messages');
  await query('INSERT INTO specialist_messages (offer_id, sender_id, text_enc) VALUES ($1,$2,$3)', [oid, me, encryptSecret(t)]);
  // Ответ специалиста на новое предложение переводит его в «обсуждение»
  if (o.status === 'sent' && o.owner_id === me) await query("UPDATE specialist_offers SET status='negotiating', updated_at=now() WHERE id=$1 AND status='sent'", [oid]);
  else await query('UPDATE specialist_offers SET updated_at = now() WHERE id = $1', [oid]);
  const other = o.owner_id === me ? o.client_id : o.owner_id;
  void notifyGift(other, 'specialist_message', 'Сообщение по предложению', `«${o.title}»`, oid).catch(() => {});
  return { ok: true };
};

/** Действия по предложению. who: specialist | client. */
const FLOW = {
  accept:   { from: ['sent', 'negotiating'], to: 'accepted', who: 'specialist' },
  decline:  { from: ['sent', 'negotiating'], to: 'declined', who: 'specialist', reason: true },
  withdraw: { from: ['sent', 'negotiating'], to: 'withdrawn', who: 'client' },
  start:    { from: ['accepted'], to: 'in_progress', who: 'specialist' },
  complete: { from: ['in_progress'], to: 'completed', who: 'client' },
  cancel:   { from: ['accepted', 'in_progress'], to: 'cancelled', who: 'both', reason: true },
  dispute:  { from: ['accepted', 'in_progress'], to: 'disputed', who: 'both', reason: true },
};
export const offerAction = async (me, oid, action, reason = '') => {
  const rule = FLOW[action]; if (!rule) return err('bad_action');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const o = await loadOffer(oid, me, true, c); if (!o) { await c.query('ROLLBACK'); return err('not_found'); }
    const role = o.owner_id === me ? 'specialist' : 'client';
    if (rule.who !== 'both' && rule.who !== role && !(action === 'complete' && o.kind === 'long_term')) { await c.query('ROLLBACK'); return err('not_allowed'); }
    if (!rule.from.includes(o.status)) { await c.query('ROLLBACK'); return err('bad_state', { status: o.status }); }
    const why = clean(reason, 300); if (rule.reason && why.length < 5) { await c.query('ROLLBACK'); return err('reason_required'); }
    if (action === 'accept') {                         // принять нельзя, если анкета больше не опубликована
      const { rows: p } = await c.query('SELECT status FROM specialist_profiles WHERE id = $1', [o.specialist_id]);
      if (p[0]?.status !== 'published') { await c.query('ROLLBACK'); return err('profile_unavailable'); }
    }
    await c.query('UPDATE specialist_offers SET status=$2, status_reason=$3, updated_at=now() WHERE id=$1', [oid, rule.to, why]);
    await c.query('COMMIT');
    await log(me, oid, `offer_${action}`, why);
    const other = role === 'specialist' ? o.client_id : o.owner_id;
    void notifyGift(other, 'specialist_offer', 'Статус предложения изменился', `«${o.title}»: ${STATUS_RU[rule.to]}`, oid).catch(() => {});
    if (action === 'dispute') void notifyStaff('specialist_review', { title: 'Спор по заказу на бирже', body: 'Нужно решение администрации.', dedupe: `spo:${oid}`, except: me });
    return { ok: true, status: rule.to };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};
export const STATUS_RU = { sent: 'отправлено', negotiating: 'обсуждение условий', accepted: 'принято', declined: 'отклонено', withdrawn: 'отозвано', in_progress: 'в работе', completed: 'завершено', cancelled: 'отменено', disputed: 'спор' };

/* ─── Жалобы ───────────────────────────────────────────────────────── */
export const report = async (me, body = {}) => {
  const type = body.targetType === 'offer' ? 'offer' : 'profile'; const tid = String(body.targetId ?? '');
  const reason = REPORT_REASONS.includes(body.reason) ? body.reason : null; if (!reason) return err('bad_field', { field: 'reason' });
  if (type === 'profile') { const { rows } = await query('SELECT owner_id, status FROM specialist_profiles WHERE id = $1', [tid]); if (!rows[0] || rows[0].status === 'draft') return err('not_found'); if (rows[0].owner_id === me) return err('own_profile'); }
  else if (!(await loadOffer(tid, me))) return err('not_found');       // на предложение жалуется только его сторона
  const { rows: today } = await query("SELECT count(*)::int AS n FROM specialist_reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'", [me]); if (today[0].n >= 10) return err('too_many_reports');
  const rid = id('spr');
  try { await query('INSERT INTO specialist_reports (id, target_type, target_id, reporter_id, reason, details_enc) VALUES ($1,$2,$3,$4,$5,$6)', [rid, type, tid, me, reason, encryptSecret(clean(body.details, 1000))]); }
  catch (e) { if (e.code === '23505') return err('already_reported'); throw e; }
  void notifyStaff('specialist_review', { title: 'Жалоба на бирже специалистов', body: 'Новая жалоба ждёт рассмотрения.', dedupe: `spr:${rid}`, except: me });
  return { ok: true, id: rid };
};

/* ─── Администрация ────────────────────────────────────────────────── */
export const adminList = async ({ status = '' } = {}) => {
  const a = []; let w = '';
  if (status) { a.push(status); w = 'WHERE status = $1'; }
  const { rows } = await query(`SELECT * FROM specialist_profiles ${w} ORDER BY (status = 'pending') DESC, updated_at DESC LIMIT 200`, a);
  const { rows: rep } = await query("SELECT * FROM specialist_reports WHERE status = 'open' ORDER BY created_at LIMIT 100");
  const { rows: dis } = await query("SELECT o.id, o.title, o.status_reason, o.updated_at, p.display_name FROM specialist_offers o JOIN specialist_profiles p ON p.id = o.specialist_id WHERE o.status = 'disputed' ORDER BY o.updated_at LIMIT 100");
  return { profiles: rows.map((r) => shape(r, { full: true })), reports: rep.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: dec(r.details_enc), at: r.created_at })), disputes: dis.map((d) => ({ id: d.id, title: d.title, reason: d.status_reason, specialist: d.display_name, at: d.updated_at })) };
};
export const adminReview = async (actor, pid, action, reason = '', { owner = false } = {}) => {
  const { rows } = await query('SELECT * FROM specialist_profiles WHERE id = $1 FOR UPDATE', [pid]); const p = rows[0]; if (!p) return err('not_found');
  if (p.owner_id === actor && !owner) return err('self_review');
  const why = clean(reason, 300);
  const map = { approve: ['pending', 'published'], reject: ['pending', 'rejected'], suspend: ['published', 'suspended'], restore: ['suspended', 'published'] };
  const rule = map[action]; if (!rule) return err('bad_action');
  if (p.status !== rule[0]) return err('bad_state', { status: p.status });
  if (['reject', 'suspend'].includes(action) && why.length < 5) return err('reason_required');
  await query('UPDATE specialist_profiles SET status=$2, status_reason=$3, reviewed_by=$4, updated_at=now() WHERE id=$1', [pid, rule[1], action === 'approve' || action === 'restore' ? '' : why, actor]);
  await log(actor, pid, action, why); await logAdmin({ actorId: actor, targetType: 'specialist', targetId: pid, type: `specialist_${action}`, detail: why.slice(0, 200) });
  void notifyGift(p.owner_id, 'specialist_profile', { approve: 'Анкета опубликована', reject: 'Анкета отклонена', suspend: 'Анкета приостановлена', restore: 'Анкета снова опубликована' }[action], why || 'Подробности — в разделе «Биржа специалистов».', pid).catch(() => {});
  return { ok: true, status: rule[1] };
};
export const adminResolveReport = async (actor, rid, outcome, note = '') => {
  const n = clean(note, 300); if (n.length < 5) return err('reason_required');
  if (!['resolved', 'dismissed'].includes(outcome)) return err('bad_action');
  const r = await query("UPDATE specialist_reports SET status=$2, resolved_by=$3, note=$4, resolved_at=now() WHERE id=$1 AND status='open'", [rid, outcome, actor, n]);
  if (!r.rowCount) return err('not_found');
  await logAdmin({ actorId: actor, targetType: 'specialist_report', targetId: rid, type: 'specialist_report_resolve', detail: `${outcome}: ${n}`.slice(0, 200) });
  return { ok: true };
};
/** Спор: администрация закрывает заказ как завершённый или отменённый (деньги она не двигает — их здесь нет). */
export const adminResolveDispute = async (actor, oid, outcome, note = '') => {
  const n = clean(note, 300); if (n.length < 5) return err('reason_required');
  if (!['completed', 'cancelled'].includes(outcome)) return err('bad_action');
  const r = await query("UPDATE specialist_offers SET status=$2, status_reason=$3, updated_at=now() WHERE id=$1 AND status='disputed' RETURNING client_id, specialist_id, title", [oid, outcome, n]);
  if (!r.rowCount) return err('bad_state');
  await log(actor, oid, 'dispute_resolved', `${outcome}: ${n}`); await logAdmin({ actorId: actor, targetType: 'specialist_offer', targetId: oid, type: 'specialist_dispute_resolve', detail: `${outcome}: ${n}`.slice(0, 200) });
  const { rows: sp } = await query('SELECT owner_id FROM specialist_profiles WHERE id = $1', [r.rows[0].specialist_id]);
  for (const u of [r.rows[0].client_id, sp[0]?.owner_id].filter(Boolean)) void notifyGift(u, 'specialist_offer', 'Спор решён', `«${r.rows[0].title}»: ${STATUS_RU[outcome]}`, oid).catch(() => {});
  return { ok: true, status: outcome };
};
export const adminLog = async (target) => (await query('SELECT at, actor_id, action, detail FROM specialist_log WHERE target_id = $1 ORDER BY id DESC LIMIT 100', [target])).rows;
/** Сотрудник открывает спорное предложение (переписка видна только при споре; каждое открытие — в журнале). */
export const adminOffer = async (actor, oid) => {
  const { rows } = await query("SELECT o.*, p.owner_id, p.display_name, c.name AS client_name FROM specialist_offers o JOIN specialist_profiles p ON p.id = o.specialist_id JOIN profiles c ON c.id = o.client_id WHERE o.id = $1", [oid]);
  const o = rows[0]; if (!o) return err('not_found'); if (o.status !== 'disputed') return err('not_disputed');
  await log(actor, oid, 'admin_viewed'); await logAdmin({ actorId: actor, targetType: 'specialist_offer', targetId: oid, type: 'specialist_dispute_view', detail: '' });
  const { rows: m } = await query('SELECT sender_id, text_enc, created_at FROM specialist_messages WHERE offer_id = $1 ORDER BY id LIMIT 300', [oid]);
  return { offer: offerShape(o, null), messages: m.map((x) => ({ side: x.sender_id === o.client_id ? 'client' : 'specialist', text: dec(x.text_enc), at: x.created_at })) };
};
