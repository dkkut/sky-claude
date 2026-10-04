/* ===============================================================
   KUTRENT MARKET — вкладка в Sky Admin Panel. Только просмотр:
   пользователи и заказы market.kutrent.online. Единственное действие,
   которое меняет баланс (подтвердить оплату вручную, пока не
   подключена настоящая касса), идёт не отсюда, а через WS 'admin'
   action 'kutrent-mark-paid' (см. AdminPanel.tsx, KutrentMarkPaidForm)
   — тот же путь второго ключа, что у любого другого начисления денег.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export interface KutrentMarketUser {
  id: string;
  profileId: string;
  skyId: string;
  authenticator: string;
  status: 'active' | 'suspended';
  username: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export type KutrentOrderStatus = 'pending' | 'paid' | 'rejected' | 'cancelled';

export interface KutrentMarketOrder {
  id: string;
  kind: string;
  amount: number;
  status: KutrentOrderStatus;
  createdAt: string;
  paidAt: string | null;
  senderPhone?: string | null;
  proofSubmittedAt?: string | null;
  username?: string;
  authenticator?: string;
  skyId?: string;
}

export interface KutrentMarketUserDetail extends KutrentMarketUser {
  orders: KutrentMarketOrder[];
}

export interface KutrentMarketRequisites {
  accountNumber: string;
  bankName: string;
  bik: string;
  bankInn: string;
  bankKpp: string;
  corrAccount: string;
  recipientName: string;
  updatedAt: string | null;
}

const enc = (s: string) => encodeURIComponent(s);

export const apiAdminListKutrentUsers = (q?: string, limit?: number) => {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (limit) qs.set('limit', String(limit));
  const s = qs.toString();
  return apiCall<{ users: KutrentMarketUser[] }>(`/api/kutrent-market/admin/users${s ? `?${s}` : ''}`);
};

export const apiAdminKutrentUserDetail = (id: string) =>
  apiCall<{ user: KutrentMarketUserDetail }>(`/api/kutrent-market/admin/users/${enc(id)}`);

export const apiAdminSetKutrentUserStatus = (id: string, status: 'active' | 'suspended') =>
  apiCall<{ status: string }>(`/api/kutrent-market/admin/users/${enc(id)}/status`, {
    method: 'POST', body: JSON.stringify({ status }),
  });

export const apiAdminListKutrentOrders = (params: { status?: string; q?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  const s = qs.toString();
  return apiCall<{ orders: KutrentMarketOrder[] }>(`/api/kutrent-market/admin/orders${s ? `?${s}` : ''}`);
};

/* Реквизиты расчётного счёта — смотреть может любой с правом
   'kutrent_market', менять только владелец (сервер сам это проверяет,
   второе подтверждение личности — stepUpCode). */
export const apiAdminGetKutrentRequisites = () =>
  apiCall<{ requisites: KutrentMarketRequisites | null }>('/api/kutrent-market/admin/requisites');

export const apiAdminSetKutrentRequisites = (
  fields: Omit<KutrentMarketRequisites, 'updatedAt'>, stepUpCode: string,
) => apiCall<{ requisites: KutrentMarketRequisites }>('/api/kutrent-market/admin/requisites', {
  method: 'POST', body: JSON.stringify({ ...fields, stepUpCode }),
});
