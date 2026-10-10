/**
 * Sky Market: заявки продавцов, документы, заявки на ПВЗ.
 *
 * Статус продавца определяет проверка, а не форма: выбор «ИП» в анкете
 * ничего не даёт, пока сотрудник не одобрил заявку. Право торговать и
 * подтверждённый налоговый статус появляются в market_sellers ТОЛЬКО из
 * `approve` ниже — и ниоткуда больше.
 *
 * Чего здесь нет и быть не должно: обращений к ФНС, ЕГРИП/ЕГРЮЛ и иным
 * госреестрам. Мы проверяем формат и контрольные суммы реквизитов, а
 * подлинность проверяет человек по приложенным документам. Поэтому ни
 * один ответ отсюда не называет статус «подтверждённым государством».
 *
 * Данные заявки (ИНН, ОГРН, ФИО) лежат зашифрованными; в списках видны
 * лишь последние цифры ИНН. Полное содержимое открывается сотруднику
 * явным запросом, и это попадает в журнал администраторов.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { CATEGORIES, marketText as text, sellerRow } from './market.mjs';
import { recheckSellerProducts } from './marketmod.mjs';
import {
  KINDS, KIND_LABEL, ACTIVITIES, ACTIVITY_LABEL, DOC_TYPES, FORMS, PVZ_KINDS,
  activityAllowed, cleanForm, requiredApplicationDocs, sellerCapabilities, validCountry,
} from './sellerrules.mjs';

export const APP_ID_RE = /^sap-[0-9a-f-]{36}$/;
export const DOC_ID_RE = /^mdc-[0-9a-f-]{36}$/;
export const PVZ_APP_ID_RE = /^mpa-[0-9a-f-]{36}$/;

const OPEN = ['draft', 'submitted', 'in_review', 'needs_changes'];
const EDITABLE = ['draft', 'needs_changes'];
const MAX_DOCS_PER_REF = 12;
const MAX_MISSING = 12;

const iso = (d) => d?.toISOString?.() ?? null;

const note = (client, e) => client.query(
  `INSERT INTO market_seller_events (profile_id, app_id, actor_id, actor_role, action, from_status, to_status, comment)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [e.profileId, e.appId ?? null, e.actorId ?? null, e.role ?? 'seller', e.action, e.from ?? null, e.to ?? null, text(e.comment, 1000)]);

/* ─── Права сотрудников ────────────────────────────────────────────── */

/** Проверка документов и запросы исправлений. */
const mayReviewDocs = async (actor) => (await can(actor, 'seller_docs')) || (await can(actor, 'market'));
/** Окончательные решения по заявкам, приостановка магазинов, правила. */
const mayDecide = async (actor) => can(actor, 'market');
const mayManagePvz = async (actor) => (await can(actor, 'pvz_manage')) || (await can(actor, 'market'));

/* ─── Представление заявки ─────────────────────────────────────────── */

const readData = (row) => {
  try { return JSON.parse(decryptContent(row.data_enc) ?? '{}'); } catch { return {}; }
};

const docsOf = async (scope, refId) => {
  const { rows } = await query(
    `SELECT id, doc_type, label, mime, bytes, status, review_comment, created_at FROM market_docs
      WHERE scope = $1 AND ref_id = $2 AND removed_at IS NULL ORDER BY created_at`, [scope, refId]);
  return rows.map((d) => ({
    id: d.id, type: d.doc_type, typeLabel: DOC_TYPES[d.doc_type] ?? d.doc_type, label: d.label,
    mime: d.mime, bytes: Number(d.bytes), status: d.status, comment: d.review_comment,
    createdAt: iso(d.created_at),
  }));
};

const appView = async (row, { withData = true } = {}) => {
  const data = withData ? readData(row) : {};
  const fields = data.fields ?? {};
  return {
    id: row.id, kind: row.kind, kindLabel: KIND_LABEL[row.kind], requestType: row.request_type,
    status: row.status, activities: row.activities, categories: row.categories,
    activityDescription: row.activity_description, fields: withData ? fields : undefined,
    uncertain: withData ? data.uncertain === true : undefined,
    sellerCountry: row.seller_country, innTail: row.inn_tail,
    missing: row.missing ?? [], adminComment: row.admin_comment, rejectReason: row.reject_reason,
    isCurrent: row.is_current, revision: row.revision,
    submittedAt: iso(row.submitted_at), decidedAt: iso(row.decided_at), createdAt: iso(row.created_at),
    requiredDocs: requiredApplicationDocs(row.kind, fields).map((t) => ({ type: t, label: DOC_TYPES[t] })),
    docs: await docsOf('application', row.id),
  };
};

const eventsOf = async (profileId, limit = 100) => {
  const { rows } = await query(
    `SELECT action, from_status, to_status, comment, actor_role, created_at, app_id FROM market_seller_events
      WHERE profile_id = $1 ORDER BY id DESC LIMIT $2`, [profileId, limit]);
  return rows.map((e) => ({
    action: e.action, from: e.from_status, to: e.to_status, comment: e.comment, by: e.actor_role,
    at: iso(e.created_at), appId: e.app_id,
  }));
};

export const verificationConfig = () => ({
  kinds: KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], fields: FORMS[k], docs: requiredApplicationDocs(k, { repIsHead: true }).map((t) => ({ type: t, label: DOC_TYPES[t] })) })),
  activities: ACTIVITIES.map((a) => ({ key: a, label: ACTIVITY_LABEL[a] })),
  categories: CATEGORIES,
  docTypes: DOC_TYPES,
});

/** Всё о проверке для кабинета самого продавца. */
export const myVerification = async (profileId) => {
  const seller = await sellerRow(profileId);
  if (!seller) return { seller: null };
  const { rows: open } = await query(
    `SELECT * FROM market_seller_applications WHERE profile_id = $1 AND status = ANY($2)
      ORDER BY created_at DESC LIMIT 1`, [profileId, OPEN]);
  const { rows: last } = await query(
    `SELECT * FROM market_seller_applications WHERE profile_id = $1 AND status IN ('rejected','approved')
      ORDER BY decided_at DESC NULLS LAST, created_at DESC LIMIT 1`, [profileId]);
  const { rows: cur } = await query(
    'SELECT * FROM market_seller_applications WHERE profile_id = $1 AND is_current', [profileId]);
  const shown = open[0] ?? last[0] ?? null;
  return {
    profileId,
    verification: seller.verification_status,
    shopStatus: seller.status,
    suspendReason: seller.status === 'suspended' || seller.verification_status === 'suspended' ? seller.suspend_reason : '',
    taxKind: seller.tax_kind ?? null,
    capabilities: sellerCapabilities(seller.tax_kind, seller.activities ?? []),
    application: shown ? await appView(shown) : null,
    current: cur[0] ? await appView(cur[0], { withData: false }) : null,
    history: await eventsOf(profileId),
  };
};

/* ─── Заявка: создание / сохранение ────────────────────────────────── */

export const saveApplication = async (profileId, input = {}) => {
  const seller = await sellerRow(profileId);
  if (!seller) return { error: 'shop_required' };

  const kind = String(input.kind ?? '');
  if (!KINDS.includes(kind)) return { error: 'bad_kind', message: 'Выберите статус продавца.' };

  const activities = [...new Set(Array.isArray(input.activities) ? input.activities.map(String) : [])];
  if (activities.length === 0) return { error: 'activity_required', message: 'Выберите, чем вы будете торговать.' };
  for (const a of activities) {
    const ok = activityAllowed(kind, a);
    if (!ok.ok) return { error: ok.error, message: ok.message };
  }
  const categories = [...new Set(Array.isArray(input.categories) ? input.categories.map(String) : [])]
    .filter((c) => CATEGORIES.includes(c)).slice(0, CATEGORIES.length);
  const country = String(input.sellerCountry ?? 'RU').toUpperCase();
  if (!validCountry(country)) return { error: 'bad_country' };

  const cleaned = cleanForm(kind, input.fields, { strict: false });
  if (cleaned.problems.length && cleaned.problems.some((p) => p.message.startsWith('Проверьте') || p.message.includes('цифр'))) {
    return { error: 'bad_fields', problems: cleaned.problems };
  }
  const desc = text(input.activityDescription, 2000);
  const inn = cleaned.fields.inn ?? '';
  const data = encryptContent(JSON.stringify({ fields: cleaned.fields, uncertain: input.uncertain === true }));

  const requestType = ['approved', 'legacy', 'reverify'].includes(seller.verification_status) ? 'change' : 'initial';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sapp:${profileId}`]);
    const { rows: open } = await client.query(
      `SELECT * FROM market_seller_applications WHERE profile_id = $1 AND status = ANY($2) FOR UPDATE`,
      [profileId, OPEN]);
    let row = open[0];
    if (row && !EDITABLE.includes(row.status)) {
      await client.query('ROLLBACK');
      return { error: 'locked', message: 'Заявка на проверке. Изменить её можно после ответа администратора.' };
    }
    if (row) {
      const { rows } = await client.query(
        `UPDATE market_seller_applications
            SET kind = $2, activities = $3, categories = $4, activity_description = $5, data_enc = $6,
                inn_tail = $7, seller_country = $8, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [row.id, kind, activities, categories, desc, data, inn.slice(-4), country]);
      row = rows[0];
    } else {
      const id = `sap-${generateId()}`;
      const { rows } = await client.query(
        `INSERT INTO market_seller_applications
           (id, profile_id, kind, request_type, activities, categories, activity_description, data_enc, inn_tail, seller_country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, profileId, kind, requestType, activities, categories, desc, data, inn.slice(-4), country]);
      row = rows[0];
      await note(client, { profileId, appId: id, action: 'created', to: 'draft', comment: requestType === 'change' ? 'Запрос на изменение статуса' : '' });
      if (requestType === 'initial') {
        await client.query(`UPDATE market_sellers SET verification_status = 'draft', updated_at = now() WHERE profile_id = $1`, [profileId]);
      }
    }
    await client.query('COMMIT');
    return { application: await appView(row) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Запрос на изменение статуса: черновик, предзаполненный действующими данными. */
export const startChangeRequest = async (profileId) => {
  const seller = await sellerRow(profileId);
  if (!seller) return { error: 'shop_required' };
  if (!['approved', 'legacy', 'reverify'].includes(seller.verification_status)) return { error: 'wrong_state' };
  const { rows: open } = await query(
    'SELECT id FROM market_seller_applications WHERE profile_id = $1 AND status = ANY($2)', [profileId, OPEN]);
  if (open[0]) return myVerification(profileId);
  const { rows: cur } = await query(
    'SELECT * FROM market_seller_applications WHERE profile_id = $1 AND is_current', [profileId]);
  const base = cur[0];
  const id = `sap-${generateId()}`;
  await query(
    `INSERT INTO market_seller_applications
       (id, profile_id, kind, request_type, activities, categories, activity_description, data_enc, inn_tail, seller_country)
     VALUES ($1,$2,$3,'change',$4,$5,$6,$7,$8,$9)`,
    [id, profileId, base?.kind ?? seller.tax_kind ?? 'ip', base?.activities ?? seller.activities ?? [],
      base?.categories ?? [], base?.activity_description ?? '', base?.data_enc ?? null,
      base?.inn_tail ?? '', base?.seller_country ?? seller.seller_country ?? 'RU']);
  const client = await pool.connect();
  try {
    await note(client, { profileId, appId: id, action: 'change_requested', to: 'draft' });
  } finally { client.release(); }
  return myVerification(profileId);
};

export const submitApplication = async (profileId) => {
  const { rows } = await query(
    `SELECT * FROM market_seller_applications WHERE profile_id = $1 AND status = ANY($2)
      ORDER BY created_at DESC LIMIT 1`, [profileId, EDITABLE]);
  const row = rows[0];
  if (!row) return { error: 'nothing_to_submit' };

  const data = readData(row);
  const strict = cleanForm(row.kind, data.fields, { strict: true });
  if (strict.problems.length) return { error: 'bad_fields', problems: strict.problems };
  for (const a of row.activities) {
    const ok = activityAllowed(row.kind, a);
    if (!ok.ok) return { error: ok.error, message: ok.message };
  }
  if (String(row.activity_description).trim().length < 10) {
    return { error: 'description_required', message: 'Опишите, чем вы занимаетесь, хотя бы в паре предложений.' };
  }
  const docs = await docsOf('application', row.id);
  const have = new Set(docs.filter((d) => d.status !== 'rejected').map((d) => d.type));
  const missing = requiredApplicationDocs(row.kind, strict.fields).filter((t) => !have.has(t));
  if (missing.length) {
    return { error: 'docs_missing', missing: missing.map((t) => ({ type: t, label: DOC_TYPES[t] })) };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Атомарный переход: повторная отправка той же заявки ничего не
       создаёт — второй запрос не найдёт её в draft/needs_changes. */
    const { rows: upd } = await client.query(
      `UPDATE market_seller_applications
          SET status = 'submitted', submitted_at = now(), revision = revision + 1, missing = '[]'::jsonb, updated_at = now()
        WHERE id = $1 AND status = ANY($2) RETURNING *`, [row.id, EDITABLE]);
    if (!upd[0]) { await client.query('ROLLBACK'); return { error: 'already_submitted' }; }
    if (row.request_type === 'initial') {
      await client.query(`UPDATE market_sellers SET verification_status = 'submitted', updated_at = now() WHERE profile_id = $1`, [profileId]);
    }
    await note(client, { profileId, appId: row.id, action: 'submitted', from: row.status, to: 'submitted' });
    await client.query('COMMIT');
    return { application: await appView(upd[0]) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Документы ────────────────────────────────────────────────────── */

/**
 * Зарезервировать место под загружаемый файл. Файл на диск пишет
 * маршрут, а строка появляется ДО файла — как и у картинок товара, чтобы
 * уборка осиротевших файлов не стёрла только что загруженное.
 */
export const reserveDoc = async (profileId, { scope, refId, docType, label, mime }) => {
  if (!DOC_TYPES[docType]) return { error: 'bad_doc_type' };
  if (!['application', 'product', 'pvz'].includes(scope)) return { error: 'bad_scope' };
  if (scope === 'application') {
    const { rows } = await query('SELECT profile_id, status FROM market_seller_applications WHERE id = $1', [refId]);
    if (!rows[0] || rows[0].profile_id !== profileId) return { error: 'not_found' };
    if (!EDITABLE.includes(rows[0].status)) return { error: 'locked' };
  } else if (scope === 'product') {
    const { rows } = await query('SELECT seller_id, moderation_status FROM market_products WHERE id = $1', [refId]);
    if (!rows[0] || rows[0].seller_id !== profileId) return { error: 'not_found' };
    if (['blocked', 'archived'].includes(rows[0].moderation_status)) return { error: 'locked' };
  } else {
    const { rows } = await query('SELECT profile_id, status FROM market_pvz_applications WHERE id = $1', [refId]);
    if (!rows[0] || rows[0].profile_id !== profileId) return { error: 'not_found' };
    if (!EDITABLE.includes(rows[0].status)) return { error: 'locked' };
  }
  const { rows: cnt } = await query(
    "SELECT count(*)::int AS n FROM market_docs WHERE scope = $1 AND ref_id = $2 AND removed_at IS NULL", [scope, refId]);
  if (cnt[0].n >= MAX_DOCS_PER_REF) return { error: 'too_many_docs' };
  const id = `mdc-${generateId()}`;
  const fileId = `mdf-${generateId()}`;
  await query(
    `INSERT INTO market_docs (id, profile_id, scope, ref_id, doc_type, label, file_id, mime)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, profileId, scope, refId, docType, text(label, 120), fileId, mime]);
  return { id, fileId };
};

/** Документы по своей заявке/карточке/ПВЗ — только владельцу. */
export const listMyDocs = async (profileId, scope, refId) => {
  if (!['application', 'product', 'pvz'].includes(scope)) return { error: 'bad_scope' };
  const { rows } = await query(
    `SELECT id, doc_type, label, mime, bytes, status, review_comment, created_at FROM market_docs
      WHERE profile_id = $1 AND scope = $2 AND ref_id = $3 AND removed_at IS NULL ORDER BY created_at`,
    [profileId, scope, String(refId ?? '')]);
  return {
    items: rows.map((d) => ({
      id: d.id, type: d.doc_type, typeLabel: DOC_TYPES[d.doc_type] ?? d.doc_type, label: d.label,
      mime: d.mime, bytes: Number(d.bytes), status: d.status, comment: d.review_comment, createdAt: iso(d.created_at),
    })),
  };
};

export const finishDoc = (docId, bytes) =>
  query('UPDATE market_docs SET bytes = $2 WHERE id = $1', [docId, bytes]);

export const dropDoc = async (docId) => {
  await query('DELETE FROM market_docs WHERE id = $1 AND bytes = 0', [docId]);
};

export const removeMyDoc = async (profileId, docId) => {
  if (!DOC_ID_RE.test(String(docId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM market_docs WHERE id = $1 AND removed_at IS NULL', [docId]);
  const d = rows[0];
  if (!d || d.profile_id !== profileId) return { error: 'not_found' };
  if (d.status === 'accepted') return { error: 'locked', message: 'Принятый документ удалить нельзя.' };
  await query('UPDATE market_docs SET removed_at = now() WHERE id = $1', [docId]);
  return { ok: true, fileId: d.file_id };
};

/** Кому можно прочитать файл: владельцу и сотрудникам нужного направления. */
export const docForReading = async (viewerId, docId) => {
  if (!DOC_ID_RE.test(String(docId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM market_docs WHERE id = $1 AND removed_at IS NULL', [docId]);
  const d = rows[0];
  if (!d) return null;
  if (d.profile_id === viewerId) return { fileId: d.file_id, mime: d.mime, staff: false };
  const perm = d.scope === 'application' ? (await mayReviewDocs(viewerId))
    : d.scope === 'pvz' ? (await mayManagePvz(viewerId) || await mayReviewDocs(viewerId))
      : ((await can(viewerId, 'market_moderation')) || (await can(viewerId, 'market')));
  if (!perm) return null;
  await logAdmin({ actorId: viewerId, targetId: docId, targetType: 'market_doc', type: 'market_doc_view', detail: `${d.scope}:${d.ref_id}` });
  return { fileId: d.file_id, mime: d.mime, staff: true };
};

export const reviewDoc = async (actorId, docId, accept, comment, { meta = {} } = {}) => {
  if (!DOC_ID_RE.test(String(docId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM market_docs WHERE id = $1 AND removed_at IS NULL', [docId]);
  const d = rows[0];
  if (!d) return { error: 'not_found' };
  const perm = d.scope === 'application' ? await mayReviewDocs(actorId)
    : d.scope === 'pvz' ? (await mayManagePvz(actorId) || await mayReviewDocs(actorId))
      : ((await can(actorId, 'market_moderation')) || (await can(actorId, 'market')) || (await can(actorId, 'seller_docs')));
  if (!perm) return { error: 'not_allowed' };
  if (d.profile_id === actorId) return { error: 'own_application' };
  const why = text(comment, 500);
  if (!accept && why.length < 3) return { error: 'reason_required' };
  await query(
    `UPDATE market_docs SET status = $2, review_comment = $3, reviewer_id = $4, reviewed_at = now() WHERE id = $1`,
    [docId, accept ? 'accepted' : 'rejected', why, actorId]);
  await logAdmin({
    actorId, targetId: docId, targetType: 'market_doc', type: accept ? 'market_doc_accept' : 'market_doc_reject',
    detail: `${d.scope}:${d.ref_id} · ${d.doc_type}${why ? ` · ${why}` : ''}`, meta,
  });
  return { ok: true };
};

/* ─── Очередь и решения (сотрудники) ───────────────────────────────── */

export const listApplications = async (actorId, { status = 'submitted', kind, requestType, limit } = {}) => {
  if (!(await mayReviewDocs(actorId))) return { error: 'not_allowed' };
  const args = [];
  const where = [];
  if (status && status !== 'all') { args.push(status); where.push(`a.status = $${args.length}`); }
  if (kind && KINDS.includes(kind)) { args.push(kind); where.push(`a.kind = $${args.length}`); }
  if (requestType === 'change' || requestType === 'initial') { args.push(requestType); where.push(`a.request_type = $${args.length}`); }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  args.push(lim);
  const { rows } = await query(
    `SELECT a.id, a.profile_id, a.kind, a.request_type, a.status, a.inn_tail, a.submitted_at, a.activities,
            s.shop_name, s.verification_status, p.name, p.username
       FROM market_seller_applications a
       JOIN market_sellers s ON s.profile_id = a.profile_id
       JOIN profiles p ON p.id = a.profile_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.submitted_at NULLS LAST, a.created_at LIMIT $${args.length}`, args);
  return {
    items: rows.map((r) => ({
      id: r.id, profileId: r.profile_id, kind: r.kind, kindLabel: KIND_LABEL[r.kind], requestType: r.request_type,
      status: r.status, innTail: r.inn_tail, activities: r.activities, shopName: r.shop_name,
      sellerVerification: r.verification_status, name: r.name, username: r.username, submittedAt: iso(r.submitted_at),
    })),
  };
};

export const readApplicationAdmin = async (actorId, appId, { meta = {} } = {}) => {
  if (!(await mayReviewDocs(actorId))) return { error: 'not_allowed' };
  if (!APP_ID_RE.test(String(appId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM market_seller_applications WHERE id = $1', [appId]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  /* Открытие полных реквизитов — отдельное действие в журнале. */
  await logAdmin({ actorId, targetId: appId, targetType: 'market_application', type: 'market_app_view', detail: `ИНН …${row.inn_tail}`, meta });
  const { rows: sel } = await query(
    `SELECT s.shop_name, s.verification_status, s.status, s.tax_kind, p.name, p.username
       FROM market_sellers s JOIN profiles p ON p.id = s.profile_id WHERE s.profile_id = $1`, [row.profile_id]);
  const { rows: prev } = await query(
    `SELECT id, kind, status, request_type, decided_at, is_current FROM market_seller_applications
      WHERE profile_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 20`, [row.profile_id, appId]);
  return {
    application: await appView(row),
    profileId: row.profile_id,
    seller: sel[0] ? { shopName: sel[0].shop_name, verification: sel[0].verification_status, status: sel[0].status,
      taxKind: sel[0].tax_kind, name: sel[0].name, username: sel[0].username } : null,
    earlier: prev.map((p) => ({ id: p.id, kind: p.kind, status: p.status, requestType: p.request_type, decidedAt: iso(p.decided_at), isCurrent: p.is_current })),
    history: await eventsOf(row.profile_id),
  };
};

const mirror = async (client, row, status) => {
  /* Пока идёт ПЕРВИЧНАЯ проверка, состояние магазина зеркалит заявку.
     Запрос на изменение магазин не трогает: он торгует по старым данным. */
  if (row.request_type === 'initial') {
    await client.query(
      `UPDATE market_sellers SET verification_status = $2, updated_at = now() WHERE profile_id = $1
         AND verification_status NOT IN ('suspended')`, [row.profile_id, status]);
  }
};

export const decideApplication = async (actorId, appId, action, payload = {}, { meta = {} } = {}) => {
  if (!APP_ID_RE.test(String(appId ?? ''))) return { error: 'not_found' };
  const finalActions = ['approve', 'reject'];
  if (finalActions.includes(action) ? !(await mayDecide(actorId)) : !(await mayReviewDocs(actorId))) {
    return { error: 'not_allowed' };
  }
  const comment = text(payload.comment, 1000);

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM market_seller_applications WHERE id = $1 FOR UPDATE', [appId]);
    const row = rows[0];
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    /* Заявку не решает тот, кто её подал. */
    if (row.profile_id === actorId) { await client.query('ROLLBACK'); return { error: 'own_application' }; }
    const from = row.status;

    if (action === 'start_review') {
      if (from !== 'submitted') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      await client.query(`UPDATE market_seller_applications SET status = 'in_review', reviewer_id = $2, updated_at = now() WHERE id = $1`, [appId, actorId]);
      await mirror(client, row, 'in_review');
      await note(client, { profileId: row.profile_id, appId, actorId, role: 'staff', action: 'review_started', from, to: 'in_review' });
    } else if (action === 'request_changes') {
      if (!['submitted', 'in_review'].includes(from)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      const missing = (Array.isArray(payload.missing) ? payload.missing : [])
        .map((m) => text(m, 200)).filter(Boolean).slice(0, MAX_MISSING);
      if (comment.length < 3 && missing.length === 0) { await client.query('ROLLBACK'); return { error: 'reason_required' }; }
      await client.query(
        `UPDATE market_seller_applications SET status = 'needs_changes', missing = $2::jsonb, admin_comment = $3,
                reviewer_id = $4, updated_at = now() WHERE id = $1`,
        [appId, JSON.stringify(missing), comment, actorId]);
      await mirror(client, row, 'needs_changes');
      await note(client, { profileId: row.profile_id, appId, actorId, role: 'staff', action: 'changes_requested', from, to: 'needs_changes', comment: [comment, ...missing].filter(Boolean).join(' · ') });
    } else if (action === 'reject') {
      if (!['submitted', 'in_review', 'needs_changes'].includes(from)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      if (comment.length < 3) { await client.query('ROLLBACK'); return { error: 'reason_required' }; }
      await client.query(
        `UPDATE market_seller_applications SET status = 'rejected', reject_reason = $2, admin_comment = $2,
                reviewer_id = $3, decided_at = now(), updated_at = now() WHERE id = $1`, [appId, comment, actorId]);
      await mirror(client, row, 'rejected');
      await note(client, { profileId: row.profile_id, appId, actorId, role: 'staff', action: 'rejected', from, to: 'rejected', comment });
    } else if (action === 'approve') {
      if (!['submitted', 'in_review'].includes(from)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      /* Обязательные документы приняты человеком — иначе одобрить нельзя. */
      const data = readData(row);
      const need = requiredApplicationDocs(row.kind, data.fields);
      const { rows: ok } = await client.query(
        `SELECT doc_type FROM market_docs WHERE scope = 'application' AND ref_id = $1 AND removed_at IS NULL AND status = 'accepted'`, [appId]);
      const accepted = new Set(ok.map((d) => d.doc_type));
      const lacking = need.filter((t) => !accepted.has(t));
      if (lacking.length) {
        await client.query('ROLLBACK');
        return { error: 'docs_not_accepted', missing: lacking.map((t) => ({ type: t, label: DOC_TYPES[t] })) };
      }
      await client.query(
        `UPDATE market_seller_applications SET is_current = FALSE, superseded_at = now()
          WHERE profile_id = $1 AND is_current AND id <> $2`, [row.profile_id, appId]);
      await client.query(
        `UPDATE market_seller_applications SET status = 'approved', is_current = TRUE, admin_comment = $2,
                missing = '[]'::jsonb, reviewer_id = $3, decided_at = now(), updated_at = now() WHERE id = $1`,
        [appId, comment, actorId]);
      /* Единственное место, где магазин получает подтверждённый статус. */
      await client.query(
        `UPDATE market_sellers
            SET tax_kind = $2, activities = $3, seller_country = $4, verification_status = 'approved',
                status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = now()
          WHERE profile_id = $1`,
        [row.profile_id, row.kind, row.activities, row.seller_country]);
      await note(client, { profileId: row.profile_id, appId, actorId, role: 'staff', action: 'approved', from, to: 'approved', comment });
    } else {
      await client.query('ROLLBACK');
      return { error: 'bad_action' };
    }
    await client.query('COMMIT');
    result = { ok: true, status: action === 'start_review' ? 'in_review' : action === 'request_changes' ? 'needs_changes' : action === 'reject' ? 'rejected' : 'approved', row };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await logAdmin({
    actorId, targetId: appId, targetType: 'market_application', type: `market_app_${action}`,
    detail: `${KIND_LABEL[result.row.kind]} · ${result.status}${comment ? ` · ${comment}` : ''}`, meta,
  });
  /* После смены статуса карточки, которые больше не проходят правила, снимаются. */
  let hidden = 0;
  if (action === 'approve' && result.row.request_type === 'change') hidden = await recheckSellerProducts(result.row.profile_id);
  return { ok: true, status: result.status, hiddenProducts: hidden };
};

/** Приостановить магазин / вернуть / отправить на повторную проверку. */
export const sellerAdminAction = async (actorId, profileId, action, reason, { meta = {} } = {}) => {
  if (!(await mayDecide(actorId))) return { error: 'not_allowed' };
  if (profileId === actorId) return { error: 'own_application' };
  const seller = await sellerRow(profileId);
  if (!seller) return { error: 'not_found' };
  const why = text(reason, 500);
  if (why.length < 3) return { error: 'reason_required' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let to;
    if (action === 'suspend') {
      /* Заказы и история остаются; закрывается только витрина. */
      await client.query(
        `UPDATE market_sellers SET status = 'suspended', verification_status = 'suspended',
                suspend_reason = $2, suspended_at = now(), updated_at = now() WHERE profile_id = $1`, [profileId, why]);
      to = 'suspended';
    } else if (action === 'reinstate') {
      if (seller.verification_status !== 'suspended' && seller.status !== 'suspended') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      const { rows: cur } = await client.query('SELECT 1 FROM market_seller_applications WHERE profile_id = $1 AND is_current', [profileId]);
      await client.query(
        `UPDATE market_sellers SET status = 'active', verification_status = $2, suspend_reason = '', updated_at = now() WHERE profile_id = $1`,
        [profileId, cur[0] ? 'approved' : 'legacy']);
      to = cur[0] ? 'approved' : 'legacy';
    } else if (action === 'reverify') {
      if (!['approved', 'legacy'].includes(seller.verification_status)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      await client.query(`UPDATE market_sellers SET verification_status = 'reverify', updated_at = now() WHERE profile_id = $1`, [profileId]);
      to = 'reverify';
    } else { await client.query('ROLLBACK'); return { error: 'bad_action' }; }
    await note(client, { profileId, actorId, role: 'staff', action: `seller_${action}`, from: seller.verification_status, to, comment: why });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await logAdmin({ actorId, targetId: profileId, targetType: 'market_seller', type: `market_seller_${action}`, detail: why, meta });
  return { ok: true };
};

/* ─── Заявки на ПВЗ (только ИП и юридические лица) ─────────────────── */

const pvzView = async (row) => ({
  id: row.id, status: row.status, title: row.title, city: row.city, address: row.address, phone: row.phone,
  contactName: row.contact_name, premises: row.premises ?? {}, notes: row.notes, missing: row.missing ?? [],
  adminComment: row.admin_comment, rejectReason: row.reject_reason, pvzId: row.pvz_id ?? null,
  submittedAt: iso(row.submitted_at), decidedAt: iso(row.decided_at), createdAt: iso(row.created_at),
  requiredDocs: [{ type: 'premises_doc', label: DOC_TYPES.premises_doc }],
  docs: await docsOf('pvz', row.id),
});

/** Может ли человек подавать заявку на ПВЗ: подтверждённый ИП или юрлицо. */
const pvzEligibility = async (profileId) => {
  const seller = await sellerRow(profileId);
  if (!seller || seller.verification_status !== 'approved' || !PVZ_KINDS.includes(seller.tax_kind) || seller.status === 'suspended') {
    return { ok: false, kind: seller?.tax_kind ?? null };
  }
  const { rows } = await query('SELECT id FROM market_seller_applications WHERE profile_id = $1 AND is_current', [profileId]);
  return { ok: true, kind: seller.tax_kind, sellerAppId: rows[0]?.id ?? null };
};

export const myPvzApplication = async (profileId) => {
  const el = await pvzEligibility(profileId);
  const seller = await sellerRow(profileId);
  const { rows } = await query(
    `SELECT * FROM market_pvz_applications WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 5`, [profileId]);
  const { rows: events } = rows[0] ? await query(
    'SELECT action, from_status, to_status, comment, created_at FROM market_pvz_app_events WHERE app_id = $1 ORDER BY id DESC LIMIT 50', [rows[0].id]) : { rows: [] };
  return {
    eligible: el.ok,
    kind: el.kind,
    reason: el.ok ? undefined
      : !seller ? 'Сначала откройте магазин.'
        : !PVZ_KINDS.includes(seller.tax_kind ?? '') ? 'Пункты выдачи открывают только индивидуальные предприниматели и юридические лица. Самозанятым и физлицам нужно сначала сменить статус на ИП или ООО.'
          : 'Ваш статус продавца ещё не подтверждён администрацией.',
    items: await Promise.all(rows.map(pvzView)),
    history: events.map((e) => ({ action: e.action, from: e.from_status, to: e.to_status, comment: e.comment, at: iso(e.created_at) })),
  };
};

export const savePvzApplication = async (profileId, input = {}) => {
  const el = await pvzEligibility(profileId);
  if (!el.ok) return { error: 'pvz_needs_ip_or_legal' };
  const title = text(input.title, 120);
  const city = text(input.city, 80);
  const address = text(input.address, 300);
  const phone = text(input.phone, 40);
  const premises = {
    ownership: ['own', 'rent'].includes(input.premises?.ownership) ? input.premises.ownership : '',
    areaM2: Number.isFinite(Number(input.premises?.areaM2)) ? Math.min(Math.max(Number(input.premises.areaM2), 0), 100000) : 0,
    note: text(input.premises?.note, 500),
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pvzapp:${profileId}`]);
    const { rows: open } = await client.query(
      `SELECT * FROM market_pvz_applications WHERE profile_id = $1 AND status = ANY($2) FOR UPDATE`, [profileId, OPEN]);
    let row = open[0];
    if (row && !EDITABLE.includes(row.status)) { await client.query('ROLLBACK'); return { error: 'locked' }; }
    if (row) {
      const { rows } = await client.query(
        `UPDATE market_pvz_applications SET title=$2, city=$3, address=$4, phone=$5, contact_name=$6, premises=$7::jsonb, notes=$8,
                seller_app_id=$9, updated_at=now() WHERE id=$1 RETURNING *`,
        [row.id, title, city, address, phone, text(input.contactName, 120), JSON.stringify(premises), text(input.notes, 1000), el.sellerAppId]);
      row = rows[0];
    } else {
      const id = `mpa-${generateId()}`;
      const { rows } = await client.query(
        `INSERT INTO market_pvz_applications (id, profile_id, title, city, address, phone, contact_name, premises, notes, seller_app_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING *`,
        [id, profileId, title, city, address, phone, text(input.contactName, 120), JSON.stringify(premises), text(input.notes, 1000), el.sellerAppId]);
      row = rows[0];
      await client.query(`INSERT INTO market_pvz_app_events (app_id, actor_id, action, to_status) VALUES ($1,$2,'created','draft')`, [id, profileId]);
    }
    await client.query('COMMIT');
    return { application: await pvzView(row) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
};

export const submitPvzApplication = async (profileId) => {
  const el = await pvzEligibility(profileId);
  if (!el.ok) return { error: 'pvz_needs_ip_or_legal' };
  const { rows } = await query(
    `SELECT * FROM market_pvz_applications WHERE profile_id = $1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1`, [profileId, EDITABLE]);
  const row = rows[0];
  if (!row) return { error: 'nothing_to_submit' };
  const problems = [];
  if (row.title.length < 2) problems.push('Укажите название пункта.');
  if (row.city.length < 2) problems.push('Укажите город.');
  if (row.address.length < 5) problems.push('Укажите адрес.');
  if (row.phone.length < 6) problems.push('Укажите телефон.');
  if (!row.premises?.ownership) problems.push('Укажите, как вы пользуетесь помещением.');
  const docs = await docsOf('pvz', row.id);
  if (!docs.some((d) => d.type === 'premises_doc' && d.status !== 'rejected')) problems.push('Приложите документ на помещение.');
  if (problems.length) return { error: 'bad_fields', problems: problems.map((m) => ({ message: m })) };
  const { rows: upd } = await query(
    `UPDATE market_pvz_applications SET status='submitted', submitted_at=now(), missing='[]'::jsonb, updated_at=now()
      WHERE id=$1 AND status = ANY($2) RETURNING *`, [row.id, EDITABLE]);
  if (!upd[0]) return { error: 'already_submitted' };
  await query(`INSERT INTO market_pvz_app_events (app_id, actor_id, action, from_status, to_status) VALUES ($1,$2,'submitted',$3,'submitted')`, [row.id, profileId, row.status]);
  return { application: await pvzView(upd[0]) };
};

export const listPvzApplications = async (actorId, { status = 'submitted' } = {}) => {
  if (!(await mayManagePvz(actorId))) return { error: 'not_allowed' };
  const args = [];
  let where = '';
  if (status && status !== 'all') { args.push(status); where = 'WHERE a.status = $1'; }
  const { rows } = await query(
    `SELECT a.*, s.shop_name, s.tax_kind, p.name, p.username FROM market_pvz_applications a
       JOIN market_sellers s ON s.profile_id = a.profile_id JOIN profiles p ON p.id = a.profile_id
       ${where} ORDER BY a.submitted_at NULLS LAST LIMIT 100`, args);
  return { items: rows.map((r) => ({
    id: r.id, status: r.status, title: r.title, city: r.city, address: r.address, shopName: r.shop_name,
    taxKind: r.tax_kind, name: r.name, username: r.username, submittedAt: iso(r.submitted_at), profileId: r.profile_id,
  })) };
};

export const readPvzApplicationAdmin = async (actorId, id) => {
  if (!(await mayManagePvz(actorId))) return { error: 'not_allowed' };
  if (!PVZ_APP_ID_RE.test(String(id ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM market_pvz_applications WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'not_found' };
  const { rows: ev } = await query('SELECT action, from_status, to_status, comment, created_at FROM market_pvz_app_events WHERE app_id = $1 ORDER BY id DESC', [id]);
  const { rows: sel } = await query('SELECT tax_kind, verification_status FROM market_sellers WHERE profile_id = $1', [rows[0].profile_id]);
  return {
    application: await pvzView(rows[0]), profileId: rows[0].profile_id,
    applicantKind: sel[0]?.tax_kind ?? null, applicantVerification: sel[0]?.verification_status ?? null,
    history: ev.map((e) => ({ action: e.action, from: e.from_status, to: e.to_status, comment: e.comment, at: iso(e.created_at) })),
  };
};

export const decidePvzApplication = async (actorId, id, action, payload = {}, { meta = {} } = {}) => {
  if (!(await mayManagePvz(actorId))) return { error: 'not_allowed' };
  if (!PVZ_APP_ID_RE.test(String(id ?? ''))) return { error: 'not_found' };
  const comment = text(payload.comment, 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM market_pvz_applications WHERE id = $1 FOR UPDATE', [id]);
    const row = rows[0];
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (row.profile_id === actorId) { await client.query('ROLLBACK'); return { error: 'own_application' }; }
    const from = row.status;
    let to;
    if (action === 'start_review') {
      if (from !== 'submitted') { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      to = 'in_review';
      await client.query(`UPDATE market_pvz_applications SET status='in_review', reviewer_id=$2, updated_at=now() WHERE id=$1`, [id, actorId]);
    } else if (action === 'request_changes') {
      if (!['submitted', 'in_review'].includes(from)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      const missing = (Array.isArray(payload.missing) ? payload.missing : []).map((m) => text(m, 200)).filter(Boolean).slice(0, MAX_MISSING);
      if (comment.length < 3 && !missing.length) { await client.query('ROLLBACK'); return { error: 'reason_required' }; }
      to = 'needs_changes';
      await client.query(`UPDATE market_pvz_applications SET status='needs_changes', missing=$2::jsonb, admin_comment=$3, reviewer_id=$4, updated_at=now() WHERE id=$1`, [id, JSON.stringify(missing), comment, actorId]);
    } else if (action === 'reject') {
      if (!['submitted', 'in_review', 'needs_changes'].includes(from)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      if (comment.length < 3) { await client.query('ROLLBACK'); return { error: 'reason_required' }; }
      to = 'rejected';
      await client.query(`UPDATE market_pvz_applications SET status='rejected', reject_reason=$2, admin_comment=$2, reviewer_id=$3, decided_at=now(), updated_at=now() WHERE id=$1`, [id, comment, actorId]);
    } else if (action === 'approve') {
      if (!['submitted', 'in_review'].includes(from)) { await client.query('ROLLBACK'); return { error: 'wrong_state' }; }
      /* Подтверждённый статус заявителя проверяется ещё раз на момент
         одобрения: за время проверки его могли приостановить. */
      const el = await pvzEligibility(row.profile_id);
      if (!el.ok) { await client.query('ROLLBACK'); return { error: 'pvz_needs_ip_or_legal' }; }
      const { rows: ok } = await client.query(
        `SELECT 1 FROM market_docs WHERE scope='pvz' AND ref_id=$1 AND removed_at IS NULL AND doc_type='premises_doc' AND status='accepted'`, [id]);
      if (!ok[0]) { await client.query('ROLLBACK'); return { error: 'docs_not_accepted' }; }
      to = 'approved';
      await client.query(`UPDATE market_pvz_applications SET status='approved', admin_comment=$2, missing='[]'::jsonb, reviewer_id=$3, decided_at=now(), updated_at=now() WHERE id=$1`, [id, comment, actorId]);
    } else { await client.query('ROLLBACK'); return { error: 'bad_action' }; }
    await client.query(`INSERT INTO market_pvz_app_events (app_id, actor_id, action, from_status, to_status, comment) VALUES ($1,$2,$3,$4,$5,$6)`, [id, actorId, action, from, to, comment]);
    await client.query('COMMIT');
    await logAdmin({ actorId, targetId: id, targetType: 'market_pvz_application', type: `market_pvz_app_${action}`, detail: `${from} → ${to}${comment ? ` · ${comment}` : ''}`, meta });
    return { ok: true, status: to };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
};

/**
 * Одобренная и ещё не использованная заявка — пропуск на создание точки.
 * Возвращает заявку или null; createPvz без неё не работает.
 */
export const approvedPvzApplicationFor = async (profileId, applicationId) => {
  if (!PVZ_APP_ID_RE.test(String(applicationId ?? ''))) return null;
  const { rows } = await query(
    `SELECT * FROM market_pvz_applications WHERE id = $1 AND profile_id = $2 AND status = 'approved' AND pvz_id IS NULL`,
    [applicationId, profileId]);
  if (!rows[0]) return null;
  const el = await pvzEligibility(profileId);
  return el.ok ? rows[0] : null;
};
