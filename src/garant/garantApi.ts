/* ===============================================================
   SKY GARANT — разговор с сервером.

   Ни одна проверка отсюда не заменяет серверную: этот файл живёт в
   браузере. Статус сделки, цена, эскроу и решение спора решает только
   сервер (server/garant.mjs) — здесь только вызовы.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type DealStatus =
  | 'pending_seller' | 'pending_buyer' | 'in_escrow' | 'completed' | 'cancelled' | 'disputed'
  | 'awaiting_data' | 'confirming' | 'verifying' | 'paid';
/** classic — прежняя сделка; sale — сделка с проверкой данных; exchange — обмен (server/garantverify.mjs). */
export type DealFlow = 'classic' | 'sale' | 'exchange';
export type ItemType = 'skin' | 'gift' | 'nft' | 'currency' | 'item' | 'other';
export type PayType = 'rubles' | 'points';
export type DisputeResult = 'seller_wins' | 'buyer_wins' | 'cancelled';

export interface GarantDeal {
  id: string;
  title: string;
  description: string;
  sellerId: string;
  sellerName?: string;
  sellerUsername?: string;
  buyerId: string;
  buyerName?: string;
  buyerUsername?: string;
  itemType: ItemType;
  itemName: string;
  price: number;
  payType: PayType;
  status: DealStatus;
  flow?: DealFlow;
  counterItemName?: string;
  sellerData?: 'none' | 'submitted' | 'confirmed';
  buyerData?: 'none' | 'submitted' | 'confirmed';
  sellerApproved?: boolean;
  buyerApproved?: boolean;
  sellerDeposited: boolean;
  buyerDeposited: boolean;
  sellerConfirmed: boolean;
  buyerConfirmed: boolean;
  createdAt?: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  disputeReason?: string;
  disputeOpenedBy?: string;
  disputeAt?: string;
  disputeResult?: DisputeResult;
  disputeNote?: string;
}

export interface GarantStatus {
  monthlyUsed: number;
  monthlyLimit: number;
  hasSubscription: boolean;
  subscriptionUntil: string | null;
}

export interface GarantNotification {
  id: string;
  dealId: string | null;
  kind: string;
  text: string;
  read: boolean;
  createdAt?: string;
}

const enc = encodeURIComponent;
const post = <T>(path: string, body: unknown = {}) => apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const apiMyGarantStatus = () => apiCall<{ data: GarantStatus }>('/api/garant/me/status');
export const apiMyDeals = () => apiCall<{ deals: GarantDeal[] }>('/api/garant/deals');

export interface CreateDealParams {
  buyerId: string;
  itemType: ItemType;
  itemName: string;
  title?: string;
  description?: string;
  price: number;
  payType: PayType;
}
export const apiCreateDeal = (params: CreateDealParams) => post<{ deal: GarantDeal }>('/api/garant/deals', params);

export const apiDepositSeller = (dealId: string) => post<{ deal: GarantDeal }>(`/api/garant/deals/${enc(dealId)}/deposit-seller`);
export const apiDepositBuyer = (dealId: string) => post<{ deal: GarantDeal }>(`/api/garant/deals/${enc(dealId)}/deposit-buyer`);
export const apiConfirmBuyer = (dealId: string) => post<{ deal: GarantDeal }>(`/api/garant/deals/${enc(dealId)}/confirm-buyer`);
export const apiConfirmSeller = (dealId: string) => post<{ deal: GarantDeal }>(`/api/garant/deals/${enc(dealId)}/confirm-seller`);
export const apiCancelDeal = (dealId: string) => post<{ deal: GarantDeal }>(`/api/garant/deals/${enc(dealId)}/cancel`);
export const apiOpenDispute = (dealId: string, reason: string) =>
  post<{ deal: GarantDeal }>(`/api/garant/deals/${enc(dealId)}/dispute`, { reason });

/* Цена подписки показана из того же значения, что и на сервере
   (server/garant.mjs::GARANT_PRO_PLAN) один в один, но решает и списывает
   только сервер — присланная отсюда цена ни на что не влияет. */
export const GARANT_PRO_PRICE = 159;
export const GARANT_PRO_DAYS = 30;
export const apiSubscribe = () => post<{ until: string; balance: number }>('/api/garant/subscribe');

export const apiGarantNotifications = () => apiCall<{ items: GarantNotification[] }>('/api/garant/notifications');
export const apiReadGarantNotification = (id: string) => post<{ ok: boolean }>('/api/garant/notifications/read', { id });

/* ─── Админка ─────────────────────────────────────────────────────── */

export const apiAdminListDeals = (params: { status?: string; q?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  const s = qs.toString();
  return apiCall<{ items: GarantDeal[] }>(`/api/garant/admin/deals${s ? `?${s}` : ''}`);
};

export interface GarantLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  detail: unknown;
  createdAt?: string;
}
export const apiAdminDealDetail = (dealId: string) =>
  apiCall<{ deal: GarantDeal; log: GarantLogEntry[] }>(`/api/garant/admin/deals/${enc(dealId)}`);

export const apiAdminResolveDispute = (dealId: string, winner: DisputeResult, note: string) =>
  post<{ deal: GarantDeal }>(`/api/garant/admin/deals/${enc(dealId)}/resolve`, { winner, note });

export const apiAdminForceConfirm = (dealId: string, side: 'buyer' | 'seller') =>
  post<{ deal: GarantDeal }>(`/api/garant/admin/deals/${enc(dealId)}/force-confirm`, { side });

export const apiAdminForceCancel = (dealId: string) =>
  post<{ deal: GarantDeal }>(`/api/garant/admin/deals/${enc(dealId)}/force-cancel`);

/* ─── Сделка с проверкой данных и обмен ─────────────────────── */
export interface DataField { label: string; value: string }
export interface DealData { fields?: DataField[]; note?: string; submittedAt: string; confirmed: boolean }
export interface DealDataView { role: 'seller' | 'buyer'; status: DealStatus; mine: DealData | null; theirs: DealData | null; canSeeTheirs: boolean }
export interface CreateVerifiedParams { flow: 'sale' | 'exchange'; counterpartyId: string; itemType: ItemType; itemName: string; counterItemName?: string; title?: string; description?: string; price?: number; payType?: PayType }
export const apiCreateVerifiedDeal = (p: CreateVerifiedParams) => post<{ deal: GarantDeal }>('/api/garant/verify', p);
const dp = (id: string, tail: string) => `/api/garant/deals/${enc(id)}${tail}`;
export const apiDealData = (id: string) => apiCall<DealDataView>(dp(id, '/data'));
export const apiSubmitDealData = (id: string, body: { fields: DataField[]; note?: string; confirmed?: boolean }) => post<{ deal: GarantDeal }>(dp(id, '/data'), body);
export const apiConfirmOwnData = (id: string) => post<{ deal: GarantDeal }>(dp(id, '/confirm-data'));
export const apiApproveData = (id: string) => post<{ deal: GarantDeal }>(dp(id, '/approve'));
export const apiPayVerified = (id: string) => post<{ deal: GarantDeal }>(dp(id, '/pay'));
export const apiCloseVerified = (id: string) => post<{ deal: GarantDeal }>(dp(id, '/close'));
export const apiCancelVerified = (id: string) => post<{ deal: GarantDeal }>(dp(id, '/v-cancel'));
export const apiVerifyDispute = (id: string, reason: string) => post<{ deal: GarantDeal }>(dp(id, '/v-dispute'), { reason });
export const apiAdminDealData = (id: string) => apiCall<{ seller: DealData | null; buyer: DealData | null; views: { actorId: string; at: string | null }[] }>(`/api/garant/admin/deals/${enc(id)}/data`);
export const apiAdminResolveVerify = (id: string, outcome: 'resume' | 'cancel', note: string) => post<{ deal: GarantDeal }>(`/api/garant/admin/deals/${enc(id)}/resolve-verify`, { outcome, note });
