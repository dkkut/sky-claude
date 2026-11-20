/** Sky GO → «Билеты на проезд»: клиент API (/api/go/transit/*, перевозчик — /api/kbiz/transit/*). Цены, сроки и проверку решает сервер. */
import { apiCall } from '@/core/auth/api';

export interface TProduct { id: string; name: string; description: string; kind: 'single' | 'multi' | 'period'; kindLabel: string; rides: number | null; validDays: number; priceRub: number; active: boolean }
export interface TOperator { id: string; name: string; city: string; address: string; canSell: boolean; products: TProduct[] }
export interface TTicket {
  id: string; operator: string; operatorId: string; name: string; kind: string; kindLabel: string; status: string; statusLabel: string; ridesLeft: number | null; ridesTotal: number | null; priceRub: number;
  validFrom: string | null; validUntil: string | null; payUrl: string | null; note: string; createdAt: string; canRefund: boolean;
}
export interface TValidation { ok?: boolean; result?: 'valid' | 'recent'; name?: string; ridesLeft?: number | null; validUntil?: string; minutesAgo?: number }
const b = (x: unknown) => JSON.stringify(x ?? {});
export const transit = {
  catalog: (city = '') => apiCall<{ operators: TOperator[] }>(`/api/go/transit/catalog${city ? `?city=${encodeURIComponent(city)}` : ''}`),
  tickets: () => apiCall<{ tickets: TTicket[] }>('/api/go/transit/tickets'),
  buy: (productId: string) => apiCall<{ id: string; payUrl: string; priceRub: number; duplicate?: boolean }>('/api/go/transit/buy', { method: 'POST', body: b({ productId, idemKey: crypto.randomUUID() }) }),
  token: (id: string) => apiCall<{ token: string; refreshSec: number }>(`/api/go/transit/tickets/${id}/token`),
  cancel: (id: string) => apiCall(`/api/go/transit/tickets/${id}/cancel`, { method: 'POST', body: b({}) }),
  refund: (id: string) => apiCall(`/api/go/transit/tickets/${id}/refund`, { method: 'POST', body: b({}) }),
};
export const transitOwner = {
  products: () => apiCall<{ products: TProduct[] }>('/api/kbiz/transit/products'),
  saveProduct: (id: string | null, p: Partial<TProduct>) => apiCall(id ? `/api/kbiz/transit/products/${id}` : '/api/kbiz/transit/products', { method: id ? 'PUT' : 'POST', body: b(p) }),
  tickets: (status = '') => apiCall<{ tickets: TTicket[] }>(`/api/kbiz/transit/tickets${status ? `?status=${status}` : ''}`),
  stats: () => apiCall<{ byStatus: Record<string, number>; validations30d: { ok: number; recent: number; rejected: number }; soldRub: number }>('/api/kbiz/transit/stats'),
  validate: (token: string) => apiCall<TValidation>('/api/kbiz/transit/validate', { method: 'POST', body: b({ token }) }),
  refund: (id: string, approve: boolean, comment = '') => apiCall(`/api/kbiz/transit/tickets/${id}/refund`, { method: 'POST', body: b({ approve, comment }) }),
};
export const TRANSIT_ERR: Record<string, string> = {
  bad_token: 'QR устарел или не принадлежит Sky. Попросите обновить билет на экране.', used: 'Билет уже использован.', expired: 'Срок билета истёк.', not_active: 'Билет не действует.', not_found: 'Это билет другого перевозчика или его нет.',
  sales_unavailable: 'Перевозчик сейчас не продаёт билеты онлайн.', own_operator: 'Нельзя купить билет у своей организации.', too_many_pending: 'Слишком много неоплаченных билетов — оплатите или отмените их.', refund_not_allowed: 'Вернуть можно только неиспользованный действующий билет.',
  not_transit: 'Раздел доступен организациям категории «Пассажирский транспорт».',
};
export const transitErr = (r: { error?: string }) => TRANSIT_ERR[r.error ?? ''] ?? 'Не получилось. Попробуйте ещё раз.';
