/* SkyKassa Business — клиент API. Ничего не решается на клиенте: сумму фиксированного QR, статусы и права определяет сервер. */
import { apiCall, apiText } from '@/core/auth/api';

export type Res<T> = { ok: true; data: T } | { ok: false; error?: string; field?: string; status?: number; data?: unknown };

const req = async <T>(path: string, init?: RequestInit): Promise<Res<T>> => {
  const r = await apiCall<T>(path, init);
  if (r.ok) return { ok: true, data: r.data as T };
  const d = (r.data ?? {}) as { field?: string };
  return { ok: false, error: r.error, field: d.field, status: r.status, data: r.data };
};
const send = <T>(method: string, p: string, b?: unknown) => req<T>(p, { method, body: JSON.stringify(b ?? {}) });

export type Mode = 'online' | 'point' | 'both';
export type LegalType = 'person' | 'selfemployed' | 'ip' | 'company' | 'other';
export interface Business {
  id: string; name: string; description: string; category: string; country: string; mode: Mode; legalType: LegalType; legalVerified: boolean;
  contacts: string; website: string; hasLogo: boolean; status: 'draft' | 'active' | 'suspended'; suspendedReason?: string; createdAt: string;
}
export interface Subscription { status: 'inactive' | 'active' | 'expiring' | 'suspended' | 'expired'; active: boolean; startedAt?: string | null; expiresAt?: string | null; priceRub: number; periodDays: number }
export interface Requisites { holder: string; method: 'phone' | 'account' | 'card' | 'other'; value: string; bank?: string; purpose?: string; instruction?: string; extra?: string; updatedAt?: string }
export interface Me { business: Business | null; subscription: Subscription; requisites?: Requisites | null; payOrigin?: string }
export interface Qr {
  id: string; publicId: string; kind: 'pay' | 'permanent'; title: string; description: string; amountRub: number | null; currency: string; orderNo: string;
  instruction: string; expiresAt: string | null; status: 'active' | 'disabled' | 'archived'; createdAt: string; url: string; opens: number; requests: number; confirmed: number;
}
export interface Payment {
  id: string; qrId: string | null; qrTitle?: string; amountRub: number; currency: string; orderNo: string; status: string; statusLabel: string; source: string;
  buyerNote: string; ownerComment: string; reportedAt: string | null; confirmedAt: string | null; createdAt: string;
}
export interface Stats { qr: number; opens: number; requests: number; awaiting: number; confirmed: number; claimedSumRub: number; confirmedByOwnerSumRub: number; confirmedByIntegrationSumRub: number }
export interface AuditItem { actor: 'owner' | 'other'; action: string; detail: string; at: string }

export const kbMe = () => req<Me>('/api/kbiz/me');
export const kbCreateBusiness = (b: unknown) => send<{ id: string }>('POST', '/api/kbiz/business', b);
export const kbUpdateBusiness = (b: unknown) => send<unknown>('PUT', '/api/kbiz/business', b);
export const kbSetLogo = (dataUrl: string) => send<unknown>('PUT', '/api/kbiz/business/logo', { dataUrl });
export const kbSetRequisites = (b: unknown) => send<{ changed?: string[] }>('PUT', '/api/kbiz/requisites', b);
export const kbPublish = (on: boolean) => send<{ status: string }>('POST', '/api/kbiz/publish', { on });
export const kbSubscription = () => req<{ subscription: Subscription; history: { id: string; priceRub: number; startedAt: string; expiresAt: string; at: string }[] }>('/api/kbiz/subscription');
export const kbBuySub = (idemKey: string) => send<{ expiresAt: string }>('POST', '/api/kbiz/subscription/buy', { idemKey });
export const kbQrList = () => req<{ qr: Qr[] }>('/api/kbiz/qr');
export const kbQrCreate = (b: unknown) => send<{ qr: Qr }>('POST', '/api/kbiz/qr', b);
export const kbQrPermanent = (b: unknown) => send<{ qr: Qr }>('POST', '/api/kbiz/qr/permanent', b);
export const kbQrStatus = (id: string, status: string) => send<unknown>('POST', `/api/kbiz/qr/${id}/status`, { status });
export const kbPayments = (status?: string) => req<{ payments: Payment[] }>(`/api/kbiz/payments${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const kbPaymentLog = (id: string) => req<{ log: { actor: string; to: string; toLabel: string; note: string; at: string }[] }>(`/api/kbiz/payments/${id}/log`);
export const kbPaymentAct = (id: string, action: string, comment?: string) => send<{ status: string }>('POST', `/api/kbiz/payments/${id}/${action}`, { comment });
export const kbOverview = () => req<{ stats: Stats | null }>('/api/kbiz/overview');
export const kbAudit = () => req<{ audit: AuditItem[] }>('/api/kbiz/audit');
export const kbScan = (text: string) => send<{ publicId: string; state: string; business: string; granted: { points: number; title: string; status: string }[]; prime: boolean }>('POST', '/api/kbiz/scan', { text });
export const kbExportCsv = async (): Promise<Blob | null> => {
  const r = await apiText('/api/kbiz/export.csv');
  return r.ok ? new Blob([r.text], { type: 'text/csv;charset=utf-8' }) : null;
};

/* Публичная страница оплаты — без входа в Sky. */
export interface PublicPage {
  business: { name: string; description: string; hasLogo: boolean; logoUrl: string | null; website?: string; contacts?: string };
  title: string; description: string; state: 'open' | 'expired' | 'disabled' | 'unavailable' | 'suspended'; kind: string;
  amountRub?: number | null; currency?: string; orderNo?: string; instruction?: string; note?: string; minAmountRub?: number; maxAmountRub?: number;
  requisites?: { holder: string; method: string; value: string; bank?: string; purpose?: string; extra?: string };
}
export const pubPage = async (pid: string): Promise<{ ok: true; data: PublicPage } | { ok: false; error: string }> => {
  try {
    const r = await fetch(`/api/kbiz/public/p/${encodeURIComponent(pid)}`);
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: d } : { ok: false, error: d.error ?? 'error' };
  } catch { return { ok: false, error: 'network' }; }
};
export const pubReport = async (pid: string, b: { amountRub?: number; note?: string; website?: string }) => {
  try {
    const r = await fetch(`/api/kbiz/public/p/${encodeURIComponent(pid)}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true as const, data: d as { id: string; statusKey: string; statusLabel: string } } : { ok: false as const, error: String(d.error ?? 'error') };
  } catch { return { ok: false as const, error: 'network' }; }
};
export const pubStatus = async (id: string, key: string) => {
  try {
    const r = await fetch(`/api/kbiz/public/status/${encodeURIComponent(id)}?k=${encodeURIComponent(key)}`);
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true as const, data: d as { status: string; statusLabel: string; note: string } } : { ok: false as const, error: String(d.error ?? 'error') };
  } catch { return { ok: false as const, error: 'network' }; }
};
