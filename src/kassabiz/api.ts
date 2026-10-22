/* SkyKassa Business — клиент API. Ничего не решается на клиенте: сумму фиксированного QR, статусы и права определяет сервер. */
import { apiCall, apiText, apiBlob, uploadUrl } from '@/core/auth/api';

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
export interface Me { business: Business | null; subscription: Subscription; requisites?: Requisites | null; payOrigin?: string; role?: 'owner' | StaffRole | null; roleLabel?: string; invites?: { id: string; role: string; roleLabel: string; business: string }[] }
export interface Qr {
  id: string; publicId: string; kind: 'pay' | 'permanent' | 'tip' | 'order' | 'invoice'; title: string; description: string; amountRub: number | null; currency: string; orderNo: string;
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
  provider?: boolean;
  tip?: { recipient: string; message?: string; amounts: number[]; allowCustom: boolean; photoUrl: string | null };
  lines?: { title: string; variant?: string; qty: number; priceRub: number; discountRub?: number }[]; number?: number; discountRub?: number;
}
export const pubPage = async (pid: string): Promise<{ ok: true; data: PublicPage } | { ok: false; error: string }> => {
  try {
    const r = await fetch(uploadUrl(`/api/kbiz/public/p/${encodeURIComponent(pid)}`));
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: d } : { ok: false, error: d.error ?? 'error' };
  } catch { return { ok: false, error: 'network' }; }
};
export const pubReport = async (pid: string, b: { amountRub?: number; note?: string; website?: string }) => {
  try {
    const r = await fetch(uploadUrl(`/api/kbiz/public/p/${encodeURIComponent(pid)}/report`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true as const, data: d as { id: string; statusKey: string; statusLabel: string } } : { ok: false as const, error: String(d.error ?? 'error') };
  } catch { return { ok: false as const, error: 'network' }; }
};
export const pubStatus = async (id: string, key: string) => {
  try {
    const r = await fetch(uploadUrl(`/api/kbiz/public/status/${encodeURIComponent(id)}?k=${encodeURIComponent(key)}`));
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true as const, data: d as { status: string; statusLabel: string; note: string } } : { ok: false as const, error: String(d.error ?? 'error') };
  } catch { return { ok: false as const, error: 'network' }; }
};

/* ── Этап 2: каталог, витрина, заказы, чаевые, счета ── */
export interface Variant { name: string; priceRub?: number }
export interface Item { id: string; title: string; description: string; priceRub: number; category: string; sku: string; variants: Variant[]; leadTime: string; available: boolean; kind?: 'product' | 'service'; stock?: number | null; photoUrl: string | null }
export interface OrderLine { itemId: string; title: string; variant: string; qty: number; priceRub: number }
export interface Order {
  id: string; number: number; lines: OrderLine[]; totalRub: number; contact: { name?: string; phone?: string; email?: string; address?: string }; note: string; status: string; statusLabel: string;
  ownerComment: string; promoCode?: string; discountRub?: number; subtotalRub?: number; createdAt: string; payUrl: string | null; payExpired: boolean; paymentStatus: string | null;
}
export interface Shop { slug: string | null; enabled: boolean; origins: string[]; notice: string; url: string | null; apiBase: string }
export interface Tip { id: string; publicId: string; title: string; status: string; recipient: string; message?: string; amounts: number[]; allowCustom: boolean; min: number; max: number; url: string; opens: number; requests: number; confirmed: number; confirmedSumRub: number }
export interface TipStats { requests: number; confirmed: number; confirmedSumRub: number; averageRub: number; byDay: { day: string; requests: number; confirmedSumRub: number }[] }
export interface InvLine { title: string; qty: number; priceRub: number; discountRub?: number }
export interface Invoice { id: string; number: number; lines: InvLine[]; subtotalRub: number; discountRub: number; totalRub: number; dueAt: string | null; orderNo: string; comment: string; status: string; statusLabel: string; url: string | null; createdAt: string }

export const kbItems = () => req<{ items: Item[] }>('/api/kbiz/items');
export const kbItemSave = (id: string | null, b: unknown) => (id ? send<{ id: string }>('PUT', `/api/kbiz/items/${id}`, b) : send<{ id: string }>('POST', '/api/kbiz/items', b));
export const kbItemDelete = (id: string) => req<unknown>(`/api/kbiz/items/${id}`, { method: 'DELETE' });
export const kbItemPhoto = (id: string, dataUrl: string) => send<{ photoUrl: string }>('PUT', `/api/kbiz/items/${id}/photo`, { dataUrl });
export const kbShop = () => req<{ shop: Shop | null }>('/api/kbiz/shop');
export const kbShopSave = (b: unknown) => send<unknown>('PUT', '/api/kbiz/shop', b);
export const kbShopPackage = async (api?: string): Promise<Blob | null> => {
  const r = await apiBlob(`/api/kbiz/shop/package.tar.gz${api ? `?api=${encodeURIComponent(api)}` : ''}`);
  return r.ok ? r.blob : null;
};
export const kbOrders = (status?: string) => req<{ orders: Order[] }>(`/api/kbiz/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const kbOrderAct = (id: string, action: string, comment?: string) => send<{ status: string }>('POST', `/api/kbiz/orders/${id}/${action}`, { comment });
export const kbOrderRenewPay = (id: string) => send<{ payUrl: string }>('POST', `/api/kbiz/orders/${id}/renew-pay`);
export const kbOrderInvoice = (id: string) => send<{ id: string; number: number }>('POST', `/api/kbiz/orders/${id}/invoice`);
export const kbTips = () => req<{ tips: Tip[]; stats: TipStats | null }>('/api/kbiz/tips');
export const kbTipCreate = (b: unknown) => send<{ id: string }>('POST', '/api/kbiz/tips', b);
export const kbInvoices = () => req<{ invoices: Invoice[] }>('/api/kbiz/invoices');
export const kbInvoiceSave = (id: string | null, b: unknown) => (id ? send<unknown>('PUT', `/api/kbiz/invoices/${id}`, b) : send<{ id: string; number: number }>('POST', '/api/kbiz/invoices', b));
export const kbInvoiceSend = (id: string) => send<{ url: string }>('POST', `/api/kbiz/invoices/${id}/send`);
export const kbInvoiceCancel = (id: string) => send<unknown>('POST', `/api/kbiz/invoices/${id}/cancel`);

/* ── Этап 3: сотрудники, касса, промокоды, отзывы, аналитика ── */
export type StaffRole = 'admin' | 'manager' | 'cashier';
export interface StaffMember { id: string; name: string; username: string; role: StaffRole; roleLabel: string; status: 'invited' | 'active'; createdAt: string }
export interface Invite { id: string; role: StaffRole; roleLabel: string; business: string }
export interface Promo { id: string; code: string; kind: 'percent' | 'fixed'; value: number; minOrderRub: number; maxUses: number | null; used: number; startsAt: string | null; expiresAt: string | null; status: 'active' | 'paused'; createdAt: string }
export interface Review { id: string; rating: number; text: string; author: string; reply: string; status: 'published' | 'hidden'; createdAt: string; orderNo: number }
export interface CashItem { id: string; publicId: string; amountRub: number; status: string; createdAt: string; url: string }
export interface Analytics {
  days: number; requests: number; confirmed: number; claimedSumRub: number; confirmedSumRub: number; averageRub: number; notFound: number; refunded: number; opens: number; conversionPercent: number | null;
  byDay: { day: string; requests: number; confirmedSumRub: number }[]; byKind: { kind: string; requests: number; confirmed: number; confirmedSumRub: number }[];
  topItems: { title: string; qty: number; sumRub: number }[]; orders: { total: number; done: number; lost: number; discountsRub: number }; reviews: { count: number; average: number };
}
export const kbStaff = () => req<{ staff: StaffMember[] }>('/api/kbiz/staff');
export const kbStaffInvite = (username: string, role: StaffRole) => send<{ id: string }>('POST', '/api/kbiz/staff', { username, role });
export const kbStaffRole = (id: string, role: StaffRole) => send<unknown>('POST', `/api/kbiz/staff/${id}/role`, { role });
export const kbStaffRemove = (id: string) => req<unknown>(`/api/kbiz/staff/${id}`, { method: 'DELETE' });
export const kbInviteAnswer = (id: string, accept: boolean) => send<unknown>('POST', `/api/kbiz/staff/${id}/${accept ? 'accept' : 'decline'}`);
export const kbCashCreate = (amountRub: number, note?: string) => send<{ id: string; publicId: string; url: string; amountRub: number; expiresInSec: number }>('POST', '/api/kbiz/cash', { amountRub, note });
export const kbCashStatus = (id: string) => req<{ status: string; amountRub: number | null }>(`/api/kbiz/cash/${id}`);
export const kbCashRecent = () => req<{ items: CashItem[] }>('/api/kbiz/cash');
export const kbPromos = () => req<{ promos: Promo[] }>('/api/kbiz/promos');
export const kbPromoCreate = (b: unknown) => send<{ id: string }>('POST', '/api/kbiz/promos', b);
export const kbPromoStatus = (id: string, status: string) => send<unknown>('POST', `/api/kbiz/promos/${id}/status`, { status });
export const kbReviews = () => req<{ reviews: Review[] }>('/api/kbiz/reviews');
export const kbReviewAct = (id: string, b: { status?: string; reply?: string }) => send<unknown>('POST', `/api/kbiz/reviews/${id}`, b);
export const kbAnalytics = (days: number) => req<{ analytics: Analytics | null }>(`/api/kbiz/analytics?days=${days}`);

export interface Provider { kind: string; title: string; host: string; merchant: string; enabled: boolean; hasSecret: boolean; lastOkAt: string | null; lastError: string | null; updatedAt: string; webhookPath: string }
export const kbProvider = () => req<{ provider: Provider | null }>('/api/kbiz/provider');
export const kbProviderSave = (b: unknown) => send<unknown>('PUT', '/api/kbiz/provider', b);
export const kbProviderPing = () => send<unknown>('POST', '/api/kbiz/provider/ping');
export const kbProviderRemove = (twoFactorCode?: string) => req<unknown>('/api/kbiz/provider', { method: 'DELETE', body: JSON.stringify({ twoFactorCode }) });
export const pubProviderPay = async (pid: string, b: { amountRub?: number; note?: string; website?: string }) => {
  try {
    const r = await fetch(uploadUrl(`/api/kbiz/public/p/${encodeURIComponent(pid)}/provider`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.url ? { ok: true as const, data: d as { id: string; statusKey: string; url: string } } : { ok: false as const, error: String(d.error ?? 'error') };
  } catch { return { ok: false as const, error: 'network' }; }
};
/* Администрация Sky */
export interface AdminBiz { id: string; name: string; owner: string; status: string; mode: string; legalType: string; createdAt: string; subUntil: string | null; requests: number; confirmedSumRub: number; staff: number; hasProvider: boolean; suspendedReason?: string }
export interface AdminCard {
  business: AdminBiz & { category: string; country: string; description: string; shopSlug?: string; shopEnabled: boolean; suspendedAt: string | null };
  subscription: Subscription; provider: { host: string; enabled: boolean; lastOkAt: string | null; lastError: string | null } | null; payments: { by_provider: number; by_owner: number; not_found: number };
  audit: { actor: string; action: string; detail: string; at: string }[];
}
export const kbAdminList = (q: string, status: string) => req<{ businesses: AdminBiz[] }>(`/api/admin/kbiz?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`);
export const kbAdminCard = (id: string) => req<AdminCard>(`/api/admin/kbiz/${id}`);
export const kbAdminAct = (id: string, action: 'suspend' | 'resume', reason: string) => send<unknown>('POST', `/api/admin/kbiz/${id}/${action}`, { reason });
