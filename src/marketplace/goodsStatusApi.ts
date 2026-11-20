/** Статус товара в заказе: разговор с сервером (server/goodsstatus.mjs). */
import { apiCall } from '@/core/auth/api';

export type StatusSource = 'seller' | 'staff' | 'tracking' | 'shipment';

export interface GoodsStatus {
  orderId: string;
  orderStatus: string;
  title: string;
  deliveryMethod: string | null;
  role: 'buyer' | 'seller' | 'staff' | 'support';
  current: { place: string; text: string; source: StatusSource; at: string } | null;
  eta: { from: string | null; to: string | null; source: StatusSource } | null;
  manual: { place: string; note: string; eta: string | null; etaTo: string | null; setRole: 'seller' | 'staff'; updatedAt: string } | null;
  parcel: { status: string; statusText: string; carrierName: string; events: { time: string; text: string; location?: string }[] } | null;
  tracking: { provider: string; providerTitle: string; number: string; url: string | null } | null;
  parcelError: string | null;
  history: { role: string; place: string; note: string; eta: string | null; etaTo: string | null; at: string }[];
  canEdit: boolean;
  verified: boolean;
}
export interface QueueItem { id: string; title: string; status: string; place: string; eta: string | null; updatedAt: string | null }
export interface StaffPerson { id: string; username: string; name: string; since: string }

const B = '/api/market/goods-status';
export const apiGoodsStatus = (orderId: string) => apiCall<GoodsStatus>(`${B}/${encodeURIComponent(orderId)}`);
export const apiSetGoodsStatus = (orderId: string, body: { place: string; note?: string; eta?: string | null; etaTo?: string | null }) =>
  apiCall<{ ok: boolean }>(`${B}/${encodeURIComponent(orderId)}`, { method: 'PUT', body: JSON.stringify(body) });
export const apiClearGoodsStatus = (orderId: string) =>
  apiCall<{ ok: boolean }>(`${B}/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
export const apiGoodsQueue = () => apiCall<{ orders: QueueItem[] }>(`${B}/queue`);
export const apiGoodsStaff = () => apiCall<{ staff: StaffPerson[]; max: number }>(`${B}/staff`);
export const apiAddGoodsStaff = (username: string) =>
  apiCall<{ ok: boolean }>(`${B}/staff`, { method: 'POST', body: JSON.stringify({ username }) });
export const apiRemoveGoodsStaff = (id: string) =>
  apiCall<{ ok: boolean }>(`${B}/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
