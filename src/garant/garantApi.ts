/* ===============================================================
   SKY GARANT — разговор с сервером.

   Ни одна проверка отсюда не заменяет серверную: этот файл живёт в
   браузере. Статус сделки, цена, эскроу и решение спора решает только
   сервер (server/garant.mjs) — здесь только вызовы.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type DealStatus =
  | 'pending_seller' | 'pending_buyer' | 'in_escrow' | 'completed' | 'cancelled' | 'disputed';
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
