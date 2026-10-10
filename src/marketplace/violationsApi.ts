/**
 * Нарушения и штрафы Market/Warehouse/PVZ: разговор с сервером.
 *
 * Только вызовы к уже решённой на сервере единой системе (см.
 * server/violations.mjs) — кому что видно и можно решает он, не этот
 * файл: сумма, статус и реквизиты оплаты всегда приходят из ответа, а
 * не придумываются на клиенте.
 */
import { apiCall, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';

export type ViolationModule = 'market' | 'warehouse' | 'pvz';
export type ViolationStatus = 'DETECTED' | 'UNDER_REVIEW' | 'CONFIRMED' | 'REJECTED' | 'APPEALED' | 'CANCELLED' | 'CLOSED';
export type PenaltyStatus = 'accrued' | 'payment_declared' | 'paid' | 'cancelled' | 'waived';

export interface ViolationPenalty {
  id: string;
  violationId: string;
  profileId: string;
  amountKop: number | null;
  currency: string;
  status: PenaltyStatus;
  issuedAt: string;
  dueAt: string | null;
  /** «Куда» — замороженные на момент начисления реквизиты владельца. */
  paymentRequisites: Record<string, string> | null;
  /** «За что» — подпись назначения платежа для перевода. */
  paymentPurpose: string;
  paymentReference: string;
}

export interface ViolationSanction {
  id: string;
  kind: string;
  status: string;
  appliedAt: string;
  expiresAt: string | null;
}

export interface ViolationItem {
  id: string;
  module: ViolationModule;
  violatorKind: string;
  violatorId: string;
  violatorName?: string;
  ruleSnapshot: { code: string; title: string; description: string };
  severity: string;
  description: string;
  status: ViolationStatus;
  sanctionApplied?: string;
  repeatCount: number;
  createdAt: string;
  reviewComment?: string;
  cancelReason?: string;
  penalties: ViolationPenalty[];
  sanctions: ViolationSanction[];
}

const enc = encodeURIComponent;

/** Вкладка «Нарушения и штрафы» в своём кабинете (магазин Market). */
export const apiMyViolations = (module?: ViolationModule) =>
  apiCall<{ violations: ViolationItem[] }>(
    `/api/violations/profile/me${module ? `?module=${enc(module)}` : ''}`);

/** Вкладка «Нарушения и штрафы» в кабинете самого ПВЗ — владелец и сотрудники. */
export const apiPvzViolations = (pvzId: string) =>
  apiCall<{ violations: ViolationItem[] }>(`/api/violations/org/pvz/${enc(pvzId)}`);

/** Та же вкладка в кабинете общего склада — видна владельцу склада. */
export const apiWarehouseViolations = (warehouseId: string) =>
  apiCall<{ violations: ViolationItem[] }>(`/api/violations/org/warehouse/${enc(warehouseId)}`);

/** «Я оплатил» — заявление, не подтверждение: решает администрация. */
export const apiDeclarePenaltyPaid = (penaltyId: string, paymentReference: string) =>
  apiCall<{ penalty: ViolationPenalty }>(`/api/violations/penalties/${enc(penaltyId)}/declare-paid`,
    { method: 'POST', body: JSON.stringify({ paymentReference }) });

export type AppealStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED';

export interface ViolationAppeal {
  id: string;
  violationId: string;
  reason: string;
  comment: string;
  status: AppealStatus;
  decidedAt: string | null;
  decisionReason?: string;
  decisionComment?: string;
  createdAt: string;
}

/** Обжаловать подтверждённое нарушение — только сам нарушитель. */
export const apiSubmitAppeal = (violationId: string, reason: string, comment?: string) =>
  apiCall<{ appeal: ViolationAppeal } | { error: string }>(`/api/violations/${enc(violationId)}/appeal`,
    { method: 'POST', body: JSON.stringify({ reason, comment }) });

/** Свои апелляции — отдельный список, если понадобится вне карточки нарушения. */
export const apiMyAppeals = () => apiCall<{ appeals: ViolationAppeal[] }>('/api/violations/appeals/mine');

/* ═══ Доказательства ═══════════════════════════════════════════════════
 *
 * Фото/видео/документ может показывать посторонних людей (камера
 * склада, переписка с покупателем) — видеть байты должны только две
 * стороны конкретного дела и администрация, тот же периметр, что у
 * остальных данных нарушения/апелляции. Поэтому байты тянутся не
 * обычным apiCall (заголовок Authorization тег <img>/<video> не
 * понесёт), а через пропуск — тот же приём, что у картинок маркета и
 * видеообзора складов (см. server/marketticket.mjs, marketApi.ts::
 * apiMarketTicket). Пропуск свой, под путь /api/violations.
 */
export type EvidenceKind = 'photo' | 'video' | 'document' | 'screenshot'
  | 'order_data' | 'tracking' | 'qr_operation' | 'system_event' | 'message';

export interface ViolationEvidence {
  id: string; kind: EvidenceKind; mime: string; bytes: number; description: string; createdAt: string;
}

let evidenceTicket: string | null = null;

export const apiViolationsTicket = async () => {
  const r = await apiCall<{ ticket?: string }>('/api/violations/ticket', { method: 'POST', body: '{}' });
  if (r.ok && r.data?.ticket) evidenceTicket = r.data.ticket;
  return r.ok;
};

/** Адрес байт доказательства — собирается здесь, путь на диске клиенту не отдают. */
export const evidenceFileUrl = (evidenceId: string) => {
  const url = uploadUrl(`/api/violations/evidence/${enc(evidenceId)}`);
  if (!MEDIA_BY_URL || !evidenceTicket) return url;
  return `${url}?t=${encodeURIComponent(evidenceTicket)}`;
};

/** К самому нарушению — прикладывает расследующий администратор (право 'violations'). */
export const apiUploadViolationEvidence = (violationId: string, kind: EvidenceKind, file: Blob, description = '') =>
  apiCall<{ id: string; bytes: number; mime: string } | { error: string }>(
    `/api/violations/${enc(violationId)}/evidence?kind=${enc(kind)}&description=${enc(description)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

/** К апелляции — прикладывает сам обжалующий (своя защита) или администратор, решающий апелляцию. */
export const apiUploadAppealEvidence = (appealId: string, kind: EvidenceKind, file: Blob, description = '') =>
  apiCall<{ id: string; bytes: number; mime: string } | { error: string }>(
    `/api/violations/appeals/${enc(appealId)}/evidence?kind=${enc(kind)}&description=${enc(description)}`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

/* ═══ Админка: право 'violations' ═════════════════════════════════════
 *
 * Отсюда и дальше — только то, что видит администратор, не сам
 * нарушитель: кому можно решает server/violations.mjs по actorId, этот
 * файл только зовёт ручки.
 */

export interface ViolationRule {
  id: string;
  module: ViolationModule;
  code: string;
  title: string;
  description: string;
  severity: string;
  defaultPenaltyKop: number | null;
  defaultSanction: string;
  escalation: Record<string, { sanction?: string }>;
  repeatMultiplier: number;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const apiListRules = (module?: ViolationModule, activeOnly?: boolean) => {
  const qs = new URLSearchParams();
  if (module) qs.set('module', module);
  if (activeOnly) qs.set('activeOnly', '1');
  const s = qs.toString();
  return apiCall<{ rules: ViolationRule[] }>(`/api/violations/rules${s ? `?${s}` : ''}`);
};

export const apiCreateRule = (data: {
  module: ViolationModule; code: string; title: string; description?: string; severity: string;
  defaultPenaltyKop?: number | null; defaultSanction: string; escalation?: Record<string, unknown>; repeatMultiplier?: number;
}) => apiCall<{ rule: ViolationRule } | { error: string }>('/api/violations/rules', { method: 'POST', body: JSON.stringify(data) });

export const apiUpdateRule = (ruleId: string, patch: Partial<{
  title: string; description: string; severity: string; defaultSanction: string;
  defaultPenaltyKop: number | null; repeatMultiplier: number; escalation: Record<string, unknown>; active: boolean;
}>) => apiCall<{ rule: ViolationRule } | { error: string }>(`/api/violations/rules/${enc(ruleId)}`,
  { method: 'POST', body: JSON.stringify(patch) });

export const apiPaymentSettings = () =>
  apiCall<{ settings: { id: string; requisites: Record<string, string>; setAt: string } | null }>('/api/violations/payment-settings');

export const apiSetPaymentSettings = (requisites: Record<string, string>) =>
  apiCall<{ settings: { id: string; requisites: Record<string, string>; setAt: string } } | { error: string }>(
    '/api/violations/payment-settings', { method: 'POST', body: JSON.stringify({ requisites }) });

export interface ViolationDetail extends ViolationItem {
  evidence: ViolationEvidence[];
}

export const apiViolationDetail = (violationId: string) =>
  apiCall<{ violation: ViolationDetail } | { error: string }>(`/api/violations/${enc(violationId)}`);

export const apiAdminViolations = (filters: {
  module?: ViolationModule; status?: ViolationStatus; severity?: string; violatorId?: string; ruleId?: string; orgId?: string;
} = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const s = qs.toString();
  return apiCall<{ violations: ViolationItem[] }>(`/api/violations/admin/list${s ? `?${s}` : ''}`);
};

export const apiDecideViolation = (violationId: string, decision: 'CONFIRMED' | 'REJECTED', opts: {
  comment?: string; sanction?: string; penaltyAmountKop?: number;
} = {}) => apiCall<{ violation: ViolationItem } | { error: string }>(`/api/violations/${enc(violationId)}/decide`,
  { method: 'POST', body: JSON.stringify({ decision, ...opts }) });

/** Аннулирование снимает уже начисленный штраф — заявка владельцу, не
 *  прямое действие: нужно подтверждение личности, как у любой заявки
 *  (см. StepUp в AdminPanel.tsx — тот же код, что и для grant_*). */
export const apiRequestCancelViolation = (violationId: string, reason: string, code: string) =>
  apiCall<{ id: string } | { error: string }>(`/api/violations/${enc(violationId)}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason, code }) });

export const apiConfirmPenaltyPaid = (penaltyId: string) =>
  apiCall<{ penalty: ViolationPenalty } | { error: string }>(`/api/violations/penalties/${enc(penaltyId)}/confirm-paid`, { method: 'POST' });

export const apiRequestCancelPenalty = (penaltyId: string, reason: string, code: string) =>
  apiCall<{ id: string } | { error: string }>(`/api/violations/penalties/${enc(penaltyId)}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason, code }) });

export interface ViolationAppealAdminRow extends ViolationAppeal {
  module: ViolationModule;
  violationTitle: string;
  violatorId: string;
  violatorName?: string;
  submittedBy?: string;
}

export const apiAdminAppeals = (status?: AppealStatus) =>
  apiCall<{ appeals: ViolationAppealAdminRow[] }>(`/api/violations/admin/appeals${status ? `?status=${enc(status)}` : ''}`);

export interface ViolationAppealDetail extends ViolationAppeal {
  evidence: ViolationEvidence[];
}

/** Полная карточка апелляции вместе с её доказательствами — свой взгляд (self) или администратор. */
export const apiAppealDetail = (appealId: string) =>
  apiCall<{ appeal: ViolationAppealDetail } | { error: string }>(`/api/violations/appeals/${enc(appealId)}`);

/** REJECTED решается прямо, без кода. APPROVED/PARTIALLY_APPROVED снимают
 *  уже назначенное наказание — заявка владельцу, нужен код подтверждения
 *  личности (см. StepUp в AdminPanel.tsx). */
export const apiDecideAppeal = (appealId: string, decision: AppealStatus, opts: {
  reason: string; comment?: string; liftSanctionId?: string; cancelPenaltyId?: string; code?: string;
}) => apiCall<{ appeal: ViolationAppeal } | { id: string } | { error: string }>(`/api/violations/appeals/${enc(appealId)}/decide`,
  { method: 'POST', body: JSON.stringify({ decision, ...opts }) });

/* Прямые строки из SQL (server/violations.mjs::violationStats), без
   camelCase-преобразования — sum_kop приходит как bigint-строка pg. */
export const apiViolationStats = () => apiCall<{
  byModule: { module: ViolationModule; status: ViolationStatus; severity: string; n: number }[];
  penaltySums: { status: PenaltyStatus; sum_kop: string; n: number }[];
  appeals: { status: AppealStatus; n: number }[];
}>('/api/violations/admin/stats');
