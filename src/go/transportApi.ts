/** Sky GO → «Для транспорта»: клиент API (/api/go/transport/*, владелец — /api/kbiz/transport/*). Цены, статусы и права решает сервер. */
import { apiCall } from '@/core/auth/api';

export interface TrFuel { fuel: string; name: string; priceRub: number; available: boolean; updatedAt: string; stale: boolean }
export interface TrPromo { id: string; title: string; body: string; startsOn: string | null; endsOn: string | null; active: boolean }
export interface TrInfo { transport: boolean; categoryId: string | null; features: { id: string; name: string }[]; fuel: TrFuel[]; promos: TrPromo[]; apps: { key: 'fuel' | 'parking'; title: string }[] }
export interface TrWork {
  id: string; placeId: string; placeName: string; title: string; vehicle: { plate: string; model: string }; status: string; statusLabel: string; priceRub: number | null; paidRub: number;
  payStatus: string; payLabel: string; payUrl: string | null; note: string; createdAt: string; updatedAt: string; events: { status: string; label: string; comment: string; at: string }[];
  actions: string[]; buyer?: { id: string; name: string; username: string };
}
export const WORK_LABEL: Record<string, string> = { accepted: 'Принят', diagnostics: 'Диагностика', awaiting_approval: 'Согласование', in_work: 'В работе', ready: 'Готов к выдаче', issued: 'Выдан', cancelled: 'Отменён' };
const b = (x: unknown) => JSON.stringify(x ?? {});
export const tr = {
  info: (id: string) => apiCall<TrInfo>(`/api/go/transport/info/${id}`),
  myWork: () => apiCall<{ orders: TrWork[] }>('/api/go/transport/work'),
  buyerStatus: (id: string, to: string, comment = '') => apiCall(`/api/go/transport/work/${id}/status`, { method: 'POST', body: b({ to, comment }) }),
};
export const trOwner = {
  catalog: () => apiCall<{ features: Record<string, string>; fuels: Record<string, string> }>('/api/kbiz/transport/catalog'),
  fuel: () => apiCall<{ fuels: Record<string, string>; prices: { fuel: string; priceRub: number; available: boolean; updatedAt: string }[] }>('/api/kbiz/transport/fuel'),
  setFuel: (prices: { fuel: string; priceRub: number; available: boolean }[]) => apiCall('/api/kbiz/transport/fuel', { method: 'PUT', body: b({ prices }) }),
  setFeatures: (features: string[]) => apiCall<{ features: string[] }>('/api/kbiz/transport/features', { method: 'PUT', body: b({ features }) }),
  promos: () => apiCall<{ promos: TrPromo[] }>('/api/kbiz/transport/promos'),
  addPromo: (p: Partial<TrPromo>) => apiCall('/api/kbiz/transport/promos', { method: 'POST', body: b(p) }),
  delPromo: (id: string) => apiCall(`/api/kbiz/transport/promos/${id}`, { method: 'DELETE' }),
  work: (status = 'open') => apiCall<{ orders: TrWork[] }>(`/api/kbiz/transport/work?status=${status}`),
  createWork: (x: { title: string; username: string; plate?: string; model?: string; priceRub?: number | null; note?: string }) => apiCall<{ id: string }>('/api/kbiz/transport/work', { method: 'POST', body: b(x) }),
  status: (id: string, to: string, comment = '', priceRub?: number) => apiCall(`/api/kbiz/transport/work/${id}/status`, { method: 'POST', body: b({ to, comment, priceRub }) }),
  pay: (id: string, kind: 'prepay' | 'full', amountRub?: number) => apiCall<{ payUrl: string; amountRub: number }>(`/api/kbiz/transport/work/${id}/pay`, { method: 'POST', body: b({ kind, amountRub }) }),
  stats: () => apiCall<{ byStatus: Record<string, number>; paidRub: number; ordersMonth: number; fuelUpdatedAt: string | null; activePromos: number }>('/api/kbiz/transport/stats'),
};
