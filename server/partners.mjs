/**
 * Партнёры Sky: каталог настоящих партнёров с проверкой и подтверждением.
 *
 *  • Людям показываются только партнёры в статусе `active` внутри срока сотрудничества (начало/окончание) и только их публичные поля.
 *    Внутренние контакты (зашифрованы), статус проверки, журнал и сведения о том, кто что правил, наружу не уходят.
 *  • Статусы: draft → review (отправил редактор) → active (подтвердил уполномоченный: право `partners_approve`, не тот, кто правил последним — кроме владельца).
 *    Правка действующего партнёра возвращает его на проверку и снимает с показа до нового подтверждения: опубликованное не меняют втихую.
 *    suspended (приостановлен) и archive (в архиве) людям не показываются.
 *  • Каждое действие пишется в журнал `partner_log` (кто, что, какие поля) и в журнал администрации; значения внутренних контактов в журнал не попадают.
 *  • Реферальных вознаграждений здесь нет: если появятся — отдельным модулем с прозрачным учётом и защитой от накрутки.
 */
import crypto from 'node:crypto';
import { notifyStaff } from './staffnotify.mjs';
import { query } from './db.mjs';
import { encryptSecret, openSecret } from './crypto.mjs';
import { logAdmin } from './adminsec.mjs';

export const CATEGORIES = { shop: 'Магазины', service: 'Сервисы', finance: 'Финансы', entertainment: 'Развлечения', education: 'Образование', other: 'Другое' };
const STATUSES = ['draft', 'review', 'active', 'suspended', 'archive'];
const MAX_LOGO = 300 * 1024;
const LOGO_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true };
const err = (code, extra = {}) => ({ error: code, ...extra });
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31 || c === '\n').join('').trim().slice(0, n);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const todayIso = () => new Date().toISOString().slice(0, 10);

const cleanUrl = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || s.length > 200) return null;
    return u.toString();
  } catch { return null; }
};

const cleanOffers = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const o of raw.slice(0, 10)) {
    const title = clean(o?.title, 80); if (title.length < 2) return null;
    const promoCode = String(o?.promoCode ?? '').trim();
    if (promoCode && !/^[A-Za-z0-9_-]{2,40}$/.test(promoCode)) return null;
    const endsAt = o?.endsAt ? String(o.endsAt) : '';
    if (endsAt && !isDate(endsAt)) return null;
    out.push({ title, terms: clean(o?.terms, 400), promoCode, endsAt });
  }
  return out;
};

const toPublic = (r) => ({
  id: r.id, name: r.name, description: r.description, category: r.category, categoryLabel: CATEGORIES[r.category] ?? CATEGORIES.other,
  website: r.website, hasLogo: Boolean(r.logo_type), startsAt: r.starts_at ? String(r.starts_at).slice(0, 10) : null, endsAt: r.ends_at ? String(r.ends_at).slice(0, 10) : null,
  conditions: r.conditions,
  offers: (r.offers ?? []).filter((o) => !o.endsAt || o.endsAt >= todayIso()),
});

/** Партнёры для людей: только подтверждённые, действующие по сроку. */
export const publicList = async () => {
  const { rows } = await query(
    `SELECT id, name, description, category, website, logo_type, starts_at::text AS starts_at, ends_at::text AS ends_at, offers, conditions
       FROM partners WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= current_date) AND (ends_at IS NULL OR ends_at >= current_date)
      ORDER BY sort, name`);
  return rows.map(toPublic);
};

export const logoOf = async (id, { staff = false } = {}) => {
  const { rows } = await query(
    `SELECT logo, logo_type FROM partners WHERE id = $1 ${staff ? '' : `AND status = 'active' AND (starts_at IS NULL OR starts_at <= current_date) AND (ends_at IS NULL OR ends_at >= current_date)`}`, [String(id)]);
  return rows[0]?.logo ? { data: rows[0].logo, type: rows[0].logo_type } : null;
};

/* ─── Администрация ────────────────────────────────────────────────── */

const toAdmin = (r) => ({
  ...toPublic(r), offers: r.offers ?? [], status: r.status, sort: r.sort, contact: r.contact_enc ? (openSecret(r.contact_enc) ?? '') : '',
  createdBy: r.created_by, updatedBy: r.updated_by, approvedBy: r.approved_by, approvedAt: r.approved_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const adminList = async () => {
  const { rows } = await query(
    `SELECT *, starts_at::text AS starts_at, ends_at::text AS ends_at FROM partners ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'draft' THEN 1 WHEN 'active' THEN 2 WHEN 'suspended' THEN 3 ELSE 4 END, sort, name`);
  return rows.map(toAdmin);
};

export const adminLog = async (id) => {
  const { rows } = await query(
    `SELECT l.action, l.detail, l.at, p.username AS actor FROM partner_log l LEFT JOIN profiles p ON p.id = l.actor_id WHERE l.partner_id = $1 ORDER BY l.at DESC LIMIT 100`, [String(id)]);
  return rows.map((r) => ({ action: r.action, detail: r.detail, at: r.at, actor: r.actor }));
};

const log = (partnerId, actorId, action, detail = {}) =>
  query('INSERT INTO partner_log (partner_id, actor_id, action, detail) VALUES ($1,$2,$3,$4::jsonb)', [partnerId, actorId, action, JSON.stringify(detail)]);

const validate = (b) => {
  const name = clean(b?.name, 80); if (name.length < 2) return err('bad_field', { field: 'name' });
  const category = Object.hasOwn(CATEGORIES, b?.category) ? b.category : null; if (!category) return err('bad_field', { field: 'category' });
  const website = cleanUrl(b?.website); if (website === null) return err('bad_field', { field: 'website' });
  const startsAt = b?.startsAt ? String(b.startsAt) : null; const endsAt = b?.endsAt ? String(b.endsAt) : null;
  if ((startsAt && !isDate(startsAt)) || (endsAt && !isDate(endsAt)) || (startsAt && endsAt && endsAt < startsAt)) return err('bad_field', { field: 'dates' });
  const offers = cleanOffers(b?.offers); if (offers === null) return err('bad_field', { field: 'offers' });
  const sortN = Math.trunc(Number(b?.sort ?? 100)); if (!Number.isFinite(sortN) || sortN < 0 || sortN > 100000) return err('bad_field', { field: 'sort' });
  return { ok: true, v: { name, category, website, description: clean(b?.description, 1200), conditions: clean(b?.conditions, 600), contact: clean(b?.contact, 500), startsAt, endsAt, offers, sort: sortN } };
};

export const save = async (actorId, body, id = null) => {
  const val = validate(body); if (val.error) return val;
  const v = val.v;
  if (!id) {
    const nid = `ptn-${crypto.randomUUID()}`;
    await query(
      `INSERT INTO partners (id, name, description, category, website, contact_enc, starts_at, ends_at, offers, conditions, sort, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'draft',$12,$12)`,
      [nid, v.name, v.description, v.category, v.website, v.contact ? encryptSecret(v.contact) : '', v.startsAt, v.endsAt, JSON.stringify(v.offers), v.conditions, v.sort, actorId]);
    await log(nid, actorId, 'create', { name: v.name });
    await logAdmin({ actorId, targetType: 'partner', targetId: nid, type: 'partner_create', detail: v.name });
    return { ok: true, id: nid, status: 'draft' };
  }
  const { rows } = await query('SELECT *, starts_at::text AS starts_at, ends_at::text AS ends_at FROM partners WHERE id = $1 FOR UPDATE', [id]);
  const cur = rows[0]; if (!cur) return err('not_found');
  if (cur.status === 'archive') return err('archived');
  const before = toAdmin(cur);
  const next = { name: v.name, category: v.category, website: v.website, description: v.description, conditions: v.conditions, startsAt: v.startsAt, endsAt: v.endsAt, offers: v.offers, sort: v.sort, contact: v.contact };
  // JSONB хранит ключи в своём порядке — сравниваем с упорядоченными ключами
  const canon = (x) => JSON.stringify(x ?? null, (_k, y) => (y && typeof y === 'object' && !Array.isArray(y) ? Object.fromEntries(Object.entries(y).sort()) : y));
  const changed = Object.keys(next).filter((k) => canon(next[k]) !== canon(before[k]));
  if (!changed.length) return { ok: true, id, status: cur.status, changed: [] };
  // Опубликованное не меняют втихую: правка публичного содержания возвращает партнёра на проверку (одна лишь сортировка и контакты — без этого)
  const publicChange = changed.some((k) => !['sort', 'contact'].includes(k));
  const status = (cur.status === 'active' || cur.status === 'suspended') && publicChange ? 'review' : cur.status;
  await query(
    `UPDATE partners SET name=$2, description=$3, category=$4, website=$5, contact_enc=$6, starts_at=$7, ends_at=$8, offers=$9::jsonb, conditions=$10, sort=$11,
            status=$12, updated_by=$13, updated_at=now(), approved_by = CASE WHEN $12 = 'review' THEN NULL ELSE approved_by END WHERE id=$1`,
    [id, v.name, v.description, v.category, v.website, v.contact ? encryptSecret(v.contact) : '', v.startsAt, v.endsAt, JSON.stringify(v.offers), v.conditions, v.sort, status, actorId]);
  await log(id, actorId, 'update', { fields: changed, sentBackToReview: status !== cur.status });
  if (status === 'review' && cur.status !== 'review') void notifyStaff('partners', { title: 'Партнёр на проверке', body: `${v.name}: правка вернула карточку на подтверждение.`, dedupe: `${id}:${Date.now()}`, except: [actorId] });
  await logAdmin({ actorId, targetType: 'partner', targetId: id, type: 'partner_update', detail: `${v.name}: ${changed.join(', ')}` });
  return { ok: true, id, status, changed };
};

export const setLogo = async (actorId, id, dataUrl) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m || !LOGO_TYPES[m[1]]) return err('bad_logo');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_LOGO) return err('logo_too_large');
  // сигнатура файла должна совпадать с заявленным типом
  const sig = buf.subarray(0, 12);
  const okSig = (m[1] === 'image/png' && sig.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
    || (m[1] === 'image/jpeg' && sig[0] === 0xff && sig[1] === 0xd8)
    || (m[1] === 'image/webp' && sig.subarray(0, 4).toString() === 'RIFF' && sig.subarray(8, 12).toString() === 'WEBP');
  if (!okSig) return err('bad_logo');
  const { rows } = await query('SELECT status FROM partners WHERE id = $1', [id]);
  if (!rows[0]) return err('not_found');
  if (rows[0].status === 'archive') return err('archived');
  const status = ['active', 'suspended'].includes(rows[0].status) ? 'review' : rows[0].status;
  await query('UPDATE partners SET logo=$2, logo_type=$3, status=$4, updated_by=$5, updated_at=now(), approved_by = CASE WHEN $4 = \'review\' THEN NULL ELSE approved_by END WHERE id=$1', [id, buf, m[1], status, actorId]);
  await log(id, actorId, 'logo', { bytes: buf.length, sentBackToReview: status !== rows[0].status });
  return { ok: true, status };
};

/**
 * Смена статуса. `canApprove` — право `partners_approve`; `owner` — владелец (может подтвердить и свою правку).
 */
export const transition = async (actorId, id, action, { reason = '', canApprove = false, owner = false } = {}) => {
  const { rows } = await query('SELECT * FROM partners WHERE id = $1 FOR UPDATE', [id]);
  const p = rows[0]; if (!p) return err('not_found');
  const why = clean(reason, 300);
  const need = (cond, code) => (cond ? null : err(code));
  let to; let e = null;
  switch (action) {
    case 'submit':
      e = need(p.status === 'draft', 'bad_state');
      if (!e && (p.description.length < 20 || !p.website)) e = err('incomplete', { need: 'описание от 20 знаков и сайт' });
      to = 'review'; break;
    case 'approve':
      e = need(canApprove, 'not_allowed') ?? need(p.status === 'review', 'bad_state') ?? need(owner || p.updated_by !== actorId, 'self_approval');
      to = 'active'; break;
    case 'return':
      e = need(canApprove, 'not_allowed') ?? need(p.status === 'review', 'bad_state') ?? (why.length < 3 ? err('reason_required') : null);
      to = 'draft'; break;
    case 'suspend':
      e = need(canApprove, 'not_allowed') ?? need(p.status === 'active', 'bad_state') ?? (why.length < 3 ? err('reason_required') : null);
      to = 'suspended'; break;
    case 'resume':
      e = need(canApprove, 'not_allowed') ?? need(p.status === 'suspended', 'bad_state');
      to = 'active'; break;
    case 'archive':
      e = need(canApprove, 'not_allowed') ?? need(p.status !== 'archive', 'bad_state') ?? (why.length < 3 ? err('reason_required') : null);
      to = 'archive'; break;
    default: return err('bad_action');
  }
  if (e) return e;
  await query(
    `UPDATE partners SET status=$2, updated_at=now(), updated_by = CASE WHEN $3 IN ('submit') THEN $4 ELSE updated_by END,
            approved_by = CASE WHEN $2 = 'active' AND $3 = 'approve' THEN $4 ELSE approved_by END,
            approved_at = CASE WHEN $2 = 'active' AND $3 = 'approve' THEN now() ELSE approved_at END WHERE id=$1`, [id, to, action, actorId]);
  await log(id, actorId, action, { from: p.status, to, reason: why });
  if (to === 'review') void notifyStaff('partners', { title: 'Партнёр на проверке', body: `${p.name} ждёт подтверждения.`, dedupe: `${id}:${Date.now()}`, except: [actorId] });
  await logAdmin({ actorId, targetType: 'partner', targetId: id, type: `partner_${action}`, detail: `${p.name}: ${p.status} → ${to}${why ? ` (${why})` : ''}` });
  return { ok: true, status: to };
};

export { STATUSES };
