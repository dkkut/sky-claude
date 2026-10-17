/**
 * Единая система нарушений и штрафов — Sky Market / склады / Sky PVZ.
 *
 * Один механизм на три модуля (см. server/migrations/091_violations.sql):
 * конкретный модуль — это просто поле на нарушении, а не отдельная
 * система со своими таблицами. То же решение, что у видеообзора
 * (server/videoreview.mjs) для (subject_kind, subject_id).
 *
 * Деньги. Штраф — начисление/обязательство, не списание: у продавца нет
 * внутреннего Sky-баланса, Sky не принимает оплату за третьих лиц и не
 * заводит для штрафов новый баланс (см. 039_market.sql, §4/§23 брифа).
 * Платёж идёт на реквизиты, которые задаёт исключительно владелец в
 * админке (violation_payment_settings, isOwner-гейт — как и другие
 * владельческие функции, см. server/tv.mjs), и которые замораживаются
 * на самом штрафе в момент начисления: смена счёта владельцем позже не
 * должна тихо поменять место оплаты уже выставленного штрафа.
 *
 * История не удаляется никогда. Отмена нарушения/штрафа — это статус и
 * причина, а не DELETE; к этому добавлен append-only журнал
 * (violation_audit_log, тот же приём, что admin_log и market_pvz_audit).
 */
import { pool, query } from './db.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { generateId } from './security.mjs';
import { can, isOwner } from './admin.mjs';
import { pushViolation } from './signal.mjs';
import { isOwnerOf as isPvzOwner } from './pvzops.mjs';
import { warehouseAccess } from './warehouses.mjs';

export const RULE_ID_RE = /^vr-[0-9a-f-]{36}$/;
export const VIOLATION_ID_RE = /^vio-[0-9a-f-]{36}$/;
export const PENALTY_ID_RE = /^pen-[0-9a-f-]{36}$/;
export const APPEAL_ID_RE = /^vap-[0-9a-f-]{36}$/;

const MODULES = ['market', 'warehouse', 'pvz'];
const SEVERITIES = ['warning', 'minor', 'moderate', 'severe', 'critical'];
const SANCTIONS = ['none', 'warning', 'remove_listing', 'restrict_publishing',
  'restrict_feature', 'suspend', 'restrict_staff', 'temp_block', 'perm_block'];
const VIOLATOR_KINDS = ['market_seller', 'warehouse_owner', 'warehouse_staff', 'pvz_owner', 'pvz_staff', 'buyer'];
const ORG_KINDS = ['', 'warehouse', 'pvz'];

const MAX_TEXT = 2000;
const MAX_PENALTY_KOP = 50_000_00; // 50 000 ₽ — защита от опечатки/подмены на абсурдную сумму
const DEFAULT_DUE_DAYS = 14;

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

const wholeOrNull = (raw, max) => {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined; // undefined = невалидно
  return n;
};

/* ─── Журнал — единый на весь модуль, никогда не редактируется/не удаляется ── */

const logViolation = async (actorId, targetType, targetId, action, detail = {}, violationId = null) => {
  try {
    await query(
      `INSERT INTO violation_audit_log (violation_id, target_type, target_id, actor_id, action, detail)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [violationId, text(targetType, 40), text(targetId, 80), actorId ?? null, text(action, 64), JSON.stringify(detail ?? {})]);
  } catch { /* журнал не должен ронять операцию, которую описывает */ }
};

const notifyViolator = async (userId, violationId, kind, textLine) => {
  if (!userId) return;
  const id = `vnn-${generateId()}`;
  await query(
    `INSERT INTO violation_notifications (id, user_id, violation_id, kind, text)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, userId, violationId ?? null, text(kind, 40), text(textLine, 500)]);
  pushViolation([userId], { type: 'violation-notification', payload: { id, kind, text: text(textLine, 500), violationId: violationId ?? null } });
};

/* ─── Выдача наружу — только безопасные поля ───────────────────────────── */

const toRule = (r) => ({
  id: r.id, module: r.module, code: r.code, title: r.title, description: r.description,
  severity: r.severity,
  defaultPenaltyKop: r.default_penalty_kop ?? null,
  defaultSanction: r.default_sanction,
  escalation: r.escalation ?? {},
  repeatMultiplier: Number(r.repeat_multiplier),
  version: r.version, active: r.active,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

const toPenalty = (p) => ({
  id: p.id, violationId: p.violation_id, profileId: p.profile_id,
  amountKop: p.amount_kop ?? null, currency: p.currency, reason: p.reason,
  status: p.status,
  issuedAt: p.issued_at.toISOString(),
  dueAt: p.due_at ? p.due_at.toISOString() : null,
  // «Когда и куда» — срок и замороженные на момент начисления реквизиты.
  paymentRequisites: p.payment_requisites_snapshot ?? null,
  paymentPurpose: p.payment_purpose,
  declaredPaidAt: p.declared_paid_at ? p.declared_paid_at.toISOString() : null,
  paidAt: p.paid_at ? p.paid_at.toISOString() : null,
  cancelledAt: p.cancelled_at ? p.cancelled_at.toISOString() : null,
  cancelReason: p.cancel_reason,
  paymentReference: p.payment_reference,
});

const toSanction = (s) => ({
  id: s.id, violationId: s.violation_id, kind: s.kind, status: s.status,
  detail: s.detail ?? {},
  appliedAt: s.applied_at.toISOString(),
  expiresAt: s.expires_at ? s.expires_at.toISOString() : null,
  liftedAt: s.lifted_at ? s.lifted_at.toISOString() : null,
  liftReason: s.lift_reason,
});

const toAppeal = (a, { withActor = false } = {}) => ({
  id: a.id, violationId: a.violation_id,
  reason: a.reason, comment: a.comment, status: a.status,
  decidedAt: a.decided_at ? a.decided_at.toISOString() : null,
  decisionReason: a.decision_reason || undefined,
  decisionComment: a.decision_comment || undefined,
  sanctionChange: a.sanction_change ?? undefined,
  createdAt: a.created_at.toISOString(),
  ...(withActor ? { submittedBy: a.submitted_by, decidedBy: a.decided_by ?? undefined } : {}),
});

const toViolation = (v, { withActor = false } = {}) => ({
  id: v.id, module: v.module,
  violatorKind: v.violator_kind, violatorId: v.violator_id,
  orgKind: v.org_kind || undefined, orgId: v.org_id || undefined,
  objectKind: v.object_kind || undefined, objectId: v.object_id || undefined,
  ruleId: v.rule_id, ruleSnapshot: v.rule_snapshot, severity: v.severity,
  description: v.description, status: v.status, source: v.source,
  sanctionApplied: v.sanction_applied ?? undefined,
  repeatCount: v.repeat_count,
  createdAt: v.created_at.toISOString(), updatedAt: v.updated_at.toISOString(),
  reviewedAt: v.reviewed_at ? v.reviewed_at.toISOString() : null,
  reviewComment: v.review_comment || undefined,
  cancelReason: v.cancel_reason || undefined,
  cancelledAt: v.cancelled_at ? v.cancelled_at.toISOString() : null,
  closedAt: v.closed_at ? v.closed_at.toISOString() : null,
  ...(withActor ? {
    createdBy: v.created_by ?? undefined,
    reviewedBy: v.reviewed_by ?? undefined,
    cancelledBy: v.cancelled_by ?? undefined,
    violatorName: v.violator_name ?? undefined,
  } : {}),
});

/* ─── Регламент (правила) ───────────────────────────────────────────────
 *
 * Правка правила не трогает уже случившиеся нарушения — они держат
 * собственный замороженный rule_snapshot. Версия тут растёт только для
 * того, чтобы в списке было видно, что текст успел поменяться.
 */

export const listRules = async (actorId, { module, activeOnly } = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const conds = [];
  const params = [];
  if (module) { params.push(module); conds.push(`module = $${params.length}`); }
  if (activeOnly) conds.push('active');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM violation_rules ${where} ORDER BY module, code`, params);
  return { rules: rows.map(toRule) };
};

const getActiveRule = async (ruleId) => {
  const { rows } = await query('SELECT * FROM violation_rules WHERE id = $1 AND active', [ruleId]);
  return rows[0] ?? null;
};

export const createRule = async (actorId, data = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const module = String(data.module ?? '');
  if (!MODULES.includes(module)) return { error: 'bad_module' };
  const code = text(data.code, 40);
  if (!code) return { error: 'bad_code' };
  const title = text(data.title, 160);
  if (!title) return { error: 'bad_title' };
  const severity = String(data.severity ?? '');
  if (!SEVERITIES.includes(severity)) return { error: 'bad_severity' };
  const defaultSanction = SANCTIONS.includes(String(data.defaultSanction)) ? String(data.defaultSanction) : 'none';
  const defaultPenaltyKop = wholeOrNull(data.defaultPenaltyKop, MAX_PENALTY_KOP);
  if (defaultPenaltyKop === undefined) return { error: 'bad_amount' };
  const repeatMultiplier = Number(data.repeatMultiplier ?? 1);
  if (!Number.isFinite(repeatMultiplier) || repeatMultiplier < 1 || repeatMultiplier > 10) return { error: 'bad_multiplier' };
  const escalation = (data.escalation && typeof data.escalation === 'object' && !Array.isArray(data.escalation)) ? data.escalation : {};

  const id = `vr-${generateId()}`;
  try {
    const { rows } = await query(
      `INSERT INTO violation_rules
         (id, module, code, title, description, severity, default_penalty_kop,
          default_sanction, escalation, repeat_multiplier, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       RETURNING *`,
      [id, module, code, title, text(data.description, MAX_TEXT), severity, defaultPenaltyKop,
        defaultSanction, JSON.stringify(escalation), repeatMultiplier, actorId]);
    await logViolation(actorId, 'rule', id, 'rule_create', { module, code, title });
    return { rule: toRule(rows[0]) };
  } catch (err) {
    if (err.code === '23505') return { error: 'code_taken' };
    throw err;
  }
};

export const updateRule = async (actorId, ruleId, patch = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const { rows: existing } = await query('SELECT * FROM violation_rules WHERE id = $1', [String(ruleId ?? '')]);
  const rule = existing[0];
  if (!rule) return { error: 'not_found' };

  const next = {
    title: patch.title !== undefined ? text(patch.title, 160) : rule.title,
    description: patch.description !== undefined ? text(patch.description, MAX_TEXT) : rule.description,
    severity: patch.severity !== undefined ? String(patch.severity) : rule.severity,
    default_sanction: patch.defaultSanction !== undefined ? String(patch.defaultSanction) : rule.default_sanction,
    default_penalty_kop: patch.defaultPenaltyKop !== undefined ? wholeOrNull(patch.defaultPenaltyKop, MAX_PENALTY_KOP) : rule.default_penalty_kop,
    repeat_multiplier: patch.repeatMultiplier !== undefined ? Number(patch.repeatMultiplier) : rule.repeat_multiplier,
    escalation: patch.escalation !== undefined ? patch.escalation : rule.escalation,
    active: patch.active !== undefined ? Boolean(patch.active) : rule.active,
  };
  if (!SEVERITIES.includes(next.severity)) return { error: 'bad_severity' };
  if (!SANCTIONS.includes(next.default_sanction)) return { error: 'bad_sanction' };
  if (next.default_penalty_kop === undefined) return { error: 'bad_amount' };
  if (!Number.isFinite(next.repeat_multiplier) || next.repeat_multiplier < 1 || next.repeat_multiplier > 10) return { error: 'bad_multiplier' };
  if (typeof next.escalation !== 'object' || Array.isArray(next.escalation) || next.escalation === null) return { error: 'bad_escalation' };

  const { rows } = await query(
    `UPDATE violation_rules SET
        title = $2, description = $3, severity = $4, default_sanction = $5,
        default_penalty_kop = $6, repeat_multiplier = $7, escalation = $8::jsonb,
        active = $9, version = version + 1, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [rule.id, next.title, next.description, next.severity, next.default_sanction,
      next.default_penalty_kop, next.repeat_multiplier, JSON.stringify(next.escalation), next.active]);
  await logViolation(actorId, 'rule', rule.id, 'rule_update', { patch });
  return { rule: toRule(rows[0]) };
};

/* ─── Реквизиты оплаты штрафов — только владелец ────────────────────────
 *
 * Прямая проверка isOwner(), как и другие владельческие функции
 * (server/tv.mjs) — не RBAC-право, которое можно выдать кому-то ещё.
 */

export const getPaymentSettings = async (actorId) => {
  if (!(await can(actorId, 'violations')) && !(await isOwner(actorId))) return { error: 'not_allowed' };
  const { rows } = await query(
    'SELECT * FROM violation_payment_settings WHERE active ORDER BY created_at DESC LIMIT 1');
  if (!rows[0]) return { settings: null };
  return { settings: { id: rows[0].id, requisites: rows[0].requisites, setAt: rows[0].created_at.toISOString() } };
};

const getActivePaymentSettingsRow = async () => {
  const { rows } = await query(
    'SELECT * FROM violation_payment_settings WHERE active ORDER BY created_at DESC LIMIT 1');
  return rows[0] ?? null;
};

export const setPaymentSettings = async (actorId, requisites) => {
  if (!(await isOwner(actorId))) return { error: 'owner_only' };
  if (!requisites || typeof requisites !== 'object' || Array.isArray(requisites)) return { error: 'bad_requisites' };
  const clean = {};
  for (const [k, v] of Object.entries(requisites)) {
    if (typeof k !== 'string' || !k) continue;
    clean[text(k, 40)] = text(v, 200);
  }
  if (!Object.keys(clean).length) return { error: 'bad_requisites' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE violation_payment_settings SET active = FALSE, replaced_at = now() WHERE active');
    const id = `vps-${generateId()}`;
    const { rows } = await client.query(
      `INSERT INTO violation_payment_settings (id, requisites, set_by)
       VALUES ($1,$2::jsonb,$3) RETURNING *`,
      [id, JSON.stringify(clean), actorId]);
    await client.query('COMMIT');
    await logViolation(actorId, 'payment_settings', id, 'payment_settings_update', {});
    return { settings: { id: rows[0].id, requisites: rows[0].requisites, setAt: rows[0].created_at.toISOString() } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Нарушения ─────────────────────────────────────────────────────────── */

const countPriorConfirmed = async (violatorId, module) => {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM violations
      WHERE violator_id = $1 AND module = $2 AND status IN ('CONFIRMED','CLOSED')`,
    [violatorId, module]);
  return rows[0]?.n ?? 0;
};

const ruleSnapshotOf = (rule) => ({
  id: rule.id, module: rule.module, code: rule.code, title: rule.title,
  description: rule.description, severity: rule.severity,
  default_penalty_kop: rule.default_penalty_kop, default_sanction: rule.default_sanction,
  escalation: rule.escalation ?? {}, repeat_multiplier: Number(rule.repeat_multiplier),
  version: rule.version,
});

/**
 * Зафиксировать нарушение. Ручная фиксация (кто-то с правом 'violations'
 * выбрал правило, объект и написал причину — §13 брифа) всегда уходит на
 * отдельное решение (UNDER_REVIEW), а не сразу становится действующей
 * санкцией: подтверждает её decideViolation, пусть даже тот же человек
 * вторым действием — разделение «записал» и «решил» не теряется.
 */
export const createViolation = async (actorId, input = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  return createViolationInternal({ ...input, createdBy: actorId, source: 'manual', status: 'UNDER_REVIEW' });
};

/**
 * Автоматическая серверная фиксация (§12) — вызывается напрямую другими
 * модулями (например, при объективном нарушении срока), не через HTTP, и
 * никогда не минует статус DETECTED: подтверждение, где оно нужно,
 * всё равно делает decideViolation.
 */
export const createAutoViolation = async (input = {}) => createViolationInternal(
  { ...input, createdBy: null, source: 'auto', status: 'DETECTED' });

const createViolationInternal = async (input) => {
  const module = String(input.module ?? '');
  if (!MODULES.includes(module)) return { error: 'bad_module' };
  const violatorKind = String(input.violatorKind ?? '');
  if (!VIOLATOR_KINDS.includes(violatorKind)) return { error: 'bad_violator_kind' };
  const violatorId = String(input.violatorId ?? '');
  const { rowCount: violatorExists } = await query('SELECT 1 FROM profiles WHERE id = $1', [violatorId]);
  if (!violatorExists) return { error: 'violator_not_found' };
  const orgKind = ORG_KINDS.includes(String(input.orgKind ?? '')) ? String(input.orgKind ?? '') : '';
  const description = text(input.description, MAX_TEXT);
  if (input.source === 'manual' && !description) return { error: 'description_required' };

  const rule = await getActiveRule(String(input.ruleId ?? ''));
  if (!rule || rule.module !== module) return { error: 'bad_rule' };

  const id = `vio-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO violations
       (id, module, violator_kind, violator_id, org_kind, org_id, object_kind, object_id,
        rule_id, rule_snapshot, severity, description, status, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)
     RETURNING *`,
    [id, module, violatorKind, violatorId, orgKind, text(input.orgId, 80),
      text(input.objectKind, 40), text(input.objectId, 80), rule.id, JSON.stringify(ruleSnapshotOf(rule)),
      rule.severity, description, input.status, input.source, input.createdBy]);

  await logViolation(input.createdBy, 'violation', id, 'violation_create', { module, ruleId: rule.id, source: input.source }, id);
  return { violation: toViolation(rows[0]) };
};

const SANCTION_LABEL = {
  none: 'без санкции', warning: 'предупреждение', remove_listing: 'снятие объявления',
  restrict_publishing: 'ограничение публикации', restrict_feature: 'ограничение функций',
  suspend: 'приостановка', restrict_staff: 'ограничение сотрудника',
  temp_block: 'временная блокировка', perm_block: 'постоянная блокировка',
};

const buildPaymentPurpose = (ruleSnapshot, violationId) =>
  `Штраф за нарушение правил «${ruleSnapshot.code}: ${ruleSnapshot.title}» в Sky (нарушение ${violationId})`;

const issuePenalty = async (violation, amountKop, actorId) => {
  const settings = await getActivePaymentSettingsRow();
  if (!settings) return { error: 'no_payment_settings' };
  const id = `pen-${generateId()}`;
  const dueAt = new Date(Date.now() + DEFAULT_DUE_DAYS * 24 * 60 * 60 * 1000);
  const purpose = buildPaymentPurpose(violation.rule_snapshot, violation.id);
  const { rows } = await query(
    `INSERT INTO penalties
       (id, violation_id, profile_id, amount_kop, currency, reason, due_at,
        payment_requisites_snapshot, payment_settings_id, payment_purpose)
     VALUES ($1,$2,$3,$4,'RUB',$5,$6,$7::jsonb,$8,$9)
     RETURNING *`,
    [id, violation.id, violation.violator_id, amountKop,
      `Штраф по нарушению ${violation.id}`, dueAt, JSON.stringify(settings.requisites), settings.id, purpose]);
  await logViolation(actorId, 'penalty', id, 'penalty_issue', { violationId: violation.id, amountKop }, violation.id);
  return { penalty: rows[0] };
};

/**
 * Решение по нарушению — подтвердить или отклонить. Сумма/санкция по
 * умолчанию берутся из замороженного правила с поправкой на повторность
 * (rule_snapshot.escalation, rule_snapshot.repeat_multiplier); решающий
 * может переопределить и то, и то, но не может создать штраф без
 * настроенных владельцем реквизитов (no_payment_settings) — тем самым
 * система не изобретает, куда деньгам идти, если владелец это не задал.
 */
export const decideViolation = async (actorId, violationId, decision, opts = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  if (!['CONFIRMED', 'REJECTED'].includes(String(decision))) return { error: 'bad_decision' };
  const { rows } = await query('SELECT * FROM violations WHERE id = $1', [String(violationId ?? '')]);
  const violation = rows[0];
  if (!violation) return { error: 'not_found' };
  if (!['DETECTED', 'UNDER_REVIEW'].includes(violation.status)) return { error: 'bad_status' };

  const comment = text(opts.comment, 500);

  if (decision === 'REJECTED') {
    const { rows: updated } = await query(
      `UPDATE violations SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now(),
              review_comment = $3, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [violation.id, actorId, comment]);
    await logViolation(actorId, 'violation', violation.id, 'violation_reject', {}, violation.id);
    return { violation: toViolation(updated[0]) };
  }

  const repeatCount = await countPriorConfirmed(violation.violator_id, violation.module);
  const occurrence = String(repeatCount + 1);
  const snapshot = violation.rule_snapshot;
  const escalationStep = snapshot.escalation?.[occurrence] ?? null;

  const requestedSanction = opts.sanction !== undefined ? String(opts.sanction) : undefined;
  const sanctionKind = requestedSanction && SANCTIONS.includes(requestedSanction)
    ? requestedSanction : (escalationStep?.sanction ?? snapshot.default_sanction ?? 'none');

  let amountKop = null;
  if (opts.penaltyAmountKop !== undefined) {
    const override = wholeOrNull(opts.penaltyAmountKop, MAX_PENALTY_KOP);
    if (override === undefined) return { error: 'bad_amount' };
    amountKop = override;
  } else if (snapshot.default_penalty_kop != null) {
    const multiplier = Number(snapshot.repeat_multiplier) || 1;
    amountKop = Math.round(snapshot.default_penalty_kop * Math.pow(multiplier, Math.max(0, repeatCount)));
  }

  const { rows: updated } = await query(
    `UPDATE violations SET status = 'CONFIRMED', reviewed_by = $2, reviewed_at = now(),
            review_comment = $3, sanction_applied = $4, repeat_count = $5, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [violation.id, actorId, comment, sanctionKind, repeatCount]);
  const confirmed = updated[0];

  if (sanctionKind !== 'none') {
    await query(
      `INSERT INTO violation_sanctions (id, violation_id, kind, applied_by, detail)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [`vsa-${generateId()}`, violation.id, sanctionKind, actorId, JSON.stringify(escalationStep ?? {})]);
  }

  let penaltyResult = null;
  if (amountKop && amountKop > 0) {
    penaltyResult = await issuePenalty(confirmed, amountKop, actorId);
    if (penaltyResult.error) return penaltyResult;
  }

  await logViolation(actorId, 'violation', violation.id, 'violation_confirm',
    { sanctionKind, amountKop, repeatCount }, violation.id);

  const penaltyLine = penaltyResult?.penalty
    ? ` Штраф: ${(amountKop / 100).toFixed(2)} ₽, оплатить до ${penaltyResult.penalty.due_at.toLocaleDateString('ru-RU')}.`
    : '';
  await notifyViolator(violation.violator_id, violation.id, 'violation_confirmed',
    `Зафиксировано нарушение «${snapshot.title}» (${new Date(confirmed.created_at).toLocaleDateString('ru-RU')}). ` +
    `Санкция: ${SANCTION_LABEL[sanctionKind] ?? sanctionKind}.${penaltyLine} Решение можно обжаловать.`);

  return { violation: toViolation(confirmed), penalty: penaltyResult?.penalty ? toPenalty(penaltyResult.penalty) : undefined };
};

/**
 * Аннулировать нарушение. Не удаление: статус, причина и кто отменил
 * остаются на записи навсегда (§17 брифа), вместе с каскадной отменой
 * ещё не оплаченных штрафов и снятием активных санкций — но тоже без
 * удаления их истории.
 */
export const cancelViolation = async (actorId, violationId, reason) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const cleanReason = text(reason, 500);
  if (!cleanReason) return { error: 'reason_required' };
  const { rows } = await query('SELECT * FROM violations WHERE id = $1', [String(violationId ?? '')]);
  const violation = rows[0];
  if (!violation) return { error: 'not_found' };
  if (['CANCELLED', 'CLOSED'].includes(violation.status)) return { error: 'already_final' };

  const { rows: updated } = await query(
    `UPDATE violations SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now(),
            cancel_reason = $3, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [violation.id, actorId, cleanReason]);

  await query(
    `UPDATE penalties SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
      WHERE violation_id = $1 AND status IN ('accrued','payment_declared')`,
    [violation.id, actorId, cleanReason]);
  await query(
    `UPDATE violation_sanctions SET status = 'lifted', lifted_at = now(), lifted_by = $2, lift_reason = $3
      WHERE violation_id = $1 AND status = 'active'`,
    [violation.id, actorId, cleanReason]);

  await logViolation(actorId, 'violation', violation.id, 'violation_cancel', { reason: cleanReason }, violation.id);
  await notifyViolator(violation.violator_id, violation.id, 'violation_cancelled',
    `Нарушение «${violation.rule_snapshot.title}» аннулировано администрацией.`);
  return { violation: toViolation(updated[0]) };
};

/* ─── Штрафы — оплата (обязательство, не списание) ──────────────────────── */

export const declarePenaltyPaid = async (actorId, penaltyId, paymentReference) => {
  const { rows } = await query('SELECT * FROM penalties WHERE id = $1', [String(penaltyId ?? '')]);
  const penalty = rows[0];
  if (!penalty) return { error: 'not_found' };
  if (penalty.profile_id !== actorId) return { error: 'not_allowed' };
  if (penalty.status !== 'accrued') return { error: 'bad_status' };
  const { rows: updated } = await query(
    `UPDATE penalties SET status = 'payment_declared', declared_paid_at = now(),
            declared_by = $2, payment_reference = $3
      WHERE id = $1 RETURNING *`,
    [penalty.id, actorId, text(paymentReference, 120)]);
  await logViolation(actorId, 'penalty', penalty.id, 'penalty_declared_paid', {}, penalty.violation_id);
  return { penalty: toPenalty(updated[0]) };
};

export const confirmPenaltyPaid = async (actorId, penaltyId) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM penalties WHERE id = $1', [String(penaltyId ?? '')]);
  const penalty = rows[0];
  if (!penalty) return { error: 'not_found' };
  if (!['accrued', 'payment_declared'].includes(penalty.status)) return { error: 'bad_status' };
  const { rows: updated } = await query(
    `UPDATE penalties SET status = 'paid', paid_at = now(), confirmed_by = $2 WHERE id = $1 RETURNING *`,
    [penalty.id, actorId]);
  await logViolation(actorId, 'penalty', penalty.id, 'penalty_paid', {}, penalty.violation_id);
  return { penalty: toPenalty(updated[0]) };
};

export const cancelPenalty = async (actorId, penaltyId, reason) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const cleanReason = text(reason, 500);
  if (!cleanReason) return { error: 'reason_required' };
  const { rows } = await query('SELECT * FROM penalties WHERE id = $1', [String(penaltyId ?? '')]);
  const penalty = rows[0];
  if (!penalty) return { error: 'not_found' };
  if (!['accrued', 'payment_declared'].includes(penalty.status)) return { error: 'bad_status' };
  const { rows: updated } = await query(
    `UPDATE penalties SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
      WHERE id = $1 RETURNING *`,
    [penalty.id, actorId, cleanReason]);
  await logViolation(actorId, 'penalty', penalty.id, 'penalty_cancel', { reason: cleanReason }, penalty.violation_id);
  return { penalty: toPenalty(updated[0]) };
};

/**
 * Кого затронет отмена — только это, для оформления заявки на второй
 * ключ (см. PENDING_KINDS.cancel_violation/cancel_penalty в
 * adminsec.mjs): аннулирование нарушения снимает уже начисленный штраф
 * и действующую санкцию, то есть прощает долг тому же счёту, что и
 * grant_money/grant_points, — тот же риск, тот же гейт. Сама отмена
 * выполняется только там, где заявку подтвердил владелец, а не прямо
 * из HTTP-ручки.
 */
export const violatorOf = async (violationId) => {
  const { rows } = await query('SELECT violator_id FROM violations WHERE id = $1', [String(violationId ?? '')]);
  return rows[0]?.violator_id ?? null;
};

export const penaltyOwnerOf = async (penaltyId) => {
  const { rows } = await query('SELECT profile_id FROM penalties WHERE id = $1', [String(penaltyId ?? '')]);
  return rows[0]?.profile_id ?? null;
};

/* ─── Обжалование ───────────────────────────────────────────────────────
 *
 * Подать апелляцию может только сам нарушитель на своё подтверждённое
 * нарушение — без права 'violations' (решение по чужому нарушению не
 * спрашивают у администратора, спрашивают у того, кого оно коснулось).
 * Пока апелляция открыта (SUBMITTED/UNDER_REVIEW), нарушение помечено
 * APPEALED — это и видно нарушителю, и защищает от второй апелляции
 * (violation_appeals_one_open_idx в 091_violations.sql).
 */
export const submitAppeal = async (actorId, violationId, reason, comment) => {
  const cleanReason = text(reason, MAX_TEXT);
  if (!cleanReason) return { error: 'reason_required' };
  const { rows } = await query('SELECT * FROM violations WHERE id = $1', [String(violationId ?? '')]);
  const violation = rows[0];
  if (!violation) return { error: 'not_found' };
  if (violation.violator_id !== actorId) return { error: 'not_allowed' };
  if (violation.status !== 'CONFIRMED') return { error: 'bad_status' };

  const id = `vap-${generateId()}`;
  let appealRow;
  try {
    const { rows: inserted } = await query(
      `INSERT INTO violation_appeals (id, violation_id, submitted_by, reason, comment)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, violation.id, actorId, cleanReason, text(comment, MAX_TEXT)]);
    appealRow = inserted[0];
  } catch (err) {
    // violation_appeals_one_open_idx — уже есть незакрытая апелляция.
    if (err?.code === '23505') return { error: 'already_appealed' };
    throw err;
  }
  await query(`UPDATE violations SET status = 'APPEALED', updated_at = now() WHERE id = $1`, [violation.id]);
  await logViolation(actorId, 'appeal', id, 'appeal_submit', { violationId: violation.id }, violation.id);
  void notifyStaff('violations', { title: 'Апелляция на нарушение', body: 'Новая апелляция ждёт рассмотрения.', dedupe: id, except: actorId });
  return { appeal: toAppeal(appealRow) };
};

const liftSanctionRow = async (sanctionId, violationId, actorId, reason) => {
  await query(
    `UPDATE violation_sanctions SET status = 'lifted', lifted_at = now(), lifted_by = $3, lift_reason = $4
      WHERE id = $1 AND violation_id = $2 AND status = 'active'`,
    [sanctionId, violationId, actorId, reason]);
};

const cancelPenaltyRow = async (penaltyId, violationId, actorId, reason) => {
  await query(
    `UPDATE penalties SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4
      WHERE id = $1 AND violation_id = $2 AND status IN ('accrued','payment_declared')`,
    [penaltyId, violationId, actorId, reason]);
};

/**
 * Решение по апелляции.
 *
 * REJECTED ничего не прощает — нарушение просто возвращается в
 * CONFIRMED, решение остаётся в силе, второй ключ не нужен (та же
 * граница, что у decideViolation). APPROVED и PARTIALLY_APPROVED
 * снимают уже назначенное наказание целиком или частично — тот же риск
 * прощения долга, что у cancelViolation/cancelPenalty, поэтому в
 * routes/violations.mjs эти два исхода идут только через заявку на
 * второй ключ (PENDING_KINDS.resolve_appeal в adminsec.mjs), а сюда
 * actorId приходит уже владельцем, подтвердившим заявку.
 */
export const decideAppeal = async (actorId, appealId, decision, opts = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  if (!['APPROVED', 'REJECTED', 'PARTIALLY_APPROVED'].includes(String(decision))) return { error: 'bad_decision' };
  const { rows } = await query('SELECT * FROM violation_appeals WHERE id = $1', [String(appealId ?? '')]);
  const appeal = rows[0];
  if (!appeal) return { error: 'not_found' };
  if (!['SUBMITTED', 'UNDER_REVIEW'].includes(appeal.status)) return { error: 'already_decided' };

  const { rows: vrows } = await query('SELECT * FROM violations WHERE id = $1', [appeal.violation_id]);
  const violation = vrows[0];
  if (!violation) return { error: 'not_found' };

  const decisionReason = text(opts.reason, 500);
  const decisionComment = text(opts.comment, MAX_TEXT);
  if (!decisionReason) return { error: 'reason_required' };

  let sanctionChange = null;

  if (decision === 'REJECTED') {
    await query(`UPDATE violations SET status = 'CONFIRMED', updated_at = now() WHERE id = $1`, [violation.id]);
  } else if (decision === 'APPROVED') {
    await query(
      `UPDATE violations SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now(),
              cancel_reason = $3, updated_at = now()
        WHERE id = $1`,
      [violation.id, actorId, `Апелляция ${appeal.id} одобрена: ${decisionReason}`]);
    await query(
      `UPDATE penalties SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
        WHERE violation_id = $1 AND status IN ('accrued','payment_declared')`,
      [violation.id, actorId, `Апелляция ${appeal.id} одобрена`]);
    await query(
      `UPDATE violation_sanctions SET status = 'lifted', lifted_at = now(), lifted_by = $2, lift_reason = $3
        WHERE violation_id = $1 AND status = 'active'`,
      [violation.id, actorId, `Апелляция ${appeal.id} одобрена`]);
    sanctionChange = { outcome: 'violation_cancelled' };
  } else {
    // PARTIALLY_APPROVED: нарушение остаётся подтверждённым, но снимается
    // конкретная санкция и/или штраф, указанные в решении — не всё целиком.
    const liftSanctionId = opts.liftSanctionId ? String(opts.liftSanctionId) : null;
    const cancelPenaltyId = opts.cancelPenaltyId ? String(opts.cancelPenaltyId) : null;
    if (!liftSanctionId && !cancelPenaltyId) return { error: 'nothing_to_change' };
    if (liftSanctionId) await liftSanctionRow(liftSanctionId, violation.id, actorId, `Апелляция ${appeal.id} частично одобрена`);
    if (cancelPenaltyId) await cancelPenaltyRow(cancelPenaltyId, violation.id, actorId, `Апелляция ${appeal.id} частично одобрена`);
    await query(`UPDATE violations SET status = 'CONFIRMED', updated_at = now() WHERE id = $1`, [violation.id]);
    sanctionChange = { liftedSanctionId: liftSanctionId ?? undefined, cancelledPenaltyId: cancelPenaltyId ?? undefined };
  }

  const { rows: updated } = await query(
    `UPDATE violation_appeals SET status = $2, decided_by = $3, decided_at = now(),
            decision_reason = $4, decision_comment = $5, sanction_change = $6::jsonb
      WHERE id = $1 RETURNING *`,
    [appeal.id, decision, actorId, decisionReason, decisionComment, sanctionChange ? JSON.stringify(sanctionChange) : null]);

  await logViolation(actorId, 'appeal', appeal.id, 'appeal_decide', { decision, sanctionChange }, violation.id);

  const DECISION_LABEL = { APPROVED: 'одобрена', REJECTED: 'отклонена', PARTIALLY_APPROVED: 'частично одобрена' };
  await notifyViolator(violation.violator_id, violation.id, 'appeal_decided',
    `Апелляция по нарушению «${violation.rule_snapshot.title}» ${DECISION_LABEL[decision]}. ${decisionReason}`);

  return { appeal: toAppeal(updated[0]) };
};

/** Кого затронет одобрение апелляции — для заявки на второй ключ. */
export const appealSubmitterOf = async (appealId) => {
  const { rows } = await query('SELECT submitted_by FROM violation_appeals WHERE id = $1', [String(appealId ?? '')]);
  return rows[0]?.submitted_by ?? null;
};

export const getAppealDetail = async (actorId, appealId) => {
  const { rows } = await query('SELECT * FROM violation_appeals WHERE id = $1', [String(appealId ?? '')]);
  const appeal = rows[0];
  if (!appeal) return { error: 'not_found' };
  const self = actorId === appeal.submitted_by;
  if (!self && !(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const { rows: evidence } = await query(
    'SELECT id, kind, mime, bytes, description, created_at FROM violation_evidence WHERE appeal_id = $1 ORDER BY created_at',
    [appeal.id]);
  return {
    appeal: {
      ...toAppeal(appeal, { withActor: !self }),
      evidence: evidence.map(toEvidence),
    },
  };
};

/* ─── Доказательства (server/evidencestore.mjs — файл на диске, здесь только
 * метаданные и приватность) ───────────────────────────────────────────
 *
 * Строка не может принадлежать и нарушению, и апелляции одновременно
 * (CHECK в 091_violations.sql) — это две разные роли: к нарушению
 * доказательство прикладывает тот, кто его расследует (администратор
 * с правом 'violations'), к апелляции — тот, кто обжалует (сам
 * нарушитель, который и подал апелляцию), либо тот же администратор,
 * когда решает апелляцию.
 *
 * Приватность: кто угодно с ссылкой на файл не читает его никогда —
 * фото/видео нарушения может показывать посторонних людей (камера
 * склада, скриншот переписки с покупателем), и видеть его должны
 * только две стороны конкретного дела — тот, кого оно касается,
 * и администрация, — тот же периметр, что уже защищает метаданные в
 * getViolationDetail/getAppealDetail выше.
 */
export const EVIDENCE_ID_RE = /^vev-[0-9a-f-]{36}$/;
export const EVIDENCE_KINDS = ['photo', 'video', 'document', 'screenshot',
  'order_data', 'tracking', 'qr_operation', 'system_event', 'message'];
export const MAX_EVIDENCE_BYTES = 200 * 1024 * 1024; // 200 МБ — фото/документ много меньше, видео с камеры склада может быть крупным

const toEvidence = (e) => ({
  id: e.id, kind: e.kind, mime: e.mime, bytes: e.bytes,
  description: e.description, createdAt: e.created_at.toISOString(),
});

/**
 * Завести строку метаданных до записи файла на диск — тот же порядок,
 * что у видеообзора (startReview/finishReview в videoreview.mjs):
 * строка существует раньше файла, чтобы оборванная загрузка не
 * оставила на диске файл без идентификатора, который можно выдать.
 */
export const beginEvidence = async (actorId, { violationId, appealId, kind, mime, description }) => {
  const cleanKind = String(kind ?? '');
  if (!EVIDENCE_KINDS.includes(cleanKind)) return { error: 'bad_kind' };
  if (Boolean(violationId) === Boolean(appealId)) return { error: 'bad_target' };

  if (violationId) {
    const { rows } = await query('SELECT violator_id FROM violations WHERE id = $1', [String(violationId)]);
    const violation = rows[0];
    if (!violation) return { error: 'not_found' };
    // Доказательство к нарушению прикладывает расследующий администратор,
    // не сам нарушитель — у него для защиты есть апелляция со своим
    // доказательством (appealId), подделать улики по себе он не должен.
    if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  } else {
    const { rows } = await query('SELECT submitted_by FROM violation_appeals WHERE id = $1', [String(appealId)]);
    const appeal = rows[0];
    if (!appeal) return { error: 'not_found' };
    const self = actorId === appeal.submitted_by;
    if (!self && !(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  }

  const id = `vev-${generateId()}`;
  await query(
    `INSERT INTO violation_evidence (id, violation_id, appeal_id, kind, mime, description, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, violationId ?? null, appealId ?? null, cleanKind, text(mime, 100), text(description, MAX_TEXT), actorId]);
  if (violationId) await logViolation(actorId, 'evidence', id, 'evidence_add', { violationId }, violationId);
  return { id };
};

/** Записать реальный размер файла после потоковой записи на диск (см. routes/violations.mjs). */
export const finishEvidence = async (evidenceId, bytes) => {
  await query('UPDATE violation_evidence SET bytes = $2 WHERE id = $1', [evidenceId, Math.max(0, Math.trunc(bytes))]);
};

/** Заведённую, но не дописанную строку — убрать, если запись на диск не удалась. */
export const dropEvidence = async (evidenceId) => {
  await query('DELETE FROM violation_evidence WHERE id = $1', [evidenceId]);
};

/**
 * Можно ли этому профилю получить байты конкретного доказательства —
 * тот же периметр self/can('violations'), что у чтения метаданных.
 */
export const evidenceAccess = async (evidenceId, actorId) => {
  const { rows } = await query(
    `SELECT e.id, e.mime,
            v.violator_id AS violation_violator_id,
            a.submitted_by AS appeal_submitted_by
       FROM violation_evidence e
       LEFT JOIN violations v ON v.id = e.violation_id
       LEFT JOIN violation_appeals a ON a.id = e.appeal_id
      WHERE e.id = $1`,
    [String(evidenceId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  const self = actorId === row.violation_violator_id || actorId === row.appeal_submitted_by;
  if (!self && !(await can(actorId, 'violations'))) return null;
  return { mime: row.mime };
};

/** Все id из базы — чтобы убрать с диска файлы без строки (см. sweepOrphans в evidencestore.mjs). */
export const liveEvidenceIds = async () => {
  const { rows } = await query('SELECT id FROM violation_evidence');
  return new Set(rows.map((r) => r.id));
};

/** Апелляции конкретного нарушителя — своя вкладка или админский взгляд. */
export const listAppealsForProfile = async (actorId, profileId) => {
  const self = actorId === profileId;
  if (!self && !(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT a.* FROM violation_appeals a WHERE a.submitted_by = $1 ORDER BY a.created_at DESC LIMIT 200`,
    [profileId]);
  return { appeals: rows.map((a) => toAppeal(a)) };
};

/** Админский список апелляций — фильтр по статусу. */
export const listAppealsForAdmin = async (actorId, filters = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const conds = [];
  const params = [];
  if (filters.status) { params.push(String(filters.status)); conds.push(`a.status = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT a.*, v.module, v.rule_snapshot, v.violator_id, p.name AS violator_name
       FROM violation_appeals a
       JOIN violations v ON v.id = a.violation_id
       LEFT JOIN profiles p ON p.id = v.violator_id
       ${where} ORDER BY a.created_at DESC LIMIT 300`, params);
  return {
    appeals: rows.map((a) => ({
      ...toAppeal(a, { withActor: true }),
      module: a.module,
      violationTitle: a.rule_snapshot?.title ?? '',
      violatorId: a.violator_id,
      violatorName: a.violator_name ?? undefined,
    })),
  };
};

/* ─── Чтение — своё (вкладка в магазине/ПВЗ) или админское ─────────────── */

/**
 * Нарушения и штрафы конкретного нарушителя — то, что покажет вкладка
 * «Нарушения и штрафы» в кабинете магазина Market и в кабинете ПВЗ.
 * Видит сам нарушитель (actorId === profileId) или администратор с
 * правом 'violations' — больше никто: это и есть защита от IDOR/BOLA
 * по чужому нарушению (§21 брифа).
 */
export const listViolationsForProfile = async (actorId, profileId, { module } = {}) => {
  const self = actorId === profileId;
  if (!self && !(await can(actorId, 'violations'))) return { error: 'not_allowed' };

  const params = [profileId];
  let where = 'v.violator_id = $1';
  if (module) { params.push(String(module)); where += ` AND v.module = $${params.length}`; }

  const { rows: violations } = await query(
    `SELECT v.* FROM violations v WHERE ${where} ORDER BY v.created_at DESC LIMIT 200`, params);
  if (!violations.length) return { violations: [] };

  const ids = violations.map((v) => v.id);
  const { rows: penalties } = await query(
    'SELECT * FROM penalties WHERE violation_id = ANY($1) ORDER BY issued_at', [ids]);
  const { rows: sanctions } = await query(
    'SELECT * FROM violation_sanctions WHERE violation_id = ANY($1) ORDER BY applied_at', [ids]);

  return {
    violations: violations.map((v) => ({
      ...toViolation(v),
      penalties: penalties.filter((p) => p.violation_id === v.id).map(toPenalty),
      sanctions: sanctions.filter((s) => s.violation_id === v.id).map(toSanction),
    })),
  };
};

/**
 * Нарушения конкретной организации (ПВЗ/склад) — то, что покажет вкладка
 * «Нарушения и штрафы» в кабинете самого ПВЗ: не только нарушения
 * владельца, но и его сотрудников, зафиксированные в рамках этой точки.
 * Видит владелец этой точки (isOwnerOf — та же проверка, что остальные
 * владельческие ручки ПВЗ) или администратор с правом 'violations'.
 * Склад пока не подключён (нет вкладки в клиенте), поэтому только 'pvz'.
 */
export const listViolationsForOrg = async (actorId, orgKind, orgId) => {
  if (!['pvz', 'warehouse'].includes(orgKind)) return { error: 'bad_org_kind' };
  let allowed = await can(actorId, 'violations');
  if (!allowed && orgKind === 'pvz') allowed = await isPvzOwner(orgId, actorId);
  if (!allowed && orgKind === 'warehouse') {
    const access = await warehouseAccess(orgId, actorId);
    allowed = access?.role === 'owner' || access?.role === 'support';
  }
  if (!allowed) return { error: 'not_allowed' };

  const { rows: violations } = await query(
    `SELECT v.*, p.name AS violator_name FROM violations v
       LEFT JOIN profiles p ON p.id = v.violator_id
      WHERE v.org_kind = $1 AND v.org_id = $2
      ORDER BY v.created_at DESC LIMIT 200`,
    [orgKind, orgId]);
  if (!violations.length) return { violations: [] };

  const ids = violations.map((v) => v.id);
  const { rows: penalties } = await query(
    'SELECT * FROM penalties WHERE violation_id = ANY($1) ORDER BY issued_at', [ids]);
  const { rows: sanctions } = await query(
    'SELECT * FROM violation_sanctions WHERE violation_id = ANY($1) ORDER BY applied_at', [ids]);

  return {
    violations: violations.map((v) => ({
      ...toViolation(v, { withActor: true }),
      penalties: penalties.filter((p) => p.violation_id === v.id).map(toPenalty),
      sanctions: sanctions.filter((s) => s.violation_id === v.id).map(toSanction),
    })),
  };
};

export const getViolationDetail = async (actorId, violationId) => {
  const { rows } = await query('SELECT * FROM violations WHERE id = $1', [String(violationId ?? '')]);
  const violation = rows[0];
  if (!violation) return { error: 'not_found' };
  const self = actorId === violation.violator_id;
  if (!self && !(await can(actorId, 'violations'))) return { error: 'not_allowed' };

  const { rows: penalties } = await query(
    'SELECT * FROM penalties WHERE violation_id = $1 ORDER BY issued_at', [violation.id]);
  const { rows: sanctions } = await query(
    'SELECT * FROM violation_sanctions WHERE violation_id = $1 ORDER BY applied_at', [violation.id]);
  const { rows: evidence } = await query(
    'SELECT id, kind, mime, bytes, description, created_at FROM violation_evidence WHERE violation_id = $1 ORDER BY created_at',
    [violation.id]);

  return {
    violation: {
      ...toViolation(violation, { withActor: !self }),
      penalties: penalties.map(toPenalty),
      sanctions: sanctions.map(toSanction),
      evidence: evidence.map(toEvidence),
    },
  };
};

/** Админский список — фильтры по модулю/нарушителю/статусу/severity/правилу. */
export const listViolationsForAdmin = async (actorId, filters = {}) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const conds = [];
  const params = [];
  const add = (expr, val) => { params.push(val); conds.push(expr.replace('?', `$${params.length}`)); };

  if (filters.module && MODULES.includes(filters.module)) add('v.module = ?', filters.module);
  if (filters.status) add('v.status = ?', String(filters.status));
  if (filters.severity && SEVERITIES.includes(filters.severity)) add('v.severity = ?', filters.severity);
  if (filters.violatorId) add('v.violator_id = ?', String(filters.violatorId));
  if (filters.ruleId) add('v.rule_id = ?', String(filters.ruleId));
  if (filters.orgId) add('v.org_id = ?', String(filters.orgId));

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT v.*, p.name AS violator_name
       FROM violations v LEFT JOIN profiles p ON p.id = v.violator_id
       ${where} ORDER BY v.created_at DESC LIMIT 300`, params);
  return { violations: rows.map((v) => toViolation(v, { withActor: true })) };
};

/** Статистика — только реальные агрегаты, без выдуманных метрик (§20 брифа). */
export const violationStats = async (actorId) => {
  if (!(await can(actorId, 'violations'))) return { error: 'not_allowed' };
  const { rows: byModule } = await query(
    `SELECT module, status, severity, count(*)::int AS n FROM violations GROUP BY module, status, severity`);
  const { rows: penaltySums } = await query(
    `SELECT status, coalesce(sum(amount_kop),0)::bigint AS sum_kop, count(*)::int AS n FROM penalties GROUP BY status`);
  const { rows: appeals } = await query(
    `SELECT status, count(*)::int AS n FROM violation_appeals GROUP BY status`);
  return { byModule, penaltySums, appeals };
};
