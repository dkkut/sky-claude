/**
 * Sky Market: публикация и модерация карточек, жалобы, апелляции,
 * настройки правил допуска.
 *
 * Статус карточки (market_products.moderation_status) — единственный
 * источник правды о том, видна ли она. Колонка `active`, на которую
 * опираются остальные модули Market, ПОДДЕРЖИВАЕТСЯ здесь же: active =
 * TRUE только при статусе 'published'. Продавец сам статус не меняет —
 * он может лишь отправить карточку на публикацию, и решает сервер по
 * правилам допуска (sellerrules.mjs): чисто — публикуется сама, спорно —
 * уходит модератору, нельзя — возвращается с объяснением.
 *
 * История решений дописывается в market_product_events и в журнал
 * администраторов; продавец не может ни удалить жалобу на себя, ни
 * одобрить собственную карточку: решающие ручки сверяют актора с
 * владельцем карточки.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { PRODUCT_ID_RE, canSell, sellerRow, marketText as text, readProduct } from './market.mjs';
import {
  evaluateListing, loadRules, loadSettings, effectiveCategoryRule, KINDS, DOC_TYPES,
  CATEGORY_DEFAULTS, DEFAULT_SETTINGS,
} from './sellerrules.mjs';

export const REPORT_ID_RE = /^mrp-[0-9a-f-]{36}$/;
export const APPEAL_ID_RE = /^map-[0-9a-f-]{36}$/;

export const REPORT_REASONS = [
  'prohibited', 'counterfeit', 'misleading', 'wrong_origin', 'scam', 'abusive', 'other',
];
const REPORTS_PER_DAY = 10;
const OPEN_FOR_SELLER_EDIT = ['draft', 'needs_changes', 'hidden', 'archived'];

const events = (client, productId, actorId, role, action, from, to, reason = '') =>
  client.query(
    `INSERT INTO market_product_events (product_id, actor_id, actor_role, action, from_status, to_status, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [productId, actorId ?? null, role, action, from ?? null, to ?? null, text(reason, 500)]);

const isStaff = async (actor) => (await can(actor, 'market_moderation')) || (await can(actor, 'market'));

/* ─── Оценка карточки по правилам ──────────────────────────────────── */

const sellerCtx = async (profileId) => {
  const row = await sellerRow(profileId);
  if (!row) return null;
  return {
    status: row.status,
    verification: row.verification_status,
    taxKind: row.tax_kind,
    activities: row.activities ?? [],
  };
};

export const evaluateProduct = async (productId) => {
  const { rows } = await query('SELECT * FROM market_products WHERE id = $1', [productId]);
  const product = rows[0];
  if (!product) return null;
  const seller = await sellerCtx(product.seller_id);
  if (!seller) return null;
  const [docs, rules, settings, active] = await Promise.all([
    query(`SELECT doc_type, status FROM market_docs
            WHERE scope = 'product' AND ref_id = $1 AND removed_at IS NULL`, [productId]),
    loadRules(),
    loadSettings(),
    query(`SELECT count(*)::int AS n FROM market_products
            WHERE seller_id = $1 AND moderation_status NOT IN ('archived','blocked')`, [product.seller_id]),
  ]);
  const verdict = evaluateListing({
    seller, product, docs: docs.rows,
    ctx: { rules, settings, activeCount: active.rows[0].n },
  });
  return { product, seller, verdict };
};

/** Что видит продавец перед публикацией: готова ли карточка и чего не хватает. */
export const listingCheck = async (productId, sellerId) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const ev = await evaluateProduct(productId);
  if (!ev) return { error: 'not_found' };
  if (ev.product.seller_id !== sellerId) return { error: 'not_allowed' };
  return { check: ev.verdict };
};

/* ─── Отправка продавцом ───────────────────────────────────────────── */

export const submitProduct = async (productId, sellerId) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const ev = await evaluateProduct(productId);
  if (!ev) return { error: 'not_found' };
  if (ev.product.seller_id !== sellerId) return { error: 'not_allowed' };

  /* Право торговать — вопрос к базе: подписка, реквизиты, статус. */
  const allowed = await canSell(sellerId);
  if (!allowed.ok) return { error: allowed.error };

  const from = ev.product.moderation_status;
  if (!OPEN_FOR_SELLER_EDIT.includes(from)) return { error: 'wrong_state' };
  if (!ev.verdict.ok) return { error: 'listing_blocked', check: ev.verdict };

  const to = ev.verdict.autoPublish ? 'published' : 'pending';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Переход атомарный: двойное нажатие не создаст двух записей. */
    const { rowCount } = await client.query(
      `UPDATE market_products
          SET moderation_status = $2, active = $3, submitted_at = now(),
              moderation_reason = '', updated_at = now()
        WHERE id = $1 AND moderation_status = $4`,
      [productId, to, to === 'published', from]);
    if (rowCount === 0) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
    await events(client, productId, sellerId, 'seller', 'submitted', from, 'pending');
    if (to === 'published') {
      await events(client, productId, null, 'system', 'auto_published', 'pending', 'published',
        'Проверка по правилам допуска пройдена без замечаний');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { product: await readProduct(productId, sellerId), check: ev.verdict };
};

/**
 * После правки владельцем: если изменилось то, от чего зависит допуск,
 * опубликованная карточка снимается и проходит проверку заново. Иначе
 * можно было бы опубликовать невинную карточку и потом подменить в ней
 * страну отправки или категорию.
 */
const SENSITIVE = new Set([
  'category', 'item_condition', 'item_source', 'origin_country', 'ship_from_country',
  'item_location_country', 'intl_shipping', 'delivery_days_min', 'delivery_days_max',
  'import_info', 'marking_declared', 'title', 'description',
]);

export const afterSellerEdit = async (productId, sellerId, changed = []) => {
  if (!changed.some((c) => SENSITIVE.has(c))) return;
  const { rows } = await query(
    'SELECT moderation_status FROM market_products WHERE id = $1 AND seller_id = $2', [productId, sellerId]);
  const from = rows[0]?.moderation_status;
  if (!['published', 'approved', 'pending'].includes(from)) return;
  /* Название и описание сами по себе повторной проверки не требуют,
     если карточка и так опубликована без модератора. */
  const onlyText = changed.every((c) => c === 'title' || c === 'description');
  if (onlyText && from === 'published') return;

  const ev = await evaluateProduct(productId);
  if (!ev) return;
  const to = ev.verdict.ok ? (ev.verdict.autoPublish && from === 'published' ? 'published' : 'pending') : 'draft';
  if (to === from) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE market_products SET moderation_status = $2, active = $3, updated_at = now()
        WHERE id = $1 AND moderation_status = $4`,
      [productId, to, to === 'published', from]);
    await events(client, productId, null, 'system', 'edited_recheck', from, to,
      ev.verdict.blockers.map((b) => b.message).join(' ') || 'Изменены данные, влияющие на допуск — нужна повторная проверка');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** История карточки — владельцу и модераторам. */
export const productHistory = async (viewerId, productId) => {
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT seller_id FROM market_products WHERE id = $1', [productId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].seller_id !== viewerId && !(await isStaff(viewerId))) return { error: 'not_allowed' };
  const { rows: ev } = await query(
    `SELECT e.action, e.from_status, e.to_status, e.reason, e.actor_role, e.created_at
       FROM market_product_events e WHERE e.product_id = $1 ORDER BY e.id DESC LIMIT 100`, [productId]);
  return {
    items: ev.map((e) => ({
      action: e.action, from: e.from_status, to: e.to_status, reason: e.reason,
      by: e.actor_role, at: e.created_at.toISOString(),
    })),
  };
};

/* ─── Модерация ────────────────────────────────────────────────────── */

const ACTIONS = {
  approve:         { to: 'published',     needReason: false },
  request_changes: { to: 'needs_changes', needReason: true },
  hide:            { to: 'hidden',        needReason: true },
  block:           { to: 'blocked',       needReason: true },
  re_review:       { to: 'pending',       needReason: false },
};

export const moderateProduct = async (actorId, productId, action, reason, { meta = {} } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const spec = ACTIONS[action];
  if (!spec) return { error: 'bad_action' };
  const why = text(reason, 500);
  if (spec.needReason && why.length < 3) return { error: 'reason_required' };

  const ev = await evaluateProduct(productId);
  if (!ev) return { error: 'not_found' };
  /* Свою карточку не одобряет никто, даже сотрудник. */
  if (ev.product.seller_id === actorId) return { error: 'own_product' };

  const from = ev.product.moderation_status;
  let to = spec.to;
  if (action === 'approve') {
    if (!['pending', 'needs_changes', 'hidden', 'approved'].includes(from)) return { error: 'wrong_state' };
    /* Жёсткие нарушения правил модератор снять не может: сначала
       продавец исправляет карточку. */
    const hard = ev.verdict.blockers.filter((b) => !b.code.startsWith('doc_'));
    if (hard.length) return { error: 'listing_blocked', check: ev.verdict };
    /* Обязательные документы должны быть ПРИНЯТЫ человеком, а не просто
       загружены. */
    const { rows: accepted } = await query(
      `SELECT doc_type FROM market_docs WHERE scope = 'product' AND ref_id = $1
          AND removed_at IS NULL AND status = 'accepted'`, [productId]);
    const ok = new Set(accepted.map((d) => d.doc_type));
    if (ev.verdict.requiredDocs.some((d) => !ok.has(d))) return { error: 'docs_not_accepted', check: ev.verdict };
    const allowed = await canSell(ev.product.seller_id);
    if (!allowed.ok) to = 'approved'; // одобрена, но продавец сейчас торговать не может
  } else if (action === 're_review') {
    if (!['hidden', 'blocked', 'published', 'approved', 'needs_changes'].includes(from)) return { error: 'wrong_state' };
  } else if (from === 'archived') {
    return { error: 'wrong_state' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE market_products
          SET moderation_status = $2, active = $3, moderation_reason = $4,
              moderated_by = $5, moderated_at = now(), updated_at = now()
        WHERE id = $1 AND moderation_status = $6`,
      [productId, to, to === 'published', why, actorId, from]);
    if (rowCount === 0) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
    await events(client, productId, actorId, 'staff', action, from, to, why);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await logAdmin({
    actorId, targetId: productId, targetType: 'market_product', type: `market_product_${action}`,
    detail: `${from} → ${to}${why ? ` · ${why}` : ''}`, meta,
  });
  return { ok: true, status: to };
};

const productListRow = (r, verdict) => ({
  id: r.id, title: r.title, sellerId: r.seller_id, shopName: r.shop_name,
  status: r.moderation_status, category: r.category, marketType: r.market_type,
  originCountry: r.origin_country ?? null, shipFromCountry: r.ship_from_country ?? null,
  foreign: Boolean(r.ship_from_country && r.ship_from_country !== 'RU')
    || Boolean(r.item_location_country && r.item_location_country !== 'RU'),
  submittedAt: r.submitted_at?.toISOString?.() ?? null,
  review: verdict ? verdict.review.map((x) => x.message) : undefined,
});

export const moderationQueue = async (actorId, { status = 'pending', foreign, q, limit } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const args = [];
  const where = [];
  if (status && status !== 'all') {
    args.push(status); where.push(`p.moderation_status = $${args.length}`);
  }
  if (foreign === 'true' || foreign === true) {
    where.push("(p.ship_from_country <> 'RU' OR p.item_location_country <> 'RU')");
  }
  const needle = text(q, 80).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`p.search_text LIKE $${args.length} ESCAPE '\\'`);
  }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  args.push(lim);
  const { rows } = await query(
    `SELECT p.*, s.shop_name FROM market_products p JOIN market_sellers s ON s.profile_id = p.seller_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.submitted_at NULLS LAST, p.created_at LIMIT $${args.length}`, args);
  return { items: rows.map((r) => productListRow(r, null)) };
};

export const moderationDetail = async (actorId, productId) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  if (!PRODUCT_ID_RE.test(String(productId ?? ''))) return { error: 'not_found' };
  const ev = await evaluateProduct(productId);
  if (!ev) return { error: 'not_found' };
  const { rows: docs } = await query(
    `SELECT id, doc_type, label, mime, bytes, status, review_comment, created_at FROM market_docs
      WHERE scope = 'product' AND ref_id = $1 AND removed_at IS NULL ORDER BY created_at`, [productId]);
  const { rows: sel } = await query('SELECT shop_name, tax_kind, verification_status FROM market_sellers WHERE profile_id = $1', [ev.product.seller_id]);
  const { rows: rep } = await query(
    "SELECT count(*)::int AS n FROM market_reports WHERE target_type = 'product' AND target_id = $1 AND status IN ('open','in_review')", [productId]);
  const history = await productHistory(actorId, productId);
  return {
    product: await readProduct(productId, actorId),
    sellerShop: sel[0]?.shop_name, sellerTaxKind: sel[0]?.tax_kind, sellerVerification: sel[0]?.verification_status,
    verdict: ev.verdict,
    docs: docs.map((d) => ({
      id: d.id, type: d.doc_type, typeLabel: DOC_TYPES[d.doc_type] ?? d.doc_type, label: d.label, mime: d.mime,
      bytes: Number(d.bytes), status: d.status, comment: d.review_comment, createdAt: d.created_at.toISOString(),
    })),
    openReports: rep[0].n,
    history: history.items ?? [],
  };
};

/** Продавец изменил статус или права — карточки, которые больше не проходят правила, снимаются. */
export const recheckSellerProducts = async (profileId, reasonPrefix = 'Статус продавца изменён') => {
  const { rows } = await query(
    `SELECT id FROM market_products WHERE seller_id = $1
        AND moderation_status IN ('published','pending','approved')`, [profileId]);
  let hidden = 0;
  for (const r of rows) {
    const ev = await evaluateProduct(r.id);
    if (!ev || ev.verdict.ok) continue;
    const why = `${reasonPrefix}: ${ev.verdict.blockers.map((b) => b.message).join(' ')}`.slice(0, 500);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE market_products SET moderation_status = 'hidden', active = FALSE,
                moderation_reason = $2, updated_at = now() WHERE id = $1`, [r.id, why]);
      await events(client, r.id, null, 'system', 'recheck_hidden', ev.product.moderation_status, 'hidden', why);
      await client.query('COMMIT');
      hidden += 1;
    } catch { await client.query('ROLLBACK').catch(() => {}); } finally { client.release(); }
  }
  return hidden;
};

/* ─── Жалобы ───────────────────────────────────────────────────────── */

export const createReport = async (reporterId, input = {}) => {
  const targetType = input.targetType === 'shop' ? 'shop' : input.targetType === 'product' ? 'product' : null;
  if (!targetType) return { error: 'bad_target' };
  const reason = String(input.reason ?? '');
  if (!REPORT_REASONS.includes(reason)) return { error: 'bad_reason' };
  const details = text(input.details, 1000);
  if (reason === 'other' && details.length < 5) return { error: 'details_required' };

  let sellerId = null;
  let targetId = String(input.targetId ?? '');
  if (targetType === 'product') {
    if (!PRODUCT_ID_RE.test(targetId)) return { error: 'not_found' };
    const { rows } = await query('SELECT seller_id, moderation_status FROM market_products WHERE id = $1', [targetId]);
    if (!rows[0] || rows[0].moderation_status !== 'published') return { error: 'not_found' };
    sellerId = rows[0].seller_id;
  } else {
    const row = await sellerRow(targetId);
    if (!row) return { error: 'not_found' };
    sellerId = row.profile_id;
  }
  if (sellerId === reporterId) return { error: 'own_target' };

  /* Защита от спама: суточный потолок на человека. Повтор жалобы на
     тот же объект, пока прежняя не рассмотрена, режет уникальный индекс. */
  const { rows: day } = await query(
    `SELECT count(*)::int AS n FROM market_reports
      WHERE reporter_id = $1 AND created_at > now() - interval '24 hours'`, [reporterId]);
  if (day[0].n >= REPORTS_PER_DAY) return { error: 'too_many_reports' };

  const id = `mrp-${generateId()}`;
  try {
    await query(
      `INSERT INTO market_reports (id, reporter_id, target_type, target_id, seller_id, reason, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, reporterId, targetType, targetId, sellerId, reason, details]);
  } catch (err) {
    if (err?.code === '23505') return { error: 'already_reported' };
    throw err;
  }
  await query('INSERT INTO market_report_events (report_id, actor_id, action) VALUES ($1,$2,$3)', [id, reporterId, 'created']);
  return { ok: true, id };
};

export const listReports = async (actorId, { status = 'open', limit } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const args = [];
  let where = '';
  if (status && status !== 'all') { args.push(status); where = 'WHERE r.status = $1'; }
  args.push(lim);
  const { rows } = await query(
    `SELECT r.*, s.shop_name, p.title AS product_title,
            (SELECT count(*)::int FROM market_reports x WHERE x.target_type = r.target_type
               AND x.target_id = r.target_id AND x.status IN ('open','in_review')) AS open_same
       FROM market_reports r
       LEFT JOIN market_sellers s ON s.profile_id = r.seller_id
       LEFT JOIN market_products p ON r.target_type = 'product' AND p.id = r.target_id
       ${where} ORDER BY r.created_at LIMIT $${args.length}`, args);
  return {
    items: rows.map((r) => ({
      id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details,
      status: r.status, resolution: r.resolution, shopName: r.shop_name, productTitle: r.product_title,
      sellerId: r.seller_id, openSame: r.open_same, createdAt: r.created_at.toISOString(),
    })),
  };
};

export const resolveReport = async (actorId, reportId, outcome, resolution, apply, { meta = {} } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  if (!REPORT_ID_RE.test(String(reportId ?? ''))) return { error: 'not_found' };
  if (!['in_review', 'upheld', 'dismissed'].includes(outcome)) return { error: 'bad_action' };
  const why = text(resolution, 500);
  if (outcome !== 'in_review' && why.length < 3) return { error: 'reason_required' };

  const { rows } = await query('SELECT * FROM market_reports WHERE id = $1', [reportId]);
  const rep = rows[0];
  if (!rep) return { error: 'not_found' };
  if (rep.seller_id === actorId) return { error: 'own_product' };
  if (['upheld', 'dismissed'].includes(rep.status)) return { error: 'already_closed' };

  await query(
    `UPDATE market_reports SET status = $2, resolution = $3, resolved_by = $4,
            resolved_at = CASE WHEN $2 = 'in_review' THEN NULL ELSE now() END WHERE id = $1`,
    [reportId, outcome, why, actorId]);
  await query('INSERT INTO market_report_events (report_id, actor_id, action, comment) VALUES ($1,$2,$3,$4)',
    [reportId, actorId, outcome, why]);

  let applied = null;
  if (outcome === 'upheld' && rep.target_type === 'product' && ['hide', 'block'].includes(apply)) {
    applied = await moderateProduct(actorId, rep.target_id, apply, `По жалобе: ${why}`, { meta });
  }
  await logAdmin({
    actorId, targetId: reportId, targetType: 'market_report', type: `market_report_${outcome}`,
    detail: `${rep.target_type}:${rep.target_id} · ${why}`, meta,
  });
  return { ok: true, applied };
};

/** Жалобы на себя — продавцу, без личности автора и без возможности удалить. */
export const reportsAboutMe = async (sellerId) => {
  const { rows } = await query(
    `SELECT id, target_type, target_id, reason, status, resolution, created_at
       FROM market_reports WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 50`, [sellerId]);
  return rows.map((r) => ({
    id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, status: r.status,
    resolution: r.status === 'upheld' || r.status === 'dismissed' ? r.resolution : '',
    createdAt: r.created_at.toISOString(),
  }));
};

/* ─── Апелляции ────────────────────────────────────────────────────── */

export const createAppeal = async (sellerId, input = {}) => {
  const subjectType = ['product', 'application', 'shop'].includes(input.subjectType) ? input.subjectType : null;
  if (!subjectType) return { error: 'bad_target' };
  const subjectId = String(input.subjectId ?? '');
  const body = text(input.text, 2000);
  if (body.length < 10) return { error: 'text_required' };

  if (subjectType === 'product') {
    const { rows } = await query('SELECT seller_id, moderation_status FROM market_products WHERE id = $1', [subjectId]);
    if (!rows[0] || rows[0].seller_id !== sellerId) return { error: 'not_found' };
    if (!['blocked', 'hidden', 'needs_changes'].includes(rows[0].moderation_status)) return { error: 'not_appealable' };
  } else if (subjectType === 'application') {
    const { rows } = await query('SELECT profile_id, status FROM market_seller_applications WHERE id = $1', [subjectId]);
    if (!rows[0] || rows[0].profile_id !== sellerId) return { error: 'not_found' };
    if (rows[0].status !== 'rejected') return { error: 'not_appealable' };
  } else {
    const row = await sellerRow(sellerId);
    if (!row || subjectId !== sellerId || !(row.status === 'suspended' || row.verification_status === 'suspended')) {
      return { error: 'not_appealable' };
    }
  }
  const id = `map-${generateId()}`;
  try {
    await query(
      `INSERT INTO market_appeals (id, seller_id, subject_type, subject_id, text) VALUES ($1,$2,$3,$4,$5)`,
      [id, sellerId, subjectType, subjectId, body]);
  } catch (err) {
    if (err?.code === '23505') return { error: 'already_appealed' };
    throw err;
  }
  return { ok: true, id };
};

export const myAppeals = async (sellerId) => {
  const { rows } = await query(
    `SELECT id, subject_type, subject_id, text, status, decision, created_at, decided_at
       FROM market_appeals WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 50`, [sellerId]);
  return rows.map((r) => ({
    id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, text: r.text, status: r.status,
    decision: r.decision, createdAt: r.created_at.toISOString(), decidedAt: r.decided_at?.toISOString() ?? null,
  }));
};

export const listAppeals = async (actorId, { status = 'open' } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const args = [];
  let where = '';
  if (status && status !== 'all') { args.push(status); where = 'WHERE a.status = $1'; }
  const { rows } = await query(
    `SELECT a.*, s.shop_name FROM market_appeals a JOIN market_sellers s ON s.profile_id = a.seller_id
      ${where} ORDER BY a.created_at LIMIT 100`, args);
  return {
    items: rows.map((r) => ({
      id: r.id, sellerId: r.seller_id, shopName: r.shop_name, subjectType: r.subject_type,
      subjectId: r.subject_id, text: r.text, status: r.status, decision: r.decision,
      createdAt: r.created_at.toISOString(),
    })),
  };
};

export const decideAppeal = async (actorId, appealId, accept, decision, { meta = {} } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  if (!APPEAL_ID_RE.test(String(appealId ?? ''))) return { error: 'not_found' };
  const why = text(decision, 500);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query('SELECT * FROM market_appeals WHERE id = $1', [appealId]);
  const ap = rows[0];
  if (!ap) return { error: 'not_found' };
  /* Решение по апелляции принимает не тот, на чью карточку она подана. */
  if (ap.seller_id === actorId) return { error: 'own_product' };
  if (ap.status !== 'open') return { error: 'already_closed' };
  const { rowCount } = await query(
    `UPDATE market_appeals SET status = $2, decision = $3, decided_by = $4, decided_at = now()
      WHERE id = $1 AND status = 'open'`, [appealId, accept ? 'accepted' : 'rejected', why, actorId]);
  if (rowCount === 0) return { error: 'already_closed' };

  if (accept) {
    if (ap.subject_type === 'product') {
      await moderateProduct(actorId, ap.subject_id, 're_review', `Апелляция принята: ${why}`, { meta });
    } else if (ap.subject_type === 'application') {
      await query(
        `UPDATE market_seller_applications SET status = 'submitted', decided_at = NULL, updated_at = now()
          WHERE id = $1 AND status = 'rejected'`, [ap.subject_id]);
      await query(
        `INSERT INTO market_seller_events (profile_id, app_id, actor_id, actor_role, action, from_status, to_status, comment)
         VALUES ($1,$2,$3,'staff','appeal_accepted','rejected','submitted',$4)`,
        [ap.seller_id, ap.subject_id, actorId, why]);
    } else {
      await query(
        `UPDATE market_sellers SET verification_status = 'reverify', updated_at = now() WHERE profile_id = $1`, [ap.seller_id]);
    }
  }
  await logAdmin({
    actorId, targetId: appealId, targetType: 'market_appeal',
    type: accept ? 'market_appeal_accept' : 'market_appeal_reject',
    detail: `${ap.subject_type}:${ap.subject_id} · ${why}`, meta,
  });
  return { ok: true };
};

/* ─── Настройки правил допуска (администратор) ─────────────────────── */

export const rulesOverview = async (actorId) => {
  if (!(await can(actorId, 'market'))) return { error: 'not_allowed' };
  const rules = await loadRules();
  const settings = await loadSettings();
  return {
    kinds: KINDS,
    docTypes: DOC_TYPES,
    categories: Object.keys(CATEGORY_DEFAULTS).map((c) => ({
      key: c,
      base: CATEGORY_DEFAULTS[c],
      effective: effectiveCategoryRule(c, rules),
      override: rules.get(`category:${c}`)
        ? { allowedKinds: rules.get(`category:${c}`).allowed_kinds, requiredDocs: rules.get(`category:${c}`).required_docs }
        : null,
    })),
    settings,
    defaults: DEFAULT_SETTINGS,
    hardRules: [
      'Физлицо продаёт только личные вещи; регулярная торговля требует статуса.',
      'Самозанятый не перепродаёт приобретённые товары и не торгует товарами с обязательной маркировкой.',
      'ПВЗ открывают только ИП и юридические лица.',
      'Эти ограничения зашиты в код и настройками не отключаются.',
    ],
  };
};

export const setCategoryRule = async (actorId, category, input = {}, { meta = {} } = {}) => {
  if (!(await can(actorId, 'market'))) return { error: 'not_allowed' };
  if (!CATEGORY_DEFAULTS[category]) return { error: 'bad_category' };
  let allowedKinds = null;
  if (input.allowedKinds !== undefined && input.allowedKinds !== null) {
    if (!Array.isArray(input.allowedKinds) || !input.allowedKinds.every((k) => KINDS.includes(k))) return { error: 'bad_kind' };
    allowedKinds = [...new Set(input.allowedKinds)];
  }
  const docs = Array.isArray(input.requiredDocs) ? [...new Set(input.requiredDocs)].filter((d) => DOC_TYPES[d]) : [];
  await query(
    `INSERT INTO market_trade_rules (rule_key, allowed_kinds, required_docs, manual_review, marking_possible, disabled, note, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (rule_key) DO UPDATE SET allowed_kinds = $2, required_docs = $3, manual_review = $4,
       marking_possible = $5, disabled = $6, note = $7, updated_by = $8, updated_at = now()`,
    [`category:${category}`, allowedKinds, docs, input.manualReview === true, input.markingPossible === true,
      input.disabled === true, text(input.note, 300), actorId]);
  await logAdmin({
    actorId, targetId: category, targetType: 'market_rule', type: 'market_rule_set',
    detail: JSON.stringify({ allowedKinds, docs, manual: input.manualReview === true, disabled: input.disabled === true }), meta,
  });
  return { ok: true };
};

export const setMarketSetting = async (actorId, key, value, { meta = {} } = {}) => {
  if (!(await can(actorId, 'market'))) return { error: 'not_allowed' };
  if (key === 'premoderation') {
    if (!['risky', 'all'].includes(value)) return { error: 'bad_value' };
  } else if (key === 'individualMaxProducts') {
    if (!Number.isInteger(value) || value < 1 || value > 1000) return { error: 'bad_value' };
  } else return { error: 'bad_key' };
  await query(
    `INSERT INTO market_settings (key, value, updated_by, updated_at) VALUES ($1,$2::jsonb,$3,now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_by = $3, updated_at = now()`,
    [key, JSON.stringify(value), actorId]);
  await logAdmin({
    actorId, targetId: key, targetType: 'market_setting', type: 'market_setting_set',
    detail: `${key} = ${JSON.stringify(value)}`, meta,
  });
  return { ok: true };
};
