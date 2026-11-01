/**
 * Sky Tax: единый налоговый учёт Sky и предпринимателей.
 *
 * Принципы (подробно — docs/SKY-TAX.md и CLAUDE.md):
 *  • Субъект учёта (`tax_subjects`) — Sky, бизнес SkyKassa Business, продавец Market, исполнитель Sky GO. У каждого свои настройки, режим, интеграция, операции и документы; чужое не видно и не меняется.
 *  • Платёжную логику модуль НЕ меняет: операции подбирают уборщики (`sweepTax`) из уже совершённых платежей и списаний — сбой налоговой очереди не может сломать оплату.
 *  • Классификация (`taxclassify.mjs`) отделяет доход от «не дохода» (пополнение, обмен, транзит, возврат, чужие деньги); спорное — `review`, решает человек.
 *  • Два режима на КАЖДОГО субъекта независимо: manual («Ручная обработка», операция ждёт «Подтвердить и отправить») и auto («Автоматически после продажи»). Ручной этап — внутренний:
 *    у него есть срок (`due_by`), напоминание и, по настройке, автоотправка по истечении `manual_auto_hours`, чтобы не нарушить законный срок.
 *  • Реальная передача выключена, пока её не включили ДВАЖДЫ: глобально (владелец Sky, код подтверждения) и для субъекта. Пока выключено, операции копятся в очереди со статусом «в очереди — отправка не включена».
 *  • Документ считается «сформированным» только по подтверждению: ответу шлюза со статусом issued и номером либо номеру, внесённому человеком (`provenance = manual`, помечено). Без подтверждения чек не создаётся.
 *  • Идемпотентность: UNIQUE (субъект, источник, ссылка) у операции, UNIQUE (операция) у документа, ключ идемпотентности у партнёра `sky-tax:<id операции>`, повторные шаги под `FOR UPDATE`.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { macOf, encryptSecret, openSecret } from './crypto.mjs';
import { inTx, sealJson, openJson, clean } from './gocore.mjs';
import { sendEmail } from './notify.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { classify, DOC_KIND_LABEL, STATUS_LABEL, SKY_INCOME_TYPES } from './taxclassify.mjs';
import * as prov from './taxproviders.mjs';
import { renderTaxDocMail, renderTaxDocPage, linksOf } from './emailtpl.mjs';

export const nid = (p) => `${p}-${crypto.randomBytes(10).toString('hex')}`;
export const err = (error, extra = {}) => ({ error, ...extra });
const TAX_STATUSES = ['npd', 'ip', 'ooo'];
const REGIMES = { npd: ['npd'], ip: ['usn_income', 'usn_income_expense', 'osno', 'psn'], ooo: ['usn_income', 'usn_income_expense', 'osno'] };
const VATS = ['none', '0', '5', '7', '10', '20', '22'];
const SOURCE_RU = { 'wallet:prime': 'Подписка Sky Prime', skykassa_topup: 'Пополнение SkyMoney', skykassa_fee: 'Комиссия пополнения', kb_payment: 'Оплата покупателя (SkyKassa Business)', market_order: 'Заказ Sky Market', go_order: 'Заказ Sky GO', refund: 'Возврат', manual: 'Внесено вручную' };
export const sourceLabel = (s) => SOURCE_RU[s] ?? (s.startsWith('wallet:') ? (SKY_INCOME_TYPES[s.slice(7)] ?? `Списание кошелька: ${s.slice(7)}`) : s);
const MAX_ATTEMPTS = 8;

/* ─── журнал ─── */
export const tlog = (subjectId, actor, action, { opId = null, docId = null, status = 'ok', detail = '' } = {}) =>
  query('INSERT INTO tax_log (subject_id, op_id, doc_id, actor, action, status, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)', [subjectId, opId, docId, String(actor), action, status, String(detail).slice(0, 400)]).catch(() => {});

/* ─── глобальные настройки ─── */
const GLOBAL_DEFAULTS = { liveEnabled: false, dueHours: 24, notifyErrors: true };
export const getGlobal = async () => {
  const { rows } = await query('SELECT key, value FROM tax_settings');
  const g = { ...GLOBAL_DEFAULTS }; for (const r of rows) g[r.key] = r.value; return g;
};
export const setGlobal = async (actor, patch) => {
  const out = {};
  if ('liveEnabled' in patch) out.liveEnabled = patch.liveEnabled === true;
  if ('dueHours' in patch) { const n = Number(patch.dueHours); if (!Number.isInteger(n) || n < 1 || n > 720) return err('bad_value'); out.dueHours = n; }
  if ('notifyErrors' in patch) out.notifyErrors = patch.notifyErrors === true;
  for (const [k, v] of Object.entries(out)) await query(`INSERT INTO tax_settings (key, value, updated_by) VALUES ($1,$2::jsonb,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`, [k, JSON.stringify(v), actor]);
  await tlog(null, actor, 'global_settings', { detail: JSON.stringify(out) });
  return { global: await getGlobal() };
};

/* ─── субъекты ─── */
const subjectView = async (r, withIntegration = true) => {
  if (!r) return null;
  const ig = withIntegration ? (await query('SELECT provider, title, status, last_ok_at, last_error, updated_at FROM tax_integrations WHERE subject_id = $1', [r.id])).rows[0] : null;
  return { id: r.id, scope: r.scope, kind: r.kind, name: r.display_name, taxStatus: r.tax_status, regime: r.regime, vat: r.vat, innLast4: r.inn_last4, hasInn: Boolean(r.inn_enc), mode: r.mode, enabled: r.enabled, enabledAt: r.enabled_at, live: r.live,
    manualEscalateHours: r.manual_escalate_hours, manualAutoHours: r.manual_auto_hours, receiptEmail: r.receipt_email,
    integration: ig ? { provider: ig.provider, title: ig.title || prov.PROVIDERS[ig.provider]?.title, status: ig.status, lastOkAt: ig.last_ok_at, lastError: ig.last_error || null } : null,
    ready: Boolean(r.tax_status && r.inn_enc && ig && ig.status === 'active') };
};
const subjByScope = async (scope) => (await query('SELECT * FROM tax_subjects WHERE scope = $1', [scope])).rows[0] ?? null;
const subjById = async (id) => (await query('SELECT * FROM tax_subjects WHERE id = $1', [id])).rows[0] ?? null;
export const ensureSky = async () => {
  await query(`INSERT INTO tax_subjects (id, scope, kind, display_name, mode) VALUES ('tsub-sky','sky','sky','Sky','manual') ON CONFLICT (scope) DO NOTHING`);
  return subjByScope('sky');
};

/** Налоговый статус, который СЕРВЕР уже знает о субъекте из других модулей (проверенный), — предлагается как значение по умолчанию. */
const knownStatus = async (kind, ref) => {
  if (kind === 'seller') {
    const { rows } = await query('SELECT tax_kind FROM market_sellers WHERE profile_id = $1', [ref]);
    const k = rows[0]?.tax_kind; return k === 'npd' ? 'npd' : k === 'ip' ? 'ip' : k === 'legal' ? 'ooo' : k === 'individual' ? 'individual' : null;
  }
  if (kind === 'executor') {
    const { rows } = await query(`SELECT legal_form FROM go_executors WHERE profile_id = $1 AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`, [ref]).catch(() => ({ rows: [] }));
    return rows[0]?.legal_form ?? null;
  }
  return null;
};

/** Кто и что вправе делать со scope. Возвращает { scope, kind, ref, role, canView, canOperate, canManage, label } или null (чужое/несуществующее — то же, что «нет»). */
export const resolveScope = async (me, scopeKey, { can, isOwner, accessOf, kbCan } = {}) => {
  const scope = String(scopeKey ?? '');
  if (scope === 'sky') {
    const owner = await isOwner(me); const staff = owner || await can(me, 'tax');
    return staff ? { scope, kind: 'sky', ref: null, role: owner ? 'owner' : 'staff', canView: true, canOperate: true, canManage: owner, label: 'Sky' } : null;
  }
  let m;
  if ((m = scope.match(/^kb:([A-Za-z0-9-]{3,60})$/))) {
    const acc = await accessOf(me);
    if (!acc || acc.businessId !== m[1]) return null;
    const { rows } = await query('SELECT name FROM kb_businesses WHERE id = $1', [m[1]]);
    const role = acc.role;
    return { scope, kind: 'business', ref: m[1], ownerId: acc.ownerId, role, canView: role === 'owner' || role === 'admin' || role === 'manager', canOperate: role === 'owner' || role === 'admin' || role === 'manager', canManage: role === 'owner', label: rows[0]?.name ?? 'Бизнес' };
  }
  if ((m = scope.match(/^(seller|go):([A-Za-z0-9-]{3,80})$/))) {
    if (m[2] !== me) return null;
    return { scope, kind: m[1] === 'seller' ? 'seller' : 'executor', ref: m[2], ownerId: me, role: 'owner', canView: true, canOperate: true, canManage: true, label: m[1] === 'seller' ? 'Магазин Sky Market' : 'Исполнитель Sky GO' };
  }
  return null;
};

/** Создаёт субъект при первом обращении (владелец). Налоговый статус берётся из уже проверенных данных модуля, если они есть. */
export const ensureSubject = async (ctx, actor) => {
  const ex = await subjByScope(ctx.scope); if (ex) return ex;
  if (ctx.kind === 'sky') return ensureSky();
  const known = ctx.kind === 'business' ? null : await knownStatus(ctx.kind, ctx.ref);
  if (known === 'individual') return null;
  const ownerId = ctx.ownerId ?? ctx.ref;
  const id = nid('tsub');
  await query(`INSERT INTO tax_subjects (id, scope, kind, owner_profile_id, display_name, tax_status, regime) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (scope) DO NOTHING`,
    [id, ctx.scope, ctx.kind, ownerId, clean(ctx.label, 120), TAX_STATUSES.includes(known) ? known : null, known === 'npd' ? 'npd' : '']);
  await tlog(id, actor, 'subject_created', { detail: ctx.scope });
  return subjByScope(ctx.scope);
};
export const getSubjectView = async (scope) => subjectView(await subjByScope(scope));
export const subjectIdOf = async (scope) => (await subjByScope(scope))?.id ?? null;

export const saveSubject = async (ctx, actor, b = {}) => {
  const row = await ensureSubject(ctx, actor); if (!row) return err('individual_not_supported');
  const sets = []; const vals = [row.id]; const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if ('name' in b) add('display_name', clean(b.name, 120));
  if ('taxStatus' in b) {
    if (!TAX_STATUSES.includes(b.taxStatus)) return err('bad_tax_status');
    // там, где статус уже проверен администрацией модуля (Market, Sky GO), человек не может объявить себе другой
    const known = ctx.kind === 'seller' || ctx.kind === 'executor' ? await knownStatus(ctx.kind, ctx.ref) : null;
    if (known && known !== b.taxStatus) return err('status_verified_elsewhere', { status: known });
    add('tax_status', b.taxStatus);
    if (!('regime' in b)) add('regime', b.taxStatus === 'npd' ? 'npd' : '');
  }
  const st = b.taxStatus ?? row.tax_status;
  if ('regime' in b) { if (!st || !(REGIMES[st] ?? []).includes(b.regime)) return err('bad_regime'); add('regime', b.regime); }
  if ('vat' in b) { if (!VATS.includes(String(b.vat))) return err('bad_vat'); if (st === 'npd' && String(b.vat) !== 'none') return err('bad_vat'); add('vat', String(b.vat)); }
  if ('inn' in b) {
    const inn = String(b.inn ?? '').replace(/\D/g, '');
    const need = st === 'ooo' ? 10 : 12;
    if (inn.length !== need || !validInn(inn)) return err('bad_inn', { expected: need });
    add('inn_enc', encryptSecret(inn)); add('inn_last4', inn.slice(-4));
  }
  if ('manualEscalateHours' in b) { const n = Number(b.manualEscalateHours); if (!Number.isInteger(n) || n < 1 || n > 720) return err('bad_value'); add('manual_escalate_hours', n); }
  if ('manualAutoHours' in b) { const n = Number(b.manualAutoHours); if (!Number.isInteger(n) || n < 0 || n > 720) return err('bad_value'); add('manual_auto_hours', n); }
  if ('receiptEmail' in b) add('receipt_email', b.receiptEmail === true);
  if (!sets.length) return { subject: await getSubjectView(ctx.scope) };
  await query(`UPDATE tax_subjects SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  await tlog(row.id, actor, 'subject_updated', { detail: Object.keys(b).filter((k) => k !== 'inn').join(',') + ('inn' in b ? ',inn' : '') });
  return { subject: await getSubjectView(ctx.scope) };
};

/** Контрольная сумма ИНН по алгоритму ФНС: ловит опечатки, но НЕ проверяет, что такой налогоплательщик существует (реестры не подключены). */
export const validInn = (inn) => {
  const d = inn.split('').map(Number);
  const c = (w) => (w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10;
  if (inn.length === 10) return c([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (inn.length === 12) return c([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && c([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  return false;
};

/** Режим обработки — только для ЭТОГО субъекта. */
export const setMode = async (ctx, actor, mode) => {
  if (!['manual', 'auto'].includes(mode)) return err('bad_mode');
  const row = await ensureSubject(ctx, actor); if (!row) return err('individual_not_supported');
  if (row.mode === mode) return { subject: await getSubjectView(ctx.scope), unchanged: true };
  await query('UPDATE tax_subjects SET mode = $2, updated_at = now() WHERE id = $1', [row.id, mode]);
  // Переход на автоматику не отправляет «задним числом» то, что ждёт подтверждения: эти операции остаются на решении человека (кнопка «Подтвердить все»).
  await tlog(row.id, actor, 'mode_changed', { detail: `${row.mode} → ${mode}` });
  return { subject: await getSubjectView(ctx.scope) };
};
export const setEnabled = async (ctx, actor, enabled) => {
  const row = await ensureSubject(ctx, actor); if (!row) return err('individual_not_supported');
  if (enabled) {
    if (!row.tax_status) return err('subject_incomplete', { missing: 'taxStatus' });
    if (!row.inn_enc) return err('subject_incomplete', { missing: 'inn' });
    const ig = (await query('SELECT 1 FROM tax_integrations WHERE subject_id = $1', [row.id])).rowCount; if (!ig) return err('subject_incomplete', { missing: 'integration' });
  }
  // Включение — с этого момента: операции, оплаченные раньше, не подбираются (чеки «за прошлое» без решения человека не формируем).
  await query(`UPDATE tax_subjects SET enabled = $2, enabled_at = CASE WHEN $2 AND NOT enabled THEN now() ELSE enabled_at END, live = CASE WHEN $2 THEN live ELSE FALSE END, updated_at = now() WHERE id = $1`, [row.id, enabled === true]);
  await tlog(row.id, actor, enabled ? 'enabled' : 'disabled');
  return { subject: await getSubjectView(ctx.scope) };
};
export const setLive = async (ctx, actor, live) => {
  const row = await ensureSubject(ctx, actor); if (!row) return err('individual_not_supported');
  if (live && !row.enabled) return err('not_enabled');
  await query('UPDATE tax_subjects SET live = $2, updated_at = now() WHERE id = $1', [row.id, live === true]);
  await tlog(row.id, actor, live ? 'live_on' : 'live_off');
  return { subject: await getSubjectView(ctx.scope) };
};

/* ─── интеграции ─── */
export const providerList = (taxStatus) => Object.entries(prov.PROVIDERS).map(([id, p]) => ({ id, title: p.title, automatic: p.automatic, available: p.available, note: p.note, forStatus: !taxStatus || p.statuses.includes(taxStatus) }));
export const saveIntegration = async (ctx, actor, b = {}) => {
  const row = await ensureSubject(ctx, actor); if (!row) return err('individual_not_supported');
  const old = (await query('SELECT * FROM tax_integrations WHERE subject_id = $1', [row.id])).rows[0];
  const p = String(b.provider ?? ''); const def = prov.PROVIDERS[p];
  if (def && !def.available) return err('provider_not_available');
  if (def && row.tax_status && !def.statuses.includes(row.tax_status)) return err('provider_not_for_status');
  const prep = await prov.prepareConfig(p, b, old?.provider === p ? old : null); if (prep.error) return prep;
  const cfg = sealJson(prep.configPlain);
  const secret = prep.secretEnc ?? (old?.provider === p ? old.secret_enc : null);
  await query(`INSERT INTO tax_integrations (id, subject_id, provider, title, config_enc, secret_enc, status, updated_by) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)
     ON CONFLICT (subject_id) DO UPDATE SET provider=$3, title=$4, config_enc=$5, secret_enc=$6, status='active', last_error='', updated_by=$7, updated_at=now()`, [nid('tint'), row.id, p, clean(b.title, 80), cfg, secret, actor]);
  await tlog(row.id, actor, 'integration_saved', { detail: p });
  return { subject: await getSubjectView(ctx.scope) };
};
export const removeIntegration = async (ctx, actor) => {
  const row = await subjByScope(ctx.scope); if (!row) return err('not_found');
  await query('DELETE FROM tax_integrations WHERE subject_id = $1', [row.id]);
  await query('UPDATE tax_subjects SET live = FALSE, updated_at = now() WHERE id = $1', [row.id]);   // без интеграции реальная передача выключается
  await tlog(row.id, actor, 'integration_removed');
  return { subject: await getSubjectView(ctx.scope) };
};
export const testIntegration = async (ctx, actor) => {
  const row = await subjByScope(ctx.scope); if (!row) return err('not_found');
  const ig = (await query('SELECT * FROM tax_integrations WHERE subject_id = $1', [row.id])).rows[0]; if (!ig) return err('no_integration');
  if (ig.provider === 'manual_entry') return { ok: true, manual: true };
  try { await prov.pingGateway(prov.openIntegration(ig, openJson)); await query(`UPDATE tax_integrations SET last_ok_at = now(), last_error = '', status = 'active' WHERE id = $1`, [ig.id]); await tlog(row.id, actor, 'integration_test'); return { ok: true }; }
  catch (e) { await query(`UPDATE tax_integrations SET last_error = $2 WHERE id = $1`, [ig.id, `${e.code ?? 'error'}: ${e.detail ?? ''}`.slice(0, 200)]); await tlog(row.id, actor, 'integration_test', { status: 'error', detail: e.code }); return err(e.code ?? 'gateway_error', { detail: e.detail }); }
};

/* ─── операции ─── */
const opView = (r) => ({ id: r.id, scope: r.scope, source: r.source, sourceLabel: sourceLabel(r.source), sourceRef: r.source_ref, kind: r.kind, classification: r.classification, classReason: r.class_reason, docKind: r.doc_kind, docKindLabel: DOC_KIND_LABEL[r.doc_kind],
  amountRub: Number(r.amount_rub), currency: r.currency, descr: r.descr, status: r.status, statusLabel: STATUS_LABEL[r.status], waitReason: r.wait_reason, attempts: r.attempts, lastError: r.last_error || null, dueBy: r.due_by, overdue: Boolean(r.due_by) && new Date(r.due_by) < new Date() && ['pending_confirm', 'queued', 'awaiting_manual', 'awaiting_provider', 'sending'].includes(r.status),
  paidAt: r.paid_at, createdAt: r.created_at, decidedBy: r.decided_by, rejectReason: r.reject_reason || null, refundOf: r.refund_of, hasBuyerEmail: Boolean(r.buyer_email_enc || r.payer_profile_id), docId: r.doc_id ?? null, docNumber: r.doc_number ?? null, subjectName: r.subject_name });
const OP_SELECT = `SELECT o.*, s.scope, s.display_name AS subject_name, d.id AS doc_id, d.number AS doc_number FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id LEFT JOIN tax_docs d ON d.op_id = o.id`;

/** Создаёт операцию (идемпотентно). Возвращает { op } | { duplicate } | { skipped }. */
export const createOp = async (subjectRow, d) => {
  const subject = typeof subjectRow === 'string' ? await subjById(subjectRow) : subjectRow;
  if (!subject || (!subject.enabled && !d.force)) return { skipped: 'not_enabled' };
  const cl = classify({ source: d.source, kind: d.kind ?? 'sale', internal: d.internal, isTip: d.isTip }, subject);
  const g = await getGlobal();
  let status; let waitReason = '';
  if (cl.classification === 'not_income' || cl.classification === 'transit') status = 'not_required';
  else if (cl.classification === 'review') { status = 'pending_confirm'; waitReason = 'classification_review'; }
  else if (cl.docKind === 'none') { status = 'pending_confirm'; waitReason = 'tax_status_missing'; }
  else status = subject.mode === 'auto' ? 'queued' : 'pending_confirm';
  const paidAt = d.paidAt ? new Date(d.paidAt) : new Date();
  const dueBy = status === 'not_required' ? null : new Date(paidAt.getTime() + g.dueHours * 3600_000);
  const id = nid('top');
  const r = await query(
    `INSERT INTO tax_ops (id, subject_id, source, source_ref, kind, classification, class_reason, doc_kind, amount_rub, currency, descr, items, payer_profile_id, buyer_email_enc, status, wait_reason, due_by, refund_of, paid_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RUB',$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (subject_id, source, source_ref) DO NOTHING RETURNING *`,
    [id, subject.id, d.source, String(d.sourceRef), d.kind ?? 'sale', cl.classification, cl.reason, cl.docKind, d.amountRub, clean(d.descr, 200), JSON.stringify(d.items ?? []), d.payerProfileId ?? null, d.buyerEmail ? encryptSecret(String(d.buyerEmail).slice(0, 200)) : null,
      status, waitReason, dueBy, d.refundOf ?? null, paidAt, d.createdBy ?? 'system']);
  if (!r.rowCount) return { duplicate: true };
  await tlog(subject.id, d.createdBy ?? 'system', 'op_created', { opId: id, detail: `${d.source} ${d.amountRub} ₽ → ${status}` });
  return { op: r.rows[0] };
};

export const listOps = async (scopeOrNull, { status, q, from, to, kind, limit = 100, offset = 0 } = {}) => {
  const p = []; const w = [];
  if (scopeOrNull) { p.push(scopeOrNull); w.push(`s.scope = $${p.length}`); }
  if (status) { p.push(String(status)); w.push(`o.status = $${p.length}`); }
  if (kind) { p.push(String(kind)); w.push(`o.kind = $${p.length}`); }
  if (q) { p.push(`%${clean(q, 60).replace(/[%_\\]/g, '\\$&')}%`); w.push(`(o.id ILIKE $${p.length} OR o.source_ref ILIKE $${p.length} OR d.number ILIKE $${p.length} OR o.descr ILIKE $${p.length})`); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { p.push(from); w.push(`o.created_at >= $${p.length}::date`); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { p.push(to); w.push(`o.created_at < ($${p.length}::date + 1)`); }
  p.push(Math.min(200, Math.max(1, Number(limit) || 100)), Math.max(0, Number(offset) || 0));
  const { rows } = await query(`${OP_SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows.map(opView);
};
export const getOp = async (id, scope) => {
  const { rows } = await query(`${OP_SELECT} WHERE o.id = $1 ${scope ? 'AND s.scope = $2' : ''}`, scope ? [id, scope] : [id]);
  return rows[0] ?? null;
};
const opScoped = async (id, scope) => { const r = await getOp(String(id ?? ''), scope); return r; };

const toQueue = (c, id) => c.query(`UPDATE tax_ops SET status = 'queued', wait_reason = '', attempts = 0, last_error = '', next_attempt_at = now(), updated_at = now() WHERE id = $1`, [id]);

/** «Подтвердить и отправить» / «Отклонить». Подтвердить можно только то, что ждёт решения; повтор безвреден. */
export const decide = async (scope, actor, opId, action, reason = '') => {
  return inTx(async (c) => {
    const { rows } = await c.query(`SELECT o.*, s.scope FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id WHERE o.id = $1 AND s.scope = $2 FOR UPDATE OF o`, [String(opId ?? ''), scope]);
    const o = rows[0]; if (!o) return err('not_found');
    if (action === 'confirm') {
      if (o.status === 'queued' || o.status === 'issued') return { ok: true, duplicate: true, status: o.status };
      if (o.status !== 'pending_confirm') return err('bad_state', { status: o.status });
      if (o.wait_reason === 'classification_review') return err('classification_required');
      if (o.wait_reason === 'tax_status_missing') return err('subject_incomplete', { missing: 'taxStatus' });
      await c.query(`UPDATE tax_ops SET decided_by = $2, decided_at = now() WHERE id = $1`, [o.id, actor]);
      await toQueue(c, o.id);
      await c.query('INSERT INTO tax_log (subject_id, op_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5)', [o.subject_id, o.id, actor, 'op_confirmed', '']);
      return { ok: true, status: 'queued' };
    }
    if (action === 'reject') {
      const why = clean(reason, 300); if (why.length < 5) return err('reason_required');
      if (o.status === 'rejected') return { ok: true, duplicate: true, status: 'rejected' };
      if (!['pending_confirm', 'failed', 'awaiting_manual'].includes(o.status)) return err('bad_state', { status: o.status });
      await c.query(`UPDATE tax_ops SET status = 'rejected', reject_reason = $3, decided_by = $2, decided_at = now(), updated_at = now() WHERE id = $1`, [o.id, actor, why]);
      await c.query('INSERT INTO tax_log (subject_id, op_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5)', [o.subject_id, o.id, actor, 'op_rejected', why]);
      return { ok: true, status: 'rejected' };
    }
    return err('bad_action');
  });
};
/** Подтвердить все ожидающие (кнопка «Подтвердить все») — каждая проходит ту же проверку, что и одиночная. */
export const confirmAll = async (scope, actor) => {
  const { rows } = await query(`SELECT o.id FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id WHERE s.scope = $1 AND o.status = 'pending_confirm' AND o.wait_reason = '' ORDER BY o.created_at LIMIT 500`, [scope]);
  let n = 0; for (const r of rows) { const x = await decide(scope, actor, r.id, 'confirm'); if (x.ok && !x.duplicate) n++; } return { confirmed: n };
};
/** Решение по спорной классификации — человеком; записывается в журнал. */
export const classifyManual = async (scope, actor, opId, as, reason) => {
  if (!['income', 'not_income'].includes(as)) return err('bad_value');
  const why = clean(reason, 300); if (why.length < 5) return err('reason_required');
  return inTx(async (c) => {
    const { rows } = await c.query(`SELECT o.*, s.mode, s.tax_status FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id WHERE o.id = $1 AND s.scope = $2 FOR UPDATE OF o`, [String(opId ?? ''), scope]);
    const o = rows[0]; if (!o) return err('not_found');
    if (o.classification !== 'review' || o.status !== 'pending_confirm') return err('bad_state', { status: o.status });
    if (as === 'not_income') await c.query(`UPDATE tax_ops SET classification = 'not_income', class_reason = $2, status = 'not_required', wait_reason = '', due_by = NULL, decided_by = $3, decided_at = now(), updated_at = now() WHERE id = $1`, [o.id, `Решение: не доход. ${why}`, actor]);
    else {
      const dk = o.tax_status === 'npd' ? 'npd_receipt' : o.tax_status ? 'fiscal_receipt' : 'none';
      await c.query(`UPDATE tax_ops SET classification = 'income', class_reason = $2, doc_kind = $3, wait_reason = $4, decided_by = $5, decided_at = now(), updated_at = now() WHERE id = $1`, [o.id, `Решение: доход. ${why}`, dk, dk === 'none' ? 'tax_status_missing' : '', actor]);
      if (dk !== 'none' && o.mode === 'auto') await toQueue(c, o.id);
    }
    await c.query('INSERT INTO tax_log (subject_id, op_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5)', [o.subject_id, o.id, actor, 'op_classified', `${as}: ${why}`]);
    return { ok: true };
  });
};
export const retryOp = async (scope, actor, opId) => inTx(async (c) => {
  const { rows } = await c.query(`SELECT o.* FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id WHERE o.id = $1 AND s.scope = $2 FOR UPDATE OF o`, [String(opId ?? ''), scope]);
  const o = rows[0]; if (!o) return err('not_found'); if (o.status !== 'failed') return err('bad_state', { status: o.status });
  await toQueue(c, o.id); await c.query('INSERT INTO tax_log (subject_id, op_id, actor, action) VALUES ($1,$2,$3,$4)', [o.subject_id, o.id, actor, 'op_retry']);
  return { ok: true };
});

/* ─── документ ─── */
const docNum = (v) => clean(v, 80);
/** Единственное место, где операция становится «сформированной». Вызывается ТОЛЬКО по подтверждению шлюза или внесённому человеком номеру. */
const issueDoc = async (opId, { number, url = '', fiscalSign = '', externalId = null, provenance, actor }) => inTx(async (c) => {
  const { rows } = await c.query(`SELECT o.*, s.receipt_email FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id WHERE o.id = $1 FOR UPDATE OF o`, [opId]);
  const o = rows[0]; if (!o) return err('not_found');
  if (o.status === 'issued') return { ok: true, duplicate: true };
  if (!number) return err('number_required');
  const hasAddr = Boolean(o.buyer_email_enc || o.payer_profile_id);
  const id = nid('tdoc');
  const ins = await c.query(`INSERT INTO tax_docs (id, op_id, subject_id, kind, op_kind, number, external_id, url, fiscal_sign, provenance, amount_rub, email_status, email_next_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) ON CONFLICT (op_id) DO NOTHING RETURNING id`,
    [id, o.id, o.subject_id, o.doc_kind, o.kind, docNum(number), externalId, url, fiscalSign, provenance, o.amount_rub, o.receipt_email && hasAddr ? 'pending' : (hasAddr ? 'none' : 'no_address')]);
  await c.query(`UPDATE tax_ops SET status = 'issued', wait_reason = '', external_id = COALESCE($2, external_id), last_error = '', updated_at = now() WHERE id = $1`, [o.id, externalId]);
  await c.query('INSERT INTO tax_log (subject_id, op_id, doc_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5,$6)', [o.subject_id, o.id, ins.rows[0]?.id ?? id, actor, 'doc_issued', `${provenance} № ${docNum(number)}`]);
  return { ok: true, docId: ins.rows[0]?.id };
});

/** «Выдаю чек сам»: человек внёс номер чека, выданного у себя. Sky его не проверяет — документ помечен manual. */
export const manualDoc = async (scope, actor, opId, { number, url }) => {
  const o = await opScoped(opId, scope); if (!o) return err('not_found');
  if (!['awaiting_manual', 'queued', 'failed'].includes(o.status)) return err('bad_state', { status: o.status });
  const sub = await subjById(o.subject_id);
  const ig = (await query('SELECT provider FROM tax_integrations WHERE subject_id = $1', [sub.id])).rows[0];
  if (!ig || ig.provider !== 'manual_entry') return err('manual_not_allowed');
  const num = docNum(number); if (num.length < 3 || /[<>]/.test(num)) return err('bad_number');
  const u = String(url ?? '').trim(); if (u && !/^https:\/\/[^\s"'<>]+$/.test(u)) return err('bad_url');
  return issueDoc(o.id, { number: num, url: u, provenance: 'manual', actor });
};

/* ─── возвраты ─── */
export const refundDoc = async (scope, actor, docId, { amount, reason }) => {
  const why = clean(reason, 300); if (why.length < 5) return err('reason_required');
  return inTx(async (c) => {
    const { rows } = await c.query(`SELECT d.*, o.descr, o.items, o.payer_profile_id, o.buyer_email_enc, o.id AS oid, s.scope, s.mode FROM tax_docs d JOIN tax_ops o ON o.id = d.op_id JOIN tax_subjects s ON s.id = d.subject_id WHERE d.id = $1 AND s.scope = $2 FOR UPDATE OF d`, [String(docId ?? ''), scope]);
    const d = rows[0]; if (!d) return err('not_found');
    if (d.op_kind !== 'sale') return err('bad_state'); if (!['npd_receipt', 'fiscal_receipt'].includes(d.kind)) return err('bad_state');
    const done = Number((await c.query(`SELECT COALESCE(sum(amount_rub),0) AS s FROM tax_ops WHERE refund_of = $1 AND status NOT IN ('rejected','failed')`, [d.oid])).rows[0].s);
    const left = Number(d.amount_rub) - done;
    const amt = amount == null || amount === '' ? left : Math.round(Number(amount) * 100) / 100;
    if (!(amt > 0) || amt > left + 0.001) return err('bad_amount', { left });
    const n = Number((await c.query(`SELECT count(*)::int AS n FROM tax_ops WHERE refund_of = $1`, [d.oid])).rows[0].n);
    const sub = (await c.query('SELECT * FROM tax_subjects WHERE id = $1', [d.subject_id])).rows[0];
    const cl = classify({ source: 'refund', kind: 'refund' }, sub);
    const id = nid('top');
    await c.query(`INSERT INTO tax_ops (id, subject_id, source, source_ref, kind, classification, class_reason, doc_kind, amount_rub, descr, items, payer_profile_id, buyer_email_enc, status, wait_reason, due_by, refund_of, created_by)
       VALUES ($1,$2,'refund',$3,'refund','income',$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'', now() + interval '24 hours',$12,$13)`,
      [id, d.subject_id, `${d.oid}:${n + 1}`, `${cl.reason}. ${why}`, d.kind, amt, `Возврат: ${d.descr}`.slice(0, 200), JSON.stringify(amt === Number(d.amount_rub) ? d.items : []), d.payer_profile_id, d.buyer_email_enc, sub.mode === 'auto' ? 'queued' : 'pending_confirm', d.oid, actor]);
    await c.query('INSERT INTO tax_log (subject_id, op_id, doc_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5,$6)', [d.subject_id, id, d.id, actor, 'refund_created', `${amt} ₽: ${why}`]);
    return { ok: true, opId: id };
  });
};

/* ─── очередь обработки ─── */
const backoffSec = (n) => Math.min(3600, 30 * 2 ** Math.max(0, n - 1));
const ownerOf = async (subject) => subject.owner_profile_id;
const notifyProblem = async (subject, o, title, body) => {
  const g = await getGlobal(); if (!g.notifyErrors) return;
  try {
    if (subject.kind === 'sky') await notifyStaff('tax_error', { title, body, dedupe: `${o.id}:${o.status}:${o.attempts}`, skipOwner: false });
    else if (subject.owner_profile_id) await notifyGift(subject.owner_profile_id, 'tax', title, body, o.id);
  } catch { /* оповещение не должно ломать очередь */ }
};
const innOf = (s) => (s.inn_enc ? openSecret(s.inn_enc) : '');

const waitOp = (id, reason, sec = 60) => query(`UPDATE tax_ops SET status = 'queued', wait_reason = $2, next_attempt_at = now() + ($3 || ' seconds')::interval, updated_at = now() WHERE id = $1`, [id, reason, String(sec)]);

const runOp = async (o) => {
  const subject = await subjById(o.subject_id);
  if (!subject || !subject.enabled) return waitOp(o.id, 'subject_not_ready', 300);
  const g = await getGlobal();
  const ig = (await query('SELECT * FROM tax_integrations WHERE subject_id = $1', [subject.id])).rows[0];
  if (!ig || ig.status === 'disabled') return waitOp(o.id, 'no_integration', 300);
  if (!g.liveEnabled || !subject.live) return waitOp(o.id, 'live_disabled', 60);
  if (ig.provider === 'manual_entry') { await query(`UPDATE tax_ops SET status = 'awaiting_manual', wait_reason = '', updated_at = now() WHERE id = $1`, [o.id]); await tlog(subject.id, 'system', 'awaiting_manual', { opId: o.id }); return; }
  let refund = null;
  if (o.kind === 'refund') {
    refund = (await query('SELECT * FROM tax_docs WHERE op_id = $1', [o.refund_of])).rows[0];
    if (!refund) { await query(`UPDATE tax_ops SET status = 'failed', last_error = 'Исходный чек ещё не сформирован', updated_at = now() WHERE id = $1`, [o.id]); return; }
  }
  const op = { ...o, buyerEmail: o.buyer_email_enc ? openSecret(o.buyer_email_enc) : (o.payer_profile_id ? await profileEmail(o.payer_profile_id) : null) };
  try {
    const res = await prov.createReceipt(prov.openIntegration(ig, openJson), { op, subject, inn: innOf(subject), refundDoc: refund });
    await query(`UPDATE tax_integrations SET last_ok_at = now(), last_error = '', status = 'active' WHERE id = $1`, [ig.id]);
    if (res.state === 'issued') { await issueDoc(o.id, { number: res.number, url: res.url, fiscalSign: res.fiscalSign, externalId: res.externalId, provenance: 'provider', actor: 'system' }); return; }
    await query(`UPDATE tax_ops SET status = 'awaiting_provider', external_id = $2, next_attempt_at = now() + interval '20 seconds', updated_at = now() WHERE id = $1`, [o.id, res.externalId]);
    await tlog(subject.id, 'system', 'accepted_by_gateway', { opId: o.id, detail: res.externalId });
  } catch (e) { await handleProviderError(o, subject, ig, e); }
};
const handleProviderError = async (o, subject, ig, e) => {
  const attempts = o.attempts + 1; const msg = `${e.code ?? 'error'}${e.detail ? `: ${e.detail}` : ''}`.slice(0, 240);
  await query(`UPDATE tax_integrations SET last_error = $2, status = CASE WHEN $3 THEN status ELSE 'error' END WHERE id = $1`, [ig.id, msg, prov.isTemporary(e)]);
  if (prov.isTemporary(e) && attempts < MAX_ATTEMPTS) {
    await query(`UPDATE tax_ops SET status = 'queued', attempts = $2, last_error = $3, next_attempt_at = now() + ($4 || ' seconds')::interval, updated_at = now() WHERE id = $1`, [o.id, attempts, msg, String(backoffSec(attempts))]);
    await tlog(subject.id, 'system', 'send_retry', { opId: o.id, status: 'retry', detail: msg }); return;
  }
  await query(`UPDATE tax_ops SET status = 'failed', attempts = $2, last_error = $3, updated_at = now() WHERE id = $1`, [o.id, attempts, msg]);
  await tlog(subject.id, 'system', 'send_failed', { opId: o.id, status: 'error', detail: msg });
  await notifyProblem(subject, { ...o, attempts, status: 'failed' }, 'Sky Tax: чек не сформирован', `${sourceLabel(o.source)} ${Number(o.amount_rub)} ₽ — ${msg}. Проверьте интеграцию и повторите.`);
};
const pollOp = async (o) => {
  const subject = await subjById(o.subject_id); const ig = (await query('SELECT * FROM tax_integrations WHERE subject_id = $1', [o.subject_id])).rows[0];
  if (!subject || !ig || !o.external_id) return;
  if (Date.now() - new Date(o.updated_at).getTime() > 24 * 3600_000 && Date.now() - new Date(o.created_at).getTime() > 24 * 3600_000) { await query(`UPDATE tax_ops SET status = 'failed', last_error = 'Шлюз не подтвердил чек за 24 часа', updated_at = now() WHERE id = $1`, [o.id]); await notifyProblem(subject, o, 'Sky Tax: чек не подтверждён', 'Шлюз не подтвердил формирование чека за 24 часа.'); return; }
  try {
    const res = await prov.getReceiptStatus(prov.openIntegration(ig, openJson), o.external_id);
    if (res.state === 'issued') await issueDoc(o.id, { number: res.number, url: res.url, fiscalSign: res.fiscalSign, externalId: res.externalId, provenance: 'provider', actor: 'system' });
    else await query(`UPDATE tax_ops SET next_attempt_at = now() + interval '30 seconds' WHERE id = $1`, [o.id]);
  } catch (e) {
    if (prov.isTemporary(e)) await query(`UPDATE tax_ops SET next_attempt_at = now() + interval '60 seconds', last_error = $2 WHERE id = $1`, [o.id, String(e.code)]);
    else { await query(`UPDATE tax_ops SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`, [o.id, `${e.code}: ${e.detail ?? ''}`.slice(0, 240)]); await notifyProblem(subject, o, 'Sky Tax: шлюз отклонил чек', `${e.detail ?? e.code}`); }
  }
};

const profileEmail = async (profileId) => (await query(`SELECT s.email FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = $1 AND s.email_verified`, [profileId])).rows[0]?.email ?? null;
export const docToken = (id) => `${id}.${macOf('tax-doc', id).slice(0, 32)}`;
export const verifyDocToken = (t) => { const s = String(t ?? ''); const i = s.lastIndexOf('.'); if (i < 1) return null; const id = s.slice(0, i); const a = Buffer.from(macOf('tax-doc', id).slice(0, 32)); const b = Buffer.from(s.slice(i + 1).padEnd(32, '_').slice(0, 32)); return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null; };

export const docData = async (docId) => {
  const { rows } = await query(`SELECT d.*, o.items, o.descr, o.amount_rub AS op_amount, s.display_name, s.inn_enc, s.kind AS skind FROM tax_docs d JOIN tax_ops o ON o.id = d.op_id JOIN tax_subjects s ON s.id = d.subject_id WHERE d.id = $1`, [docId]);
  const d = rows[0]; if (!d) return null;
  const items = Array.isArray(d.items) && d.items.length ? d.items : [{ name: d.descr || 'Услуга', qty: 1, price: Number(d.amount_rub), amount: Number(d.amount_rub) }];
  return { id: d.id, kind: d.kind, kindLabel: DOC_KIND_LABEL[d.kind], opKind: d.op_kind, number: d.number, issuedAt: new Date(d.issued_at).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }), sellerName: d.display_name, sellerInn: d.inn_enc ? openSecret(d.inn_enc) : '', amount: Number(d.amount_rub),
    items: items.map((i) => ({ name: String(i.name ?? ''), qty: Number(i.qty ?? 1), price: Number(i.price ?? 0), amount: Number(i.amount ?? Number(i.qty ?? 1) * Number(i.price ?? 0)) })), provenance: d.provenance, url: d.url, fiscalSign: d.fiscal_sign };
};
export const docPage = async (token, autoPrint) => { const id = verifyDocToken(token); if (!id) return null; const d = await docData(id); return d ? renderTaxDocPage({ ...d, autoPrint }) : null; };

/** Письмо с документом покупателю. Адрес берётся в момент отправки (адрес продавца-получателя здесь не используется), в журнале адреса нет. */
const deliverEmail = async (d) => {
  const { rows } = await query(`SELECT o.buyer_email_enc, o.payer_profile_id FROM tax_ops o WHERE o.id = $1`, [d.op_id]);
  const o = rows[0]; const addr = o?.buyer_email_enc ? openSecret(o.buyer_email_enc) : (o?.payer_profile_id ? await profileEmail(o.payer_profile_id) : null);
  if (!addr) { await query(`UPDATE tax_docs SET email_status = 'no_address' WHERE id = $1`, [d.id]); return; }
  const data = await docData(d.id); const origin = (config.publicOrigin || '').replace(/\/$/, '');
  const ctx = { appUrl: origin ? `${origin}/` : '', supportUrl: origin ? `${origin}/?open=support` : '', privacyUrl: origin ? `${origin}/?open=privacy` : '', messageId: `taxdoc-${d.id}`, pageUrl: origin ? `${origin}/api/tax/doc/${encodeURIComponent(docToken(d.id))}` : '' };
  const mail = renderTaxDocMail(data, ctx);
  const r = await sendEmail(addr, mail.subject, mail.text, { html: mail.html, fromName: 'Sky Tax: чеки и документы', headers: { 'X-Sky-Message-ID': ctx.messageId } });
  if (r.ok) { await query(`UPDATE tax_docs SET email_status = 'sent', emailed_at = now() WHERE id = $1`, [d.id]); return; }
  const n = d.email_attempts + 1;
  if (r.error === 'email_not_configured' || n >= 6) await query(`UPDATE tax_docs SET email_status = 'failed', email_attempts = $2 WHERE id = $1`, [d.id, n]);
  else await query(`UPDATE tax_docs SET email_attempts = $2, email_next_at = now() + ($3 || ' minutes')::interval WHERE id = $1`, [d.id, n, String(2 ** n)]);
};
export const resendDoc = async (scope, actor, docId) => {
  const { rows } = await query(`SELECT d.* FROM tax_docs d JOIN tax_subjects s ON s.id = d.subject_id WHERE d.id = $1 AND s.scope = $2`, [String(docId ?? ''), scope]);
  if (!rows[0]) return err('not_found');
  await query(`UPDATE tax_docs SET email_status = 'pending', email_attempts = 0, email_next_at = now() WHERE id = $1`, [rows[0].id]);
  await tlog(rows[0].subject_id, actor, 'doc_resend', { docId: rows[0].id });
  return { ok: true };
};

let busy = false;
export const processQueue = async () => {
  if (busy) return 0; busy = true;
  try {
    let n = 0;
    // 1. сроки ручного режима: напоминание и (по настройке) автоотправка, чтобы не нарушить законный срок
    const stale = (await query(`SELECT o.*, s.manual_escalate_hours, s.manual_auto_hours FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id WHERE o.status = 'pending_confirm' AND o.wait_reason = '' AND s.enabled`)).rows;
    for (const o of stale) {
      const ageH = (Date.now() - new Date(o.paid_at).getTime()) / 3600_000;
      if (o.manual_auto_hours > 0 && ageH >= o.manual_auto_hours) { const sc = (await subjById(o.subject_id)).scope; await decide(sc, 'system:deadline', o.id, 'confirm'); await tlog(o.subject_id, 'system', 'auto_confirm_deadline', { opId: o.id, detail: `${Math.round(ageH)} ч` }); n++; }
      else if (!o.escalated_at && ageH >= o.manual_escalate_hours) {
        await query('UPDATE tax_ops SET escalated_at = now() WHERE id = $1', [o.id]);
        const sub = await subjById(o.subject_id); await notifyProblem(sub, o, 'Sky Tax: операция ждёт подтверждения', `${sourceLabel(o.source)} на ${Number(o.amount_rub)} ₽ ждёт решения ${Math.round(ageH)} ч. Срок оформления чека — до ${new Date(o.due_by).toLocaleString('ru-RU')}.`);
      }
    }
    // 2. отправка
    const claimed = (await query(`UPDATE tax_ops SET status = 'sending' WHERE id IN (SELECT id FROM tax_ops WHERE status = 'queued' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows;
    for (const o of claimed) { try { await runOp(o); } catch (e) { console.error('[tax] сбой операции', o.id, e.message); await query(`UPDATE tax_ops SET status = 'queued', next_attempt_at = now() + interval '2 minutes', last_error = $2 WHERE id = $1 AND status = 'sending'`, [o.id, String(e.message).slice(0, 120)]); } n++; }
    // зависшие «отправляется» (процесс упал на середине) возвращаются в очередь; повтор безопасен — у партнёра ключ идемпотентности
    await query(`UPDATE tax_ops SET status = 'queued' WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'`);
    // 3. опрос принятых шлюзом
    for (const o of (await query(`SELECT * FROM tax_ops WHERE status = 'awaiting_provider' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20`)).rows) { await pollOp(o); n++; }
    // 4. письма покупателям
    for (const d of (await query(`SELECT * FROM tax_docs WHERE email_status = 'pending' AND email_next_at <= now() ORDER BY issued_at LIMIT 20`)).rows) { try { await deliverEmail(d); } catch (e) { console.error('[tax] письмо', e.message); } n++; }
    return n;
  } finally { busy = false; }
};

/* ─── подбор операций из уже совершённых платежей (платёжную логику не трогаем) ─── */
const emailFromContact = (blob) => { try { const j = openJson(blob); const e = String(j?.email ?? '').trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null; } catch { return null; } };
const collectSky = async (s) => {
  const since = s.enabled_at; let n = 0;
  const tx = (await query(`SELECT id, user_id, type, -amount AS amt, descr, created_at FROM wallet_transactions WHERE amount < 0 AND created_at > $1 AND currency IS DISTINCT FROM 'pts' AND type = ANY($2) LIMIT 500`,
    [since, [...Object.keys(SKY_INCOME_TYPES), 'fx_out', 'garant_escrow', 'nft_purchase', 'skin_purchase']])).rows;
  for (const t of tx) { const r = await createOp(s, { source: `wallet:${t.type}`, sourceRef: t.id, amountRub: Number(t.amt), descr: t.descr, payerProfileId: t.user_id, paidAt: t.created_at }); if (r.op) n++; }
  const top = (await query(`SELECT p.id, p.number, p.user_id, p.amount, p.fee, p.destination, c.created_at AS at FROM skykassa_payments p JOIN skykassa_credits c ON c.payment_id = p.id WHERE c.created_at > $1 LIMIT 500`, [since])).rows;
  for (const p of top) {
    if (p.destination === 'balance') { const r = await createOp(s, { source: 'skykassa_topup', sourceRef: p.id, amountRub: Number(p.amount), descr: `Пополнение SkyMoney ${p.number}`, payerProfileId: p.user_id, paidAt: p.at }); if (r.op) n++; }
    if (Number(p.fee) > 0) { const r = await createOp(s, { source: 'skykassa_fee', sourceRef: p.id, amountRub: Number(p.fee), descr: `Комиссия за пополнение ${p.number}`, payerProfileId: p.user_id, paidAt: p.at }); if (r.op) n++; }
  }
  return n;
};
const collectKb = async (s) => {
  const biz = s.scope.slice(3); let n = 0;
  const pays = (await query(`SELECT p.id, p.amount_rub, p.order_no, p.confirmed_at, q.kind AS qkind, q.id AS qid FROM kb_payments p LEFT JOIN kb_qr q ON q.id = p.qr_id WHERE p.business_id = $1 AND p.status = 'confirmed' AND p.confirmed_at > $2 LIMIT 500`, [biz, s.enabled_at])).rows;
  for (const p of pays) {
    let email = null; if (p.qid) { const o = (await query('SELECT contact_enc FROM kb_orders WHERE qr_id = $1 ORDER BY created_at DESC LIMIT 1', [p.qid])).rows[0]; if (o) email = emailFromContact(o.contact_enc); }
    const r = await createOp(s, { source: 'kb_payment', sourceRef: p.id, amountRub: p.amount_rub, descr: p.order_no ? `Оплата ${p.order_no}` : 'Оплата покупателя', buyerEmail: email, isTip: p.qkind === 'tip', paidAt: p.confirmed_at }); if (r.op) n++;
  }
  // возврат владельцем: к подтверждённому и оформленному чеку — операция возврата
  const ref = (await query(`SELECT p.id, p.amount_rub, p.updated_at FROM kb_payments p WHERE p.business_id = $1 AND p.status = 'refunded' AND p.updated_at > $2 LIMIT 200`, [biz, s.enabled_at])).rows;
  for (const p of ref) {
    const orig = (await query(`SELECT o.id, d.id AS did FROM tax_ops o LEFT JOIN tax_docs d ON d.op_id = o.id WHERE o.subject_id = $1 AND o.source = 'kb_payment' AND o.source_ref = $2`, [s.id, p.id])).rows[0];
    if (!orig || orig.did === null) continue;
    const exists = (await query(`SELECT 1 FROM tax_ops WHERE subject_id = $1 AND refund_of = $2`, [s.id, orig.id])).rowCount; if (exists) continue;
    await refundDoc(s.scope, 'system', orig.did, { amount: p.amount_rub, reason: 'Возврат выполнен владельцем в SkyKassa Business' }).then((x) => { if (x.ok) n++; });
  }
  return n;
};
const collectSeller = async (s) => {
  const pid = s.scope.slice(7); let n = 0;
  const rows = (await query(`SELECT id, total_kop, title_snap, quantity, price_kop, paid_confirmed_at, buyer_id FROM market_orders WHERE seller_id = $1 AND paid_confirmed_at > $2 AND status IN ('seller_payment_confirmed','fulfillment','seller_shipped','in_transit','ready_for_pickup','buyer_received','completed') LIMIT 500`, [pid, s.enabled_at])).rows;
  for (const o of rows) { const r = await createOp(s, { source: 'market_order', sourceRef: o.id, amountRub: Number(o.total_kop) / 100, descr: `Заказ Sky Market: ${o.title_snap}`, items: [{ name: o.title_snap, qty: o.quantity, price: Number(o.price_kop) / 100 }], payerProfileId: o.buyer_id, paidAt: o.paid_confirmed_at }); if (r.op) n++; }
  return n;
};
const collectExecutor = async (s) => {
  const pid = s.scope.slice(3); let n = 0;
  const rows = (await query(`SELECT p.order_id, p.amount_rub, p.payer_id, p.confirmed_at, o.kind, o.org_id FROM go_order_pay p JOIN go_orders o ON o.id = p.order_id WHERE p.payee_id = $1 AND p.state = 'confirmed' AND p.confirmed_at > $2 AND COALESCE(o.data->>'internal', '') <> 'true' LIMIT 500`, [pid, s.enabled_at])).rows;
  for (const o of rows) { const r = await createOp(s, { source: 'go_order', sourceRef: o.order_id, amountRub: o.amount_rub, descr: `Заказ Sky GO (${o.kind})`, payerProfileId: o.payer_id, paidAt: o.confirmed_at, internal: false }); if (r.op) n++; }
  return n;
};
export const sweepTax = async () => {
  const subs = (await query(`SELECT * FROM tax_subjects WHERE enabled AND enabled_at IS NOT NULL`)).rows; let n = 0;
  for (const s of subs) {
    try { n += s.kind === 'sky' ? await collectSky(s) : s.kind === 'business' ? await collectKb(s) : s.kind === 'seller' ? await collectSeller(s) : await collectExecutor(s); }
    catch (e) { console.error('[tax] подбор операций', s.scope, e.message); await tlog(s.id, 'system', 'collect_failed', { status: 'error', detail: e.message }); }
  }
  return n;
};

/* ─── отчёты, обзор, журнал ─── */
export const report = async (scope, { from, to } = {}) => {
  const p = [scope]; let w = 's.scope = $1';
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { p.push(from); w += ` AND o.paid_at >= $${p.length}::date`; }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { p.push(to); w += ` AND o.paid_at < ($${p.length}::date + 1)`; }
  const { rows } = await query(`SELECT o.kind, o.status, o.classification, count(*)::int AS n, COALESCE(sum(o.amount_rub),0) AS sum FROM tax_ops o JOIN tax_subjects s ON s.id = o.subject_id WHERE ${w} GROUP BY 1,2,3`, p);
  const get = (f) => rows.filter(f).reduce((a, r) => ({ n: a.n + r.n, sum: a.sum + Number(r.sum) }), { n: 0, sum: 0 });
  const sales = get((r) => r.kind === 'sale' && r.status === 'issued'); const refunds = get((r) => r.kind === 'refund' && r.status === 'issued');
  return { from: from || null, to: to || null, sales, refunds, net: Math.round((sales.sum - refunds.sum) * 100) / 100,
    waiting: get((r) => ['pending_confirm', 'queued', 'sending', 'awaiting_provider', 'awaiting_manual'].includes(r.status)), failed: get((r) => r.status === 'failed'), rejected: get((r) => r.status === 'rejected'), notRequired: get((r) => r.status === 'not_required') };
};
const csv = (v) => { const s = String(v ?? ''); const x = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",;\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
export const reportCsv = async (scope, range) => {
  const ops = await listOps(scope, { ...range, limit: 200 });
  const head = ['Дата оплаты', 'Операция', 'Вид', 'Источник', 'Сумма, ₽', 'Статус', 'Документ №', 'Классификация', 'Основание'];
  return [head, ...ops.map((o) => [o.paidAt ? new Date(o.paidAt).toISOString().slice(0, 19).replace('T', ' ') : '', o.id, o.kind === 'refund' ? 'возврат' : 'продажа', o.sourceLabel, o.amountRub.toFixed(2), o.statusLabel, o.docNumber ?? '', o.classification, o.classReason])].map((r) => r.map(csv).join(';')).join('\n');
};
export const listDocs = async (scope, { q, from, to, limit = 100, offset = 0 } = {}) => {
  const p = []; const w = [];
  if (scope) { p.push(scope); w.push(`s.scope = $${p.length}`); }
  if (q) { p.push(`%${clean(q, 60).replace(/[%_\\]/g, '\\$&')}%`); w.push(`(d.number ILIKE $${p.length} OR d.op_id ILIKE $${p.length} OR d.id ILIKE $${p.length})`); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { p.push(from); w.push(`d.issued_at >= $${p.length}::date`); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { p.push(to); w.push(`d.issued_at < ($${p.length}::date + 1)`); }
  p.push(Math.min(200, Math.max(1, Number(limit) || 100)), Math.max(0, Number(offset) || 0));
  const { rows } = await query(`SELECT d.*, s.scope, s.display_name FROM tax_docs d JOIN tax_subjects s ON s.id = d.subject_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.issued_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows.map((d) => ({ id: d.id, opId: d.op_id, scope: d.scope, subjectName: d.display_name, kind: d.kind, kindLabel: DOC_KIND_LABEL[d.kind], opKind: d.op_kind, number: d.number, url: d.url || null, amountRub: Number(d.amount_rub), provenance: d.provenance, status: d.status, emailStatus: d.email_status, emailedAt: d.emailed_at, issuedAt: d.issued_at, pageUrl: `/api/tax/doc/${encodeURIComponent(docToken(d.id))}` }));
};
export const listLog = async (scope, { limit = 100, offset = 0 } = {}) => {
  const p = []; let w = '';
  if (scope) { p.push(scope); w = 'WHERE s.scope = $1'; }
  p.push(Math.min(300, Math.max(1, Number(limit) || 100)), Math.max(0, Number(offset) || 0));
  const { rows } = await query(`SELECT l.*, s.scope, pr.username FROM tax_log l LEFT JOIN tax_subjects s ON s.id = l.subject_id LEFT JOIN profiles pr ON pr.id = l.actor ${w} ORDER BY l.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows.map((l) => ({ id: Number(l.id), scope: l.scope, opId: l.op_id, docId: l.doc_id, actor: l.username ? `@${l.username}` : l.actor, action: l.action, status: l.status, detail: l.detail, at: l.created_at }));
};
export const overview = async () => {
  await ensureSky();
  const g = await getGlobal();
  const st = (await query(`SELECT status, count(*)::int AS n FROM tax_ops GROUP BY 1`)).rows; const by = Object.fromEntries(st.map((r) => [r.status, r.n]));
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const docs = Number((await query('SELECT count(*)::int AS n FROM tax_docs')).rows[0].n);
  const refunds = Number((await query(`SELECT count(*)::int AS n FROM tax_ops WHERE kind = 'refund'`)).rows[0].n);
  const overdue = Number((await query(`SELECT count(*)::int AS n FROM tax_ops WHERE due_by < now() AND status IN ('pending_confirm','queued','awaiting_manual','awaiting_provider')`)).rows[0].n);
  const subjects = (await query(`SELECT s.*, (SELECT count(*)::int FROM tax_ops o WHERE o.subject_id = s.id) AS ops, (SELECT count(*)::int FROM tax_ops o WHERE o.subject_id = s.id AND o.status = 'pending_confirm') AS pending, (SELECT count(*)::int FROM tax_ops o WHERE o.subject_id = s.id AND o.status = 'failed') AS failed FROM tax_subjects s ORDER BY (s.kind = 'sky') DESC, s.created_at`)).rows;
  const views = []; for (const s of subjects) views.push({ ...(await subjectView(s)), ops: s.ops, pending: s.pending, failed: s.failed });
  return { global: g, counts: { total, docs, refunds, overdue, issued: by.issued ?? 0, pending: by.pending_confirm ?? 0, queued: (by.queued ?? 0) + (by.sending ?? 0) + (by.awaiting_provider ?? 0) + (by.awaiting_manual ?? 0), failed: by.failed ?? 0, rejected: by.rejected ?? 0, notRequired: by.not_required ?? 0 }, subjects: views, providers: providerList() };
};
export const myScopes = async (me, deps) => {
  const out = [];
  const cands = ['sky', `seller:${me}`, `go:${me}`];
  const acc = await deps.accessOf(me); if (acc) cands.push(`kb:${acc.businessId}`);
  for (const sc of cands) { const ctx = await resolveScope(me, sc, deps); if (ctx && ctx.canView && (ctx.kind !== 'sky' || true)) out.push({ scope: sc, kind: ctx.kind, label: ctx.label, role: ctx.role, canManage: ctx.canManage, subject: await getSubjectView(sc) }); }
  // продавец без магазина / не исполнитель: убираем пустые варианты
  const filtered = [];
  for (const o of out) {
    if (o.kind === 'seller') { const r = await query('SELECT 1 FROM market_sellers WHERE profile_id = $1', [me]); if (!r.rowCount) continue; }
    if (o.kind === 'executor') { const r = await query(`SELECT 1 FROM go_executors WHERE profile_id = $1 AND status = 'approved'`, [me]).catch(() => ({ rowCount: 0 })); if (!r.rowCount) continue; }
    filtered.push(o);
  }
  return filtered;
};
