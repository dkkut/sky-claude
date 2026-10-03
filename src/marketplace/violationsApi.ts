/**
 * Нарушения и штрафы Market/Warehouse/PVZ: разговор с сервером.
 *
 * Только вызовы к уже решённой на сервере единой системе (см.
 * server/violations.mjs) — кому что видно и можно решает он, не этот
 * файл: сумма, статус и реквизиты оплаты всегда приходят из ответа, а
 * не придумываются на клиенте.
 */
import { apiCall } from '@/core/auth/api';

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

/** «Я оплатил» — заявление, не подтверждение: решает администрация. */
export const apiDeclarePenaltyPaid = (penaltyId: string, paymentReference: string) =>
  apiCall<{ penalty: ViolationPenalty }>(`/api/violations/penalties/${enc(penaltyId)}/declare-paid`,
    { method: 'POST', body: JSON.stringify({ paymentReference }) });
